/**
 * lib.rs - Tauri backend logic, native filesystem, process management, and Git commands
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Write};
#[cfg(unix)]
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

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
	pub target_file: Option<String>,
	pub highlight_start: Option<u32>,
	pub highlight_end: Option<u32>,
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
	pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitCommitFileChange {
	pub path: String,
	pub insertions: usize,
	pub deletions: usize,
	pub status: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitCommitDetails {
	pub hash: String,
	pub short_hash: String,
	pub author_name: String,
	pub author_email: String,
	pub author_date: String,
	pub author_date_relative: String,
	pub committer_name: String,
	pub committer_email: String,
	pub committer_date: String,
	pub subject: String,
	pub body: String,
	pub parents: Vec<String>,
	pub refs: Vec<String>,
	pub stat_summary: String,
	pub files: Vec<GitCommitFileChange>,
	pub patch: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitCommitFileContentPair {
	pub before_content: String,
	pub after_content: String,
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

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileInspectionResult {
	pub is_binary: bool,
	pub file_type: String,
	pub mime_type: String,
	pub size: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HexLine {
	pub offset: String,
	pub hex_part1: String,
	pub hex_part2: String,
	pub ascii: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HexViewResult {
	pub total_size: u64,
	pub file_type: String,
	pub lines: Vec<HexLine>,
	pub bytes_shown: usize,
	pub has_more: bool,
}

fn expand_path(p: &str) -> String {
	let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok();
	if let Some(h) = home {
		if p.starts_with("~/") {
			return format!("{}{}", h, &p[1..]);
		} else if p == "~" {
			return h;
		}
	}
	p.to_string()
}

#[tauri::command]
fn get_git_branch(repo_path: String) -> Result<String, String> {
	let clean_repo = expand_path(&repo_path);

	// 1. Verify if the directory is actually inside a Git work tree
	let check = Command::new("git")
		.args(["-C", &clean_repo, "rev-parse", "--is-inside-work-tree"])
		.output()
		.map_err(|e| format!("Failed to execute git: {}", e))?;

	if !check.status.success() {
		return Err("Not a git repository".to_string());
	}

	// 2. Try symbolic-ref --short HEAD (works on empty repos and normal repos with branch)
	let sym_output = Command::new("git")
		.args(["-C", &clean_repo, "symbolic-ref", "--short", "HEAD"])
		.output();

	if let Ok(out) = sym_output {
		if out.status.success() {
			let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
			if !name.is_empty() {
				return Ok(name);
			}
		}
	}

	// 3. Try branch --show-current
	let branch_output = Command::new("git")
		.args(["-C", &clean_repo, "branch", "--show-current"])
		.output();

	if let Ok(out) = branch_output {
		if out.status.success() {
			let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
			if !name.is_empty() {
				return Ok(name);
			}
		}
	}

	// 4. Try rev-parse --abbrev-ref HEAD
	let abbrev_output = Command::new("git")
		.args(["-C", &clean_repo, "rev-parse", "--abbrev-ref", "HEAD"])
		.output();

	if let Ok(out) = abbrev_output {
		if out.status.success() {
			let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
			if !name.is_empty() && name != "HEAD" {
				return Ok(name);
			}
		}
	}

	// 5. If HEAD is detached, get short commit hash
	let rev_output = Command::new("git")
		.args(["-C", &clean_repo, "rev-parse", "--short", "HEAD"])
		.output();

	if let Ok(out) = rev_output {
		if out.status.success() {
			let hash = String::from_utf8_lossy(&out.stdout).trim().to_string();
			if !hash.is_empty() {
				return Ok(format!("HEAD ({})", hash));
			}
		}
	}

	// Fallback: If repo is empty and HEAD ref cannot be resolved, default to "main"
	Ok("main".to_string())
}

#[tauri::command]
fn get_git_status(repo_path: String) -> Result<Vec<GitFileItem>, String> {
	let clean_repo = expand_path(&repo_path);

	// Check if repo_path is inside a git work tree and get prefix if in a subdirectory
	let prefix = Command::new("git")
		.args(["-C", &clean_repo, "rev-parse", "--show-prefix"])
		.output()
		.map(|o| {
			if o.status.success() {
				String::from_utf8_lossy(&o.stdout).trim().to_string()
			} else {
				String::new()
			}
		})
		.unwrap_or_default();

	let output = Command::new("git")
		.args([
			"-C",
			&clean_repo,
			"status",
			"--porcelain=v1",
			"-unormal",
			".",
		])
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

		// Handle possible rename syntax: "R  old -> new"
		let target_raw = if raw_file_path.contains(" -> ") {
			raw_file_path
				.split(" -> ")
				.last()
				.unwrap_or(raw_file_path)
				.trim()
		} else {
			raw_file_path
		};

		// Remove surrounding quotes if git output contains them
		let mut file_path = target_raw.trim_matches('"').to_string();

		// If in a subdirectory, git paths start with prefix (e.g. "src/").
		// Strip the prefix so file_path is relative to the open workspace (clean_repo).
		if !prefix.is_empty() && file_path.starts_with(&prefix) {
			file_path = file_path[prefix.len()..].to_string();
		}

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
	let clean_file = file_path.trim_start_matches('/').trim_start_matches("./");

	// Try HEAD:./<clean_file> first (works from any subdirectory or root)
	let git_spec_relative = format!("HEAD:./{}", clean_file);
	let mut output = Command::new("git")
		.args(["-C", &clean_repo, "show", &git_spec_relative])
		.output()
		.map_err(|e| format!("Failed to execute git show: {}", e))?;

	if !output.status.success() {
		// Fallback to HEAD:<clean_file> (in case path was already repo-root relative)
		let git_spec_root = format!("HEAD:{}", clean_file);
		if let Ok(out) = Command::new("git")
			.args(["-C", &clean_repo, "show", &git_spec_root])
			.output()
		{
			if out.status.success() {
				output = out;
			}
		}
	}

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
	let clean_file = file_path.trim_start_matches('/').trim_start_matches("./");
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
			"--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%s%x1f%D%x1e",
		])
		.output()
		.map_err(|e| format!("Failed to execute git log: {}", e))?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		if stderr.contains("does not have any commits yet")
			|| stderr.contains("unknown revision")
			|| stderr.contains("bad default revision 'HEAD'")
			|| stderr.contains("fatal: ambiguous argument 'HEAD'")
		{
			return Ok(Vec::new());
		}
		return Err(stderr.to_string());
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
			let mut tags = Vec::new();
			if parts.len() >= 6 {
				let decs = parts[5];
				for item in decs.split(',') {
					let trimmed = item.trim();
					if let Some(tag) = trimmed.strip_prefix("tag:") {
						let clean = tag.trim();
						if !clean.is_empty() {
							tags.push(clean.to_string());
						}
					}
				}
			}
			commits.push(GitCommitItem {
				hash: parts[0].to_string(),
				short_hash: parts[1].to_string(),
				author: parts[2].to_string(),
				date: parts[3].to_string(),
				message: parts[4].to_string(),
				tags,
			});
		}
	}

	Ok(commits)
}

#[tauri::command]
fn get_git_commit_details(
	repo_path: String,
	commit_hash: String,
) -> Result<GitCommitDetails, String> {
	let clean_repo = expand_path(&repo_path);
	let target = commit_hash.trim();
	if target.is_empty() {
		return Err("Commit hash cannot be empty".to_string());
	}

	// 1. Get commit metadata
	let meta_output = Command::new("git")
		.args([
			"-C",
			&clean_repo,
			"show",
			"-s",
			"--format=%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%ar%x1f%cn%x1f%ce%x1f%cd%x1f%s%x1f%b%x1f%P%x1f%D",
			target,
		])
		.output()
		.map_err(|e| format!("Failed to run git show: {}", e))?;

	if !meta_output.status.success() {
		return Err(String::from_utf8_lossy(&meta_output.stderr).to_string());
	}

	let meta_str = String::from_utf8_lossy(&meta_output.stdout);
	let parts: Vec<&str> = meta_str.split('\x1f').collect();
	if parts.len() < 13 {
		return Err("Unexpected git show metadata format".to_string());
	}

	let hash = parts[0].trim().to_string();
	let short_hash = parts[1].trim().to_string();
	let author_name = parts[2].trim().to_string();
	let author_email = parts[3].trim().to_string();
	let author_date = parts[4].trim().to_string();
	let author_date_relative = parts[5].trim().to_string();
	let committer_name = parts[6].trim().to_string();
	let committer_email = parts[7].trim().to_string();
	let committer_date = parts[8].trim().to_string();
	let subject = parts[9].trim().to_string();
	let body = parts[10].trim().to_string();

	let parents: Vec<String> = parts[11]
		.split_whitespace()
		.map(|s| s.to_string())
		.collect();

	let mut refs = Vec::new();
	if !parts[12].trim().is_empty() {
		for r in parts[12].split(',') {
			let clean_ref = r.trim();
			if !clean_ref.is_empty() {
				refs.push(clean_ref.to_string());
			}
		}
	}

	// 2. Short stat summary
	let stat_output = Command::new("git")
		.args([
			"-C",
			&clean_repo,
			"show",
			"--shortstat",
			"--format=",
			target,
		])
		.output()
		.map_err(|e| format!("Failed to run git shortstat: {}", e))?;
	let stat_summary = String::from_utf8_lossy(&stat_output.stdout)
		.trim()
		.to_string();

	// 3. Name-status for file change types (M, A, D, R...)
	let mut file_statuses: std::collections::HashMap<String, String> =
		std::collections::HashMap::new();
	if let Ok(name_status_out) = Command::new("git")
		.args([
			"-C",
			&clean_repo,
			"show",
			"--name-status",
			"--format=",
			target,
		])
		.output()
	{
		for line in String::from_utf8_lossy(&name_status_out.stdout).lines() {
			let line = line.trim();
			if line.is_empty() {
				continue;
			}
			let sp: Vec<&str> = line.split('\t').collect();
			if sp.len() >= 2 {
				let status_code = sp[0].trim();
				let file_name = sp[sp.len() - 1].trim();
				file_statuses.insert(file_name.to_string(), status_code.to_string());
			}
		}
	}

	// 4. Numstat for insertions/deletions per file
	let mut files: Vec<GitCommitFileChange> = Vec::new();
	if let Ok(numstat_out) = Command::new("git")
		.args(["-C", &clean_repo, "show", "--numstat", "--format=", target])
		.output()
	{
		for line in String::from_utf8_lossy(&numstat_out.stdout).lines() {
			let line = line.trim();
			if line.is_empty() {
				continue;
			}
			let sp: Vec<&str> = line.split('\t').collect();
			if sp.len() >= 3 {
				let ins = sp[0].trim().parse::<usize>().unwrap_or(0);
				let del = sp[1].trim().parse::<usize>().unwrap_or(0);
				let p = sp[2].trim().to_string();
				let st = file_statuses
					.get(&p)
					.cloned()
					.unwrap_or_else(|| "M".to_string());
				files.push(GitCommitFileChange {
					path: p,
					insertions: ins,
					deletions: del,
					status: st,
				});
			}
		}
	}

	// 5. Unified diff / patch (limit to 300 KB to preserve responsiveness)
	let patch_output = Command::new("git")
		.args(["-C", &clean_repo, "show", "--patch", "--format=", target])
		.output()
		.map_err(|e| format!("Failed to run git show patch: {}", e))?;

	let raw_patch = String::from_utf8_lossy(&patch_output.stdout);
	let patch = if raw_patch.len() > 300_000 {
		format!(
			"{}\n\n... [Diff truncated: commit diff exceeds 300 KB]",
			&raw_patch[..300_000]
		)
	} else {
		raw_patch.to_string()
	};

	Ok(GitCommitDetails {
		hash,
		short_hash,
		author_name,
		author_email,
		author_date,
		author_date_relative,
		committer_name,
		committer_email,
		committer_date,
		subject,
		body,
		parents,
		refs,
		stat_summary,
		files,
		patch,
	})
}

#[tauri::command]
fn get_git_commit_file_diff_content(
	repo_path: String,
	commit_hash: String,
	file_path: String,
) -> Result<GitCommitFileContentPair, String> {
	let clean_repo = expand_path(&repo_path);
	let target_commit = commit_hash.trim();
	let clean_path = file_path
		.trim()
		.trim_start_matches("./")
		.trim_start_matches('/');

	if target_commit.is_empty() || clean_path.is_empty() {
		return Err("Commit hash and file path cannot be empty".to_string());
	}

	// 1. Before content (parent commit or empty if added/initial)
	let before_spec = format!("{}~1:{}", target_commit, clean_path);
	let before_output = Command::new("git")
		.args(["-C", &clean_repo, "show", &before_spec])
		.output();

	let before_content = match before_output {
		Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).to_string(),
		_ => String::new(),
	};

	// 2. After content (target commit or empty if deleted)
	let after_spec = format!("{}:{}", target_commit, clean_path);
	let after_output = Command::new("git")
		.args(["-C", &clean_repo, "show", &after_spec])
		.output();

	let after_content = match after_output {
		Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).to_string(),
		_ => String::new(),
	};

	Ok(GitCommitFileContentPair {
		before_content,
		after_content,
	})
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

	Ok(String::from_utf8_lossy(&commit_output.stdout)
		.trim()
		.to_string())
}

#[tauri::command]
fn git_untrack_file(
	repo_path: String,
	file_path: String,
	add_to_gitignore: bool,
) -> Result<(), String> {
	let clean_repo = expand_path(&repo_path);
	let clean_file = file_path.trim_start_matches('/').trim_start_matches("./");

	// 1. If tracked in Git index, remove it from cache
	let _ = Command::new("git")
		.args(["-C", &clean_repo, "rm", "--cached", "-f", "--", clean_file])
		.output();

	// 2. Append to .gitignore if requested
	if add_to_gitignore {
		let gitignore_path = Path::new(&clean_repo).join(".gitignore");
		let content = if gitignore_path.exists() {
			fs::read_to_string(&gitignore_path).unwrap_or_default()
		} else {
			String::new()
		};

		let entry = if clean_file.starts_with('/') {
			clean_file.to_string()
		} else {
			format!("/{}", clean_file)
		};

		let already_present = content
			.lines()
			.any(|l| l.trim() == entry || l.trim() == clean_file);
		if !already_present {
			let mut new_content = content;
			if !new_content.is_empty() && !new_content.ends_with('\n') {
				new_content.push('\n');
			}
			new_content.push_str(&entry);
			new_content.push('\n');
			fs::write(&gitignore_path, new_content)
				.map_err(|e| format!("Failed to update .gitignore: {}", e))?;
		}
	}

	Ok(())
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
	let remotes: Vec<&str> = remotes_str
		.lines()
		.map(|l| l.trim())
		.filter(|l| !l.is_empty())
		.collect();

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
		.args([
			"-C",
			&clean_repo,
			"rev-parse",
			"--abbrev-ref",
			"--symbolic-full-name",
			"@{u}",
		])
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
					.args([
						"-C",
						&clean_repo,
						"rev-list",
						"--left-right",
						"--count",
						"@{u}...HEAD",
					])
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
							.args([
								"-C",
								&clean_repo,
								"rev-list",
								"--left-right",
								"--count",
								&rev_range,
							])
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
								ahead = String::from_utf8_lossy(&c_out.stdout)
									.trim()
									.parse::<u32>()
									.unwrap_or(0);
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
		.args([
			"-C",
			&clean_repo,
			"rev-parse",
			"--abbrev-ref",
			"--symbolic-full-name",
			"@{u}",
		])
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
		let branch = String::from_utf8_lossy(&branch_out.stdout)
			.trim()
			.to_string();

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

#[derive(Debug, Serialize, Deserialize)]
pub struct GitBranchItem {
	pub name: String,
	pub is_current: bool,
	pub is_remote: bool,
}

#[tauri::command]
fn get_git_branches(repo_path: String) -> Result<Vec<GitBranchItem>, String> {
	let clean_repo = expand_path(&repo_path);
	let output = Command::new("git")
		.args([
			"-C",
			&clean_repo,
			"branch",
			"-a",
			"--format=%(refname:short)|%(HEAD)",
		])
		.output()
		.map_err(|e| format!("Failed to list git branches: {}", e))?;

	if !output.status.success() {
		return Err(String::from_utf8_lossy(&output.stderr).to_string());
	}

	let mut branches = Vec::new();
	let stdout = String::from_utf8_lossy(&output.stdout);
	for line in stdout.lines() {
		let trimmed = line.trim();
		if trimmed.is_empty() {
			continue;
		}
		let parts: Vec<&str> = trimmed.split('|').collect();
		let name = parts[0].trim();
		if name.contains("HEAD") {
			continue;
		}
		let head_flag = parts.get(1).map(|s| s.trim()).unwrap_or("");
		let is_current = head_flag == "*";
		let is_remote = name.starts_with("origin/");

		branches.push(GitBranchItem {
			name: name.to_string(),
			is_current,
			is_remote,
		});
	}

	Ok(branches)
}

#[tauri::command]
fn switch_git_branch(repo_path: String, branch_name: String) -> Result<String, String> {
	let clean_repo = expand_path(&repo_path);
	let trimmed = branch_name.trim();
	if trimmed.is_empty() {
		return Err("Branch name cannot be empty".to_string());
	}

	let target = if let Some(local_name) = trimmed.strip_prefix("origin/") {
		local_name
	} else {
		trimmed
	};

	let output = Command::new("git")
		.args(["-C", &clean_repo, "checkout", target])
		.output()
		.map_err(|e| format!("Failed to switch branch: {}", e))?;

	if !output.status.success() {
		let err_msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
		let out_msg = String::from_utf8_lossy(&output.stdout).trim().to_string();
		return Err(if !err_msg.is_empty() {
			err_msg
		} else {
			out_msg
		});
	}

	let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
	let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
	Ok(if !out.is_empty() { out } else { err })
}

#[tauri::command]
fn create_git_branch(
	repo_path: String,
	new_branch_name: String,
	switch_to: bool,
) -> Result<String, String> {
	let clean_repo = expand_path(&repo_path);
	let trimmed = new_branch_name.trim();
	if trimmed.is_empty() {
		return Err("Branch name cannot be empty".to_string());
	}

	let output = if switch_to {
		Command::new("git")
			.args(["-C", &clean_repo, "checkout", "-b", trimmed])
			.output()
	} else {
		Command::new("git")
			.args(["-C", &clean_repo, "branch", trimmed])
			.output()
	}
	.map_err(|e| format!("Failed to create branch: {}", e))?;

	if !output.status.success() {
		let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(if !err.is_empty() {
			err
		} else {
			"Failed to create branch".to_string()
		});
	}

	Ok(format!("Branch '{}' created successfully", trimmed))
}

#[tauri::command]
fn get_git_tags(repo_path: String) -> Result<Vec<String>, String> {
	let clean_repo = expand_path(&repo_path);
	let output = Command::new("git")
		.args(["-C", &clean_repo, "tag", "--sort=-creatordate"])
		.output()
		.map_err(|e| format!("Failed to list git tags: {}", e))?;

	if !output.status.success() {
		return Err(String::from_utf8_lossy(&output.stderr).to_string());
	}

	let tags = String::from_utf8_lossy(&output.stdout)
		.lines()
		.map(|l| l.trim().to_string())
		.filter(|s| !s.is_empty())
		.collect();

	Ok(tags)
}

#[tauri::command]
fn create_git_tag(
	repo_path: String,
	tag_name: String,
	message: Option<String>,
) -> Result<String, String> {
	let clean_repo = expand_path(&repo_path);
	let trimmed_tag = tag_name.trim();
	if trimmed_tag.is_empty() {
		return Err("Tag name cannot be empty".to_string());
	}

	let mut args = vec!["-C", &clean_repo, "tag"];
	let clean_msg = message.as_deref().unwrap_or("").trim();
	if !clean_msg.is_empty() {
		args.push("-a");
		args.push(trimmed_tag);
		args.push("-m");
		args.push(clean_msg);
	} else {
		args.push(trimmed_tag);
	}

	let output = Command::new("git")
		.args(&args)
		.output()
		.map_err(|e| format!("Failed to create tag: {}", e))?;

	if !output.status.success() {
		let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
		return Err(if !err.is_empty() {
			err
		} else {
			"Failed to create tag".to_string()
		});
	}

	Ok(format!("Tag '{}' created successfully", trimmed_tag))
}

#[tauri::command]
fn select_directory(current_path: Option<String>) -> Result<Option<String>, String> {
	let mut cmd = Command::new("zenity");
	cmd.args([
		"--file-selection",
		"--directory",
		"--title=Select Project Folder",
	]);

	let init_path = if let Some(ref p) = current_path {
		let expanded = expand_path(p);
		let path = Path::new(&expanded);
		if let Some(parent) = path.parent() {
			parent.to_string_lossy().to_string()
		} else {
			expanded
		}
	} else {
		std::env::var("HOME")
			.or_else(|_| std::env::var("USERPROFILE"))
			.unwrap_or_else(|_| ".".to_string())
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
fn read_dir_entries(
	dir_path: String,
	show_hidden: Option<bool>,
) -> Result<Vec<FsEntryItem>, String> {
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
	let bytes = fs::read(&clean_path)
		.map_err(|e| format!("Failed to read file '{}': {}", clean_path, e))?;
	Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
fn read_file_base64(file_path: String) -> Result<String, String> {
	use base64::Engine;
	let clean_path = expand_path(&file_path);
	let bytes = fs::read(&clean_path)
		.map_err(|e| format!("Failed to read binary file '{}': {}", clean_path, e))?;
	let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
	Ok(b64)
}

#[tauri::command]
fn inspect_file(file_path: String) -> Result<FileInspectionResult, String> {
	use std::io::Read;
	let clean_path = expand_path(&file_path);
	let metadata = fs::metadata(&clean_path)
		.map_err(|e| format!("Failed to read metadata for '{}': {}", clean_path, e))?;
	let size = metadata.len();

	let mut file_type = String::new();
	let mut mime_type = String::from("application/octet-stream");

	// 1. Try running system `file` command (with -L to follow symlinks and -b for brief output)
	#[cfg(unix)]
	{
		if let Ok(output) = Command::new("file")
			.args(["-b", "-L", &clean_path])
			.output()
		{
			if output.status.success() {
				let desc = String::from_utf8_lossy(&output.stdout).trim().to_string();
				if !desc.is_empty() {
					file_type = desc;
				}
			}
		}
		if let Ok(output) = Command::new("file")
			.args(["-b", "-L", "--mime-type", &clean_path])
			.output()
		{
			if output.status.success() {
				let mime = String::from_utf8_lossy(&output.stdout).trim().to_string();
				if !mime.is_empty() {
					mime_type = mime;
				}
			}
		}
	}

	// 2. Read first chunk up to 8192 bytes for binary inspection and fallback detection
	let mut file = fs::File::open(&clean_path)
		.map_err(|e| format!("Failed to open '{}': {}", clean_path, e))?;
	let mut buffer = vec![0u8; 8192];
	let bytes_read = file.read(&mut buffer).unwrap_or(0);
	let sample = &buffer[..bytes_read];

	let contains_null = sample.contains(&0u8);
	let is_utf8 = std::str::from_utf8(sample).is_ok();

	if file_type.is_empty() {
		if sample.starts_with(b"\x7fELF") {
			file_type = "ELF 64-bit/32-bit executable or shared library".to_string();
			mime_type = "application/x-executable".to_string();
		} else if sample.starts_with(b"MZ") {
			file_type = "DOS/Windows executable (PE format)".to_string();
			mime_type = "application/x-dosexec".to_string();
		} else if sample.starts_with(b"PK\x03\x04") {
			file_type = "Zip archive data".to_string();
			mime_type = "application/zip".to_string();
		} else if sample.starts_with(b"%PDF-") {
			file_type = "PDF document".to_string();
			mime_type = "application/pdf".to_string();
		} else if sample.starts_with(b"\x1f\x8b") {
			file_type = "gzip compressed data".to_string();
			mime_type = "application/gzip".to_string();
		} else if sample.starts_with(b"7z\xbc\xaf\x27\x1c") {
			file_type = "7-zip archive data".to_string();
			mime_type = "application/x-7z-compressed".to_string();
		} else if sample.starts_with(b"SQLite format 3\0") {
			file_type = "SQLite 3.x database".to_string();
			mime_type = "application/x-sqlite3".to_string();
		} else if contains_null || !is_utf8 {
			file_type = "Binary data".to_string();
		} else {
			file_type = "Text document".to_string();
			mime_type = "text/plain".to_string();
		}
	}

	let is_binary = contains_null
		|| (!is_utf8 && !mime_type.starts_with("text/"))
		|| mime_type.starts_with("application/x-")
		|| mime_type == "application/octet-stream"
		|| mime_type == "application/pdf"
		|| mime_type == "application/zip"
		|| (!mime_type.starts_with("text/")
			&& !mime_type.starts_with("image/")
			&& !mime_type.ends_with("+xml")
			&& !mime_type.ends_with("+json")
			&& mime_type != "application/json"
			&& mime_type != "application/javascript"
			&& mime_type != "application/xml");

	Ok(FileInspectionResult {
		is_binary,
		file_type,
		mime_type,
		size,
	})
}

#[tauri::command]
fn read_file_hex(
	file_path: String,
	offset: u64,
	max_bytes: Option<usize>,
) -> Result<HexViewResult, String> {
	use std::io::{Read, Seek, SeekFrom};
	let clean_path = expand_path(&file_path);
	let metadata = fs::metadata(&clean_path)
		.map_err(|e| format!("Failed to read metadata for '{}': {}", clean_path, e))?;
	let total_size = metadata.len();

	let mut file = fs::File::open(&clean_path)
		.map_err(|e| format!("Failed to open '{}': {}", clean_path, e))?;

	if offset < total_size {
		file.seek(SeekFrom::Start(offset))
			.map_err(|e| format!("Failed to seek to offset {}: {}", offset, e))?;
	}

	let limit = max_bytes.unwrap_or(4096); // Default 4KB chunk (256 lines)
	let mut buffer = vec![0u8; limit];
	let bytes_read = file.read(&mut buffer).unwrap_or(0);
	let slice = &buffer[..bytes_read];

	let mut lines = Vec::new();
	for (chunk_idx, chunk) in slice.chunks(16).enumerate() {
		let line_offset = offset + (chunk_idx * 16) as u64;
		let offset_str = format!("{:08X}", line_offset);

		let mut hex_part1 = String::new();
		let mut hex_part2 = String::new();
		let mut ascii_part = String::new();

		for (i, &b) in chunk.iter().enumerate() {
			let byte_str = format!("{:02X}", b);
			if i < 8 {
				if !hex_part1.is_empty() {
					hex_part1.push(' ');
				}
				hex_part1.push_str(&byte_str);
			} else {
				if !hex_part2.is_empty() {
					hex_part2.push(' ');
				}
				hex_part2.push_str(&byte_str);
			}

			if (32..=126).contains(&b) {
				ascii_part.push(b as char);
			} else {
				ascii_part.push('.');
			}
		}

		// Pad hex parts if chunk has fewer than 16 bytes
		if chunk.len() < 8 {
			let missing = 8 - chunk.len();
			for _ in 0..missing {
				if !hex_part1.is_empty() {
					hex_part1.push(' ');
				}
				hex_part1.push_str("  ");
			}
		}
		if chunk.len() < 16 {
			let present_in_p2 = if chunk.len() > 8 { chunk.len() - 8 } else { 0 };
			let missing = 8 - present_in_p2;
			for _ in 0..missing {
				if !hex_part2.is_empty() {
					hex_part2.push(' ');
				}
				hex_part2.push_str("  ");
			}
		}

		lines.push(HexLine {
			offset: offset_str,
			hex_part1,
			hex_part2,
			ascii: ascii_part,
		});
	}

	let has_more = (offset + bytes_read as u64) < total_size;

	// Get file type description
	let mut file_type = String::from("Binary data");
	#[cfg(unix)]
	{
		if let Ok(output) = Command::new("file")
			.args(["-b", "-L", &clean_path])
			.output()
		{
			if output.status.success() {
				let desc = String::from_utf8_lossy(&output.stdout).trim().to_string();
				if !desc.is_empty() {
					file_type = desc;
				}
			}
		}
	}

	Ok(HexViewResult {
		total_size,
		file_type,
		lines,
		bytes_shown: (offset + bytes_read as u64) as usize,
		has_more,
	})
}

#[tauri::command]
fn write_file_text(file_path: String, content: String) -> Result<(), String> {
	let clean_path = expand_path(&file_path);
	if let Some(parent) = std::path::Path::new(&clean_path).parent() {
		let _ = fs::create_dir_all(parent);
	}
	fs::write(&clean_path, content)
		.map_err(|e| format!("Failed to write file '{}': {}", clean_path, e))
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
	fs::create_dir_all(&clean_path)
		.map_err(|e| format!("Failed to create directory '{}': {}", clean_path, e))
}

#[tauri::command]
fn delete_workspace_file(repo_path: Option<String>, file_path: String) -> Result<(), String> {
	let clean_path = if let Some(repo) = repo_path {
		let repo_clean = expand_path(&repo);
		let p = Path::new(&file_path);
		if p.is_absolute() {
			expand_path(&file_path)
		} else {
			let relative = file_path.trim_start_matches('/').trim_start_matches("./");
			Path::new(&repo_clean)
				.join(relative)
				.to_string_lossy()
				.to_string()
		}
	} else {
		expand_path(&file_path)
	};

	let target = Path::new(&clean_path);
	if !target.exists() {
		return Err(format!("File or directory '{}' does not exist", clean_path));
	}

	if target.is_dir() {
		fs::remove_dir_all(target)
			.map_err(|e| format!("Failed to delete directory '{}': {}", clean_path, e))?;
	} else {
		fs::remove_file(target)
			.map_err(|e| format!("Failed to delete file '{}': {}", clean_path, e))?;
	}

	Ok(())
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

pub struct ActiveInstanceListener {
	pub socket_path: PathBuf,
	pub info_path: PathBuf,
}

static ACTIVE_LISTENER: Mutex<Option<ActiveInstanceListener>> = Mutex::new(None);

pub fn normalize_workspace_path(raw: &str) -> Option<String> {
	let expanded = expand_path(raw);
	let p = PathBuf::from(&expanded);
	let abs = if p.is_absolute() {
		p
	} else {
		std::env::current_dir()
			.unwrap_or_else(|_| PathBuf::from("."))
			.join(p)
	};
	if let Ok(canon) = abs.canonicalize() {
		Some(canon.to_string_lossy().to_string())
	} else if abs.exists() {
		Some(abs.to_string_lossy().to_string())
	} else {
		Some(expanded)
	}
}

pub fn parse_highlight_range(raw: &str) -> Option<(u32, u32)> {
	let raw = raw.trim();
	if let Some((s, e)) = raw.split_once('-').or_else(|| raw.split_once(':')) {
		if let (Ok(start), Ok(end)) = (s.trim().parse::<u32>(), e.trim().parse::<u32>()) {
			return Some((start.min(end), start.max(end)));
		}
	} else if let Ok(line) = raw.parse::<u32>() {
		return Some((line, line));
	}
	None
}

#[derive(Debug, Clone)]
pub struct ParsedCliArgs {
	pub positional: Vec<String>,
	pub goto_file: Option<String>,
	pub highlight_start: Option<u32>,
	pub highlight_end: Option<u32>,
}

pub fn parse_cli_arguments(raw_args: &[String]) -> ParsedCliArgs {
	let mut positional = Vec::new();
	let mut goto_file: Option<String> = None;
	let mut highlight_str: Option<String> = None;

	let mut i = 0;
	while i < raw_args.len() {
		let arg = &raw_args[i];
		if arg == "--goto" {
			i += 1;
			if i < raw_args.len() {
				goto_file = Some(raw_args[i].clone());
			}
		} else if arg.starts_with("--goto=") {
			goto_file = Some(arg["--goto=".len()..].to_string());
		} else if arg == "--highlight" {
			i += 1;
			if i < raw_args.len() {
				highlight_str = Some(raw_args[i].clone());
			}
		} else if arg.starts_with("--highlight=") {
			highlight_str = Some(arg["--highlight=".len()..].to_string());
		} else if arg == "--is-open" || arg == "--list-instances" {
			// boolean flags without value
		} else if arg.starts_with('-') {
			// unknown flag
		} else {
			positional.push(arg.clone());
		}
		i += 1;
	}

	let (highlight_start, highlight_end) = highlight_str
		.as_deref()
		.and_then(parse_highlight_range)
		.map(|(s, e)| (Some(s), Some(e)))
		.unwrap_or((None, None));

	ParsedCliArgs {
		positional,
		goto_file,
		highlight_start,
		highlight_end,
	}
}

pub fn get_workspace_socket_path(canon_ws: &str) -> PathBuf {
	use std::collections::hash_map::DefaultHasher;
	use std::hash::{Hash, Hasher};
	let mut s = DefaultHasher::new();
	canon_ws.hash(&mut s);
	let hash = format!("{:016x}", s.finish());
	let instances_dir = expand_path("~/.vide/instances");
	let _ = std::fs::create_dir_all(&instances_dir);
	PathBuf::from(instances_dir).join(format!("{}.sock", hash))
}

pub fn get_workspace_info_path(canon_ws: &str) -> PathBuf {
	use std::collections::hash_map::DefaultHasher;
	use std::hash::{Hash, Hasher};
	let mut s = DefaultHasher::new();
	canon_ws.hash(&mut s);
	let hash = format!("{:016x}", s.finish());
	let instances_dir = expand_path("~/.vide/instances");
	let _ = std::fs::create_dir_all(&instances_dir);
	PathBuf::from(instances_dir).join(format!("{}.json", hash))
}

#[tauri::command]
fn register_active_workspace(app: tauri::AppHandle, workspace_path: String) -> Result<(), String> {
	let canon_ws =
		normalize_workspace_path(&workspace_path).unwrap_or_else(|| expand_path(&workspace_path));
	let sock_path = get_workspace_socket_path(&canon_ws);
	let info_path = get_workspace_info_path(&canon_ws);

	let mut guard = ACTIVE_LISTENER.lock().map_err(|e| e.to_string())?;

	if let Some(ref active) = *guard {
		if active.socket_path == sock_path {
			return Ok(());
		}
	}

	if let Some(old) = guard.take() {
		let _ = std::fs::remove_file(&old.socket_path);
		let _ = std::fs::remove_file(&old.info_path);
	}

	if sock_path.exists() {
		let _ = std::fs::remove_file(&sock_path);
	}

	#[cfg(unix)]
	{
		let listener = UnixListener::bind(&sock_path)
			.map_err(|e| format!("Failed to bind unix socket at {:?}: {}", sock_path, e))?;

		let info = serde_json::json!({
			"pid": std::process::id(),
			"workspace": canon_ws,
			"socket": sock_path.to_string_lossy(),
		});
		let _ = std::fs::write(&info_path, info.to_string());

		*guard = Some(ActiveInstanceListener {
			socket_path: sock_path.clone(),
			info_path: info_path.clone(),
		});

		let app_handle = app.clone();
		std::thread::spawn(move || {
			for stream in listener.incoming() {
				match stream {
					Ok(mut stream) => {
						let mut reader = BufReader::new(&stream);
						let mut line = String::new();
						if reader.read_line(&mut line).is_ok() {
							if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
								let action = val
									.get("action")
									.and_then(|v| v.as_str())
									.unwrap_or("focus");

								if let Some(win) = app_handle.get_webview_window("main") {
									let _ = win.unminimize();
									let _ = win.show();
									let _ = win.set_focus();
								}

								let file = val
									.get("file")
									.and_then(|v| v.as_str())
									.map(|s| s.to_string());
								let hl_start = val
									.get("highlight_start")
									.and_then(|v| v.as_u64())
									.map(|n| n as u32);
								let hl_end = val
									.get("highlight_end")
									.and_then(|v| v.as_u64())
									.map(|n| n as u32);

								if action == "goto" || file.is_some() || hl_start.is_some() {
									let payload = serde_json::json!({
										"file": file,
										"highlight_start": hl_start,
										"highlight_end": hl_end,
									});
									let _ = app_handle.emit("vide://navigate", payload);
								}
							}
						}
						let _ = stream.write_all(b"OK\n");
					}
					Err(_) => break,
				}
			}
		});
	}

	#[cfg(not(unix))]
	{
		let _ = app;
		let _ = canon_ws;
		let _ = sock_path;
		let _ = info_path;
		let _ = guard;
	}

	Ok(())
}

#[tauri::command]
fn get_cli_launch_payload() -> Result<CliLaunchPayload, String> {
	let raw_args: Vec<String> = std::env::args().skip(1).collect();
	let parsed = parse_cli_arguments(&raw_args);
	let positional = parsed.positional;
	let mut goto_file = parsed.goto_file;
	let hl_start = parsed.highlight_start;
	let hl_end = parsed.highlight_end;

	if goto_file.is_none() && positional.len() > 1 {
		goto_file = Some(positional[1].clone());
	}

	if positional.is_empty() {
		return Ok(CliLaunchPayload {
			workspace_path: None,
			files: Vec::new(),
			target_file: goto_file,
			highlight_start: hl_start,
			highlight_end: hl_end,
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
		target_file: goto_file,
		highlight_start: hl_start,
		highlight_end: hl_end,
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

const DEFAULT_MODEL_URL: &str = "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf";
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

					let final_size = fs::metadata(&clean_copy)
						.map(|m| m.len())
						.unwrap_or(current_bytes);
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
		return Err(format!(
			"Model file '{}' does not exist. Please download it first.",
			clean_model
		));
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

	let child = cmd
		.spawn()
		.map_err(|e| format!("Failed to spawn llama-server: {}", e))?;

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
			Ok(None) => Ok(AiSidecarStatus {
				running: true,
				pid: Some(proc.child.id()),
				port: proc.port,
				model_path: Some(proc.model_path.clone()),
			}),
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
		.args(["-C", &clean_repo, "diff", "--staged", "."])
		.output()
		.map_err(|e| format!("Failed to run git diff --staged: {}", e))?;

	let staged_text = String::from_utf8_lossy(&staged.stdout).trim().to_string();
	if !staged_text.is_empty() {
		return Ok(staged_text);
	}

	let unstaged = Command::new("git")
		.args(["-C", &clean_repo, "diff", "."])
		.output()
		.map_err(|e| format!("Failed to run git diff: {}", e))?;

	let unstaged_text = String::from_utf8_lossy(&unstaged.stdout).trim().to_string();
	if !unstaged_text.is_empty() {
		return Ok(unstaged_text);
	}

	let status = Command::new("git")
		.args(["-C", &clean_repo, "status", "--short", "."])
		.output()
		.map_err(|e| format!("Failed to run git status: {}", e))?;

	Ok(String::from_utf8_lossy(&status.stdout).trim().to_string())
}

#[tauri::command]
fn run_git_read(
	repo_path: String,
	subcommand: String,
	args: Option<Vec<String>>,
) -> Result<String, String> {
	let clean_repo = expand_path(&repo_path);
	let sub = subcommand.trim().to_lowercase();

	// Strictly allow only safe read-only git subcommands
	const ALLOWED_SUBCOMMANDS: &[&str] = &[
		"status",
		"diff",
		"log",
		"show",
		"branch",
		"blame",
		"rev-parse",
		"describe",
	];

	if !ALLOWED_SUBCOMMANDS.contains(&sub.as_str()) {
		return Err(format!(
			"Permission denied: Git subcommand '{}' is not allowed. Only read-only subcommands (status, diff, log, show, branch, blame) are permitted.",
			subcommand
		));
	}

	// Validate arguments: reject flags that write or modify
	let user_args = args.unwrap_or_default();
	for arg in &user_args {
		let lower = arg.to_lowercase();
		if lower == "--delete"
			|| lower == "-d"
			|| lower == "-D"
			|| lower == "--force"
			|| lower == "-f"
			|| lower == "--hard"
			|| lower == "--mixed"
			|| lower == "--soft"
			|| lower.starts_with("--exec")
			|| lower.starts_with("--output")
			|| lower.starts_with("--edit")
		{
			return Err(format!("Permission denied: Disallowed Git flag '{}'.", arg));
		}
	}

	let mut cmd = Command::new("git");
	cmd.args(["-C", &clean_repo, "--no-pager", &sub]);
	cmd.args(&user_args);

	let output = cmd
		.output()
		.map_err(|e| format!("Failed to execute git {}: {}", sub, e))?;

	let stdout = String::from_utf8_lossy(&output.stdout);
	let stderr = String::from_utf8_lossy(&output.stderr);

	if !output.status.success() && stdout.trim().is_empty() {
		return Err(format!(
			"Git error (code {:?}): {}",
			output.status.code(),
			stderr.trim()
		));
	}

	let mut full_output = stdout.to_string();
	if !stderr.trim().is_empty() {
		if !full_output.is_empty() {
			full_output.push_str("\n--- stderr ---\n");
		}
		full_output.push_str(&stderr);
	}

	// Cap output to 64KB to avoid overwhelming memory or LLM context
	if full_output.len() > 64 * 1024 {
		let truncated: String = full_output.chars().take(64 * 1024).collect();
		return Ok(format!(
			"{}\n\n[... Output truncated: exceeded 64KB limit ...]",
			truncated
		));
	}

	Ok(full_output)
}

#[tauri::command]
fn set_window_title(window: tauri::Window, title: String) -> Result<(), String> {
	window.set_title(&title).map_err(|e| e.to_string())
}

#[tauri::command]
fn log_to_terminal(level: String, message: String) {
	println!("[{}] {}", level.to_uppercase(), message);
	let _ = std::io::stdout().flush();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let raw_args: Vec<String> = std::env::args().skip(1).collect();

	// 1. Handle --list-instances
	if raw_args.iter().any(|a| a == "--list-instances") {
		let instances_dir = expand_path("~/.vide/instances");
		let p = Path::new(&instances_dir);
		let mut count = 0;
		if p.is_dir() {
			if let Ok(entries) = std::fs::read_dir(p) {
				for entry in entries.flatten() {
					let path = entry.path();
					if path.extension().and_then(|e| e.to_str()) == Some("json") {
						if let Ok(content) = std::fs::read_to_string(&path) {
							if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
								let pid = v.get("pid").and_then(|p| p.as_u64()).unwrap_or(0);
								let ws = v.get("workspace").and_then(|w| w.as_str()).unwrap_or("");
								let is_alive =
									pid > 0 && Path::new(&format!("/proc/{}", pid)).exists();
								if is_alive {
									if count == 0 {
										println!("{:<10} {:<10} {}", "PID", "STATUS", "WORKSPACE");
										println!("{:-<60}", "");
									}
									println!("{:<10} {:<10} {}", pid, "running", ws);
									count += 1;
								} else {
									let _ = std::fs::remove_file(&path);
									let sock = path.with_extension("sock");
									let _ = std::fs::remove_file(&sock);
								}
							}
						}
					}
				}
			}
		}
		if count == 0 {
			println!("No active Vector IDE instances found.");
		}
		std::process::exit(0);
	}

	// 2. Handle --is-open
	if raw_args.iter().any(|a| a == "--is-open") {
		let positional: Vec<String> = raw_args
			.iter()
			.filter(|a| !a.starts_with('-'))
			.cloned()
			.collect();
		let raw_ws = positional
			.first()
			.cloned()
			.unwrap_or_else(|| ".".to_string());
		let ws = normalize_workspace_path(&raw_ws).unwrap_or_else(|| expand_path(&raw_ws));
		let sock_path = get_workspace_socket_path(&ws);
		#[cfg(unix)]
		{
			if UnixStream::connect(&sock_path).is_ok() {
				println!("true");
				std::process::exit(0);
			} else {
				println!("false");
				std::process::exit(1);
			}
		}
		#[cfg(not(unix))]
		{
			let _ = sock_path;
			println!("false");
			std::process::exit(1);
		}
	}

	// 3. Handle IPC to existing running instance if workspace is provided
	let parsed = parse_cli_arguments(&raw_args);
	let positional = parsed.positional;
	let mut goto_file = parsed.goto_file;
	let hl_start = parsed.highlight_start;
	let hl_end = parsed.highlight_end;

	let mut workspace_opt = positional.first().and_then(|w| normalize_workspace_path(w));

	if workspace_opt.is_none() && !positional.is_empty() {
		let candidate_file = &positional[0];
		if Path::new(candidate_file).exists() || !candidate_file.starts_with('-') {
			workspace_opt = normalize_workspace_path(".");
			if goto_file.is_none() {
				goto_file = Some(candidate_file.clone());
			}
		}
	} else if goto_file.is_none() && positional.len() > 1 {
		goto_file = Some(positional[1].clone());
	}

	if let Some(ref ws) = workspace_opt {
		let sock_path = get_workspace_socket_path(ws);
		#[cfg(unix)]
		{
			if let Ok(mut stream) = UnixStream::connect(&sock_path) {
				let action = if goto_file.is_some() || hl_start.is_some() {
					"goto"
				} else {
					"focus"
				};
				let msg = serde_json::json!({
					"action": action,
					"workspace": ws,
					"file": goto_file,
					"highlight_start": hl_start,
					"highlight_end": hl_end,
				});
				let mut msg_str = serde_json::to_string(&msg).unwrap_or_default();
				msg_str.push('\n');
				if stream.write_all(msg_str.as_bytes()).is_ok() {
					let mut reader = BufReader::new(stream);
					let mut response = String::new();
					let _ = reader.read_line(&mut response);
					println!(
						"Target navigated in existing Vector IDE instance for workspace: {}",
						ws
					);
					std::process::exit(0);
				}
			} else {
				if sock_path.exists() {
					let _ = std::fs::remove_file(&sock_path);
				}
				let info_path = get_workspace_info_path(ws);
				if info_path.exists() {
					let _ = std::fs::remove_file(&info_path);
				}
			}
		}
		#[cfg(not(unix))]
		{
			let _ = sock_path;
		}
	}

	#[tauri::command]
	fn exit_app(app_handle: tauri::AppHandle) {
		app_handle.exit(0);
	}

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
		.on_window_event(|window, event| match event {
			tauri::WindowEvent::CloseRequested { api, .. } => {
				api.prevent_close();
				let _ = window.emit("window-close-requested", ());
			}
			tauri::WindowEvent::Destroyed => {
				if let Ok(mut guard) = ACTIVE_LISTENER.lock() {
					if let Some(active) = guard.take() {
						let _ = std::fs::remove_file(&active.socket_path);
						let _ = std::fs::remove_file(&active.info_path);
					}
				}
				if let Ok(mut guard) = AI_SIDECAR.lock() {
					if let Some(mut proc) = guard.take() {
						let _ = proc.child.kill();
					}
				}
			}
			_ => {}
		})
		.invoke_handler(tauri::generate_handler![
			resolve_path,
			register_active_workspace,
			get_git_branch,
			get_git_status,
			get_git_diff_baseline,
			revert_git_file,
			get_git_commits,
			get_git_commit_details,
			get_git_commit_file_diff_content,
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
			git_untrack_file,
			delete_workspace_file,
			check_ai_model_status,
			download_ai_model,
			cancel_ai_model_download,
			get_git_branches,
			switch_git_branch,
			create_git_branch,
			get_git_tags,
			create_git_tag,
			set_window_title,
			log_to_terminal,
			inspect_file,
			read_file_hex,
			run_git_read,
			exit_app,
		])
		.run(tauri::generate_context!())
		.expect("error while building tauri application");
}
