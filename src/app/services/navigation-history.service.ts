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

	// Unbounded / infinite navigation history stack
	public readonly history = signal<NavigationEntry[]>([]);

	// Pointer to current active entry in history
	public readonly currentIndex = signal<number>(-1);

	// Controls dropdown visibility in tabs bar
	public readonly isDropdownOpen = signal<boolean>(false);

	// Guard flag to prevent re-recording during navigation jumps
	private isNavigating = false;

	// Track last recorded line to detect duplicate entries
	private lastRecordedLine = -1;
	private lastRecordedFile = '';

	// Can navigate back
	public readonly canNavigateBack = computed(() => this.currentIndex() > 0);

	// Can navigate forward
	public readonly canNavigateForward = computed(() => {
		const idx = this.currentIndex();
		return idx >= 0 && idx < this.history().length - 1;
	});

	// Recent up to 30 locations (newest on top)
	public readonly recent30Entries = computed<NavigationRecentItem[]>(() => {
		const list = this.history();
		const currentIdx = this.currentIndex();
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
					isCurrent: originalIndex === currentIdx,
				};
			})
			.reverse();
	});

	constructor() {
		// Hook into WorkspaceService jumpToLine so all jumps are tracked
		this.workspaceService.onBeforeJumpToLine = (targetFile, targetLine, targetCol) => {
			this.recordCurrentLocation();
			setTimeout(() => {
				this.recordLocation(targetFile, targetLine, targetCol);
			}, 50);
		};

		// Hook into WorkspaceService openFile (tab switches and explorer clicks)
		this.workspaceService.onFileOpened = (file) => {
			if (this.isNavigating || !file.isLoaded) return;
			const line = file.cursor?.line || 1;
			const col = file.cursor?.column || 1;
			this.recordLocation(file, line, col);
		};

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
	 * Records the current editor position before making a jump
	 */
	public recordCurrentLocation(): void {
		if (this.isNavigating || this.workspaceService.isRestoringSession()) return;
		const file = this.workspaceService.activeFile();
		if (!file) return;

		const line = file.cursor?.line || 1;
		const col = file.cursor?.column || 1;
		this.recordLocation(file, line, col);
	}

	/**
	 * Manually records the current position or specified file/line as a bookmark in navigation stack
	 */
	public addManualLocation(
		targetFile?: WorkspaceFile | { path: string; name?: string; content?: string } | null,
		targetLine?: number,
		targetCol = 1
	): void {
		const file = targetFile || this.workspaceService.activeFile();
		if (!file) return;
		const cursor = 'cursor' in file ? (file as WorkspaceFile).cursor : undefined;
		const line = targetLine !== undefined ? targetLine : (cursor?.line || 1);
		const col = targetCol !== undefined ? targetCol : (cursor?.column || 1);
		this.recordLocation(file, line, col, undefined, true);
		const fileName = file.name || (file as any).path?.split('/').pop() || 'file';
		this.workspaceService.showNotification(`📍 Added ${fileName}:${line} to navigation stack`);
	}

	/**
	 * Records a location in the navigation stack
	 */
	public recordLocation(
		file: WorkspaceFile | { path: string; name?: string; content?: string },
		line: number,
		col = 1,
		explicitPreview?: string,
		isManual = false
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
		};

		const currentList = this.history();
		const currIdx = this.currentIndex();
		const currentEntry = currIdx >= 0 ? currentList[currIdx] : null;

		// Check if this is the exact same or adjacent location in same file
		if (
			currentEntry &&
			currentEntry.filePath === filePath &&
			(isManual ? currentEntry.lineNumber === line : Math.abs(currentEntry.lineNumber - line) <= 1)
		) {
			// Update line preview and column without creating a duplicate
			this.history.update((h) => {
				const copy = [...h];
				copy[currIdx] = {
					...copy[currIdx],
					lineNumber: line,
					column: col,
					linePreview: preview || copy[currIdx].linePreview,
					timestamp: Date.now(),
					isManual: isManual ? true : copy[currIdx].isManual,
				};
				return copy;
			});
			this.lastRecordedLine = line;
			this.lastRecordedFile = filePath;
			this.syncToWorkspaceSession();
			return;
		}

		// If we were in the middle of history and made a new move, truncate forward history
		let baseList = currentList;
		if (currIdx >= 0 && currIdx < currentList.length - 1) {
			baseList = currentList.slice(0, currIdx + 1);
		}

		this.history.set([...baseList, newEntry]);
		this.currentIndex.set(baseList.length);
		this.lastRecordedLine = line;
		this.lastRecordedFile = filePath;
		this.syncToWorkspaceSession();
	}

	/**
	 * Navigates back in history (Alt+Left)
	 */
	public async navigateBack(): Promise<void> {
		if (!this.canNavigateBack()) return;

		// Update active position before jumping
		this.updateCurrentLocationBeforeJump();

		const targetIndex = this.currentIndex() - 1;
		this.currentIndex.set(targetIndex);
		const target = this.history()[targetIndex];
		if (target) {
			await this.jumpToEntry(target, targetIndex);
		}
	}

	/**
	 * Navigates forward in history (Alt+Right)
	 */
	public async navigateForward(): Promise<void> {
		if (!this.canNavigateForward()) return;

		const targetIndex = this.currentIndex() + 1;
		this.currentIndex.set(targetIndex);
		const target = this.history()[targetIndex];
		if (target) {
			await this.jumpToEntry(target, targetIndex);
		}
	}

	/**
	 * Jumps directly to a given navigation entry
	 */
	public async jumpToEntry(entry: NavigationEntry, targetIndex?: number): Promise<void> {
		this.isNavigating = true;
		try {
			if (typeof targetIndex === 'number' && targetIndex >= 0) {
				this.currentIndex.set(targetIndex);
			}

			const file = await this.workspaceService.openFileByPath(entry.filePath);
			if (file) {
				await this.workspaceService.jumpToLine(file, entry.lineNumber, entry.column || 1);
			}

			this.closeDropdown();
			this.syncToWorkspaceSession();
		} finally {
			setTimeout(() => {
				this.isNavigating = false;
			}, 300);
		}
	}

	/**
	 * Clears the entire navigation history stack
	 */
	public clearHistory(): void {
		this.history.set([]);
		this.currentIndex.set(-1);
		this.lastRecordedLine = -1;
		this.lastRecordedFile = '';
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
	 * Updates current location before jumping away
	 */
	private updateCurrentLocationBeforeJump(): void {
		const file = this.workspaceService.activeFile();
		const currIdx = this.currentIndex();
		if (file && currIdx >= 0 && this.history()[currIdx]) {
			const line = file.cursor?.line || 1;
			const col = file.cursor?.column || 1;
			this.history.update((h) => {
				const copy = [...h];
				copy[currIdx] = {
					...copy[currIdx],
					lineNumber: line,
					column: col,
					timestamp: Date.now(),
				};
				return copy;
			});
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

	/**
	 * Loads restored history from workspace.json
	 */
	public loadFromState(entries: NavigationEntry[], index?: number): void {
		if (!Array.isArray(entries)) return;
		this.history.set(entries);
		const validIndex =
			typeof index === 'number' && index >= 0 && index < entries.length
				? index
				: entries.length - 1;
		this.currentIndex.set(validIndex);
		if (validIndex >= 0 && entries[validIndex]) {
			this.lastRecordedLine = entries[validIndex].lineNumber;
			this.lastRecordedFile = entries[validIndex].filePath;
		}
	}
}
