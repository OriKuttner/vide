/**
 * navigation-history.service.ts - Manages cursor navigation history stack and session persistence
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { WorkspaceService } from './workspace.service';
import { WorkspaceFile } from '../models/file.model';

export interface NavigationEntry {
	filePath: string;
	fileName: string;
	lineNumber: number;
	column: number;
	linePreview?: string;
	timestamp: number;
	isManual?: boolean;
	source?: 'jump' | 'edit' | 'explorer' | 'manual';
}

export interface NavigationRecentItem {
	entry: NavigationEntry;
	originalIndex: number;
	isCurrent: boolean;
}

@Injectable({
	providedIn: 'root',
})
export class NavigationHistoryService {
	private readonly workspaceService = inject(WorkspaceService);

	// Back stack (locations navigated away from)
	public readonly history = signal<NavigationEntry[]>([]);

	// Forward stack (locations for forward navigation after going back)
	public readonly forwardStack = signal<NavigationEntry[]>([]);

	// Pointer / index compatibility (points to top of history, or -1 if empty)
	public readonly currentIndex = signal<number>(-1);

	// Controls dropdown visibility in tabs bar
	public readonly isDropdownOpen = signal<boolean>(false);

	// Guard flag to prevent re-recording during navigation transitions
	private isNavigating = false;

	// Tracking for active file context to avoid explorer glance pollution
	private activeFilePath = '';
	private activeFileLine = 1;
	private activeFileCol = 1;
	private activeHasInteracted = false;

	// Can navigate back
	public readonly canNavigateBack = computed(() => this.history().length > 0);

	// Can navigate forward
	public readonly canNavigateForward = computed(() => this.forwardStack().length > 0);

	// Recent up to 30 locations (newest on top)
	public readonly recent30Entries = computed<NavigationRecentItem[]>(() => {
		const list = this.history();
		if (list.length === 0) return [];

		const total = list.length;
		const start = Math.max(0, total - 30);
		const slice = list.slice(start);

		// Return with original indices reversed (newest first)
		return slice
			.map((entry, offset) => {
				const originalIndex = start + offset;
				return {
					entry,
					originalIndex,
					isCurrent: false,
				};
			})
			.reverse();
	});

	constructor() {
		// Hook into WorkspaceService jumpToLine: records ONLY the origin position before jump
		this.workspaceService.onBeforeJumpToLine = (_targetFile, _targetLine, _targetCol) => {
			if (this.isNavigating) return;

			this.recordCurrentLocationBeforeJump('jump');
			this.isNavigating = true;
			setTimeout(() => {
				this.isNavigating = false;
				this.updateActiveTrackingAfterJump(_targetFile, _targetLine, _targetCol);
			}, 300);
		};

		// Hook into WorkspaceService openFile (explorer clicks and tab switches)
		this.workspaceService.onFileOpened = (file) => {
			if (this.isNavigating || !file.isLoaded) return;
			this.onFileSwitched(file);
		};

		// Check if session was already restored before this service constructor ran
		const existingState = this.workspaceService.navigationSessionState();
		if (
			existingState &&
			Array.isArray(existingState.history) &&
			existingState.history.length > 0
		) {
			this.loadFromState(existingState.history, existingState.index);
		}

		// Hook into WorkspaceService session restore
		this.workspaceService.onSessionRestored = (entries, index) => {
			this.loadFromState(entries, index);
		};

		// Hook into WorkspaceService folder change / close
		this.workspaceService.onWorkspaceReset = () => {
			this.clearHistory();
		};
	}

	/**
	 * Records current editor position before making a jump away
	 */
	public recordCurrentLocation(source: 'jump' | 'edit' | 'explorer' | 'manual' = 'jump'): void {
		if (this.isNavigating || this.workspaceService.isRestoringSession()) return;
		this.recordCurrentLocationBeforeJump(source);
	}

	/**
	 * Manually records the current position or specified file/line as a bookmark in navigation stack
	 */
	public addManualLocation(
		targetFile?: WorkspaceFile | { path: string; name?: string; content?: string } | null,
		targetLine?: number,
		targetCol = 1,
	): void {
		const file = targetFile || this.workspaceService.activeFile();
		if (!file) return;
		const filePath = file.path || (file as any).id || '';
		if (!filePath) return;

		const cursor = 'cursor' in file ? (file as WorkspaceFile).cursor : undefined;
		const line = targetLine !== undefined ? targetLine : cursor?.line || this.activeFileLine || 1;
		const col = targetCol !== undefined ? targetCol : cursor?.column || this.activeFileCol || 1;
		const fileName = file.name || filePath.split('/').pop() || filePath;

		let preview: string | undefined;
		if (file.content) {
			const lines = file.content.split('\n');
			if (lines[line - 1]) {
				preview = lines[line - 1].trim().slice(0, 100);
			}
		}

		const manualEntry: NavigationEntry = {
			filePath,
			fileName,
			lineNumber: line,
			column: col,
			linePreview: preview,
			timestamp: Date.now(),
			isManual: true,
			source: 'manual',
		};

		this.pushToHistory(manualEntry);
		this.activeHasInteracted = true;
		this.workspaceService.showNotification(`📍 Added ${fileName}:${line} to navigation stack`);
	}

	/**
	 * Records a location directly into the history stack
	 */
	public recordLocation(
		file: WorkspaceFile | { path: string; name?: string; content?: string },
		line: number,
		col = 1,
		explicitPreview?: string,
		isManual = false,
		source: 'jump' | 'edit' | 'explorer' | 'manual' = 'jump',
	): void {
		if (this.isNavigating || this.workspaceService.isRestoringSession()) return;
		const filePath = file.path || (file as any).id || '';
		if (!filePath) return;

		const fileName = file.name || filePath.split('/').pop() || filePath;
		let preview = explicitPreview;
		if (!preview && file.content) {
			const lines = file.content.split('\n');
			if (lines[line - 1]) {
				preview = lines[line - 1].trim().slice(0, 100);
			}
		}

		const newEntry: NavigationEntry = {
			filePath,
			fileName,
			lineNumber: line,
			column: col,
			linePreview: preview,
			timestamp: Date.now(),
			isManual: isManual || undefined,
			source,
		};

		this.pushToHistory(newEntry);
	}

	/**
	 * Tracks cursor position within the active editor
	 */
	public recordCursorMovement(file: WorkspaceFile, line: number, col: number): void {
		if (this.isNavigating || this.workspaceService.isRestoringSession()) return;
		const filePath = file.path || file.id || '';
		if (!filePath) return;

		if (this.activeFilePath === filePath) {
			if (line !== 1 || col !== 1 || this.activeFileLine !== line) {
				this.activeHasInteracted = true;
			}
			this.activeFileLine = line;
			this.activeFileCol = col;
		} else {
			this.activeFilePath = filePath;
			this.activeFileLine = line;
			this.activeFileCol = col;
			this.activeHasInteracted = true;
		}
	}

	/**
	 * Records that content was edited in the active file
	 */
	public recordEditLocation(file: WorkspaceFile, line: number, col: number): void {
		if (this.isNavigating || this.workspaceService.isRestoringSession()) return;
		const filePath = file.path || file.id || '';
		if (!filePath) return;

		this.activeFilePath = filePath;
		this.activeFileLine = line;
		this.activeFileCol = col;
		this.activeHasInteracted = true;
	}

	/**
	 * Navigates back in history (Alt+Left)
	 */
	public async navigateBack(): Promise<void> {
		if (!this.canNavigateBack()) return;

		// 1. Capture current location before leaving it
		const currentEntry = this.captureCurrentLocation('jump');

		// 2. Pop top entry from history
		const historyList = this.history();
		const target = historyList[historyList.length - 1];
		this.history.set(historyList.slice(0, -1));
		this.currentIndex.set(this.history().length - 1);

		// 3. Push current location to forwardStack
		if (currentEntry) {
			this.forwardStack.update((fwd) => [...fwd, currentEntry]);
		}

		// 4. Jump to target
		if (target) {
			await this.performJump(target);
		}
	}

	/**
	 * Navigates forward in history (Alt+Right)
	 */
	public async navigateForward(): Promise<void> {
		if (!this.canNavigateForward()) return;

		// 1. Capture current location before leaving it
		const currentEntry = this.captureCurrentLocation('jump');

		// 2. Pop top entry from forwardStack
		const fwdList = this.forwardStack();
		const target = fwdList[fwdList.length - 1];
		this.forwardStack.set(fwdList.slice(0, -1));

		// 3. Push current location to history
		if (currentEntry) {
			this.pushToHistory(currentEntry);
		}

		// 4. Jump to target
		if (target) {
			await this.performJump(target);
		}
	}

	/**
	 * Jumps directly to a given navigation entry from the dropdown
	 */
	public async jumpToEntry(entry: NavigationEntry, originalIndex?: number): Promise<void> {
		const currentEntry = this.captureCurrentLocation('jump');
		const historyList = this.history();

		if (
			typeof originalIndex === 'number' &&
			originalIndex >= 0 &&
			originalIndex < historyList.length
		) {
			const poppedAfter = historyList.slice(originalIndex + 1);

			// Truncate history to originalIndex (excluding target entry itself since user is jumping to it)
			this.history.set(historyList.slice(0, originalIndex));
			this.currentIndex.set(this.history().length - 1);

			// Forward stack gets current location and popped intermediate entries in forward order
			const toForward: NavigationEntry[] = [];
			if (currentEntry) {
				toForward.push(currentEntry);
			}
			for (let i = poppedAfter.length - 1; i >= 0; i--) {
				toForward.push(poppedAfter[i]);
			}
			this.forwardStack.update((fwd) => [...fwd, ...toForward]);
		}

		await this.performJump(entry);
	}

	/**
	 * Removes a specific entry from the history stack by its original index
	 */
	public removeEntryByIndex(index: number): void {
		const list = this.history();
		if (index < 0 || index >= list.length) return;

		this.history.update((h) => h.filter((_, i) => i !== index));
		this.currentIndex.set(this.history().length - 1);
		this.syncToWorkspaceSession();
	}

	/**
	 * Clears the entire navigation history stack
	 */
	public clearHistory(): void {
		this.history.set([]);
		this.forwardStack.set([]);
		this.currentIndex.set(-1);
		this.syncToWorkspaceSession();
	}

	/**
	 * Toggles the dropdown menu
	 */
	public toggleDropdown(): void {
		this.isDropdownOpen.update((v) => !v);
	}

	/**
	 * Opens the dropdown menu
	 */
	public openDropdown(): void {
		this.isDropdownOpen.set(true);
	}

	/**
	 * Closes the dropdown menu
	 */
	public closeDropdown(): void {
		this.isDropdownOpen.set(false);
	}

	/**
	 * Loads restored history from workspace.json
	 */
	public loadFromState(entries: NavigationEntry[], _index?: number): void {
		if (!Array.isArray(entries)) return;
		this.history.set(entries);
		this.forwardStack.set([]);
		const validIndex = entries.length - 1;
		this.currentIndex.set(validIndex);
		this.workspaceService.navigationSessionState.set({
			history: entries,
			index: validIndex,
		});
	}

	/**
	 * Records current location before a jump and clears forward stack
	 */
	private recordCurrentLocationBeforeJump(
		source: 'jump' | 'edit' | 'explorer' | 'manual' = 'jump',
	): void {
		const current = this.captureCurrentLocation(source);
		if (!current) return;

		this.pushToHistory(current);
		this.forwardStack.set([]);
	}

	/**
	 * Captures current active file and cursor position
	 */
	private captureCurrentLocation(
		source: 'jump' | 'edit' | 'explorer' | 'manual' = 'jump',
	): NavigationEntry | null {
		const file = this.workspaceService.activeFile();
		if (!file) return null;
		const filePath = file.path || (file as any).id || '';
		if (!filePath) return null;

		const fileName = file.name || filePath.split('/').pop() || filePath;
		const line = file.cursor?.line || this.activeFileLine || 1;
		const col = file.cursor?.column || this.activeFileCol || 1;

		let preview: string | undefined;
		if (file.content) {
			const lines = file.content.split('\n');
			if (lines[line - 1]) {
				preview = lines[line - 1].trim().slice(0, 100);
			}
		}

		return {
			filePath,
			fileName,
			lineNumber: line,
			column: col,
			linePreview: preview,
			timestamp: Date.now(),
			source,
		};
	}

	/**
	 * Pushes an entry to history with duplicate suppression
	 */
	private pushToHistory(entry: NavigationEntry): void {
		const list = this.history();
		if (list.length > 0) {
			const last = list[list.length - 1];
			if (
				last.filePath === entry.filePath &&
				Math.abs(last.lineNumber - entry.lineNumber) <= 1
			) {
				return;
			}
		}

		this.history.update((h) => [...h, entry]);
		this.currentIndex.set(this.history().length - 1);
		this.syncToWorkspaceSession();
	}

	/**
	 * Handles file switching from explorer or tabs
	 */
	private onFileSwitched(file: WorkspaceFile): void {
		const newPath = file.path || file.id || '';
		if (!newPath) return;

		if (this.activeFilePath === newPath) return;

		// If user interacted with the previous file, push it to history before switching
		if (this.activeFilePath && this.activeHasInteracted) {
			const prevFile = this.workspaceService
				.files()
				.find((f) => f.path === this.activeFilePath || f.id === this.activeFilePath);
			const fileName =
				prevFile?.name || this.activeFilePath.split('/').pop() || this.activeFilePath;
			let preview: string | undefined;
			if (prevFile?.content) {
				const lines = prevFile.content.split('\n');
				if (lines[this.activeFileLine - 1]) {
					preview = lines[this.activeFileLine - 1].trim().slice(0, 100);
				}
			}

			const prevEntry: NavigationEntry = {
				filePath: this.activeFilePath,
				fileName,
				lineNumber: this.activeFileLine,
				column: this.activeFileCol,
				linePreview: preview,
				timestamp: Date.now(),
				source: 'explorer',
			};

			this.pushToHistory(prevEntry);
			this.forwardStack.set([]);
		}

		this.activeFilePath = newPath;
		this.activeFileLine = file.cursor?.line || 1;
		this.activeFileCol = file.cursor?.column || 1;
		this.activeHasInteracted = false;
	}

	/**
	 * Updates active tracking after a jump finishes
	 */
	private updateActiveTrackingAfterJump(
		targetFile: WorkspaceFile,
		targetLine: number,
		targetCol: number,
	): void {
		this.activeFilePath = targetFile.path || targetFile.id || '';
		this.activeFileLine = targetLine;
		this.activeFileCol = targetCol;
		this.activeHasInteracted = true;
	}

	/**
	 * Performs actual file opening and line jumping
	 */
	private async performJump(target: NavigationEntry): Promise<void> {
		this.isNavigating = true;
		try {
			const file = await this.workspaceService.openFileByPath(target.filePath);
			if (file) {
				await this.workspaceService.jumpToLine(file, target.lineNumber, target.column || 1);
			}
			this.activeFilePath = target.filePath;
			this.activeFileLine = target.lineNumber;
			this.activeFileCol = target.column || 1;
			this.activeHasInteracted = true;
			this.closeDropdown();
			this.currentIndex.set(this.history().length - 1);
			this.syncToWorkspaceSession();
		} finally {
			setTimeout(() => {
				this.isNavigating = false;
			}, 300);
		}
	}

	/**
	 * Synchronizes current state to WorkspaceService for workspace.json persistence
	 */
	private syncToWorkspaceSession(): void {
		if (this.workspaceService.isRestoringSession()) return;
		this.workspaceService.navigationSessionState.set({
			history: this.history(),
			index: this.currentIndex(),
		});
		this.workspaceService.triggerSaveSessionState();
	}
}
