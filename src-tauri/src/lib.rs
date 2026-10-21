use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

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
        .args(["-C", &clean_repo, "status", "--porcelain=v1", "-uall"])
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
    fs::read_to_string(&full_path).map_err(|e| format!("Failed to read reverted file: {}", e))
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

            let file_type = entry.file_type().map_err(|e| e.to_string())?;
            let is_dir = file_type.is_dir();
            let size = if is_dir {
                0
            } else {
                entry.metadata().map(|m| m.len()).unwrap_or(0)
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
    fs::read_to_string(&clean_path).map_err(|e| format!("Failed to read file '{}': {}", clean_path, e))
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
    fs::write(&clean_path, content).map_err(|e| format!("Failed to write file '{}': {}", clean_path, e))
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
        .invoke_handler(tauri::generate_handler![
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
            get_cli_launch_payload,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
