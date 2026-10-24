/**
 * workspace.service.ts - Workspace directory state, file trees, and buffer management
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import { Injectable, signal, computed, inject, NgZone, effect, untracked, ApplicationRef } from '@angular/core';
import {
	WorkspaceFile,
	FileTreeNode,
	detectLanguageFromFilename,
	detectLanguage,
	isImageFile,
	getImageMimeType,
	CliLaunchPayload,
	CliFileToOpen,
	GitCommit,
	GitSyncStatus,
	GitBranchItem,
	HexViewResult,
	HexLine,
	FileInspectionResult,
	isBinaryFile,
} from '../models/file.model';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export function isTauriApp(): boolean {
	if (typeof window === 'undefined') return false;
	return isTauri() || typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';
}

export function terminalLog(level: string, message: string): void {
	if (typeof window !== 'undefined') {
		console.log(`[${level}] ${message}`);
		if (isTauriApp()) {
			invoke('log_to_terminal', { level, message }).catch(() => {});
		}
	}
}

export interface GrepResult {
	file: WorkspaceFile;
	lineNumber: number;
	lineText: string;
	matchStart?: number;
	matchLength?: number;
}

export interface GrepOptions {
	matchCase?: boolean;
	wholeWord?: boolean;
	isRegex?: boolean;
}

export interface FileGrepGroup {
	file: WorkspaceFile;
	matches: GrepResult[];
	expanded: boolean;
}

export interface GitIndexEntry {
	path: string;
	size: number;
	sha: string;
	mtime: number;
}

export interface RecentWorkspaceItem {
	name: string;
	path: string;
}

// Heavy directories skipped during recursive background search indexing
const BACKGROUND_INDEX_IGNORED_DIRS = new Set([
	'.git',
	'.vide',
	'node_modules',
	'vendor',
	'.cache',
	'dist',
	'build',
	'.angular',
]);

@Injectable({
	providedIn: 'root',
})
export class WorkspaceService {
	private readonly ngZone = inject(NgZone);
	private readonly appRef = inject(ApplicationRef);
	readonly workspaceName = signal<string>('NO FOLDER OPENED');
	readonly isRealWorkspace = signal<boolean>(false);
	readonly statusNotification = signal<string>('');

	// Whether hidden files (starting with '.') are visible (toggleable via Ctrl+H or toolbar button)
	readonly showHiddenFiles = signal<boolean>(
		typeof window !== 'undefined'
			? localStorage.getItem('vector_show_hidden_files') === 'true'
			: false
	);

	// Scanning / loading state
	readonly isScanning = signal<boolean>(false);
	readonly isRefreshingTree = signal<boolean>(false);
	readonly scanProgress = signal<string>('');

	// All files in workspace map for active tabs & retrieval
	readonly files = signal<WorkspaceFile[]>([]);

	// Hierarchical file tree with on-demand shallow loading
	readonly fileTree = signal<FileTreeNode[]>([]);

	// Open tabs
	readonly openTabs = signal<WorkspaceFile[]>([]);

	// Currently active file ID
	readonly activeFileId = signal<string>('');

	// Active file computed signal
	readonly activeFile = computed<WorkspaceFile | null>(() => {
		const currentId = this.activeFileId();
		if (!currentId) return null;
		return (
			this.files().find((f) => f.id === currentId) ??
			this.openTabs().find((t) => t.id === currentId) ??
			null
		);
	});

	// Active search/modal mode
	readonly activeModal = signal<
		'grep' | 'file-search' | 'new-file' | 'new-folder' | 'open-folder-path' | 'indentation' | 'change-language' | 'unsaved-changes' | 'ai-settings' | 'ai-download' | 'delete-file-confirm' | 'git-untrack-confirm' | 'git-branches' | 'git-create-tag' | 'references' | null
	>(null);
	readonly pendingReferencesSymbol = signal<string>('');
	readonly pendingReferences = signal<GrepResult[]>([]);
	readonly isSearchingReferences = signal<boolean>(false);
	readonly pendingUnsavedFile = signal<WorkspaceFile | null>(null);
	readonly pendingDeleteFile = signal<WorkspaceFile | null>(null);
	readonly pendingGitUntrackFile = signal<WorkspaceFile | null>(null);

	// Line jump request (from Grep search or Go to Definition)
	readonly pendingLineJump = signal<{ lineNumber: number; column?: number; fileId?: string } | null>(null);

	// Programmatic content replacement request (from AI tools / external)
	readonly pendingContentReplacement = signal<{ fileId: string; newContent: string } | null>(null);

	// Line highlight range request (from Ada / CLI goto)
	readonly pendingHighlight = signal<{
		fileId: string;
		highlightStart: number;
		highlightEnd: number;
	} | null>(null);

	// Background indexing state for real workspace search & grep
	readonly isIndexing = signal<boolean>(false);
	readonly indexedFileCount = signal<number>(0);

	// Git Branch (default null)
	readonly gitBranch = signal<string | null>(null);
	readonly gitBranches = signal<GitBranchItem[]>([]);
	readonly gitTags = signal<string[]>([]);
	readonly isLoadingBranches = signal<boolean>(false);
	readonly recentCommits = signal<GitCommit[]>([]);
	readonly isCommitting = signal<boolean>(false);
	readonly isLoadingCommits = signal<boolean>(false);
	readonly gitSyncStatus = signal<GitSyncStatus | null>(null);
	readonly isPushing = signal<boolean>(false);

	// Diff Mode state
	readonly diffModeActive = signal<boolean>(false);
	readonly activeDiffFile = signal<WorkspaceFile | null>(null);
	readonly diffRenderSideBySide = signal<boolean>(true);

	// Markdown & HTML Preview Mode state ('none' | 'split' | 'full')
	readonly previewMode = signal<'none' | 'split' | 'full'>('none');

	// Changed files computed signal (files that differ from last commit / HEAD)
	readonly changedFiles = computed(() => {
		if (!this.isRealWorkspace()) return [];
		const isGit = !!this.gitBranch();
		const list = this.files().filter((f) => {
			if (isGit) {
				return (
					f.isModified ||
					f.gitStatus === 'added' ||
					f.gitStatus === 'modified' ||
					f.gitStatus === 'untracked' ||
					f.gitStatus === 'deleted'
				);
			}
			return f.isModified || (f.originalContent !== undefined && f.content !== f.originalContent);
		});
		return list.sort((a, b) => {
			// Show modified files first, then untracked/added
			if (a.gitStatus === 'modified' && b.gitStatus !== 'modified') return -1;
			if (a.gitStatus !== 'modified' && b.gitStatus === 'modified') return 1;
			return a.path.localeCompare(b.path);
		});
	});

	// Indentation configuration (default fallback: Tabs, size 4)
	readonly defaultIndentType = signal<'tabs' | 'spaces'>('tabs');
	readonly defaultTabSize = signal<number>(4);
	readonly indentType = signal<'tabs' | 'spaces'>('tabs');
	readonly tabSize = signal<number>(4);
	readonly pendingRedetectIndentation = signal<string | null>(null);
	readonly pendingConvertIndentation = signal<{
		fileId: string;
		type: 'tabs' | 'spaces';
		size: number;
		fromType?: 'tabs' | 'spaces';
		fromSize?: number;
	} | null>(null);

	// Active language change request
	readonly pendingLanguageChange = signal<{ fileId: string; language: string } | null>(null);

	// Sticky Scroll toggle (default: true)
	readonly stickyScrollEnabled = signal<boolean>(true);

	// Primary Side Bar visibility (default: true)
	readonly sidebarVisible = signal<boolean>(true);

	// Primary Side Bar width in pixels (default: 250, persisted in localStorage)
	readonly sidebarWidth = signal<number>(this.getInitialSidebarWidth());

	// Primary Side Bar active view ('explorer', 'search', or 'git-changes')
	readonly sidebarView = signal<'explorer' | 'search' | 'git-changes'>('explorer');

	// Desktop native Tauri state
	readonly isDesktop = signal<boolean>(isTauriApp());
	readonly nativeWorkspacePath = signal<string | null>(null);

	// Parent workspace path computed
	readonly parentWorkspacePath = computed(() => {
		const current = this.nativeWorkspacePath();
		if (!current) return null;
		const parts = current.replace(/\/+$/, '').split('/');
		if (parts.length > 1) {
			parts.pop();
			return parts.join('/') || '/';
		}
		return null;
	});

	// Recent workspace persistence
	readonly recentWorkspaceName = signal<string | null>(null);
	readonly recentWorkspaces = signal<RecentWorkspaceItem[]>([]);
	private recentDirHandle: any = null;
	private recentGitDirHandle: any = null;
	private autoSyncIntervalId: any = null;
	private isAutoSyncing = false;
	readonly isRestoringSession = signal<boolean>(false);
	private saveSessionTimeout: any = null;
	private beforeCloseCallbacks: Array<() => void | Promise<void>> = [];

	constructor() {
		this.isDesktop.set(isTauriApp());
		this.loadRecentWorkspaces();
		this.initRecentWorkspace();
		this.setupAutoSync();
		this.setupSessionPersistence();
		this.setupAutoReveal();
		this.setupIpcNavigationListener();
		if (typeof window !== 'undefined') {
			window.addEventListener('beforeunload', () => {
				if (this.isRealWorkspace()) {
					this.saveWorkspaceSessionState();
				}
			});
		}
	}

	private setupIpcNavigationListener(): void {
		if (!isTauriApp()) return;
		listen<{ file?: string | null; highlight_start?: number; highlight_end?: number }>(
			'vide://navigate',
			async (event) => {
				const payload = event.payload;
				if (payload) {
					if (payload.file) {
						await this.navigateToFile(payload.file, payload.highlight_start, payload.highlight_end);
					} else if (payload.highlight_start !== undefined && payload.highlight_start !== null) {
						const active = this.activeFile();
						if (active) {
							const s = payload.highlight_start;
							const e = payload.highlight_end ?? payload.highlight_start;
							this.pendingHighlight.set({
								fileId: active.id,
								highlightStart: s,
								highlightEnd: e,
							});
						}
					}
				}
			}
		).catch((err) => {
			console.warn('Failed to register vide://navigate listener:', err);
		});
	}

	public async navigateToFile(
		filePath: string,
		highlightStart?: number | null,
		highlightEnd?: number | null
	): Promise<void> {
		const rootPath = this.nativeWorkspacePath();
		const cleanPath = filePath.trim();
		if (!cleanPath) return;

		let relPath = cleanPath;
		if (rootPath && cleanPath.startsWith(rootPath)) {
			relPath = cleanPath.slice(rootPath.length).replace(/^\//, '');
		} else {
			relPath = cleanPath.replace(/^\//, '');
		}

		let fileToOpen = this.files().find(
			(f) => f.path === relPath || f.id === relPath || f.fsPath === cleanPath || f.name === relPath
		);

		if (!fileToOpen && rootPath) {
			const fullFsPath = cleanPath.startsWith('/')
				? cleanPath
				: rootPath.endsWith('/')
				? `${rootPath}${relPath}`
				: `${rootPath}/${relPath}`;
			const baseName = relPath.split('/').pop() || relPath;
			fileToOpen = {
				id: relPath,
				name: baseName,
				path: relPath,
				fsPath: fullFsPath,
				language: detectLanguageFromFilename(baseName),
				content: '',
				isLoaded: false,
				isModified: false,
			};
			this.files.update((prev) => [...prev, fileToOpen!]);
		}

		if (fileToOpen) {
			await this.openFile(fileToOpen);
			if (highlightStart !== undefined && highlightStart !== null) {
				const s = highlightStart;
				const e = highlightEnd ?? highlightStart;
				this.pendingHighlight.set({
					fileId: fileToOpen.id,
					highlightStart: s,
					highlightEnd: e,
				});
			}
		}
	}

	public setSidebarView(view: 'explorer' | 'search' | 'git-changes'): void {
		this.sidebarView.set(view);
		if (!this.sidebarVisible()) {
			this.sidebarVisible.set(true);
		}
	}

	public toggleSidebarView(view: 'explorer' | 'search' | 'git-changes'): void {
		if (this.sidebarView() === view && this.sidebarVisible()) {
			this.sidebarView.set('explorer');
		} else {
			this.sidebarView.set(view);
			this.sidebarVisible.set(true);
		}
	}

	private getInitialSidebarWidth(): number {
		if (typeof window === 'undefined') return 250;
		try {
			const saved = localStorage.getItem('vector_sidebar_width');
			if (saved) {
				const val = parseInt(saved, 10);
				if (!isNaN(val) && val >= 180 && val <= 1200) {
					return val;
				}
			}
		} catch {
			// ignore
		}
		return 250;
	}

	public setSidebarWidth(width: number): void {
		const maxWidth = typeof window !== 'undefined' ? Math.max(300, window.innerWidth - 200) : 800;
		const clamped = Math.max(180, Math.min(width, maxWidth));
		this.sidebarWidth.set(clamped);
		try {
			localStorage.setItem('vector_sidebar_width', clamped.toString());
		} catch {
			// ignore
		}
	}

	public async openDiffView(file: WorkspaceFile): Promise<void> {
		if (!file.isLoaded && (file.fsPath || file.handle || file.rawFile)) {
			try {
				let content = '';
				if (isTauriApp() && file.fsPath) {
					content = await invoke<string>('read_file_text', { filePath: file.fsPath });
				} else if (file.handle && typeof file.handle.getFile === 'function') {
					const fileObj = await file.handle.getFile();
					content = await fileObj.text();
				} else if (file.rawFile) {
					content = await file.rawFile.text();
				}
				file.content = content;
				file.isLoaded = true;
				this.files.update((files) =>
					files.map((f) => (f.id === file.id ? { ...f, content, isLoaded: true } : f))
				);
			} catch (err) {
				console.error('Failed to load file content for diff:', err);
			}
		}

		if (file.gitStatus === 'untracked' || file.gitStatus === 'added') {
			file.originalContent = '';
		} else if (isTauriApp() && this.nativeWorkspacePath()) {
			try {
				const baseline = await invoke<string>('get_git_diff_baseline', {
					repoPath: this.nativeWorkspacePath()!,
					filePath: file.path,
				});
				file.originalContent = baseline;
			} catch (e) {
				console.warn('Could not read baseline from native git:', e);
				file.originalContent = '';
			}
		} else if (file.originalContent === undefined) {
				try {
					const gitDir = this.recentGitDirHandle;
					if (gitDir) {
						let indexHandle: any = null;
						try {
							indexHandle = await gitDir.getFileHandle('index', { create: false });
						} catch {
							for await (const entry of gitDir.values()) {
								if (entry.name === 'index') { indexHandle = entry; break; }
							}
						}
						if (indexHandle) {
							const indexFile = await indexHandle.getFile();
							const indexMap = this.parseGitIndex(await indexFile.arrayBuffer());
							const normPath = file.path.replace(/^\.\//, '').replace(/^\//, '');
							const entry = indexMap.get(normPath);
							if (entry) {
								const orig = await this.readGitBlob(gitDir, entry.sha);
								file.originalContent = orig !== null ? orig : '';
							}
						}
					}
				} catch (e) {
					console.warn('Could not read baseline blob in openDiffView:', e);
				}
			}

		const currentTabs = this.openTabs();
		if (!currentTabs.some((tab) => tab.id === file.id)) {
			this.openTabs.set([...currentTabs, file]);
		}
		this.activeFileId.set(file.id);
		this.activeDiffFile.set(file);
		this.diffModeActive.set(true);
	}

	public closeDiffView(): void {
		this.diffModeActive.set(false);
		this.activeDiffFile.set(null);
	}

	public toggleDiffSideBySide(): void {
		this.diffRenderSideBySide.update((v) => !v);
	}

	public toggleCurrentFileDiff(): void {
		if (this.diffModeActive()) {
			this.closeDiffView();
		} else {
			const file = this.activeFile();
			if (file) {
				this.openDiffView(file);
			}
		}
	}

	public setPreviewMode(mode: 'none' | 'split' | 'full'): void {
		this.previewMode.set(mode);
	}

	public togglePreview(): void {
		const current = this.previewMode();
		if (current === 'none') {
			this.previewMode.set('split');
		} else {
			this.previewMode.set('none');
		}
	}

	public closePreview(): void {
		this.previewMode.set('none');
	}

	public async revertFile(fileId: string): Promise<void> {
		const file = this.files().find((f) => f.id === fileId);
		if (!file) return;

		if (isTauriApp() && this.nativeWorkspacePath()) {
			try {
				const restored = await invoke<string>('revert_git_file', {
					repoPath: this.nativeWorkspacePath()!,
					filePath: file.path,
				});
				file.content = restored;
				file.originalContent = restored;
				file.isModified = false;
				file.gitStatus = undefined;

				this.files.update((files) =>
					files.map((f) =>
						f.id === fileId
							? {
									...f,
									content: restored,
									originalContent: restored,
									isModified: false,
									gitStatus: undefined,
								}
							: f
					)
				);
				this.showNotification(`Reverted ${file.name} to HEAD baseline`);
				await this.refreshGitStatus();
				return;
			} catch (err) {
				console.error('Failed to revert native git file:', err);
			}
		}

		if (file.originalContent !== undefined) {
			const original = file.originalContent;
			file.content = original;
			file.isModified = false;
			file.gitStatus = undefined;

			if (file.handle && typeof file.handle.createWritable === 'function') {
				try {
					const writable = await file.handle.createWritable();
					await writable.write(original);
					await writable.close();
				} catch (wErr) {
					console.error('Failed to write reverted content to disk:', wErr);
				}
			}

			this.files.update((files) =>
				files.map((f) =>
					f.id === fileId
						? {
								...f,
								content: original,
								isModified: false,
								gitStatus: undefined,
							}
						: f
				)
			);
			this.showNotification(`Reverted ${file.name} to HEAD baseline`);
			await this.refreshGitStatus();
		}
	}

	public confirmDeleteFile(file: WorkspaceFile): void {
		this.pendingDeleteFile.set(file);
		this.openModal('delete-file-confirm');
	}

	private removeNodeFromTree(nodes: FileTreeNode[], target: WorkspaceFile): FileTreeNode[] {
		const normTarget = target.path.replace(/^\.\//, '').replace(/^\//, '');
		const targetFs = target.fsPath;

		return nodes
			.filter((n) => {
				if (n.id === target.id) return false;
				const normNode = n.path.replace(/^\.\//, '').replace(/^\//, '');
				if (normNode === normTarget) return false;
				if (targetFs && n.fsPath && n.fsPath === targetFs) return false;
				if (n.file && (n.file.id === target.id || n.file.path === target.path)) return false;
				return true;
			})
			.map((n) => {
				if (n.children && n.children.length > 0) {
					return {
						...n,
						children: this.removeNodeFromTree(n.children, target),
					};
				}
				return n;
			});
	}

	public async deleteFilePermanently(file: WorkspaceFile): Promise<boolean> {
		if (!file) return false;

		// 1. Close open tab if present
		this.forceCloseTab(file.id);
		const currentTabs = this.openTabs();
		const newTabs = currentTabs.filter(
			(t) => t.id !== file.id && t.path !== file.path && (!file.fsPath || t.fsPath !== file.fsPath)
		);
		if (newTabs.length !== currentTabs.length) {
			this.openTabs.set(newTabs);
			if (this.activeFileId() === file.id || !newTabs.some((t) => t.id === this.activeFileId())) {
				this.activeFileId.set(newTabs.length > 0 ? newTabs[newTabs.length - 1].id : '');
			}
		}

		if (this.activeDiffFile()?.id === file.id || this.activeDiffFile()?.path === file.path) {
			this.closeDiffView();
		}

		// 2. Perform deletion on disk if running under Tauri
		if (isTauriApp()) {
			try {
				await invoke('delete_workspace_file', {
					repoPath: this.nativeWorkspacePath(),
					filePath: file.path,
				});
			} catch (err: any) {
				console.error('Failed to delete file from disk:', err);
				this.showNotification(`Failed to delete file: ${err?.message || err}`);
				this.closeModal();
				return false;
			}
		}

		// 3. Remove file from in-memory state and file tree
		this.files.update((files) =>
			files.filter((f) => f.id !== file.id && f.path !== file.path && (!file.fsPath || f.fsPath !== file.fsPath))
		);
		this.fileTree.update((nodes) => this.removeNodeFromTree(nodes, file));

		// 4. Clean up active modal
		this.pendingDeleteFile.set(null);
		this.closeModal();
		this.showNotification(`✓ Deleted "${file.name}"`);

		// 5. Refresh File Tree from disk and Git status
		await this.refreshFileTree();
		await this.refreshGitStatus();
		return true;
	}

	public confirmGitUntrackFile(file: WorkspaceFile): void {
		this.pendingGitUntrackFile.set(file);
		this.openModal('git-untrack-confirm');
	}

	public async untrackFileFromGit(file: WorkspaceFile, addToGitignore = true): Promise<boolean> {
		if (!file) return false;

		if (isTauriApp() && this.nativeWorkspacePath()) {
			try {
				await invoke('git_untrack_file', {
					repoPath: this.nativeWorkspacePath()!,
					filePath: file.path,
					addToGitignore,
				});

				this.pendingGitUntrackFile.set(null);
				this.closeModal();
				this.showNotification(`✓ Removed "${file.name}" from Git tracking (file kept on disk)`);
				await this.refreshFileTree();
				await this.refreshGitStatus();
				return true;
			} catch (err: any) {
				console.error('Failed to untrack file from git:', err);
				this.showNotification(`Failed to untrack file: ${err?.message || err}`);
				this.closeModal();
				return false;
			}
		}
		return false;
	}

	private recentCommitsPromise: Promise<void> | null = null;
	public async loadRecentCommits(): Promise<void> {
		if (this.recentCommitsPromise) {
			return this.recentCommitsPromise;
		}
		if (!this.isRealWorkspace()) {
			this.recentCommits.set([]);
			return;
		}

		if (isTauriApp() && this.nativeWorkspacePath()) {
			this.recentCommitsPromise = (async () => {
				this.isLoadingCommits.set(true);
				try {
					const repoPath = this.nativeWorkspacePath()!;
					const commits = await invoke<
						Array<{
							hash: string;
							short_hash: string;
							author: string;
							date: string;
							message: string;
							tags?: string[];
						}>
					>('get_git_commits', { repoPath, limit: 15 });

					this.recentCommits.set(
						commits.map((c) => ({
							hash: c.hash,
							shortHash: c.short_hash,
							author: c.author,
							date: c.date,
							message: c.message,
							tags: c.tags || [],
						}))
					);
				} catch (err) {
					console.warn('Failed to load git commits:', err);
					this.recentCommits.set([]);
				} finally {
					this.isLoadingCommits.set(false);
					this.recentCommitsPromise = null;
				}
			})();
			return this.recentCommitsPromise;
		}
	}

	public async commitChanges(message: string): Promise<boolean> {
		if (!this.isRealWorkspace() || !isTauriApp() || !this.nativeWorkspacePath()) {
			this.showNotification('Commit is only supported in desktop mode');
			return false;
		}

		const repoPath = this.nativeWorkspacePath()!;
		const cleanMsg = message.trim();
		if (!cleanMsg) {
			this.showNotification('Please enter a commit message');
			return false;
		}

		this.ngZone.run(() => this.isCommitting.set(true));
		try {
			await invoke<string>('create_git_commit', { repoPath, message: cleanMsg });
			this.ngZone.run(() => {
				this.showNotification('Committed successfully');
			});
			// Synchronize in-memory content baseline so all saved edits are recognized as committed
			this.files.update((files) =>
				files.map((f) => ({
					...f,
					originalContent: f.savedContent ?? f.content,
					gitStatus: undefined,
				}))
			);
			this.openTabs.update((tabs) =>
				tabs.map((t) => ({
					...t,
					originalContent: t.savedContent ?? t.content,
					gitStatus: undefined,
				}))
			);
			if (this.diffModeActive()) {
				this.closeDiffView();
			}
			await this.refreshGitStatus();
			return true;
		} catch (err: any) {
			console.error('Failed to commit changes:', err);
			this.ngZone.run(() => {
				this.showNotification(`Commit failed: ${err.message || err}`);
			});
			return false;
		} finally {
			this.ngZone.run(() => this.isCommitting.set(false));
		}
	}

	private gitSyncStatusPromise: Promise<void> | null = null;
	public async loadGitSyncStatus(): Promise<void> {
		if (this.gitSyncStatusPromise) {
			return this.gitSyncStatusPromise;
		}
		if (!this.isRealWorkspace() || !isTauriApp() || !this.nativeWorkspacePath()) {
			this.gitSyncStatus.set(null);
			return;
		}

		this.gitSyncStatusPromise = (async () => {
			try {
				const repoPath = this.nativeWorkspacePath()!;
				const status = await invoke<GitSyncStatus>('get_git_sync_status', { repoPath });
				const prev = this.gitSyncStatus();
				if (
					!prev ||
					prev.ahead !== status.ahead ||
					prev.behind !== status.behind ||
					prev.has_remote !== status.has_remote ||
					prev.upstream !== status.upstream
				) {
					this.ngZone.run(() => this.gitSyncStatus.set(status));
				}
			} catch (err) {
				console.warn('Failed to load git sync status:', err);
				if (this.gitSyncStatus() !== null) {
					this.ngZone.run(() => this.gitSyncStatus.set(null));
				}
			} finally {
				this.gitSyncStatusPromise = null;
			}
		})();

		return this.gitSyncStatusPromise;
	}

	public async pushChanges(): Promise<boolean> {
		if (!this.isRealWorkspace() || !isTauriApp() || !this.nativeWorkspacePath()) {
			this.showNotification('Push is only supported in desktop mode');
			return false;
		}

		const repoPath = this.nativeWorkspacePath()!;
		this.ngZone.run(() => this.isPushing.set(true));
		try {
			await invoke<string>('git_push', { repoPath });
			this.ngZone.run(() => {
				this.showNotification('Pushed changes successfully to remote');
			});
			await this.refreshGitStatus();
			return true;
		} catch (err: any) {
			console.error('Failed to push changes:', err);
			const msg = typeof err === 'string' ? err : err?.message || 'Push failed';
			this.ngZone.run(() => {
				this.showNotification(`Push failed: ${msg}`);
			});
			return false;
		} finally {
			this.ngZone.run(() => this.isPushing.set(false));
		}
	}

	public async loadGitBranches(): Promise<GitBranchItem[]> {
		if (!this.isRealWorkspace() || !isTauriApp() || !this.nativeWorkspacePath()) {
			this.gitBranches.set([]);
			return [];
		}

		this.isLoadingBranches.set(true);
		try {
			const repoPath = this.nativeWorkspacePath()!;
			const list = await invoke<GitBranchItem[]>('get_git_branches', { repoPath });
			this.ngZone.run(() => this.gitBranches.set(list));
			return list;
		} catch (err: any) {
			console.warn('Failed to get git branches:', err);
			return [];
		} finally {
			this.ngZone.run(() => this.isLoadingBranches.set(false));
		}
	}

	public async switchGitBranch(branchName: string): Promise<boolean> {
		if (!this.isRealWorkspace() || !isTauriApp() || !this.nativeWorkspacePath()) {
			return false;
		}

		const repoPath = this.nativeWorkspacePath()!;
		try {
			await invoke<string>('switch_git_branch', { repoPath, branchName });
			this.ngZone.run(() => {
				this.showNotification(`✓ Switched to branch '${branchName}'`);
			});
			await this.refreshAll();
			return true;
		} catch (err: any) {
			const msg = typeof err === 'string' ? err : err?.message || 'Branch switch failed';
			this.ngZone.run(() => {
				this.showNotification(`Error switching branch: ${msg}`);
			});
			return false;
		}
	}

	public async createGitBranch(newBranchName: string, switchTo = true): Promise<boolean> {
		if (!this.isRealWorkspace() || !isTauriApp() || !this.nativeWorkspacePath()) {
			return false;
		}

		const repoPath = this.nativeWorkspacePath()!;
		try {
			await invoke<string>('create_git_branch', { repoPath, newBranchName, switchTo });
			this.ngZone.run(() => {
				this.showNotification(`✓ Created and switched to branch '${newBranchName}'`);
			});
			await this.refreshAll();
			return true;
		} catch (err: any) {
			const msg = typeof err === 'string' ? err : err?.message || 'Create branch failed';
			this.ngZone.run(() => {
				this.showNotification(`Error creating branch: ${msg}`);
			});
			return false;
		}
	}

	public async createGitTag(tagName: string, message?: string): Promise<boolean> {
		if (!this.isRealWorkspace() || !isTauriApp() || !this.nativeWorkspacePath()) {
			return false;
		}

		const repoPath = this.nativeWorkspacePath()!;
		try {
			await invoke<string>('create_git_tag', { repoPath, tagName, message: message || null });
			this.ngZone.run(() => {
				this.showNotification(`✓ Created tag '${tagName}'`);
			});
			await this.refreshAll();
			return true;
		} catch (err: any) {
			const msg = typeof err === 'string' ? err : err?.message || 'Create tag failed';
			this.ngZone.run(() => {
				this.showNotification(`Error creating tag: ${msg}`);
			});
			return false;
		}
	}

	public async loadGitTags(): Promise<string[]> {
		if (!this.isRealWorkspace() || !isTauriApp() || !this.nativeWorkspacePath()) {
			this.gitTags.set([]);
			return [];
		}

		try {
			const repoPath = this.nativeWorkspacePath()!;
			const tags = await invoke<string[]>('get_git_tags', { repoPath });
			this.ngZone.run(() => this.gitTags.set(tags));
			return tags;
		} catch (err) {
			console.warn('Failed to load git tags:', err);
			return [];
		}
	}

	public parseGitIndex(buf: ArrayBuffer): Map<string, GitIndexEntry> {
		const view = new DataView(buf);
		const u8 = new Uint8Array(buf);
		const result = new Map<string, GitIndexEntry>();

		if (buf.byteLength < 12) return result;
		const sig = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
		if (sig !== 'DIRC') return result;

		const version = view.getUint32(4, false);
		const entryCount = view.getUint32(8, false);

		let pos = 12;
		for (let i = 0; i < entryCount && pos + 62 <= buf.byteLength; i++) {
			const entryStart = pos;
			const mtime = view.getUint32(pos + 8, false);
			const size = view.getUint32(pos + 36, false);

			let sha = '';
			for (let s = 0; s < 20; s++) {
				sha += u8[pos + 40 + s].toString(16).padStart(2, '0');
			}

			const flags = view.getUint16(pos + 60, false);
			const nameLen = flags & 0x0fff;

			pos += 62;
			let path = '';
			if (nameLen < 0x0fff) {
				path = new TextDecoder().decode(u8.subarray(pos, pos + nameLen));
				pos += nameLen;
			} else {
				let end = pos;
				while (end < buf.byteLength && u8[end] !== 0) end++;
				path = new TextDecoder().decode(u8.subarray(pos, end));
				pos = end;
			}

			if (version < 4) {
				const entryLen = pos - entryStart;
				const pad = 8 - (entryLen % 8);
				pos += pad;
			}

			result.set(path, { path, size, sha, mtime });
		}

		return result;
	}

	public async readGitBlob(gitDir: any, sha: string): Promise<string | null> {
		try {
			if (!gitDir) return null;
			let objectsDir: any = null;
			try {
				objectsDir = await gitDir.getDirectoryHandle('objects', { create: false });
			} catch {
				for await (const entry of gitDir.values()) {
					if (entry.name === 'objects' && entry.kind === 'directory') {
						objectsDir = entry;
						break;
					}
				}
			}
			if (!objectsDir) return null;

			const prefix = sha.substring(0, 2);
			const rest = sha.substring(2);

			let prefixDir: any = null;
			try {
				prefixDir = await objectsDir.getDirectoryHandle(prefix, { create: false });
			} catch {
				for await (const entry of objectsDir.values()) {
					if (entry.name === prefix && entry.kind === 'directory') {
						prefixDir = entry;
						break;
					}
				}
			}
			if (!prefixDir) return null;

			let blobHandle: any = null;
			try {
				blobHandle = await prefixDir.getFileHandle(rest, { create: false });
			} catch {
				for await (const entry of prefixDir.values()) {
					if (entry.name === rest && entry.kind === 'file') {
						blobHandle = entry;
						break;
					}
				}
			}
			if (!blobHandle) return null;

			const blobFile = await blobHandle.getFile();
			const compressedBuf = await blobFile.arrayBuffer();

			const ds = new DecompressionStream('deflate');
			const writer = ds.writable.getWriter();
			writer.write(new Uint8Array(compressedBuf));
			writer.close();

			const response = new Response(ds.readable);
			const decompressedBuf = new Uint8Array(await response.arrayBuffer());
			const nullIdx = decompressedBuf.indexOf(0);
			if (nullIdx === -1) return null;

			return new TextDecoder().decode(decompressedBuf.subarray(nullIdx + 1));
		} catch (err) {
			console.warn('readGitBlob error for sha', sha, err);
			return null;
		}
	}

	private async computeGitBlobSha(content: string): Promise<string> {
		const enc = new TextEncoder();
		const body = enc.encode(content);
		const header = enc.encode(`blob ${body.length}\0`);
		const full = new Uint8Array(header.length + body.length);
		full.set(header, 0);
		full.set(body, header.length);
		const digest = await crypto.subtle.digest('SHA-1', full);
		return Array.from(new Uint8Array(digest))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}

	public async refreshGitStatus(dirHandle?: any): Promise<void> {
		if (!this.isRealWorkspace()) {
			this.gitBranch.set(null);
			this.gitSyncStatus.set(null);
			return;
		}

		if (isTauriApp() && this.nativeWorkspacePath()) {
			const repoPath = this.nativeWorkspacePath()!;
			try {
				try {
					const branch = await invoke<string>('get_git_branch', { repoPath });
					this.gitBranch.set(branch);
					if (branch) {
						await Promise.all([this.loadRecentCommits(), this.loadGitSyncStatus(), this.loadGitTags()]);
					} else {
						this.recentCommits.set([]);
						this.gitSyncStatus.set(null);
						this.gitTags.set([]);
					}
				} catch {
					this.gitBranch.set(null);
					this.recentCommits.set([]);
					this.gitSyncStatus.set(null);
				}

				const gitItems = await invoke<
					Array<{ path: string; status: 'modified' | 'untracked' | 'added' | 'deleted'; staged: boolean }>
				>('get_git_status', { repoPath });

				const statusMap = new Map(gitItems.map((item) => [item.path.replace(/^\.\//, '').replace(/^\//, ''), item]));
				const currentFiles = [...this.files()];
				const knownPaths = new Set(currentFiles.map((f) => f.path.replace(/^\.\//, '').replace(/^\//, '')));

				for (const item of gitItems) {
					const normItemPath = item.path.replace(/^\.\//, '').replace(/^\//, '');
					if (!knownPaths.has(normItemPath)) {
						const parts = normItemPath.split('/');
						const name = parts[parts.length - 1];
						const newFile: WorkspaceFile = {
							id: normItemPath,
							name,
							path: normItemPath,
							fsPath: `${repoPath}/${normItemPath}`,
							language: detectLanguageFromFilename(name),
							content: '',
							isLoaded: false,
							gitStatus: item.status,
							isModified: false,
						};
						currentFiles.push(newFile);
						knownPaths.add(normItemPath);
					}
				}

				const updated = currentFiles
					.filter((file) => {
						if (file.gitStatus === 'deleted' && !statusMap.has(file.path.replace(/^\.\//, '').replace(/^\//, ''))) {
							return false;
						}
						return true;
					})
					.map((file) => {
						const normPath = file.path.replace(/^\.\//, '').replace(/^\//, '');
						const item = statusMap.get(normPath);
						if (item) {
							return {
								...file,
								gitStatus: item.status,
							};
						} else {
							return {
								...file,
								gitStatus: undefined,
								originalContent: !file.isModified ? (file.savedContent ?? file.content) : file.originalContent,
							};
						}
					});

				this.files.set(updated);
				this.openTabs.update((tabs) =>
					tabs.map((tab) => {
						const normPath = tab.path.replace(/^\.\//, '').replace(/^\//, '');
						const item = statusMap.get(normPath);
						return {
							...tab,
							gitStatus: item ? item.status : undefined,
							originalContent: !tab.isModified && !item ? (tab.savedContent ?? tab.content) : tab.originalContent,
						};
					})
				);

				// Also update file tree nodes to reflect updated gitStatus and trigger tree re-render
				const updateTreeGitStatus = (nodes: FileTreeNode[]) => {
					for (const node of nodes) {
						if (node.file) {
							const normPath = node.file.path.replace(/^\.\//, '').replace(/^\//, '');
							const item = statusMap.get(normPath);
							node.file.gitStatus = item ? item.status : undefined;
							if (!item && !node.file.isModified) {
								node.file.originalContent = node.file.savedContent ?? node.file.content;
							}
						}
						if (node.children && node.children.length > 0) {
							updateTreeGitStatus(node.children);
						}
					}
				};
				updateTreeGitStatus(this.fileTree());
				this.triggerTreeUpdate();
				return;
			} catch (err) {
				this.gitBranch.set(null);
				this.recentCommits.set([]);
				this.gitSyncStatus.set(null);
				this.files.update((files) =>
					files.map((f) => ({
						...f,
						gitStatus: undefined,
						isModified: f.originalContent !== undefined && f.content !== f.originalContent,
					}))
				);
				return;
			}
		}

		const handle = dirHandle || this.recentDirHandle;

		try {
			let gitDir: any = this.recentGitDirHandle;
			if (!gitDir && handle) {
				if (typeof handle.getDirectoryHandle === 'function') {
					try {
						gitDir = await handle.getDirectoryHandle('.git', { create: false });
					} catch {
						// Direct handle access rejected by browser, fallback to iterator
						try {
							for await (const entry of handle.values()) {
								if (entry.name === '.git' && entry.kind === 'directory') {
									gitDir = entry;
									this.recentGitDirHandle = gitDir;
									break;
								}
							}
						} catch (iterErr) {
							console.warn('Could not iterate handle for .git:', iterErr);
						}
					}
				}
			}

			if (!gitDir) {
				return;
			}
			this.recentGitDirHandle = gitDir;

			// Read branch from HEAD
			try {
				let headHandle: any = null;
				try {
					headHandle = await gitDir.getFileHandle('HEAD', { create: false });
				} catch {
					for await (const entry of gitDir.values()) {
						if (entry.name === 'HEAD' && entry.kind === 'file') {
							headHandle = entry;
							break;
						}
					}
				}
				if (headHandle) {
					const headFile = await headHandle.getFile();
					const text = (await headFile.text()).trim();
					if (text.startsWith('ref: refs/heads/')) {
						this.gitBranch.set(text.substring('ref: refs/heads/'.length));
					} else if (text.length >= 7) {
						this.gitBranch.set(text.substring(0, 7));
					}
				}
			} catch (headErr) {
				console.warn('Error reading HEAD:', headErr);
			}

			// Read .git/index
			let gitIndexMap = new Map<string, GitIndexEntry>();
			try {
				let indexHandle: any = null;
				try {
					indexHandle = await gitDir.getFileHandle('index', { create: false });
				} catch {
					for await (const entry of gitDir.values()) {
						if (entry.name === 'index' && entry.kind === 'file') {
							indexHandle = entry;
							break;
						}
					}
				}
				if (indexHandle) {
					const indexFile = await indexHandle.getFile();
					const buf = await indexFile.arrayBuffer();
					gitIndexMap = this.parseGitIndex(buf);
				}
			} catch (err) {
				console.warn('Could not read .git/index:', err);
				return;
			}

			const allFiles = this.files();
			const updatedFiles = await Promise.all(
				allFiles.map(async (file) => {
					const normPath = file.path.replace(/^\.\//, '').replace(/^\//, '');
					const indexEntry = gitIndexMap.get(normPath);
					if (!indexEntry) {
						// Untracked / newly added file
						return {
							...file,
							gitStatus: 'untracked' as const,
							originalContent: file.originalContent !== undefined ? file.originalContent : '',
						};
					}

					// Tracked file - check if modified
					try {
						let currentSize = -1;
						if (file.handle && typeof file.handle.getFile === 'function') {
							const fileObj = await file.handle.getFile();
							currentSize = fileObj.size;
						} else if (file.content) {
							currentSize = new TextEncoder().encode(file.content).length;
						}

						let isModified = false;
						let origContent: string | null = null;

						if (currentSize !== -1 && currentSize !== indexEntry.size) {
							isModified = true;
							origContent = await this.readGitBlob(gitDir, indexEntry.sha);
						} else if (file.isLoaded && file.content) {
							const sha = await this.computeGitBlobSha(file.content);
							if (sha !== indexEntry.sha) {
								isModified = true;
								origContent = await this.readGitBlob(gitDir, indexEntry.sha);
							}
						}

						if (isModified) {
							return {
								...file,
								gitStatus: 'modified' as const,
								originalContent: origContent !== null ? origContent : (file.originalContent ?? ''),
							};
						} else {
							return {
								...file,
								gitStatus: undefined,
							};
						}
					} catch (fileErr) {
						console.warn('Error checking file status:', file.path, fileErr);
						return file;
					}
				})
			);

			this.files.set(updatedFiles);
		} catch (err) {
			console.warn('Git status check error:', err);
		}
	}

	/**
	 * Sets up auto-synchronization:
	 * 1. Window focus & visibilitychange listener (e.g. returning from terminal).
	 * 2. Periodic background check every 60 seconds ONLY while the window is focused.
	 * When window loses focus or becomes hidden, the timer is stopped to conserve system resources.
	 */
	private setupAutoSync(): void {
		if (typeof window === 'undefined') return;

		window.addEventListener('focus', () => {
			this.syncExternalChanges();
			this.startAutoSyncTimer();
		});

		window.addEventListener('blur', () => {
			this.stopAutoSyncTimer();
		});

		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') {
				this.syncExternalChanges();
				if (typeof document !== 'undefined' && document.hasFocus()) {
					this.startAutoSyncTimer();
				}
			} else {
				this.stopAutoSyncTimer();
			}
		});

		if (typeof document !== 'undefined' && document.hasFocus() && document.visibilityState === 'visible') {
			this.startAutoSyncTimer();
		}
	}

	private startAutoSyncTimer(): void {
		if (this.autoSyncIntervalId) return;
		this.autoSyncIntervalId = setInterval(() => {
			if (typeof document !== 'undefined' && (!document.hasFocus() || document.visibilityState !== 'visible')) {
				this.stopAutoSyncTimer();
				return;
			}
			this.syncExternalChanges();
		}, 60000);
	}

	private stopAutoSyncTimer(): void {
		if (this.autoSyncIntervalId) {
			clearInterval(this.autoSyncIntervalId);
			this.autoSyncIntervalId = null;
		}
	}

	/**
	 * Synchronizes file tree, git status and active file from disk.
	 */
	public async syncExternalChanges(): Promise<void> {
		if (this.isAutoSyncing) return;
		if (!this.nativeWorkspacePath() && !this.recentDirHandle) return;

		this.isAutoSyncing = true;
		try {
			await this.refreshFileTree();
			await this.refreshGitStatus();
			await this.reloadActiveFileIfChangedOnDisk();
		} catch (e) {
			console.warn('Auto-sync error:', e);
		} finally {
			this.isAutoSyncing = false;
		}
	}

	/**
	 * Manually refreshes the entire workspace: file tree, git status, active file and search index.
	 */
	public async refreshAll(): Promise<void> {
		if (this.isRefreshingTree()) return;
		this.isRefreshingTree.set(true);
		try {
			await this.refreshFileTree();
			await this.refreshGitStatus();
			await this.reloadActiveFileIfChangedOnDisk();
			const nativePath = this.nativeWorkspacePath();
			if (nativePath) {
				this.indexNativeDirectoryInBackground(nativePath);
			}
			this.showNotification('✓ Workspace refreshed');
		} catch (err: any) {
			console.error('Failed to refresh workspace:', err);
			this.showNotification(`Failed to refresh: ${err?.message || err}`);
		} finally {
			this.isRefreshingTree.set(false);
		}
	}

	/**
	 * Checks if the currently active file was modified on disk outside the IDE.
	 * If the user has not modified the file in the editor, seamlessly reloads it.
	 * If the user has unsaved edits in the editor, preserves them and alerts the user.
	 */
	public async reloadActiveFileIfChangedOnDisk(): Promise<void> {
		const active = this.activeFile();
		if (!active || active.isImage || active.isBinary || (!active.fsPath && !active.handle && !active.rawFile)) {
			return;
		}

		try {
			let currentMtime: number | undefined;
			let currentSize: number | undefined;

			if (isTauriApp() && active.fsPath) {
				try {
					const meta = await invoke<{ mtime_ms: number; size: number }>('get_file_metadata', {
						filePath: active.fsPath,
					});
					currentMtime = meta.mtime_ms;
					currentSize = meta.size;
				} catch {
					// File may be temporarily inaccessible or removed
					return;
				}
			} else if (active.handle && typeof active.handle.getFile === 'function') {
				try {
					const fileObj = await active.handle.getFile();
					currentMtime = fileObj.lastModified;
					currentSize = fileObj.size;
				} catch {
					return;
				}
			} else if (active.rawFile) {
				currentMtime = active.rawFile.lastModified;
				currentSize = active.rawFile.size;
			}

			// Fast-path: if signature (mtime + size) matches our recorded state, disk did not change!
			if (
				active.isLoaded &&
				active.lastDiskMtime !== undefined &&
				active.lastDiskSize !== undefined &&
				currentMtime !== undefined &&
				currentSize !== undefined &&
				currentMtime === active.lastDiskMtime &&
				currentSize === active.lastDiskSize
			) {
				return;
			}

			// Signature differs or was uninitialized: read full text from disk
			let diskContent: string | null = null;

			if (isTauriApp() && active.fsPath) {
				diskContent = await invoke<string>('read_file_text', { filePath: active.fsPath });
			} else if (active.handle && typeof active.handle.getFile === 'function') {
				const fileObj = await active.handle.getFile();
				diskContent = await fileObj.text();
			} else if (active.rawFile) {
				diskContent = await active.rawFile.text();
			}

			if (diskContent === null) return;

			if (!active.isLoaded) {
				active.content = diskContent;
				active.savedContent = diskContent;
				active.originalContent = diskContent;
				active.isLoaded = true;
				active.lastDiskMtime = currentMtime;
				active.lastDiskSize = currentSize;
				active.fileSize = currentSize;
				this.files.update((files) =>
					files.map((f) =>
						f.id === active.id
							? {
									...f,
									content: diskContent!,
									savedContent: diskContent!,
									originalContent: diskContent!,
									isLoaded: true,
									lastDiskMtime: currentMtime,
									lastDiskSize: currentSize,
									fileSize: currentSize,
								}
							: f
					)
				);
				this.triggerSaveSessionState();
				return;
			}

			const baseContent = active.savedContent !== undefined ? active.savedContent : active.originalContent;
			const diskChanged = baseContent !== undefined ? diskContent !== baseContent : diskContent !== active.content;

			// Update stored signature
			active.lastDiskMtime = currentMtime;
			active.lastDiskSize = currentSize;
			active.fileSize = currentSize;

			if (!diskChanged) {
				// Disk signature might have changed (e.g. touch or save that produced identical content)
				this.files.update((files) =>
					files.map((f) =>
						f.id === active.id
							? { ...f, lastDiskMtime: currentMtime, lastDiskSize: currentSize, fileSize: currentSize }
							: f
					)
				);
				this.openTabs.update((tabs) =>
					tabs.map((t) =>
						t.id === active.id
							? { ...t, lastDiskMtime: currentMtime, lastDiskSize: currentSize, fileSize: currentSize }
							: t
					)
				);
				this.triggerSaveSessionState();
				return;
			}

			// Genuinely modified on disk externally by another process
			if (active.isModified) {
				active.savedContent = diskContent;
				active.originalContent = diskContent;
				this.files.update((files) =>
					files.map((f) =>
						f.id === active.id
							? {
									...f,
									savedContent: diskContent!,
									originalContent: diskContent!,
									lastDiskMtime: currentMtime,
									lastDiskSize: currentSize,
									fileSize: currentSize,
								}
							: f
					)
				);
				this.openTabs.update((tabs) =>
					tabs.map((t) =>
						t.id === active.id
							? {
									...t,
									savedContent: diskContent!,
									originalContent: diskContent!,
									lastDiskMtime: currentMtime,
									lastDiskSize: currentSize,
									fileSize: currentSize,
								}
							: t
					)
				);
				this.triggerSaveSessionState();
				this.showNotification(`External disk change detected for ${active.name} (unsaved edits preserved)`);
			} else {
				active.content = diskContent;
				active.savedContent = diskContent;
				active.originalContent = diskContent;
				active.isModified = false;
				this.files.update((files) =>
					files.map((f) =>
						f.id === active.id
							? {
									...f,
									content: diskContent!,
									savedContent: diskContent!,
									originalContent: diskContent!,
									isLoaded: true,
									isModified: false,
									lastDiskMtime: currentMtime,
									lastDiskSize: currentSize,
									fileSize: currentSize,
								}
							: f
					)
				);
				this.openTabs.update((tabs) =>
					tabs.map((t) =>
						t.id === active.id
							? {
									...t,
									content: diskContent!,
									savedContent: diskContent!,
									originalContent: diskContent!,
									isLoaded: true,
									isModified: false,
									lastDiskMtime: currentMtime,
									lastDiskSize: currentSize,
									fileSize: currentSize,
								}
							: t
					)
				);
				if (this.diffModeActive() && this.activeDiffFile()?.id === active.id) {
					this.activeDiffFile.set({
						...active,
						content: diskContent,
						savedContent: diskContent,
						originalContent: diskContent,
						isModified: false,
						lastDiskMtime: currentMtime,
						lastDiskSize: currentSize,
						fileSize: currentSize,
					});
				}
				this.triggerSaveSessionState();
				this.showNotification(`Reloaded ${active.name} (updated on disk)`);
			}
		} catch (err) {
			console.warn('Failed to check active file on disk:', err);
		}
	}

	public toggleSidebar(): void {
		const next = !this.sidebarVisible();
		this.sidebarVisible.set(next);
		this.showNotification(`Sidebar: ${next ? 'Shown' : 'Hidden'}`);
	}

	public toggleStickyScroll(): void {
		const next = !this.stickyScrollEnabled();
		this.stickyScrollEnabled.set(next);
		this.showNotification(`Sticky Scroll: ${next ? 'Enabled' : 'Disabled'}`);
	}

	public setIndentation(type: 'tabs' | 'spaces', size: number): void {
		const active = this.activeFile();
		if (active) {
			active.indentType = type;
			active.tabSize = size;
			active.isIndentationCustom = true;
		}
		this.indentType.set(type);
		this.tabSize.set(size);
		this.showNotification(
			`Indentation set to ${type === 'tabs' ? 'Tab Size: ' : 'Spaces: '}${size}`
		);
		this.closeModal();
	}

	public syncActiveIndentation(type: 'tabs' | 'spaces', size: number): void {
		const active = this.activeFile();
		if (active) {
			active.indentType = type;
			active.tabSize = size;
		}
		if (this.indentType() !== type || this.tabSize() !== size) {
			this.indentType.set(type);
			this.tabSize.set(size);
		}
	}

	public redetectActiveFileIndentation(): void {
		const active = this.activeFile();
		if (active) {
			active.isIndentationCustom = false;
			this.pendingRedetectIndentation.set(active.id);
		}
	}

	public convertActiveFileIndentation(
		type: 'tabs' | 'spaces',
		size: number,
		fromType?: 'tabs' | 'spaces',
		fromSize?: number
	): void {
		const active = this.activeFile();
		if (!active) {
			this.showNotification('No active file to convert');
			return;
		}
		this.setIndentation(type, size);
		this.pendingConvertIndentation.set({ fileId: active.id, type, size, fromType, fromSize });
	}

	public updateFileLanguage(fileId: string, language: string): void {
		const active = this.activeFile();
		if (active && active.id === fileId) {
			active.language = language;
		}
		this.files.update((files) =>
			files.map((f) => (f.id === fileId ? { ...f, language } : f))
		);
		this.openTabs.update((tabs) =>
			tabs.map((t) => (t.id === fileId ? { ...t, language } : t))
		);
	}

	public changeActiveFileLanguage(language: string): void {
		const active = this.activeFile();
		if (!active) return;
		active.language = language;
		this.files.update((files) =>
			files.map((f) => (f.id === active.id ? { ...f, language } : f))
		);
		this.openTabs.update((tabs) =>
			tabs.map((t) => (t.id === active.id ? { ...t, language } : t))
		);
		this.pendingLanguageChange.set({ fileId: active.id, language });
		this.showNotification(`Language set to ${language}`);
		this.closeModal();
	}

	private fallbackFilesList: File[] = [];
	private fallbackRootName = '';

	public openModal(
		mode:
			| 'grep'
			| 'file-search'
			| 'new-file'
			| 'new-folder'
			| 'open-folder-path'
			| 'indentation'
			| 'change-language'
			| 'unsaved-changes'
			| 'ai-settings'
			| 'ai-download'
			| 'delete-file-confirm'
			| 'git-untrack-confirm'
			| 'git-branches'
			| 'git-create-tag'
			| 'references'
	): void {
		if (mode === 'grep') {
			this.setSidebarView('search');
			return;
		}
		if (mode === 'git-branches') {
			this.loadGitBranches();
			this.loadGitTags();
		}
		this.activeModal.set(mode);
	}

	public closeModal(): void {
		this.activeModal.set(null);
	}

	public async openParentDirectory(): Promise<void> {
		const parent = this.parentWorkspacePath();
		if (parent) {
			await this.loadFromNativePath(parent);
		}
	}

	public async openDirectoryByPath(dirPath: string): Promise<void> {
		let trimmed = dirPath.trim();
		if (!trimmed) return;
		if (trimmed.startsWith('~/')) {
			trimmed = '/home/ori' + trimmed.substring(1);
		} else if (trimmed === '~') {
			trimmed = '/home/ori';
		}
		await this.loadFromNativePath(trimmed);
		this.closeModal();
	}

	public async createNewFile(fileName: string): Promise<void> {
		const trimmed = fileName.trim();
		if (!trimmed) return;
		const parts = trimmed.split('/');
		const baseName = parts[parts.length - 1];
		const language = detectLanguageFromFilename(baseName);
		const nativeRoot = this.nativeWorkspacePath();
		const fsPath = nativeRoot
			? (nativeRoot.endsWith('/') ? `${nativeRoot}${trimmed}` : `${nativeRoot}/${trimmed}`)
			: undefined;

		const newFile: WorkspaceFile = {
			id: trimmed,
			name: baseName,
			path: trimmed,
			fsPath,
			language,
			content: '',
			isLoaded: true,
			isModified: true,
		};

		this.files.update((prev) => [newFile, ...prev]);

		const newNode: FileTreeNode = {
			id: trimmed,
			name: baseName,
			path: trimmed,
			fsPath,
			kind: 'file',
			language,
			file: newFile,
			level: 0,
		};

		this.fileTree.update((prev) => [newNode, ...prev]);
		await this.openFile(newFile);
		this.showNotification(`Created file: ${baseName}`);
		this.closeModal();
	}

	public createNewFolder(folderPath: string): void {
		const trimmed = folderPath.trim();
		if (!trimmed) return;
		const parts = trimmed.split('/');
		const folderName = parts[parts.length - 1];
		const nativeRoot = this.nativeWorkspacePath();
		const fsPath = nativeRoot
			? (nativeRoot.endsWith('/') ? `${nativeRoot}${trimmed}` : `${nativeRoot}/${trimmed}`)
			: undefined;

		const newNode: FileTreeNode = {
			id: trimmed,
			name: folderName,
			path: trimmed,
			fsPath,
			kind: 'directory',
			expanded: true,
			isLoaded: true,
			isLoading: false,
			children: [],
			level: 0,
		};

		if (isTauriApp() && fsPath) {
			invoke('create_directory', { dirPath: fsPath }).catch((err) => {
				console.error('Failed to create directory on disk:', err);
			});
		}

		this.fileTree.update((prev) => [newNode, ...prev]);
		this.showNotification(`Created folder: ${folderName}`);
		this.closeModal();
	}

	public async grepFiles(query: string, options?: GrepOptions): Promise<GrepResult[]> {
		const rawTerm = query.trim();
		if (!rawTerm) return [];

		const matchCase = options?.matchCase ?? false;
		const wholeWord = options?.wholeWord ?? false;
		const isRegex = options?.isRegex ?? false;

		let regex: RegExp;
		try {
			let pattern = rawTerm;
			if (!isRegex) {
				pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			}
			if (wholeWord) {
				pattern = `\\b${pattern}\\b`;
			}
			regex = new RegExp(pattern, matchCase ? '' : 'i');
		} catch {
			return [];
		}

		const results: GrepResult[] = [];
		const allFiles = this.files();
		let scannedFiles = 0;

		for (const file of allFiles) {
			const content = await this.ensureFileContent(file);
			if (content) {
				const lines = content.split('\n');
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					const match = regex.exec(line);
					if (match) {
						results.push({
							file,
							lineNumber: i + 1,
							lineText: line.trim(),
							matchStart: match.index,
							matchLength: match[0].length,
						});
						if (results.length >= 500) break;
					}
				}
			}

			scannedFiles++;
			// Yield to the browser event loop periodically to keep the search UI snappy
			if (scannedFiles % 12 === 0) {
				await new Promise((r) => setTimeout(r, 0));
			}

			if (results.length >= 500) break;
		}
		return results;
	}

	public async ensureFileContent(file: WorkspaceFile): Promise<string> {
		if (file.isLoaded && file.content !== undefined) {
			return file.content;
		}
		if (isImageFile(file.name) || file.isBinary) {
			return '';
		}
		try {
			if (isTauriApp() && file.fsPath) {
				const content = await invoke<string>('read_file_text', { filePath: file.fsPath });
				file.content = content;
				file.isLoaded = true;
				return content;
			} else if (file.handle && typeof file.handle.getFile === 'function') {
				const fileObj = await file.handle.getFile();
				if (fileObj.size <= 2 * 1024 * 1024) {
					const content = await fileObj.text();
					file.content = content;
					file.isLoaded = true;
					return content;
				}
			} else if (file.rawFile) {
				if (file.rawFile.size <= 2 * 1024 * 1024) {
					const content = await file.rawFile.text();
					file.content = content;
					file.isLoaded = true;
					return content;
				}
			}
		} catch {
			// Skip inaccessible or locked files gracefully
		}
		return file.content ?? '';
	}

	public findFiles(query: string): WorkspaceFile[] {
		const term = query.trim().toLowerCase();
		const all = this.files();
		if (!term) return all.slice(0, 30);
		return all
			.filter((f) => f.name.toLowerCase().includes(term) || f.path.toLowerCase().includes(term))
			.slice(0, 60);
	}

	public async jumpToLine(file: WorkspaceFile, lineNumber: number, column = 1): Promise<void> {
		await this.openFile(file);
		this.pendingLineJump.set({ lineNumber, column, fileId: file.id });
		this.closeModal();
	}

	public async openFileByPath(relPath: string): Promise<WorkspaceFile | null> {
		const cleanPath = relPath.trim().replace(/^[/\\]+/, '');
		let file = this.files().find(
			(f) => f.path === cleanPath || f.path.endsWith(cleanPath) || (f.fsPath && f.fsPath.endsWith(cleanPath))
		);

		if (!file && this.nativeWorkspacePath()) {
			const ws = this.nativeWorkspacePath()!;
			const fullPath = `${ws}/${cleanPath}`;
			if (isTauriApp()) {
				try {
					const content = await invoke<string>('read_file_text', { filePath: fullPath });
					const name = cleanPath.split('/').pop() || cleanPath;
					file = {
						id: cleanPath,
						name,
						path: cleanPath,
						fsPath: fullPath,
						language: detectLanguage(name, content),
						content,
						savedContent: content,
						originalContent: content,
						isLoaded: true,
					};
					this.files.update((files) => [...files, file!]);
				} catch {}
			}
		}

		if (file) {
			await this.openFile(file, true);
			return file;
		}
		return null;
	}

	public async replaceTextInFile(
		target: string,
		replacement: string,
		relPath?: string,
		replaceAll = false
	): Promise<{ success: boolean; message: string }> {
		let file: WorkspaceFile | null = null;
		if (relPath) {
			file = await this.openFileByPath(relPath);
		} else {
			file = this.activeFile();
		}

		if (!file) {
			return { success: false, message: 'No active or specified file to edit.' };
		}

		if (!file.isLoaded && file.fsPath && isTauriApp()) {
			try {
				file.content = await invoke<string>('read_file_text', { filePath: file.fsPath });
				file.isLoaded = true;
			} catch (err: any) {
				return { success: false, message: `Could not read file: ${err?.message || err}` };
			}
		}

		const currentContent = file.content || '';
		if (!currentContent.includes(target)) {
			return { success: false, message: `Target text was not found in ${file.path}.` };
		}

		const newContent = replaceAll
			? currentContent.split(target).join(replacement)
			: currentContent.replace(target, replacement);

		// Update in-memory file & tabs
		this.updateContent(file.id, newContent);

		// Broadcast to Monaco editor
		this.pendingContentReplacement.set({ fileId: file.id, newContent });

		// In desktop mode, write to disk
		if (file.fsPath && isTauriApp()) {
			try {
				await invoke('write_file_text', { filePath: file.fsPath, content: newContent });
				file.savedContent = newContent;
				file.isModified = false;
				this.updateContent(file.id, newContent);
			} catch (err: any) {
				console.warn('Failed to save to disk immediately:', err);
			}
		}

		return { success: true, message: `Successfully replaced text in ${file.path}.` };
	}

	/**
	 * Lazily loads file text content and opens in editor.
	 */
	public async openFile(file: WorkspaceFile, setActive = true): Promise<void> {
		if (this.diffModeActive()) {
			this.closeDiffView();
		}

		const isImg = isImageFile(file.name);
		if (isImg) {
			file.isImage = true;
			file.language = 'image';
		}

		const alreadyLoaded = file.isLoaded;

		if ((!file.isLoaded || (isImg && !file.imageUrl) || (file.isBinary && !file.hexData)) && (file.fsPath || file.handle || file.rawFile)) {
			try {
				if (isImg) {
					const mime = getImageMimeType(file.name);
					let imageUrl = '';
					if (isTauriApp() && file.fsPath) {
						try {
							const b64 = await invoke<string>('read_file_base64', { filePath: file.fsPath });
							imageUrl = `data:${mime};base64,${b64}`;
							try {
								const meta = await invoke<{ mtime_ms: number; size: number }>('get_file_metadata', {
									filePath: file.fsPath,
								});
								file.lastDiskMtime = meta.mtime_ms;
								file.lastDiskSize = meta.size;
								file.fileSize = meta.size;
							} catch {}
						} catch (err) {
							console.warn('Failed to load image in Tauri via read_file_base64:', err);
						}
					} else if (file.handle && typeof file.handle.getFile === 'function') {
						const fileObj = await file.handle.getFile();
						file.fileSize = fileObj.size;
						file.lastDiskSize = fileObj.size;
						file.lastDiskMtime = fileObj.lastModified;
						imageUrl = URL.createObjectURL(fileObj);
					} else if (file.rawFile) {
						file.fileSize = file.rawFile.size;
						file.lastDiskSize = file.rawFile.size;
						file.lastDiskMtime = file.rawFile.lastModified;
						imageUrl = URL.createObjectURL(file.rawFile);
					}
					file.imageUrl = imageUrl;
					file.content = '';
					file.isLoaded = true;
				} else {
					let isBinary = file.isBinary ?? false;
					let fileTypeDesc = file.fileTypeDescription ?? '';
					let hexResult: HexViewResult | null = file.hexData ?? null;
					let content = '';
					let mtime: number | undefined;
					let size: number | undefined;

					if (isTauriApp() && file.fsPath) {
						try {
							const inspection = await invoke<FileInspectionResult>('inspect_file', { filePath: file.fsPath });
							if (inspection && inspection.is_binary) {
								isBinary = true;
								fileTypeDesc = inspection.file_type;
								size = inspection.size;
								try {
									hexResult = await invoke<HexViewResult>('read_file_hex', {
										filePath: file.fsPath,
										offset: 0,
										maxBytes: 4096,
									});
								} catch (hexErr) {
									console.warn('read_file_hex failed:', hexErr);
								}
							}
						} catch (inspErr) {
							console.warn('inspect_file failed:', inspErr);
						}

						if (!isBinary) {
							content = await invoke<string>('read_file_text', { filePath: file.fsPath });
							try {
								const meta = await invoke<{ mtime_ms: number; size: number }>('get_file_metadata', {
									filePath: file.fsPath,
								});
								mtime = meta.mtime_ms;
								size = meta.size;
							} catch (err) {
								console.warn('Failed to get metadata in openFile:', err);
							}
						}
					} else if (file.handle && typeof file.handle.getFile === 'function') {
						const fileObj = await file.handle.getFile();
						mtime = fileObj.lastModified;
						size = fileObj.size;
						const slice = await fileObj.slice(0, Math.min(8192, fileObj.size)).arrayBuffer();
						const u8 = new Uint8Array(slice);
						let hasNull = false;
						for (let i = 0; i < u8.length; i++) {
							if (u8[i] === 0) {
								hasNull = true;
								break;
							}
						}
						if (hasNull) {
							isBinary = true;
							fileTypeDesc = fileObj.type ? `Binary file (${fileObj.type})` : 'Binary data';
							const hexSlice = await fileObj.slice(0, Math.min(4096, fileObj.size)).arrayBuffer();
							hexResult = this.formatHexFromBuffer(new Uint8Array(hexSlice), fileObj.size, fileTypeDesc, 0);
						} else {
							content = await fileObj.text();
						}
					} else if (file.rawFile) {
						const fileObj = file.rawFile;
						mtime = fileObj.lastModified;
						size = fileObj.size;
						const slice = await fileObj.slice(0, Math.min(8192, fileObj.size)).arrayBuffer();
						const u8 = new Uint8Array(slice);
						let hasNull = false;
						for (let i = 0; i < u8.length; i++) {
							if (u8[i] === 0) {
								hasNull = true;
								break;
							}
						}
						if (hasNull) {
							isBinary = true;
							fileTypeDesc = fileObj.type ? `Binary file (${fileObj.type})` : 'Binary data';
							const hexSlice = await fileObj.slice(0, Math.min(4096, fileObj.size)).arrayBuffer();
							hexResult = this.formatHexFromBuffer(new Uint8Array(hexSlice), fileObj.size, fileTypeDesc, 0);
						} else {
							content = await fileObj.text();
						}
					}

					if (isBinary) {
						file.isBinary = true;
						file.fileTypeDescription = fileTypeDesc;
						file.hexData = hexResult ?? undefined;
						file.language = 'binary';
						file.content = '';
						if (size !== undefined) {
							file.lastDiskSize = size;
							file.fileSize = size;
						}
						if (mtime !== undefined) {
							file.lastDiskMtime = mtime;
						}
						file.isLoaded = true;
						file.isModified = false;

						// Update matching node in file tree so it reflects BIN badge immediately
						this.fileTree.update((nodes) => {
							const updateNodes = (list: FileTreeNode[]): FileTreeNode[] => {
								return list.map((n) => {
									if (n.path === file.path || n.fsPath === file.fsPath || n.id === file.id) {
										return { ...n, language: 'binary', file };
									}
									if (n.children && n.children.length > 0) {
										return { ...n, children: updateNodes(n.children) };
									}
									return n;
								});
							};
							return updateNodes(nodes);
						});
					} else {
						file.content = content;
						if (mtime !== undefined) file.lastDiskMtime = mtime;
						if (size !== undefined) {
							file.lastDiskSize = size;
							file.fileSize = size;
						}
						if (file.language === 'plaintext' || !file.language) {
							const detected = detectLanguage(file.name, content);
							if (detected !== 'plaintext' && detected !== file.language) {
								file.language = detected;
								this.fileTree.update((nodes) => {
									const updateNodes = (list: FileTreeNode[]): FileTreeNode[] => {
										return list.map((n) => {
											if (n.path === file.path || n.fsPath === file.fsPath || n.id === file.id) {
												return { ...n, language: detected, file };
											}
											if (n.children && n.children.length > 0) {
												return { ...n, children: updateNodes(n.children) };
											}
											return n;
										});
									};
									return updateNodes(nodes);
								});
							}
						}
						if (file.savedContent === undefined) {
							file.savedContent = content;
						}
						if (file.originalContent === undefined && !file.isModified && !file.gitStatus) {
							file.originalContent = content;
						}
						file.isLoaded = true;
						file.isModified = false;
					}
				}

				this.files.update((files) => {
					const exists = files.some((f) => f.id === file.id);
					if (exists) {
						return files.map((f) =>
							f.id === file.id
								? {
										...f,
										language: file.language,
										content: file.content,
										savedContent: file.savedContent ?? f.savedContent ?? file.content,
										originalContent: file.originalContent ?? f.originalContent ?? file.content,
										isLoaded: true,
										isModified: f.isModified ?? false,
										isImage: file.isImage,
										imageUrl: file.imageUrl,
										isBinary: file.isBinary,
										fileTypeDescription: file.fileTypeDescription,
										hexData: file.hexData,
										fileSize: file.fileSize,
										lastDiskMtime: file.lastDiskMtime,
										lastDiskSize: file.lastDiskSize,
										cursor: file.cursor ?? f.cursor,
									}
								: f
						);
					}
					return [...files, file];
				});
			} catch (err) {
				console.error('Failed to load file content:', err);
			}
		} else {
			if ((file.language === 'plaintext' || !file.language) && file.content) {
				file.language = detectLanguage(file.name, file.content);
			}
			if (file.savedContent === undefined && file.content !== undefined) {
				file.savedContent = file.content;
			}
			if (file.originalContent === undefined && file.content !== undefined && !file.isModified && !file.gitStatus) {
				file.originalContent = file.content;
			}
			// Ensure file exists in files signal
			if (!this.files().some((f) => f.id === file.id)) {
				this.files.update((files) => [...files, file]);
			}
		}

		if (setActive && this.activeFileId() === file.id && file.isLoaded) {
			return;
		}

		const currentTabs = this.openTabs();
		if (!currentTabs.some((tab) => tab.id === file.id)) {
			this.openTabs.set([...currentTabs, file]);
		} else {
			this.openTabs.update((tabs) =>
				tabs.map((tab) =>
					tab.id === file.id
						? {
								...tab,
								isLoaded: true,
								isBinary: file.isBinary,
								fileTypeDescription: file.fileTypeDescription,
								hexData: file.hexData,
								fileSize: file.fileSize,
						  }
						: tab
				)
			);
		}
		if (setActive) {
			this.activeFileId.set(file.id);
			this.revealActiveFileInTree(file);
		}
	}

	public formatHexFromBuffer(u8: Uint8Array, totalSize: number, fileType: string, startOffset: number = 0): HexViewResult {
		const lines: HexLine[] = [];
		for (let i = 0; i < u8.length; i += 16) {
			const lineOffset = (startOffset + i).toString(16).padStart(8, '0').toUpperCase();
			const chunk = u8.slice(i, Math.min(i + 16, u8.length));
			let hexPart1 = '';
			let hexPart2 = '';
			let ascii = '';
			for (let j = 0; j < 16; j++) {
				if (j < chunk.length) {
					const b = chunk[j];
					const hexStr = b.toString(16).padStart(2, '0').toUpperCase();
					if (j < 8) {
						hexPart1 += (hexPart1 ? ' ' : '') + hexStr;
					} else {
						hexPart2 += (hexPart2 ? ' ' : '') + hexStr;
					}
					ascii += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
				} else {
					if (j < 8) {
						hexPart1 += (hexPart1 ? '   ' : '  ');
					} else {
						hexPart2 += (hexPart2 ? '   ' : '  ');
					}
					ascii += ' ';
				}
			}
			lines.push({ offset: lineOffset, hex_part1: hexPart1, hex_part2: hexPart2, ascii });
		}
		return {
			total_size: totalSize,
			file_type: fileType,
			lines,
			bytes_shown: startOffset + u8.length,
			has_more: (startOffset + u8.length) < totalSize
		};
	}

	public async loadMoreHex(file: WorkspaceFile): Promise<void> {
		if (!file.isBinary || !file.hexData || !file.hexData.has_more) return;
		const currentOffset = file.hexData.bytes_shown;
		if (isTauriApp() && file.fsPath) {
			try {
				const nextChunk = await invoke<HexViewResult>('read_file_hex', {
					filePath: file.fsPath,
					offset: currentOffset,
					maxBytes: 4096,
				});
				file.hexData.lines = [...file.hexData.lines, ...nextChunk.lines];
				file.hexData.bytes_shown = nextChunk.bytes_shown;
				file.hexData.has_more = nextChunk.has_more;
				this.files.update((files) =>
					files.map((f) => (f.id === file.id ? { ...f, hexData: { ...file.hexData! } } : f))
				);
				this.openTabs.update((tabs) =>
					tabs.map((t) => (t.id === file.id ? { ...t, hexData: { ...file.hexData! } } : t))
				);
			} catch (err) {
				console.error('Failed to load more hex:', err);
			}
		} else if (file.handle || file.rawFile) {
			try {
				const fileObj: File = file.handle ? await file.handle.getFile() : file.rawFile!;
				const nextSlice = await fileObj
					.slice(currentOffset, Math.min(currentOffset + 4096, fileObj.size))
					.arrayBuffer();
				const nextChunk = this.formatHexFromBuffer(
					new Uint8Array(nextSlice),
					fileObj.size,
					file.fileTypeDescription || '',
					currentOffset
				);
				file.hexData.lines = [...file.hexData.lines, ...nextChunk.lines];
				file.hexData.bytes_shown = nextChunk.bytes_shown;
				file.hexData.has_more = nextChunk.has_more;
				this.files.update((files) =>
					files.map((f) => (f.id === file.id ? { ...f, hexData: { ...file.hexData! } } : f))
				);
				this.openTabs.update((tabs) =>
					tabs.map((t) => (t.id === file.id ? { ...t, hexData: { ...file.hexData! } } : t))
				);
			} catch (err) {
				console.error('Failed to load more hex from web handle:', err);
			}
		}
	}

	public closeTab(fileId: string, event?: MouseEvent): void {
		if (event) {
			event.stopPropagation();
		}
		const tab = this.openTabs().find((t) => t.id === fileId);
		if (tab && tab.isModified) {
			this.promptUnsavedClose(tab);
			return;
		}
		this.forceCloseTab(fileId);
	}

	public promptUnsavedClose(file: WorkspaceFile): void {
		this.pendingUnsavedFile.set(file);
		this.openModal('unsaved-changes');
	}

	public forceCloseTab(fileId: string): void {
		const currentTabs = this.openTabs();
		const newTabs = currentTabs.filter((tab) => tab.id !== fileId);

		this.openTabs.set(newTabs);

		if (this.activeFileId() === fileId) {
			this.activeFileId.set(newTabs.length > 0 ? newTabs[newTabs.length - 1].id : '');
		}
		if (this.diffModeActive() && this.activeDiffFile()?.id === fileId) {
			this.closeDiffView();
		}
	}

	public discardChangesAndCloseTab(fileId: string): void {
		const target = this.files().find((f) => f.id === fileId) || this.openTabs().find((t) => t.id === fileId);
		if (target) {
			const reverted = target.savedContent ?? target.originalContent ?? target.content;
			target.content = reverted;
			target.isModified = false;
			this.files.update((files) =>
				files.map((f) => (f.id === fileId ? { ...f, content: reverted, isModified: false } : f))
			);
		}
		this.forceCloseTab(fileId);
		this.pendingUnsavedFile.set(null);
	}

	public updateContent(fileId: string, content: string): void {
		this.files.update((files) =>
			files.map((file) => {
				if (file.id === fileId) {
					const baseContent = file.savedContent !== undefined ? file.savedContent : file.originalContent;
					const isModified = baseContent !== undefined ? baseContent !== content : true;
					return { ...file, content, isModified };
				}
				return file;
			})
		);
		this.openTabs.update((tabs) =>
			tabs.map((tab) => {
				if (tab.id === fileId) {
					const baseContent = tab.savedContent !== undefined ? tab.savedContent : tab.originalContent;
					const isModified = baseContent !== undefined ? baseContent !== content : true;
					return { ...tab, content, isModified };
				}
				return tab;
			})
		);
	}

	/**
	 * Toggles directory expansion. If directory was not loaded yet, loads ONLY its immediate children!
	 */
	public async toggleFolder(node: FileTreeNode): Promise<void> {
		if (node.kind !== 'directory') return;

		if (node.isLoaded) {
			node.expanded = !node.expanded;
			this.triggerTreeUpdate();
			return;
		}

		if (isTauriApp() && node.fsPath) {
			node.isLoading = true;
			this.triggerTreeUpdate();
			try {
				const entries = await invoke<
					Array<{ name: string; path: string; is_dir: boolean; size: number }>
				>('read_dir_entries', { dirPath: node.fsPath, showHidden: this.showHiddenFiles() });
				const children: FileTreeNode[] = [];
				for (const entry of entries) {
					const relPath = `${node.path}/${entry.name}`;
					if (entry.is_dir) {
						children.push({
							id: relPath,
							name: entry.name,
							path: relPath,
							fsPath: entry.path,
							kind: 'directory',
							expanded: false,
							isLoaded: false,
							isLoading: false,
							children: [],
							level: node.level + 1,
						});
					} else if (this.isReadableTextFile(entry.name)) {
						const isBin = isBinaryFile(entry.name);
						const file: WorkspaceFile = {
							id: relPath,
							name: entry.name,
							path: relPath,
							fsPath: entry.path,
							language: isBin ? 'binary' : detectLanguageFromFilename(entry.name),
							content: '',
							isLoaded: false,
							isBinary: isBin || undefined,
							isModified: false,
						};
						children.push({
							id: relPath,
							name: entry.name,
							path: relPath,
							fsPath: entry.path,
							kind: 'file',
							language: file.language,
							file,
							level: node.level + 1,
						});
					}
				}
				node.children = children;
				node.isLoaded = true;
				node.expanded = true;
			} catch (err) {
				console.error('Failed to read native folder in Tauri:', err);
			} finally {
				node.isLoading = false;
				this.triggerTreeUpdate();
			}
			return;
		}

		// Load directory contents ON-DEMAND
		node.isLoading = true;
		this.triggerTreeUpdate();

		try {
			const children: FileTreeNode[] = [];

			if (node.handle && typeof node.handle.values === 'function') {
				for await (const entry of node.handle.values()) {
					if (!this.showHiddenFiles() && entry.name.startsWith('.')) {
						continue;
					}

					const childPath = `${node.path}/${entry.name}`;

					if (entry.kind === 'directory') {
						children.push({
							id: childPath,
							name: entry.name,
							path: childPath,
							kind: 'directory',
							expanded: false,
							isLoaded: false,
							isLoading: false,
							children: [],
							handle: entry,
							level: node.level + 1,
						});
					} else if (entry.kind === 'file') {
						if (this.isReadableTextFile(entry.name)) {
							const file: WorkspaceFile = {
								id: childPath,
								name: entry.name,
								path: childPath,
								language: detectLanguageFromFilename(entry.name),
								content: '',
								isLoaded: false,
								handle: entry,
								isModified: false,
							};
							children.push({
								id: childPath,
								name: entry.name,
								path: childPath,
								kind: 'file',
								language: file.language,
								file,
								handle: entry,
								level: node.level + 1,
							});
						}
					}
				}
			} else if (this.fallbackFilesList.length > 0) {
				// Load immediate children from fallback file list
				const prefix = node.path + '/';
				const encounteredDirs = new Set<string>();

				for (const file of this.fallbackFilesList) {
					const rel = this.stripRootPrefix(file.webkitRelativePath || file.name);
					if (rel.startsWith(prefix)) {
						const remainder = rel.substring(prefix.length);
						const parts = remainder.split('/');

						if (parts.length === 1) {
							// Direct file in this folder
							if (this.isReadableTextFile(parts[0])) {
								const f: WorkspaceFile = {
									id: rel,
									name: parts[0],
									path: rel,
									language: detectLanguageFromFilename(parts[0]),
									content: '',
									isLoaded: false,
									rawFile: file,
									isModified: false,
								};
								children.push({
									id: rel,
									name: parts[0],
									path: rel,
									kind: 'file',
									language: f.language,
									file: f,
									level: node.level + 1,
								});
							}
						} else {
							// Immediate subdirectory
							const dirName = parts[0];
							if (
								!encounteredDirs.has(dirName) &&
								(!dirName.startsWith('.') || this.showHiddenFiles())
							) {
								encounteredDirs.add(dirName);
								const subPath = `${node.path}/${dirName}`;
								children.push({
									id: subPath,
									name: dirName,
									path: subPath,
									kind: 'directory',
									expanded: false,
									isLoaded: false,
									isLoading: false,
									children: [],
									level: node.level + 1,
								});
							}
						}
					}
				}
			}

			children.sort((a, b) => {
				if (a.kind !== b.kind) {
					return a.kind === 'directory' ? -1 : 1;
				}
				return a.name.localeCompare(b.name);
			});

			node.children = children;
			node.isLoaded = true;
			node.expanded = true;
		} catch (err) {
			console.error('Failed to expand folder:', err);
		} finally {
			node.isLoading = false;
			this.triggerTreeUpdate();
		}
	}

	public collapseAllFolders(): void {
		const collapseRecursive = (nodes: FileTreeNode[]) => {
			for (const n of nodes) {
				if (n.kind === 'directory') {
					n.expanded = false;
					if (n.children && n.children.length > 0) {
						collapseRecursive(n.children);
					}
				}
			}
		};
		const current = this.fileTree();
		collapseRecursive(current);
		this.triggerTreeUpdate();
	}

	public async expandAllFolders(): Promise<void> {
		const expandRecursive = async (nodes: FileTreeNode[]) => {
			for (const n of nodes) {
				if (n.kind === 'directory') {
					if (!n.isLoaded) {
						await this.toggleFolder(n);
					} else {
						n.expanded = true;
					}
					if (n.children && n.children.length > 0) {
						await expandRecursive(n.children);
					}
				}
			}
		};
		await expandRecursive(this.fileTree());
		this.triggerTreeUpdate();
	}

	private revealToken = 0;

	private setupAutoReveal(): void {
		effect(() => {
			const activeId = this.activeFileId();
			if (!activeId) return;

			untracked(() => {
				if (!this.isScanning() && this.fileTree().length > 0) {
					this.revealActiveFileInTree();
				}
			});
		});
	}

	/**
	 * Reveals the active file in the sidebar file tree by expanding only its
	 * ancestor directories and collapsing all unrelated directories.
	 */
	public async revealActiveFileInTree(activeFile?: WorkspaceFile): Promise<void> {
		const currentToken = ++this.revealToken;
		const file = activeFile || this.activeFile();
		if (!file) return;

		const normalizePath = (p: string) =>
			p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');

		let relPath = file.path || file.id;
		let wsRoot = this.nativeWorkspacePath();
		if (wsRoot) {
			wsRoot = normalizePath(wsRoot);
			if (file.fsPath) {
				const normFs = normalizePath(file.fsPath);
				if (normFs.startsWith(wsRoot)) {
					relPath = normFs.substring(wsRoot.length);
				}
			}
		}
		relPath = normalizePath(relPath);

		const parts = relPath.split('/').filter(Boolean);
		const ancestorPaths = new Set<string>();
		let acc = '';
		for (let i = 0; i < parts.length - 1; i++) {
			acc = acc ? `${acc}/${parts[i]}` : parts[i];
			ancestorPaths.add(acc);
		}

		const collapseChildrenRecursively = (nodes: FileTreeNode[]) => {
			for (const n of nodes) {
				if (n.kind === 'directory') {
					n.expanded = false;
					if (n.children && n.children.length > 0) {
						collapseChildrenRecursively(n.children);
					}
				}
			}
		};

		const processNodes = async (nodes: FileTreeNode[]) => {
			for (const node of nodes) {
				if (this.revealToken !== currentToken) return;
				if (node.kind === 'directory') {
					const nodePath = normalizePath(node.path);
					if (ancestorPaths.has(nodePath)) {
						if (!node.isLoaded) {
							await this.toggleFolder(node);
						} else {
							node.expanded = true;
						}
						if (node.children && node.children.length > 0) {
							await processNodes(node.children);
						}
					} else {
						node.expanded = false;
						if (node.children && node.children.length > 0) {
							collapseChildrenRecursively(node.children);
						}
					}
				}
			}
		};

		await processNodes(this.fileTree());
		if (this.revealToken === currentToken) {
			this.triggerTreeUpdate();
		}
	}

	private setupSessionPersistence(): void {
		effect(() => {
			// Automatically track openTabs and activeFileId changes
			const tabs = this.openTabs();
			const activeId = this.activeFileId();
			if (this.isRealWorkspace() && !this.isRestoringSession()) {
				this.triggerSaveSessionState();
			}
		});
	}

	public triggerSaveSessionState(): void {
		if (!this.isRealWorkspace() || this.isRestoringSession()) return;
		if (this.saveSessionTimeout) {
			clearTimeout(this.saveSessionTimeout);
		}
		this.saveSessionTimeout = setTimeout(() => {
			this.saveWorkspaceSessionState();
		}, 250);
	}

	public async saveWorkspaceSessionState(): Promise<void> {
		const rootPath = this.nativeWorkspacePath();
		if (!this.isRealWorkspace()) return;

		const currentActiveId = this.activeFileId();
		const currentActiveFile = this.activeFile();
		const activePath = currentActiveFile?.path || currentActiveFile?.id || currentActiveId || null;

		const openFiles = this.openTabs().map((t) => {
			const item: { path: string; mtime?: number; size?: number; cursor?: { line: number; column: number } } = {
				path: t.path || t.id,
			};
			if (t.lastDiskMtime !== undefined) item.mtime = t.lastDiskMtime;
			if (t.lastDiskSize !== undefined || t.fileSize !== undefined) {
				item.size = t.lastDiskSize ?? t.fileSize;
			}
			const matched = this.files().find((f) => f.id === t.id || f.path === t.path);
			const cur = t.cursor || matched?.cursor;
			if (cur) {
				item.cursor = cur;
			}
			return item;
		});

		const state = {
			openFiles,
			activeFile: activePath,
		};

		const jsonStr = JSON.stringify(state, null, 2);

		if (this.isDesktop() && rootPath) {
			const videDir = rootPath.endsWith('/') ? `${rootPath}.vide` : `${rootPath}/.vide`;
			const configPath = `${videDir}/workspace.json`;
			try {
				await invoke('write_file_text', {
					filePath: configPath,
					content: jsonStr,
				});
			} catch (err) {
				console.warn('Failed to save .vide/workspace.json:', err);
			}
		} else if (this.recentDirHandle) {
			try {
				const videHandle = await this.recentDirHandle.getDirectoryHandle('.vide', { create: true });
				const fileHandle = await videHandle.getFileHandle('workspace.json', { create: true });
				const writable = await fileHandle.createWritable();
				await writable.write(jsonStr);
				await writable.close();
			} catch (err) {
				console.warn('Failed to save .vide/workspace.json in browser mode:', err);
			}
		}
	}

	public async loadWorkspaceSessionState(dirHandle?: any): Promise<{
		openFiles: Array<{ path: string; mtime?: number; size?: number; cursor?: { line: number; column: number } }>;
		activeFile: string | null;
	} | null> {
		const rootPath = this.nativeWorkspacePath();
		if (!this.isRealWorkspace()) return null;

		const parseSession = (content: string) => {
			try {
				const parsed = JSON.parse(content);
				if (parsed && Array.isArray(parsed.openFiles)) {
					const normalizedOpenFiles: Array<{ path: string; mtime?: number; size?: number; cursor?: { line: number; column: number } }> = [];
					for (const item of parsed.openFiles) {
						if (typeof item === 'string' && item.trim()) {
							normalizedOpenFiles.push({ path: item.trim() });
						} else if (item && typeof item === 'object' && typeof item.path === 'string' && item.path.trim()) {
							normalizedOpenFiles.push({
								path: item.path.trim(),
								mtime: typeof item.mtime === 'number' ? item.mtime : undefined,
								size: typeof item.size === 'number' ? item.size : undefined,
								cursor: item.cursor && typeof item.cursor.line === 'number' ? item.cursor : undefined,
							});
						}
					}
					return {
						openFiles: normalizedOpenFiles,
						activeFile: typeof parsed.activeFile === 'string' ? parsed.activeFile : null,
					};
				}
			} catch {
				// Invalid JSON
			}
			return null;
		};

		if (this.isDesktop() && rootPath) {
			const configPath = rootPath.endsWith('/')
				? `${rootPath}.vide/workspace.json`
				: `${rootPath}/.vide/workspace.json`;
			try {
				const content = await invoke<string>('read_file_text', { filePath: configPath });
				if (content) {
					return parseSession(content);
				}
			} catch {
				// File does not exist or invalid JSON; return null
			}
		} else {
			const handle = dirHandle || this.recentDirHandle;
			if (handle) {
				try {
					const videHandle = await handle.getDirectoryHandle('.vide', { create: false });
					const fileHandle = await videHandle.getFileHandle('workspace.json', { create: false });
					const fileObj = await fileHandle.getFile();
					const content = await fileObj.text();
					if (content) {
						return parseSession(content);
					}
				} catch {
					// Does not exist
				}
			}
		}
		return null;
	}

	/**
	 * Opens directory using HTML5 File System Access API with instant shallow root load.
	 */
	public async openDirectoryFromDisk(): Promise<void> {
		if (typeof window === 'undefined') return;

		if (isTauriApp()) {
			try {
				const current = this.nativeWorkspacePath();
				const selected = await invoke<string | null>('select_directory', {
					currentPath: current || '/home/ori/work/vide',
				});
				if (selected) {
					await this.loadFromNativePath(selected);
				}
			} catch (err: any) {
				console.error('Failed to select native directory in Tauri:', err);
				this.showNotification(`Error opening folder: ${err.message || err}`);
			}
			return;
		}

		// Start loading animation instantly so the user sees feedback with 0ms delay
		this.isScanning.set(true);
		this.scanProgress.set('Select folder...');

		if ('showDirectoryPicker' in window) {
			try {
				const dirHandle = await (window as any).showDirectoryPicker({
					mode: 'readwrite',
				});

				this.scanProgress.set(`Opening ${dirHandle.name}...`);
				await this.loadFromDirHandle(dirHandle);
			} catch (err: any) {
				if (err.name !== 'AbortError') {
					console.error('Failed to open directory:', err);
					this.showNotification(`Error opening folder: ${err.message}`);
				}
			} finally {
				this.isScanning.set(false);
			}
		} else {
			this.fallbackInputDirectory();
		}
	}

	public async loadFromNativePath(
		rootPath: string,
		cliFiles?: CliFileToOpen[],
		targetFile?: string | null,
		highlightStart?: number | null,
		highlightEnd?: number | null
	): Promise<void> {
		if (this.isRealWorkspace() && this.nativeWorkspacePath() && this.nativeWorkspacePath() !== rootPath) {
			await this.flushSessionBeforeClose();
		}

		if (isTauriApp()) {
			try {
				rootPath = await invoke<string>('resolve_path', { path: rootPath });
			} catch {
				if (rootPath.startsWith('~/')) {
					rootPath = '/home/ori/' + rootPath.substring(2);
				} else if (rootPath === '~') {
					rootPath = '/home/ori';
				}
			}
			try {
				await invoke('register_active_workspace', { workspacePath: rootPath });
			} catch (err) {
				console.warn('Failed to register active workspace:', err);
			}
		} else {
			if (rootPath.startsWith('~/')) {
				rootPath = '/home/ori/' + rootPath.substring(2);
			} else if (rootPath === '~') {
				rootPath = '/home/ori';
			}
		}

		this.isRestoringSession.set(true);
		const folderName = rootPath.split('/').filter(Boolean).pop() || rootPath;

		this.ngZone.run(() => {
			this.isScanning.set(true);
			this.scanProgress.set(`Opening ${folderName}...`);
			this.nativeWorkspacePath.set(rootPath);
			if (typeof window !== 'undefined') {
				localStorage.setItem('vector_last_native_path', rootPath);
				this.recentWorkspaceName.set(folderName);
				this.addRecentWorkspace(folderName, rootPath);
			}
			this.workspaceName.set(folderName);
			this.isRealWorkspace.set(true);

			// Reset editor tabs and diff mode for the new folder
			this.openTabs.set([]);
			this.activeFileId.set('');
			this.diffModeActive.set(false);
			this.activeDiffFile.set(null);
		});

		try {
			const entries = await invoke<
				Array<{ name: string; path: string; is_dir: boolean; size: number }>
			>('read_dir_entries', { dirPath: rootPath, showHidden: this.showHiddenFiles() });

			const rootNodes: FileTreeNode[] = [];
			const rootFiles: WorkspaceFile[] = [];

			for (const entry of entries) {
				if (entry.is_dir) {
					rootNodes.push({
						id: entry.name,
						name: entry.name,
						path: entry.name,
						fsPath: entry.path,
						kind: 'directory',
						expanded: false,
						isLoaded: false,
						isLoading: false,
						children: [],
						level: 0,
					});
				} else if (this.isReadableTextFile(entry.name)) {
					const isBin = isBinaryFile(entry.name);
					const file: WorkspaceFile = {
						id: entry.name,
						name: entry.name,
						path: entry.name,
						fsPath: entry.path,
						language: isBin ? 'binary' : detectLanguageFromFilename(entry.name),
						content: '',
						isLoaded: false,
						isBinary: isBin || undefined,
						isModified: false,
					};
					rootFiles.push(file);
					rootNodes.push({
						id: entry.name,
						name: entry.name,
						path: entry.name,
						fsPath: entry.path,
						kind: 'file',
						language: file.language,
						file,
						level: 0,
					});
				}
			}

			rootNodes.sort((a, b) => {
				if (a.kind !== b.kind) {
					return a.kind === 'directory' ? -1 : 1;
				}
				return a.name.localeCompare(b.name);
			});
			const sortedRootFiles = rootNodes.filter((n) => n.file).map((n) => n.file!);

			this.ngZone.run(() => {
				this.fileTree.set(rootNodes);
				this.files.set(sortedRootFiles);
			});

			const fileToNavigate =
				targetFile ||
				(highlightStart !== undefined && highlightStart !== null && cliFiles && cliFiles.length > 0
					? cliFiles[0].rel_path || cliFiles[0].fs_path
					: null);

			if (fileToNavigate) {
				await this.navigateToFile(fileToNavigate, highlightStart, highlightEnd);
			} else if (cliFiles && cliFiles.length > 0) {
				for (const cf of cliFiles.slice(0, 3)) {
					let fileToOpen = sortedRootFiles.find(
						(f) => f.path === cf.rel_path || f.fsPath === cf.fs_path
					);
					if (!fileToOpen) {
						fileToOpen = {
							id: cf.rel_path,
							name: cf.name,
							path: cf.rel_path,
							fsPath: cf.fs_path,
							language: detectLanguageFromFilename(cf.name),
							content: '',
							isLoaded: false,
							isModified: false,
						};
						this.files.update((files) => [...files, fileToOpen!]);
					}
					await this.openFile(fileToOpen, false);
				}
				if (cliFiles.length > 0) {
					const firstTarget = cliFiles[0];
					const found = this.files().find(
						(f) => f.path === firstTarget.rel_path || f.fsPath === firstTarget.fs_path
					);
					if (found) {
						this.activeFileId.set(found.id);
					}
				}
			} else {
				const session = await this.loadWorkspaceSessionState();
				if (session && session.openFiles.length > 0) {
					for (const item of session.openFiles) {
						const relPath = item.path;
						let fileToOpen = sortedRootFiles.find(
							(f) => f.path === relPath || f.id === relPath || f.fsPath === relPath
						);
						if (!fileToOpen) {
							const fullFsPath = rootPath.endsWith('/') ? `${rootPath}${relPath}` : `${rootPath}/${relPath}`;
							const baseName = relPath.split('/').pop() || relPath;
							fileToOpen = {
								id: relPath,
								name: baseName,
								path: relPath,
								fsPath: fullFsPath,
								language: detectLanguageFromFilename(baseName),
								content: '',
								isLoaded: false,
								isModified: false,
								lastDiskMtime: item.mtime,
								lastDiskSize: item.size,
								fileSize: item.size,
								cursor: item.cursor,
							};
							this.files.update((files) => [...files, fileToOpen!]);
						} else {
							if (item.mtime !== undefined) fileToOpen.lastDiskMtime = item.mtime;
							if (item.size !== undefined) {
								fileToOpen.lastDiskSize = item.size;
								fileToOpen.fileSize = item.size;
							}
						}
						if (item.cursor) {
							fileToOpen.cursor = item.cursor;
						}
						try {
							await this.openFile(fileToOpen, false);
						} catch (err) {
							console.warn(`Failed to restore file ${relPath}:`, err);
						}
					}
					if (session.activeFile) {
						const activeTarget = this.files().find(
							(f) => f.path === session.activeFile || f.id === session.activeFile
						);
						if (activeTarget) {
							this.activeFileId.set(activeTarget.id);
							if (activeTarget.cursor) {
								this.pendingLineJump.set({
									fileId: activeTarget.id,
									lineNumber: activeTarget.cursor.line,
									column: activeTarget.cursor.column || 1,
								});
							}
							if (highlightStart !== undefined && highlightStart !== null) {
								const s = highlightStart;
								const e = highlightEnd ?? highlightStart;
								this.pendingHighlight.set({
									fileId: activeTarget.id,
									highlightStart: s,
									highlightEnd: e,
								});
							}
						}
					} else if (this.openTabs().length > 0) {
						this.activeFileId.set(this.openTabs()[0].id);
					}
				}
			}

			this.showNotification(`Opened ${folderName}`);
		} catch (err: any) {
			console.error('Failed to load native directory:', err);
			this.showNotification(`Error: ${err.message || err}`);
		} finally {
			this.isRestoringSession.set(false);
			this.ngZone.run(() => {
				this.isScanning.set(false);
			});
			this.revealActiveFileInTree();
			this.appRef.tick();
		}

		// Persist session state so new folders get their .vide/workspace.json saved
		this.saveWorkspaceSessionState();

		// Launch Git refresh and background file indexing asynchronously without blocking UI
		this.refreshGitStatus().catch((err) => console.warn('Git refresh error:', err));
		this.indexNativeDirectoryInBackground(rootPath);
	}

	// Toggle show/hide hidden files (Ctrl+H or toolbar button)
	public async toggleHiddenFiles(): Promise<void> {
		const newVal = !this.showHiddenFiles();
		this.showHiddenFiles.set(newVal);
		if (typeof window !== 'undefined') {
			localStorage.setItem('vector_show_hidden_files', String(newVal));
		}
		this.showNotification(newVal ? 'Showing hidden files' : 'Hiding hidden files');
		await this.refreshFileTree();
	}

	public async refreshFileTree(): Promise<void> {
		const nativePath = this.nativeWorkspacePath();
		if (this.isDesktop() && nativePath) {
			await this.reloadNativeTreePreservingState(nativePath);
			return;
		}
		if (this.recentDirHandle) {
			await this.loadFromDirHandle(this.recentDirHandle);
		}
	}

	private async reloadNativeTreePreservingState(rootPath: string): Promise<void> {
		const expandedFsPaths = new Set<string>();
		const collectExpanded = (nodes: FileTreeNode[]) => {
			for (const n of nodes) {
				if (n.kind === 'directory' && n.expanded && n.fsPath) {
					expandedFsPaths.add(n.fsPath);
				}
				if (n.children && n.children.length > 0) {
					collectExpanded(n.children);
				}
			}
		};
		collectExpanded(this.fileTree());

		const loadDirRecursive = async (
			dirFsPath: string,
			dirRelPath: string,
			level: number
		): Promise<FileTreeNode[]> => {
			try {
				const entries = await invoke<
					Array<{ name: string; path: string; is_dir: boolean; size: number }>
				>('read_dir_entries', { dirPath: dirFsPath, showHidden: this.showHiddenFiles() });

				const nodes: FileTreeNode[] = [];
				for (const entry of entries) {
					const relPath = dirRelPath ? `${dirRelPath}/${entry.name}` : entry.name;
					if (entry.is_dir) {
						const isExpanded = expandedFsPaths.has(entry.path);
						const dirNode: FileTreeNode = {
							id: relPath,
							name: entry.name,
							path: relPath,
							fsPath: entry.path,
							kind: 'directory',
							expanded: isExpanded,
							isLoaded: isExpanded,
							isLoading: false,
							children: [],
							level,
						};
						if (isExpanded) {
							dirNode.children = await loadDirRecursive(entry.path, relPath, level + 1);
						}
						nodes.push(dirNode);
					} else if (this.isReadableTextFile(entry.name)) {
						const isBin = isBinaryFile(entry.name);
						const existingFile = this.files().find(
							(f) => f.fsPath === entry.path || f.path === relPath
						);
						const file: WorkspaceFile = existingFile || {
							id: relPath,
							name: entry.name,
							path: relPath,
							fsPath: entry.path,
							language: isBin ? 'binary' : detectLanguageFromFilename(entry.name),
							content: '',
							isLoaded: false,
							isBinary: isBin || undefined,
							isModified: false,
						};
						nodes.push({
							id: relPath,
							name: entry.name,
							path: relPath,
							fsPath: entry.path,
							kind: 'file',
							language: file.language,
							file,
							level,
						});
					}
				}
				return nodes;
			} catch (err) {
				console.error('Failed to load dir in tree refresh:', dirFsPath, err);
				return [];
			}
		};

		const newRootNodes = await loadDirRecursive(rootPath, '', 0);
		this.fileTree.set(newRootNodes);
	}

	public async indexNativeDirectoryInBackground(rootPath: string): Promise<void> {
		this.isIndexing.set(true);
		this.indexedFileCount.set(0);

		const discoveredFiles: WorkspaceFile[] = [];
		const queue: { fullPath: string; relPath: string }[] = [{ fullPath: rootPath, relPath: '' }];
		const visitedDirs = new Set<string>();
		let dirsProcessed = 0;

		try {
			while (queue.length > 0) {
				if (dirsProcessed > 5000 || discoveredFiles.length > 30000) {
					console.warn('Indexing limit reached, stopping background traversal');
					break;
				}
				const current = queue.shift()!;
				if (visitedDirs.has(current.fullPath)) {
					continue;
				}
				visitedDirs.add(current.fullPath);
				try {
					const entries = await invoke<
						Array<{ name: string; path: string; is_dir: boolean; size: number }>
					>('read_dir_entries', { dirPath: current.fullPath, showHidden: this.showHiddenFiles() });

					for (const entry of entries) {
						const relPath = current.relPath ? `${current.relPath}/${entry.name}` : entry.name;
						if (entry.is_dir) {
							if (
								BACKGROUND_INDEX_IGNORED_DIRS.has(entry.name) ||
								(!this.showHiddenFiles() && entry.name.startsWith('.'))
							) {
								continue;
							}
							queue.push({ fullPath: entry.path, relPath });
						} else if (this.isReadableTextFile(entry.name)) {
							const isBin = isBinaryFile(entry.name);
							discoveredFiles.push({
								id: relPath,
								name: entry.name,
								path: relPath,
								fsPath: entry.path,
								language: isBin ? 'binary' : detectLanguageFromFilename(entry.name),
								content: '',
								isLoaded: false,
								isBinary: isBin || undefined,
								isModified: false,
							});
						}
					}
				} catch (dirErr) {
					console.warn('Skipping native directory in indexer:', current.relPath, dirErr);
				}

				dirsProcessed++;
				if (dirsProcessed % 10 === 0) {
					this.indexedFileCount.set(discoveredFiles.length);
					await new Promise((r) => setTimeout(r, 0));
				}
			}

			const existingMap = new Map(
				this.files()
					.filter((f) => f.isLoaded || f.isModified || f.gitStatus)
					.map((f) => [f.path, f])
			);

			const mergedFiles = discoveredFiles.map((df) => {
				const existing = existingMap.get(df.path);
				if (existing) {
					return {
						...df,
						...existing,
					};
				}
				return df;
			});

			for (const existing of existingMap.values()) {
				if (!mergedFiles.some((f) => f.path === existing.path || f.id === existing.id)) {
					mergedFiles.push(existing);
				}
			}

			this.files.set(mergedFiles);
			this.indexedFileCount.set(mergedFiles.length);
			this.showNotification(`Indexed ${mergedFiles.length} files`);
			await this.refreshGitStatus();
		} catch (err) {
			console.error('Background native indexing error:', err);
		} finally {
			this.isIndexing.set(false);
		}
	}

	public async loadFromDirHandle(dirHandle: any): Promise<void> {
		if (this.isRealWorkspace() && this.recentWorkspaceName() !== dirHandle.name) {
			await this.flushSessionBeforeClose();
		}
		this.isRestoringSession.set(true);
		this.isScanning.set(true);
		this.scanProgress.set(`Opening ${dirHandle.name}...`);
		await new Promise((r) => setTimeout(r, 0));

		try {
			// Save to IndexedDB and localStorage for one-click reopening
			this.saveLastDirectoryHandle(dirHandle);

			// Read ONLY immediate children of the root directory (shallow, instant!)
			const rootNodes: FileTreeNode[] = [];

			for await (const entry of dirHandle.values()) {
				if (entry.name === '.git' && entry.kind === 'directory') {
					this.recentGitDirHandle = entry;
					if (!this.showHiddenFiles()) {
						continue;
					}
				} else if (!this.showHiddenFiles() && entry.name.startsWith('.')) {
					continue;
				}

				if (entry.kind === 'directory') {
					rootNodes.push({
						id: entry.name,
						name: entry.name,
						path: entry.name,
						kind: 'directory',
						expanded: false,
						isLoaded: false,
						isLoading: false,
						children: [],
						handle: entry,
						level: 0,
					});
				} else if (entry.kind === 'file') {
					if (this.isReadableTextFile(entry.name)) {
						const file: WorkspaceFile = {
							id: entry.name,
							name: entry.name,
							path: entry.name,
							language: detectLanguageFromFilename(entry.name),
							content: '',
							isLoaded: false,
							handle: entry,
							isModified: false,
						};
						rootNodes.push({
							id: entry.name,
							name: entry.name,
							path: entry.name,
							kind: 'file',
							language: file.language,
							file,
							handle: entry,
							level: 0,
						});
					}
				}
			}

			rootNodes.sort((a, b) => {
				if (a.kind !== b.kind) {
					return a.kind === 'directory' ? -1 : 1;
				}
				return a.name.localeCompare(b.name);
			});

			this.workspaceName.set(dirHandle.name);
			this.isRealWorkspace.set(true);
			this.openTabs.set([]);
			this.activeFileId.set('');
			this.diffModeActive.set(false);
			this.activeDiffFile.set(null);
			this.fileTree.set(rootNodes);

			const rootFiles = rootNodes.filter((n) => n.file).map((n) => n.file!);
			this.files.set(rootFiles);

			// Restore session state or find first file to open
			const session = await this.loadWorkspaceSessionState(dirHandle);
			if (session && session.openFiles.length > 0) {
				for (const item of session.openFiles) {
					const relPath = item.path;
					let fileToOpen = rootFiles.find((f) => f.path === relPath || f.id === relPath);
					if (!fileToOpen) {
						const baseName = relPath.split('/').pop() || relPath;
						fileToOpen = {
							id: relPath,
							name: baseName,
							path: relPath,
							language: detectLanguageFromFilename(baseName),
							content: '',
							isLoaded: false,
							isModified: false,
							lastDiskMtime: item.mtime,
							lastDiskSize: item.size,
							fileSize: item.size,
							cursor: item.cursor,
						};
						this.files.update((files) => [...files, fileToOpen!]);
					} else {
						if (item.mtime !== undefined) fileToOpen.lastDiskMtime = item.mtime;
						if (item.size !== undefined) {
							fileToOpen.lastDiskSize = item.size;
							fileToOpen.fileSize = item.size;
						}
					}
					if (item.cursor) {
						fileToOpen.cursor = item.cursor;
					}
					try {
						await this.openFile(fileToOpen, false);
					} catch (err) {
						console.warn(`Failed to restore file ${relPath}:`, err);
					}
				}
				if (session.activeFile) {
					const activeTarget = this.files().find(
						(f) => f.path === session.activeFile || f.id === session.activeFile
					);
					if (activeTarget) {
						this.activeFileId.set(activeTarget.id);
						if (activeTarget.cursor) {
							this.pendingLineJump.set({
								fileId: activeTarget.id,
								lineNumber: activeTarget.cursor.line,
								column: activeTarget.cursor.column || 1,
							});
						}
					}
				} else if (this.openTabs().length > 0) {
					this.activeFileId.set(this.openTabs()[0].id);
				}
			}

			this.showNotification(`Opened ${dirHandle.name}`);
		} catch (err: any) {
			console.error('Failed to load directory handle:', err);
			this.showNotification(`Error: ${err.message || err}`);
		} finally {
			this.isRestoringSession.set(false);
			this.isScanning.set(false);
			this.revealActiveFileInTree();
		}

		this.saveWorkspaceSessionState();

		// Read real git branch and initial status asynchronously
		this.refreshGitStatus(dirHandle).catch((err) => console.warn('Git refresh error:', err));

		// Launch background indexing so find-file & grep can search ALL project files
		this.indexDirectoryInBackground(dirHandle);
	}

	private openDb(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const req = indexedDB.open('VectorIdeStorage', 3);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains('handles')) {
					db.createObjectStore('handles');
				}
			};
			req.onsuccess = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains('handles')) {
					db.close();
					const upReq = indexedDB.open('VectorIdeStorage', db.version + 1);
					upReq.onupgradeneeded = () => {
						upReq.result.createObjectStore('handles');
					};
					upReq.onsuccess = () => resolve(upReq.result);
					upReq.onerror = () => reject(upReq.error);
				} else {
					resolve(db);
				}
			};
			req.onerror = () => reject(req.error);
		});
	}

	private async initRecentWorkspace(): Promise<void> {
		if (typeof window === 'undefined') return;

		try {
			if (isTauriApp()) {
				try {
					const cli = await invoke<CliLaunchPayload>('get_cli_launch_payload');
					if (cli && cli.workspace_path) {
						await this.loadFromNativePath(
							cli.workspace_path,
							cli.files,
							cli.target_file,
							cli.highlight_start,
							cli.highlight_end
						);
						return;
					}
				} catch (cliErr) {
					console.warn('Could not read CLI launch payload:', cliErr);
				}

				const lastNative = localStorage.getItem('vector_last_native_path');
				if (lastNative) {
					const folderName = lastNative.split('/').filter(Boolean).pop() || lastNative;
					this.recentWorkspaceName.set(folderName);
				}
				return;
			}

			const savedName = localStorage.getItem('vector_last_workspace_name');
			if (savedName) {
				this.recentWorkspaceName.set(savedName);
			}

			if ('showDirectoryPicker' in window) {
				const handle = await this.getStoredDirectoryHandle();
				if (handle) {
					this.recentDirHandle = handle;
					this.recentWorkspaceName.set(handle.name);

					// Attempt automatic restore if permission is already granted
					if (typeof handle.queryPermission === 'function') {
						try {
							const status = await handle.queryPermission({ mode: 'readwrite' });
							if (status === 'granted') {
								await this.loadFromDirHandle(handle);
							}
						} catch (pErr) {
							console.warn('Could not query permission on startup:', pErr);
						}
					}
				}
			}
		} catch (err) {
			console.warn('Error initializing recent workspace:', err);
		}
	}

	public loadRecentWorkspaces(): void {
		if (typeof window === 'undefined') return;
		try {
			const raw = localStorage.getItem('vector_recent_workspaces');
			if (raw) {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed) && parsed.length > 0) {
					this.recentWorkspaces.set(parsed);
					return;
				}
			}
		} catch {
			// Fallback
		}

		const initialList: RecentWorkspaceItem[] = [];
		const lastNative = localStorage.getItem('vector_last_native_path');
		if (lastNative) {
			const name = lastNative.split('/').filter(Boolean).pop() || lastNative;
			initialList.push({ name, path: lastNative });
		}
		if (!initialList.some((w) => w.path === '/home/ori/work/vide')) {
			initialList.push({ name: 'vide', path: '/home/ori/work/vide' });
		}
		if (!initialList.some((w) => w.path === '/home/ori/work/officemanager')) {
			initialList.push({ name: 'officemanager', path: '/home/ori/work/officemanager' });
		}
		this.recentWorkspaces.set(initialList);
	}

	public addRecentWorkspace(name: string, path: string): void {
		const current = this.recentWorkspaces().filter((item) => item.path !== path);
		const updated = [{ name, path }, ...current].slice(0, 10);
		this.recentWorkspaces.set(updated);
		if (typeof window !== 'undefined') {
			try {
				localStorage.setItem('vector_recent_workspaces', JSON.stringify(updated));
			} catch (e) {
				console.warn('Could not save recent workspaces:', e);
			}
		}
	}

	public async openRecentByPath(path: string): Promise<void> {
		if (this.isDesktop()) {
			await this.loadFromNativePath(path);
		} else {
			await this.openDirectoryFromDisk();
		}
	}

	public removeRecentWorkspace(path: string, event?: MouseEvent): void {
		if (event) {
			event.stopPropagation();
		}
		const updated = this.recentWorkspaces().filter((item) => item.path !== path);
		this.recentWorkspaces.set(updated);
		if (typeof window !== 'undefined') {
			try {
				localStorage.setItem('vector_recent_workspaces', JSON.stringify(updated));
			} catch (e) {
				console.warn('Could not update recent workspaces:', e);
			}
		}
	}

	public registerBeforeCloseCallback(cb: () => void | Promise<void>): () => void {
		this.beforeCloseCallbacks.push(cb);
		return () => {
			this.beforeCloseCallbacks = this.beforeCloseCallbacks.filter((c) => c !== cb);
		};
	}

	public async flushSessionBeforeClose(): Promise<void> {
		for (const cb of this.beforeCloseCallbacks) {
			try {
				await cb();
			} catch (e) {
				console.warn('Error in beforeClose callback:', e);
			}
		}
		if (this.isRealWorkspace()) {
			await this.saveWorkspaceSessionState();
		}
	}

	public updateFileCursor(fileId: string, cursor: { line: number; column: number }): void {
		const f = this.files().find((file) => file.id === fileId || file.path === fileId);
		if (f) {
			f.cursor = cursor;
		}
		const t = this.openTabs().find((tab) => tab.id === fileId || tab.path === fileId);
		if (t) {
			t.cursor = cursor;
		}
	}

	public async closeWorkspace(): Promise<void> {
		await this.flushSessionBeforeClose();
		this.nativeWorkspacePath.set(null);
		this.workspaceName.set('NO FOLDER OPENED');
		this.isRealWorkspace.set(false);
		this.files.set([]);
		this.fileTree.set([]);
		this.openTabs.set([]);
		this.activeFileId.set('');
		this.diffModeActive.set(false);
		this.activeDiffFile.set(null);
		this.gitBranch.set(null);
		this.showNotification('Folder closed');
	}

	public async openSystemTerminal(): Promise<void> {
		const rootPath = this.nativeWorkspacePath();
		if (!this.isDesktop() || !rootPath) {
			this.showNotification('Terminal is only available in desktop mode with an open folder');
			return;
		}

		try {
			await invoke('open_system_terminal', { dirPath: rootPath });
			this.showNotification('Terminal opened');
		} catch (err: any) {
			console.error('Failed to open system terminal:', err);
			this.showNotification(`Terminal error: ${err.message || err}`);
		}
	}

	private async saveLastDirectoryHandle(dirHandle: any): Promise<void> {
		try {
			if (typeof window === 'undefined') return;
			localStorage.setItem('vector_last_workspace_name', dirHandle.name);
			this.recentWorkspaceName.set(dirHandle.name);
			this.recentDirHandle = dirHandle;

			const db = await this.openDb();
			const tx = db.transaction('handles', 'readwrite');
			tx.objectStore('handles').put(dirHandle, 'last_dir_handle');
			await new Promise<void>((resolve, reject) => {
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
			console.log('✅ Directory handle persisted to IndexedDB:', dirHandle.name);
		} catch (err) {
			console.warn('Could not store directory handle in IndexedDB:', err);
		}
	}

	private async getStoredDirectoryHandle(): Promise<any> {
		try {
			const db = await this.openDb();
			return await new Promise((resolve) => {
				const tx = db.transaction('handles', 'readonly');
				const req = tx.objectStore('handles').get('last_dir_handle');
				req.onsuccess = () => resolve(req.result || null);
				req.onerror = () => resolve(null);
			});
		} catch {
			return null;
		}
	}

	public async openRecentWorkspace(): Promise<void> {
		if (isTauriApp()) {
			const lastNative = localStorage.getItem('vector_last_native_path');
			if (lastNative) {
				await this.loadFromNativePath(lastNative);
				return;
			}
			await this.openDirectoryFromDisk();
			return;
		}

		if (!this.recentDirHandle && 'showDirectoryPicker' in window) {
			this.recentDirHandle = await this.getStoredDirectoryHandle();
			console.log('Retrieved stored directory handle from IndexedDB:', this.recentDirHandle);
		}

		if (this.recentDirHandle) {
			try {
				this.isScanning.set(true);
				this.scanProgress.set(`Opening ${this.recentDirHandle.name}...`);
				const perm = await this.recentDirHandle.requestPermission({ mode: 'readwrite' });
				console.log('Permission request result for recent handle:', perm);
				if (perm === 'granted') {
					await this.loadFromDirHandle(this.recentDirHandle);
					return;
				}
			} catch (err) {
				console.warn('Recent workspace permission request failed:', err);
			} finally {
				this.isScanning.set(false);
			}
		}
		// Fallback to picker if handle unavailable or permission denied
		console.log('Handle unavailable or permission denied, opening directory picker dialog');
		await this.openDirectoryFromDisk();
	}

	public async readGitBranch(dirHandle: any): Promise<void> {
		try {
			if (dirHandle && typeof dirHandle.getDirectoryHandle === 'function') {
				const gitDir = await dirHandle.getDirectoryHandle('.git');
				const headHandle = await gitDir.getFileHandle('HEAD');
				const headFile = await headHandle.getFile();
				const text = (await headFile.text()).trim();
				if (text.startsWith('ref: refs/heads/')) {
					this.gitBranch.set(text.substring('ref: refs/heads/'.length));
				} else if (text.length >= 7) {
					this.gitBranch.set(text.substring(0, 7));
				} else {
					this.gitBranch.set(text);
				}
				return;
			}
		} catch {
			// Not a git repository or cannot access .git
		}
		this.gitBranch.set(null);
	}

	/**
	 * Fast background crawler that indexes all project file paths across subdirectories
	 * without loading their contents into RAM, enabling instant Quick Open (Ctrl+P) and Grep.
	 */
	public async indexDirectoryInBackground(dirHandle: any): Promise<void> {
		this.isIndexing.set(true);
		this.indexedFileCount.set(0);

		const discoveredFiles: WorkspaceFile[] = [];
		const queue: { handle: any; path: string }[] = [{ handle: dirHandle, path: '' }];
		let dirsProcessed = 0;

		try {
			while (queue.length > 0) {
				const current = queue.shift()!;
				try {
					for await (const entry of current.handle.values()) {
						if (
							BACKGROUND_INDEX_IGNORED_DIRS.has(entry.name) ||
							(!this.showHiddenFiles() && entry.name.startsWith('.'))
						) {
							continue;
						}

						const relPath = current.path ? `${current.path}/${entry.name}` : entry.name;

						if (entry.kind === 'directory') {
							queue.push({ handle: entry, path: relPath });
						} else if (entry.kind === 'file') {
							if (this.isReadableTextFile(entry.name)) {
								const isBin = isBinaryFile(entry.name);
								discoveredFiles.push({
									id: relPath,
									name: entry.name,
									path: relPath,
									language: isBin ? 'binary' : detectLanguageFromFilename(entry.name),
									content: '',
									isLoaded: false,
									isBinary: isBin || undefined,
									handle: entry,
									isModified: false,
								});
							}
						}
					}
				} catch (dirErr) {
					console.warn('Skipping directory in indexer:', current.path, dirErr);
				}

				dirsProcessed++;
				if (dirsProcessed % 8 === 0) {
					this.indexedFileCount.set(discoveredFiles.length);
					await new Promise((resolve) => setTimeout(resolve, 0));
				}
			}

			// Preserve state for files that are already loaded, modified, or diffed
			const existingMap = new Map(
				this.files()
					.filter((f) => f.isLoaded || f.isModified || f.gitStatus)
					.map((f) => [f.path, f])
			);
			const mergedFiles = discoveredFiles.map((df) => {
				const existing = existingMap.get(df.path);
				if (existing) {
					return {
						...df,
						...existing,
					};
				}
				return df;
			});

			for (const existing of existingMap.values()) {
				if (!mergedFiles.some((f) => f.path === existing.path || f.id === existing.id)) {
					mergedFiles.push(existing);
				}
			}

			this.files.set(mergedFiles);
			this.indexedFileCount.set(mergedFiles.length);
			this.showNotification(`Indexed ${mergedFiles.length} files for instant search`);

			// Inspect Git index & objects for all discovered files
			await this.refreshGitStatus(dirHandle);
		} catch (err) {
			console.error('Background indexing error:', err);
		} finally {
			this.isIndexing.set(false);
		}
	}

	/**
	 * Opens single or multiple real files from local disk.
	 */
	public async openFilesFromDisk(): Promise<void> {
		if (typeof window === 'undefined') return;

		if ('showOpenFilePicker' in window) {
			try {
				const fileHandles: any[] = await (window as any).showOpenFilePicker({
					multiple: true,
				});

				const newNodes: FileTreeNode[] = [];

				for (const handle of fileHandles) {
					const fileObj = await handle.getFile();
					const language = detectLanguageFromFilename(fileObj.name);

					const file: WorkspaceFile = {
						id: handle.name + '_' + Date.now(),
						name: handle.name,
						path: handle.name,
						language,
						content: '',
						handle,
						isLoaded: false,
						isModified: false,
					};

					newNodes.push({
						id: file.id,
						name: file.name,
						path: file.path,
						kind: 'file',
						language,
						file,
						handle,
						level: 0,
					});
				}

				if (newNodes.length > 0) {
					this.isRealWorkspace.set(true);
					this.fileTree.update((prev) => [...newNodes, ...prev]);
					if (newNodes[0].file) {
						await this.openFile(newNodes[0].file);
					}
					this.showNotification(`Opened ${newNodes.length} file(s)`);
				}
			} catch (err: any) {
				if (err.name !== 'AbortError') {
					console.error('Failed to open files:', err);
				}
			}
		} else {
			this.fallbackInputFile();
		}
	}

	/**
	 * Saves a specific file back to disk and updates savedContent & isModified.
	 */
	public async saveFile(file: WorkspaceFile): Promise<boolean> {
		if (file.isBinary || file.isImage) {
			return true;
		}
		if (isTauriApp() && file.fsPath) {
			try {
				await invoke('write_file_text', {
					filePath: file.fsPath,
					content: file.content,
				});
				try {
					const meta = await invoke<{ mtime_ms: number; size: number }>('get_file_metadata', {
						filePath: file.fsPath,
					});
					file.lastDiskMtime = meta.mtime_ms;
					file.lastDiskSize = meta.size;
					file.fileSize = meta.size;
				} catch {}
				this.files.update((files) =>
					files.map((f) =>
						f.id === file.id
							? {
									...f,
									isModified: false,
									savedContent: file.content,
									lastDiskMtime: file.lastDiskMtime,
									lastDiskSize: file.lastDiskSize,
									fileSize: file.fileSize,
								}
							: f
					)
				);
				this.openTabs.update((tabs) =>
					tabs.map((t) =>
						t.id === file.id
							? {
									...t,
									isModified: false,
									savedContent: file.content,
									lastDiskMtime: file.lastDiskMtime,
									lastDiskSize: file.lastDiskSize,
									fileSize: file.fileSize,
								}
							: t
					)
				);
				this.triggerSaveSessionState();
				this.showNotification(`Saved ${file.name} to disk`);
				await this.refreshGitStatus();
				return true;
			} catch (err: any) {
				console.error('Failed to save file in Tauri:', err);
				this.showNotification(`Save failed: ${err.message || err}`);
				return false;
			}
		}

		if (file.handle && typeof file.handle.createWritable === 'function') {
			try {
				const writable = await file.handle.createWritable();
				await writable.write(file.content);
				await writable.close();

				if (typeof file.handle.getFile === 'function') {
					try {
						const fileObj = await file.handle.getFile();
						file.lastDiskMtime = fileObj.lastModified;
						file.lastDiskSize = fileObj.size;
						file.fileSize = fileObj.size;
					} catch {}
				}

				this.files.update((files) =>
					files.map((f) =>
						f.id === file.id
							? {
									...f,
									isModified: false,
									savedContent: file.content,
									lastDiskMtime: file.lastDiskMtime,
									lastDiskSize: file.lastDiskSize,
									fileSize: file.fileSize,
								}
							: f
					)
				);
				this.openTabs.update((tabs) =>
					tabs.map((t) =>
						t.id === file.id
							? {
									...t,
									isModified: false,
									savedContent: file.content,
									lastDiskMtime: file.lastDiskMtime,
									lastDiskSize: file.lastDiskSize,
									fileSize: file.fileSize,
								}
							: t
					)
				);
				this.triggerSaveSessionState();
				this.showNotification(`Saved ${file.name} to disk`);
				this.refreshGitStatus();
				return true;
			} catch (err: any) {
				console.error('Failed to save file:', err);
				this.showNotification(`Save failed: ${err.message}`);
				return false;
			}
		} else {
			this.files.update((files) =>
				files.map((f) => (f.id === file.id ? { ...f, isModified: false, savedContent: file.content } : f))
			);
			this.openTabs.update((tabs) =>
				tabs.map((t) => (t.id === file.id ? { ...t, isModified: false, savedContent: file.content } : t))
			);
			this.showNotification(`Updated ${file.name} (in-memory)`);
			return true;
		}
	}

	/**
	 * Saves the currently active file back to disk.
	 */
	public async saveCurrentFile(): Promise<boolean> {
		const active = this.activeFile();
		if (!active) return false;
		return this.saveFile(active);
	}

	public hasGitChanges(fileOrPath: WorkspaceFile | string): boolean {
		const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
		const id = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.id;
		const normPath = path?.replace(/^\.\//, '').replace(/^\//, '');
		const normId = id?.replace(/^\.\//, '').replace(/^\//, '');
		const file = this.files().find((f) => {
			const fNorm = f.path.replace(/^\.\//, '').replace(/^\//, '');
			return fNorm === normPath || f.id === normId || f.path === path;
		});
		const status = file ? file.gitStatus : (typeof fileOrPath === 'object' ? fileOrPath.gitStatus : undefined);
		return status === 'modified' || status === 'added' || status === 'untracked' || status === 'deleted';
	}

	public isFileModified(fileOrPath: WorkspaceFile | string): boolean {
		const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
		const id = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.id;
		const normPath = path?.replace(/^\.\//, '').replace(/^\//, '');
		const normId = id?.replace(/^\.\//, '').replace(/^\//, '');
		const file = this.files().find((f) => {
			const fNorm = f.path.replace(/^\.\//, '').replace(/^\//, '');
			return fNorm === normPath || f.id === normId || f.path === path;
		});
		if (file && file.isModified !== undefined) {
			return file.isModified;
		}
		return typeof fileOrPath === 'object' ? !!fileOrPath.isModified : false;
	}

	public showNotification(message: string): void {
		this.statusNotification.set(message);
		setTimeout(() => {
			if (this.statusNotification() === message) {
				this.statusNotification.set('');
			}
		}, 4000);
	}

	private triggerTreeUpdate(): void {
		this.fileTree.set([...this.fileTree()]);
	}

	private isReadableTextFile(filename: string): boolean {
		return true;
	}

	private stripRootPrefix(path: string): string {
		const slashIdx = path.indexOf('/');
		return slashIdx !== -1 ? path.substring(slashIdx + 1) : path;
	}

	private fallbackInputDirectory(): void {
		const input = document.createElement('input');
		input.type = 'file';
		input.setAttribute('webkitdirectory', '');
		input.setAttribute('directory', '');
		input.multiple = true;

		// Start loading animation instantly so the user never sees a freeze or dead pause
		this.isScanning.set(true);
		this.scanProgress.set('Select folder...');

		input.oncancel = () => {
			this.isScanning.set(false);
		};

		window.addEventListener(
			'focus',
			() => {
				setTimeout(() => {
					if (!input.files || input.files.length === 0) {
						this.isScanning.set(false);
					}
				}, 500);
			},
			{ once: true }
		);

		input.onchange = async () => {
			if (!input.files || input.files.length === 0) {
				this.isScanning.set(false);
				return;
			}

			this.isScanning.set(true);
			this.scanProgress.set(`Opening folder...`);
			await new Promise((r) => setTimeout(r, 0));

			try {
				const filesList: File[] = [];
				for (let i = 0; i < input.files.length; i++) {
					filesList.push(input.files[i]);
				}
				this.fallbackFilesList = filesList;

				const firstPath = filesList[0].webkitRelativePath || filesList[0].name;
				const slashIdx = firstPath.indexOf('/');
				this.fallbackRootName = slashIdx !== -1 ? firstPath.substring(0, slashIdx) : 'WORKSPACE';
				this.workspaceName.set(this.fallbackRootName);
				this.isRealWorkspace.set(true);
				if (typeof window !== 'undefined') {
					localStorage.setItem('vector_last_workspace_name', this.fallbackRootName);
					this.recentWorkspaceName.set(this.fallbackRootName);
				}

				// Build ONLY top-level nodes for root (instant!)
				const rootNodes: FileTreeNode[] = [];
				const rootDirs = new Set<string>();

				for (const file of filesList) {
					const rel = this.stripRootPrefix(file.webkitRelativePath || file.name);
					const parts = rel.split('/');

					if (parts.length === 1) {
						// Direct file in root
						if (this.isReadableTextFile(parts[0])) {
							const f: WorkspaceFile = {
								id: rel,
								name: parts[0],
								path: rel,
								language: detectLanguageFromFilename(parts[0]),
								content: '',
								isLoaded: false,
								rawFile: file,
								isModified: false,
							};
							rootNodes.push({
								id: rel,
								name: parts[0],
								path: rel,
								kind: 'file',
								language: f.language,
								file: f,
								level: 0,
							});
						}
					} else {
						// Immediate directory in root
						const dirName = parts[0];
						if (
							!rootDirs.has(dirName) &&
							(!dirName.startsWith('.') || this.showHiddenFiles())
						) {
							rootDirs.add(dirName);
							rootNodes.push({
								id: dirName,
								name: dirName,
								path: dirName,
								kind: 'directory',
								expanded: false,
								isLoaded: false,
								isLoading: false,
								children: [],
								level: 0,
							});
						}
					}
				}

				rootNodes.sort((a, b) => {
					if (a.kind !== b.kind) {
						return a.kind === 'directory' ? -1 : 1;
					}
					return a.name.localeCompare(b.name);
				});

				this.fileTree.set(rootNodes);

				// Index all non-ignored project files for instant search and grep
				const allWorkspaceFiles: WorkspaceFile[] = [];
				for (const file of filesList) {
					const rel = this.stripRootPrefix(file.webkitRelativePath || file.name);
					const parts = rel.split('/');
					const isIgnored =
						!this.showHiddenFiles() &&
						parts.some((part, idx) => idx < parts.length - 1 && part.startsWith('.'));
					if (!isIgnored && this.isReadableTextFile(parts[parts.length - 1])) {
						allWorkspaceFiles.push({
							id: rel,
							name: parts[parts.length - 1],
							path: rel,
							language: detectLanguageFromFilename(parts[parts.length - 1]),
							content: '',
							isLoaded: false,
							rawFile: file,
							isModified: false,
						});
					}
				}
				this.files.set(allWorkspaceFiles);
				this.indexedFileCount.set(allWorkspaceFiles.length);

				// Check for git branch in fallback files list
				const gitHead = filesList.find(
					(f) => f.webkitRelativePath?.endsWith('.git/HEAD') || f.name === 'HEAD'
				);
				if (gitHead) {
					try {
						const headText = (await gitHead.text()).trim();
						if (headText.startsWith('ref: refs/heads/')) {
							this.gitBranch.set(headText.substring('ref: refs/heads/'.length));
						} else if (headText.length >= 7) {
							this.gitBranch.set(headText.substring(0, 7));
						}
					} catch {
						this.gitBranch.set(null);
					}
				} else {
					this.gitBranch.set(null);
				}

				this.showNotification(`Opened ${this.fallbackRootName} (${allWorkspaceFiles.length} files indexed)`);
			} finally {
				this.isScanning.set(false);
			}
		};

		input.click();
	}

	private fallbackInputFile(): void {
		const input = document.createElement('input');
		input.type = 'file';
		input.multiple = true;

		input.onchange = async () => {
			if (!input.files || input.files.length === 0) return;
			const newNodes: FileTreeNode[] = [];

			for (let i = 0; i < input.files.length; i++) {
				const file = input.files[i];
				const f: WorkspaceFile = {
					id: file.name + '_' + Date.now(),
					name: file.name,
					path: file.name,
					language: detectLanguageFromFilename(file.name),
					content: '',
					isLoaded: false,
					rawFile: file,
					isModified: false,
				};
				newNodes.push({
					id: f.id,
					name: f.name,
					path: f.path,
					kind: 'file',
					language: f.language,
					file: f,
					level: 0,
				});
			}

			if (newNodes.length > 0) {
				this.isRealWorkspace.set(true);
				this.fileTree.update((prev) => [...newNodes, ...prev]);
				if (newNodes[0].file) {
					await this.openFile(newNodes[0].file);
				}
			}
		};

		input.click();
	}
}
