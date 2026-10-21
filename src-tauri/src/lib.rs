use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::Emitter;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CliFileToOpen {
    pub name: String,
    pub rel_path: String,
    pub fs_path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CliLaunchPayload {
    pub workspace_path: Option<String>,
    pub files: Vec<CliFileToOpen>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitFileItem {
    pub path: String,
    pub status: String, // "modified" | "untracked" | "added" | "deleted"
    pub staged: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitCommitItem {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitSyncStatus {
    pub has_remote: bool,
    pub remote_name: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FsEntryItem {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileMetadataResult {
    pub mtime_ms: u64,
    pub size: u64,
}

fn expand_path(p: &str) -> String {
    if p.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{}{}", home, &p[1..]);
        }
    } else if p == "~" {
        if let Ok(home) = std::env::var("HOME") {
            return home;
        }
    }
    p.to_string()
}

#[tauri::command]
fn get_git_branch(repo_path: String) -> Result<String, String> {
    let clean_repo = expand_path(&repo_path);
    let output = Command::new("git")
        .args(["-C", &clean_repo, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
fn get_git_status(repo_path: String) -> Result<Vec<GitFileItem>, String> {
    let clean_repo = expand_path(&repo_path);
    let output = Command::new("git")
        .args(["-C", &clean_repo, "status", "--porcelain=v1", "-unormal"])
        .output()
        .map_err(|e| format!("Failed to execute git status: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut items = Vec::new();

    for line in text.lines() {
        if line.len() < 3 {
            continue;
        }
        let index_status = line.chars().nth(0).unwrap_or(' ');
        let worktree_status = line.chars().nth(1).unwrap_or(' ');
        let raw_file_path = line[3..].trim();
        // Remove surrounding quotes if git output contains them
        let file_path = raw_file_path.trim_matches('"').to_string();

        let status = if index_status == '?' && worktree_status == '?' {
            "untracked".to_string()
        } else if index_status == 'A' || worktree_status == 'A' {
            "added".to_string()
        } else if index_status == 'D' || worktree_status == 'D' {
            "deleted".to_string()
        } else {
            "modified".to_string()
        };

        let staged = index_status != ' ' && index_status != '?';

        items.push(GitFileItem {
            path: file_path,
            status,
            staged,
        });
    }

    Ok(items)
}

#[tauri::command]
fn get_git_diff_baseline(repo_path: String, file_path: String) -> Result<String, String> {
    let clean_repo = expand_path(&repo_path);
    let clean_file = file_path.trim_start_matches('/');
    let git_spec = format!("HEAD:{}", clean_file);
    let output = Command::new("git")
        .args(["-C", &clean_repo, "show", &git_spec])
        .output()
        .map_err(|e| format!("Failed to execute git show: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        // If file is untracked or not in HEAD, baseline is empty string
        Ok(String::new())
    }
}

#[tauri::command]
fn revert_git_file(repo_path: String, file_path: String) -> Result<String, String> {
    let clean_repo = expand_path(&repo_path);
    let clean_file = file_path.trim_start_matches('/');
    let output = Command::new("git")
        .args(["-C", &clean_repo, "checkout", "HEAD", "--", clean_file])
        .output()
        .map_err(|e| format!("Failed to revert file: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    // Read the reverted content
    let full_path = Path::new(&clean_repo).join(clean_file);
    let bytes = fs::read(&full_path).map_err(|e| format!("Failed to read reverted file: {}", e))?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
fn get_git_commits(repo_path: String, limit: Option<usize>) -> Result<Vec<GitCommitItem>, String> {
    let clean_repo = expand_path(&repo_path);
    let max_count = limit.unwrap_or(15).to_string();
    let output = Command::new("git")
        .args([
            "-C",
            &clean_repo,
            "log",
            "-n",
            &max_count,
            "--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%s%x1e",
        ])
        .output()
        .map_err(|e| format!("Failed to execute git log: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut commits = Vec::new();

    for record in text.split('\x1e') {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }
        let parts: Vec<&str> = record.split('\x1f').collect();
        if parts.len() >= 5 {
            commits.push(GitCommitItem {
                hash: parts[0].to_string(),
                short_hash: parts[1].to_string(),
                author: parts[2].to_string(),
                date: parts[3].to_string(),
                message: parts[4].to_string(),
            });
        }
    }

    Ok(commits)
}

#[tauri::command]
fn create_git_commit(repo_path: String, message: String) -> Result<String, String> {
    let clean_repo = expand_path(&repo_path);
    let trimmed_msg = message.trim();
    if trimmed_msg.is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }

    // Stage all changes (new files, modified, deleted) adhering to .gitignore
    let add_output = Command::new("git")
        .args(["-C", &clean_repo, "add", "-A"])
        .output()
        .map_err(|e| format!("Failed to execute git add: {}", e))?;

    if !add_output.status.success() {
        return Err(String::from_utf8_lossy(&add_output.stderr).to_string());
    }

    // Create commit
    let commit_output = Command::new("git")
        .args(["-C", &clean_repo, "commit", "-m", trimmed_msg])
        .output()
        .map_err(|e| format!("Failed to execute git commit: {}", e))?;

    if !commit_output.status.success() {
        return Err(String::from_utf8_lossy(&commit_output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&commit_output.stdout).trim().to_string())
}

#[tauri::command]
fn get_git_sync_status(repo_path: String) -> Result<GitSyncStatus, String> {
    let clean_repo = expand_path(&repo_path);

    let remotes_output = Command::new("git")
        .args(["-C", &clean_repo, "remote"])
        .output()
        .map_err(|e| format!("Failed to execute git remote: {}", e))?;

    if !remotes_output.status.success() {
        return Ok(GitSyncStatus {
            has_remote: false,
            remote_name: None,
            upstream: None,
            ahead: 0,
            behind: 0,
        });
    }

    let remotes_str = String::from_utf8_lossy(&remotes_output.stdout);
    let remotes: Vec<&str> = remotes_str.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();

    if remotes.is_empty() {
        return Ok(GitSyncStatus {
            has_remote: false,
            remote_name: None,
            upstream: None,
            ahead: 0,
            behind: 0,
        });
    }

    let remote_name = remotes[0].to_string();

    let upstream_output = Command::new("git")
        .args(["-C", &clean_repo, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .output();

    let mut upstream: Option<String> = None;
    let mut ahead: u32 = 0;
    let mut behind: u32 = 0;

    if let Ok(out) = upstream_output {
        if out.status.success() {
            let up = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !up.is_empty() {
                upstream = Some(up.clone());
                let rev_list = Command::new("git")
                    .args(["-C", &clean_repo, "rev-list", "--left-right", "--count", "@{u}...HEAD"])
                    .output();
                if let Ok(rl_out) = rev_list {
                    if rl_out.status.success() {
                        let rl_str = String::from_utf8_lossy(&rl_out.stdout);
                        let counts: Vec<&str> = rl_str.split_whitespace().collect();
                        if counts.len() >= 2 {
                            behind = counts[0].parse::<u32>().unwrap_or(0);
                            ahead = counts[1].parse::<u32>().unwrap_or(0);
                        }
                    }
                }
            }
        }
    }

    if upstream.is_none() {
        let branch_output = Command::new("git")
            .args(["-C", &clean_repo, "rev-parse", "--abbrev-ref", "HEAD"])
            .output();
        if let Ok(b_out) = branch_output {
            if b_out.status.success() {
                let current_branch = String::from_utf8_lossy(&b_out.stdout).trim().to_string();
                let remote_ref = format!("{}/{}", remote_name, current_branch);
                let verify_output = Command::new("git")
                    .args(["-C", &clean_repo, "rev-parse", "--verify", &remote_ref])
                    .output();
                if let Ok(v_out) = verify_output {
                    if v_out.status.success() {
                        let rev_range = format!("{}...HEAD", remote_ref);
                        let rev_list = Command::new("git")
                            .args(["-C", &clean_repo, "rev-list", "--left-right", "--count", &rev_range])
                            .output();
                        if let Ok(rl_out) = rev_list {
                            if rl_out.status.success() {
                                let rl_str = String::from_utf8_lossy(&rl_out.stdout);
                                let counts: Vec<&str> = rl_str.split_whitespace().collect();
                                if counts.len() >= 2 {
                                    behind = counts[0].parse::<u32>().unwrap_or(0);
                                    ahead = counts[1].parse::<u32>().unwrap_or(0);
                                }
                            }
                        }
                        upstream = Some(remote_ref);
                    } else {
                        let count_output = Command::new("git")
                            .args(["-C", &clean_repo, "rev-list", "--count", "HEAD"])
                            .output();
                        if let Ok(c_out) = count_output {
                            if c_out.status.success() {
                                ahead = String::from_utf8_lossy(&c_out.stdout).trim().parse::<u32>().unwrap_or(0);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(GitSyncStatus {
        has_remote: true,
        remote_name: Some(remote_name),
        upstream,
        ahead,
        behind,
    })
}

#[tauri::command]
fn git_push(repo_path: String) -> Result<String, String> {
    let clean_repo = expand_path(&repo_path);

    let upstream_output = Command::new("git")
        .args(["-C", &clean_repo, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .output();

    let has_upstream = match upstream_output {
        Ok(out) => out.status.success() && !String::from_utf8_lossy(&out.stdout).trim().is_empty(),
        Err(_) => false,
    };

    let output = if has_upstream {
        Command::new("git")
            .args(["-C", &clean_repo, "push"])
            .output()
            .map_err(|e| format!("Failed to execute git push: {}", e))?
    } else {
        let branch_out = Command::new("git")
            .args(["-C", &clean_repo, "rev-parse", "--abbrev-ref", "HEAD"])
            .output()
            .map_err(|e| format!("Failed to get current branch: {}", e))?;
        let branch = String::from_utf8_lossy(&branch_out.stdout).trim().to_string();

        let remotes_out = Command::new("git")
            .args(["-C", &clean_repo, "remote"])
            .output()
            .map_err(|e| format!("Failed to get remotes: {}", e))?;
        let remotes_str = String::from_utf8_lossy(&remotes_out.stdout);
        let remote = remotes_str.lines().next().unwrap_or("origin").trim();

        if remote.is_empty() {
            return Err("No git remote configured to push to".to_string());
        }

        Command::new("git")
            .args(["-C", &clean_repo, "push", "-u", remote, &branch])
            .output()
            .map_err(|e| format!("Failed to execute git push: {}", e))?
    };

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(if err.is_empty() {
            String::from_utf8_lossy(&output.stdout).to_string()
        } else {
            err
        });
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr_str = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stdout_str.is_empty() {
        Ok(stderr_str)
    } else {
        Ok(stdout_str)
    }
}

#[tauri::command]
fn select_directory(current_path: Option<String>) -> Result<Option<String>, String> {
    let mut cmd = Command::new("zenity");
    cmd.args(["--file-selection", "--directory", "--title=Select Project Folder"]);

    let init_path = if let Some(ref p) = current_path {
        let expanded = expand_path(p);
        let path = Path::new(&expanded);
        if let Some(parent) = path.parent() {
            parent.to_string_lossy().to_string()
        } else {
            expanded
        }
    } else {
        std::env::var("HOME").unwrap_or_else(|_| "/home/ori".to_string())
    };

    let filename_arg = format!("--filename={}/", init_path.trim_end_matches('/'));
    cmd.arg(filename_arg);

    let output = cmd.output();
    match output {
        Ok(out) => {
            if out.status.success() {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(Some(path));
                }
            }
            Ok(None)
        }
        Err(e) => Err(format!("Could not open file dialog: {}", e)),
    }
}

#[tauri::command]
fn resolve_path(path: String) -> String {
    expand_path(&path)
}

#[tauri::command]
fn read_dir_entries(dir_path: String, show_hidden: Option<bool>) -> Result<Vec<FsEntryItem>, String> {
    let clean_dir = expand_path(&dir_path);
    let path = Path::new(&clean_dir);
    if !path.is_dir() {
        return Err(format!("Path '{}' is not a directory", clean_dir));
    }

    let include_hidden = show_hidden.unwrap_or(false);
    let read_dir = fs::read_dir(path).map_err(|e| format!("Failed to read dir: {}", e))?;
    let mut entries = Vec::new();

    for entry in read_dir {
        if let Ok(entry) = entry {
            let file_name = entry.file_name().to_string_lossy().to_string();
            // Filter out dot files only if hidden files are not enabled
            if !include_hidden && file_name.starts_with('.') {
                continue;
            }

            let (is_dir, size) = match entry.file_type() {
                Ok(ft) => {
                    let is_d = ft.is_dir();
                    let s = if is_d {
                        0
                    } else {
                        entry.metadata().map(|m| m.len()).unwrap_or(0)
                    };
                    (is_d, s)
                }
                Err(_) => (false, 0),
            };

            entries.push(FsEntryItem {
                name: file_name,
                path: entry.path().to_string_lossy().to_string(),
                is_dir,
                size,
            });
        }
    }

    entries.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            return b.is_dir.cmp(&a.is_dir); // Directories first
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });

    Ok(entries)
}

#[tauri::command]
fn read_file_text(file_path: String) -> Result<String, String> {
    let clean_path = expand_path(&file_path);
    let bytes = fs::read(&clean_path).map_err(|e| format!("Failed to read file '{}': {}", clean_path, e))?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
fn read_file_base64(file_path: String) -> Result<String, String> {
    use base64::Engine;
    let clean_path = expand_path(&file_path);
    let bytes = fs::read(&clean_path).map_err(|e| format!("Failed to read binary file '{}': {}", clean_path, e))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(b64)
}

#[tauri::command]
fn write_file_text(file_path: String, content: String) -> Result<(), String> {
    let clean_path = expand_path(&file_path);
    if let Some(parent) = std::path::Path::new(&clean_path).parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&clean_path, content).map_err(|e| format!("Failed to write file '{}': {}", clean_path, e))
}

#[tauri::command]
fn get_file_metadata(file_path: String) -> Result<FileMetadataResult, String> {
    let clean_path = expand_path(&file_path);
    let metadata = fs::metadata(&clean_path)
        .map_err(|e| format!("Failed to read metadata for '{}': {}", clean_path, e))?;
    let mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(FileMetadataResult {
        mtime_ms,
        size: metadata.len(),
    })
}

#[tauri::command]
fn create_directory(dir_path: String) -> Result<(), String> {
    let clean_path = expand_path(&dir_path);
    fs::create_dir_all(&clean_path).map_err(|e| format!("Failed to create directory '{}': {}", clean_path, e))
}

#[tauri::command]
fn open_system_terminal(dir_path: String) -> Result<(), String> {
    let clean_path = expand_path(&dir_path);
    let path = std::path::Path::new(&clean_path);
    if !path.exists() {
        return Err(format!("Directory '{}' does not exist", clean_path));
    }

    #[cfg(target_os = "linux")]
    {
        let candidates: &[(&str, &[&str])] = &[
            ("x-terminal-emulator", &["--working-directory", &clean_path]),
            ("mate-terminal", &["--working-directory", &clean_path]),
            ("gnome-terminal", &["--working-directory", &clean_path]),
            ("xfce4-terminal", &["--working-directory", &clean_path]),
            ("konsole", &["--workdir", &clean_path]),
            ("alacritty", &["--working-directory", &clean_path]),
            ("kitty", &["--directory", &clean_path]),
            ("terminator", &["--working-directory", &clean_path]),
            ("tilix", &["--working-directory", &clean_path]),
            ("x-terminal-emulator", &[]),
            ("xterm", &[]),
        ];

        for (term, args) in candidates {
            let mut cmd = std::process::Command::new(term);
            cmd.current_dir(&clean_path);
            for arg in *args {
                cmd.arg(arg);
            }
            if cmd.spawn().is_ok() {
                return Ok(());
            }
        }

        return Err("No supported terminal emulator found on this system".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "cmd.exe"])
            .current_dir(&clean_path)
            .spawn()
            .map_err(|e| format!("Failed to launch terminal on Windows: {}", e))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-a", "Terminal", &clean_path])
            .spawn()
            .map_err(|e| format!("Failed to launch terminal on macOS: {}", e))?;
        Ok(())
    }
}

#[tauri::command]
fn get_cli_launch_payload() -> Result<CliLaunchPayload, String> {
    let raw_args: Vec<String> = std::env::args().skip(1).collect();
    let positional: Vec<String> = raw_args
        .into_iter()
        .filter(|a| !a.starts_with('-'))
        .collect();

    if positional.is_empty() {
        return Ok(CliLaunchPayload {
            workspace_path: None,
            files: Vec::new(),
        });
    }

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    let first = &positional[0];
    let first_expanded = PathBuf::from(expand_path(first));
    let first_full = if first_expanded.is_absolute() {
        first_expanded
    } else {
        cwd.join(first_expanded)
    };

    let (workspace_dir, candidate_files) = if first_full.is_dir() {
        let ws = first_full.canonicalize().unwrap_or(first_full);
        (ws, &positional[1..])
    } else if first_full.is_file() {
        (cwd.canonicalize().unwrap_or(cwd.clone()), &positional[..])
    } else {
        (first_full, &positional[1..])
    };

    let mut files = Vec::new();
    let max_files = 3;

    for arg in candidate_files {
        if files.len() >= max_files {
            break;
        }
        let exp = PathBuf::from(expand_path(arg));
        let full_path = if exp.is_absolute() {
            exp
        } else {
            let from_cwd = cwd.join(&exp);
            if from_cwd.exists() {
                from_cwd
            } else {
                workspace_dir.join(&exp)
            }
        };

        if full_path.is_file() {
            let canon = full_path.canonicalize().unwrap_or(full_path.clone());
            let name = canon
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| arg.clone());

            let rel_path = match canon.strip_prefix(&workspace_dir) {
                Ok(rel) => rel.to_string_lossy().to_string(),
                Err(_) => name.clone(),
            };

            files.push(CliFileToOpen {
                name,
                rel_path,
                fs_path: canon.to_string_lossy().to_string(),
            });
        }
    }

    Ok(CliLaunchPayload {
        workspace_path: Some(workspace_dir.to_string_lossy().to_string()),
        files,
    })
}

pub struct AiSidecarProcess {
    pub child: Child,
    pub port: u16,
    pub model_path: String,
}

static AI_SIDECAR: Mutex<Option<AiSidecarProcess>> = Mutex::new(None);

static DOWNLOAD_CANCELLED: AtomicBool = AtomicBool::new(false);
static DOWNLOAD_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

const DEFAULT_MODEL_URL: &str =
    "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf";
const DEFAULT_MODEL_SIZE: u64 = 986_500_000;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AiSidecarStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: u16,
    pub model_path: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AiModelStatus {
    pub exists: bool,
    pub path: String,
    pub size_bytes: u64,
    pub default_url: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AiDownloadProgress {
    pub percent: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub is_complete: bool,
    pub error: Option<String>,
}

fn get_default_model_path() -> String {
    expand_path("~/.vide/models/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf")
}

fn find_llama_server_binary(preferred: Option<String>) -> Result<String, String> {
    if let Some(p) = preferred {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            let expanded = expand_path(trimmed);
            let path = Path::new(&expanded);
            if path.is_file() {
                return Ok(expanded);
            }
        }
    }

    // 1. Check relative to current working directory (project repo: src-tauri/bin/llama-server)
    let project_candidates = [
        "src-tauri/bin/llama-server",
        "bin/llama-server",
        "./llama-server",
    ];
    for rel in &project_candidates {
        let path = Path::new(rel);
        if path.is_file() {
            if let Ok(canon) = path.canonicalize() {
                return Ok(canon.to_string_lossy().to_string());
            }
            return Ok(rel.to_string());
        }
    }

    // 2. Check relative to running executable (installed Debian package / bundle)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let bundle_candidates = [
                exe_dir.join("bin/llama-server"),
                exe_dir.join("llama-server"),
                exe_dir.join("resources/bin/llama-server"),
                exe_dir.join("../lib/vide/bin/llama-server"),
                exe_dir.join("../lib/vide/llama-server"),
                exe_dir.join("../lib/vide/resources/bin/llama-server"),
                exe_dir.join("../share/vide/bin/llama-server"),
            ];
            for b in &bundle_candidates {
                if b.is_file() {
                    return Ok(b.to_string_lossy().to_string());
                }
            }
        }
    }

    // 3. System and user local paths
    let system_candidates = [
        "~/.vide/bin/llama-server",
        "~/.local/bin/llama-server",
        "/usr/local/bin/llama-server",
        "/usr/bin/llama-server",
        "/usr/lib/vide/bin/llama-server",
        "/usr/lib/vide/llama-server",
    ];

    for c in &system_candidates {
        let expanded = expand_path(c);
        let path = Path::new(&expanded);
        if path.is_file() {
            return Ok(expanded);
        }
        if let Ok(out) = Command::new("which").arg(c).output() {
            if out.status.success() {
                let bin = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !bin.is_empty() {
                    return Ok(bin);
                }
            }
        }
    }

    Err("llama-server binary was not found. Looked in src-tauri/bin/llama-server, app bundle, and system paths.".to_string())
}

#[tauri::command]
fn check_ai_model_status(custom_path: Option<String>) -> Result<AiModelStatus, String> {
    let path_str = custom_path
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(get_default_model_path);
    let clean = expand_path(&path_str);
    let path = Path::new(&clean);

    if path.is_file() {
        let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        if size > 100_000_000 {
            return Ok(AiModelStatus {
                exists: true,
                path: clean,
                size_bytes: size,
                default_url: DEFAULT_MODEL_URL.to_string(),
            });
        }
    }

    // Fallbacks: check in src-tauri/models or ~/models
    let fallback_paths = [
        "src-tauri/models/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
        "~/models/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
    ];
    for fp in &fallback_paths {
        let exp = expand_path(fp);
        let fpath = Path::new(&exp);
        if fpath.is_file() {
            let size = fs::metadata(fpath).map(|m| m.len()).unwrap_or(0);
            if size > 100_000_000 {
                return Ok(AiModelStatus {
                    exists: true,
                    path: exp,
                    size_bytes: size,
                    default_url: DEFAULT_MODEL_URL.to_string(),
                });
            }
        }
    }

    Ok(AiModelStatus {
        exists: false,
        path: clean,
        size_bytes: 0,
        default_url: DEFAULT_MODEL_URL.to_string(),
    })
}

#[tauri::command]
async fn download_ai_model(
    app: tauri::AppHandle,
    custom_path: Option<String>,
    custom_url: Option<String>,
) -> Result<String, String> {
    let target = custom_path
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(get_default_model_path);
    let clean_target = expand_path(&target);
    let url = custom_url
        .filter(|u| !u.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL_URL.to_string());

    let target_path = PathBuf::from(&clean_target);
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create folder: {}", e))?;
    }

    let tmp_path = format!("{}.downloading", clean_target);
    DOWNLOAD_CANCELLED.store(false, Ordering::SeqCst);

    let child = Command::new("curl")
        .arg("-f")
        .arg("-L")
        .arg("-C")
        .arg("-")
        .arg("-o")
        .arg(&tmp_path)
        .arg(&url)
        .spawn()
        .map_err(|e| format!("Failed to start curl download: {}", e))?;

    {
        let mut proc_guard = DOWNLOAD_PROCESS.lock().unwrap();
        *proc_guard = Some(child);
    }

    let app_handle = app.clone();
    let tmp_copy = tmp_path.clone();
    let clean_copy = clean_target.clone();

    let monitor = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let total_bytes = DEFAULT_MODEL_SIZE;
        loop {
            if DOWNLOAD_CANCELLED.load(Ordering::SeqCst) {
                if let Ok(mut guard) = DOWNLOAD_PROCESS.lock() {
                    if let Some(mut p) = guard.take() {
                        let _ = p.kill();
                    }
                }
                let _ = fs::remove_file(&tmp_copy);
                let _ = app_handle.emit(
                    "ai-download-progress",
                    AiDownloadProgress {
                        percent: 0.0,
                        downloaded_bytes: 0,
                        total_bytes,
                        is_complete: false,
                        error: Some("Download was cancelled".to_string()),
                    },
                );
                return Err("Download cancelled by user".to_string());
            }

            let finished = {
                let mut guard = DOWNLOAD_PROCESS.lock().unwrap();
                if let Some(ref mut p) = *guard {
                    match p.try_wait() {
                        Ok(Some(status)) => Some(status),
                        Ok(None) => None,
                        Err(e) => return Err(format!("Error monitoring download: {}", e)),
                    }
                } else {
                    return Err("Process terminated".to_string());
                }
            };

            let current_bytes = fs::metadata(&tmp_copy).map(|m| m.len()).unwrap_or(0);
            let percent = if total_bytes > 0 {
                ((current_bytes as f64 / total_bytes as f64) * 100.0).min(99.9)
            } else {
                0.0
            };

            let _ = app_handle.emit(
                "ai-download-progress",
                AiDownloadProgress {
                    percent,
                    downloaded_bytes: current_bytes,
                    total_bytes,
                    is_complete: false,
                    error: None,
                },
            );

            if let Some(status) = finished {
                if status.success() {
                    fs::rename(&tmp_copy, &clean_copy)
                        .map_err(|e| format!("Failed to finalize model file: {}", e))?;

                    let final_size = fs::metadata(&clean_copy).map(|m| m.len()).unwrap_or(current_bytes);
                    let _ = app_handle.emit(
                        "ai-download-progress",
                        AiDownloadProgress {
                            percent: 100.0,
                            downloaded_bytes: final_size,
                            total_bytes: final_size,
                            is_complete: true,
                            error: None,
                        },
                    );
                    return Ok(clean_copy);
                } else {
                    let err_msg = format!("curl download failed (exit code: {:?})", status.code());
                    let _ = app_handle.emit(
                        "ai-download-progress",
                        AiDownloadProgress {
                            percent: 0.0,
                            downloaded_bytes: current_bytes,
                            total_bytes,
                            is_complete: false,
                            error: Some(err_msg.clone()),
                        },
                    );
                    return Err(err_msg);
                }
            }

            std::thread::sleep(std::time::Duration::from_millis(300));
        }
    });

    monitor.await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_ai_model_download() -> Result<(), String> {
    DOWNLOAD_CANCELLED.store(true, Ordering::SeqCst);
    if let Ok(mut guard) = DOWNLOAD_PROCESS.lock() {
        if let Some(mut p) = guard.take() {
            let _ = p.kill();
        }
    }
    Ok(())
}

#[tauri::command]
fn start_ai_sidecar(
    binary_path: Option<String>,
    model_path: Option<String>,
    port: Option<u16>,
    n_gpu_layers: Option<i32>,
    context_size: Option<u32>,
) -> Result<AiSidecarStatus, String> {
    let model_str = model_path
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(get_default_model_path);
    let clean_model = expand_path(&model_str);
    if !Path::new(&clean_model).is_file() {
        return Err(format!("Model file '{}' does not exist. Please download it first.", clean_model));
    }

    let bin = find_llama_server_binary(binary_path)?;
    let p = port.unwrap_or(8080);
    let ngl = n_gpu_layers.unwrap_or(99);
    let ctx = context_size.unwrap_or(4096);

    // Stop existing sidecar if running
    let mut guard = AI_SIDECAR.lock().map_err(|e| e.to_string())?;
    if let Some(mut existing) = guard.take() {
        let _ = existing.child.kill();
        let _ = existing.child.wait();
    }

    let mut cmd = Command::new(&bin);
    cmd.arg("-m")
        .arg(&clean_model)
        .arg("--port")
        .arg(p.to_string())
        .arg("-c")
        .arg(ctx.to_string())
        .arg("-ngl")
        .arg(ngl.to_string())
        .arg("--host")
        .arg("127.0.0.1");

    // Ensure LD_LIBRARY_PATH includes the directory of llama-server so .so libs are loaded
    if let Some(parent) = Path::new(&bin).parent() {
        let current_ld = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
        let new_ld = if current_ld.is_empty() {
            parent.to_string_lossy().to_string()
        } else {
            format!("{}:{}", parent.to_string_lossy(), current_ld)
        };
        cmd.env("LD_LIBRARY_PATH", new_ld);
    }

    let child = cmd.spawn().map_err(|e| format!("Failed to spawn llama-server: {}", e))?;

    let pid = child.id();
    *guard = Some(AiSidecarProcess {
        child,
        port: p,
        model_path: clean_model.clone(),
    });

    Ok(AiSidecarStatus {
        running: true,
        pid: Some(pid),
        port: p,
        model_path: Some(clean_model),
    })
}

#[tauri::command]
fn stop_ai_sidecar() -> Result<AiSidecarStatus, String> {
    let mut guard = AI_SIDECAR.lock().map_err(|e| e.to_string())?;
    if let Some(mut existing) = guard.take() {
        let _ = existing.child.kill();
        let _ = existing.child.wait();
    }
    Ok(AiSidecarStatus {
        running: false,
        pid: None,
        port: 8080,
        model_path: None,
    })
}

#[tauri::command]
fn get_ai_sidecar_status() -> Result<AiSidecarStatus, String> {
    let mut guard = AI_SIDECAR.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut proc) = *guard {
        match proc.child.try_wait() {
            Ok(Some(_status)) => {
                *guard = None;
                Ok(AiSidecarStatus {
                    running: false,
                    pid: None,
                    port: 8080,
                    model_path: None,
                })
            }
            Ok(None) => {
                Ok(AiSidecarStatus {
                    running: true,
                    pid: Some(proc.child.id()),
                    port: proc.port,
                    model_path: Some(proc.model_path.clone()),
                })
            }
            Err(_) => {
                *guard = None;
                Ok(AiSidecarStatus {
                    running: false,
                    pid: None,
                    port: 8080,
                    model_path: None,
                })
            }
        }
    } else {
        Ok(AiSidecarStatus {
            running: false,
            pid: None,
            port: 8080,
            model_path: None,
        })
    }
}

#[tauri::command]
fn get_git_diff_for_commit(repo_path: String) -> Result<String, String> {
    let clean_repo = expand_path(&repo_path);

    let staged = Command::new("git")
        .args(["-C", &clean_repo, "diff", "--staged"])
        .output()
        .map_err(|e| format!("Failed to run git diff --staged: {}", e))?;

    let staged_text = String::from_utf8_lossy(&staged.stdout).trim().to_string();
    if !staged_text.is_empty() {
        return Ok(staged_text);
    }

    let unstaged = Command::new("git")
        .args(["-C", &clean_repo, "diff"])
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    let unstaged_text = String::from_utf8_lossy(&unstaged.stdout).trim().to_string();
    if !unstaged_text.is_empty() {
        return Ok(unstaged_text);
    }

    let status = Command::new("git")
        .args(["-C", &clean_repo, "status", "--short"])
        .output()
        .map_err(|e| format!("Failed to run git status: {}", e))?;

    Ok(String::from_utf8_lossy(&status.stdout).trim().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Ok(mut guard) = AI_SIDECAR.lock() {
                    if let Some(mut proc) = guard.take() {
                        let _ = proc.child.kill();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            resolve_path,
            get_git_branch,
            get_git_status,
            get_git_diff_baseline,
            revert_git_file,
            get_git_commits,
            create_git_commit,
            get_git_sync_status,
            git_push,
            select_directory,
            read_dir_entries,
            read_file_text,
            read_file_base64,
            write_file_text,
            get_file_metadata,
            create_directory,
            open_system_terminal,
            get_cli_launch_payload,
            start_ai_sidecar,
            stop_ai_sidecar,
            get_ai_sidecar_status,
            get_git_diff_for_commit,
            check_ai_model_status,
            download_ai_model,
            cancel_ai_model_download,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

