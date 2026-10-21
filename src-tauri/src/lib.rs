use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitFileItem {
    pub path: String,
    pub status: String, // "modified" | "untracked" | "added" | "deleted"
    pub staged: bool,
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
            select_directory,
            read_dir_entries,
            read_file_text,
            read_file_base64,
            write_file_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
