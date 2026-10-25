/**
 * app.ts - Root component orchestrating IDE layout, shortcuts, and dialogs
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import { Component, HostListener, inject, signal, effect, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { TabsComponent } from './components/tabs/tabs.component';
import { EditorComponent } from './components/editor/editor.component';
import { StatusBarComponent } from './components/status-bar/status-bar.component';
import { SearchModalComponent } from './components/search-modal/search-modal.component';
import { AgentChatComponent } from './components/agent-chat/agent-chat.component';
import { TerminalComponent } from './components/terminal/terminal.component';
import { isTauriApp, WorkspaceService } from './services/workspace.service';
import { ZoomService } from './services/zoom.service';
import { NavigationHistoryService } from './services/navigation-history.service';
import { TerminalService } from './services/terminal.service';

@Component({
	selector: 'app-root',
	standalone: true,
	imports: [
		CommonModule,
		SidebarComponent,
		TabsComponent,
		EditorComponent,
		StatusBarComponent,
		SearchModalComponent,
		AgentChatComponent,
		TerminalComponent,
	],
	templateUrl: './app.html',
	styleUrl: './app.scss',
})
export class App {
	@ViewChild(EditorComponent) editorComponent?: EditorComponent;

	public workspaceService = inject(WorkspaceService);
	public zoomService = inject(ZoomService);
	public navigationHistoryService = inject(NavigationHistoryService);
	public terminalService = inject(TerminalService);
	private titleService = inject(Title);
	readonly title = signal('Vector IDE');
	readonly cursor = signal<{ line: number; column: number }>({ line: 1, column: 1 });

	// Global Context Menu state
	public readonly contextMenuVisible = signal<boolean>(false);
	public readonly contextMenuPosition = signal<{ x: number; y: number }>({ x: 0, y: 0 });
	private contextTarget: EventTarget | null = null;

	private initialZoomReported = false;

	constructor() {
		effect(() => {
			const pct = this.zoomService.zoomPercentage();
			const fs = this.zoomService.editorFontSize();
			if (this.initialZoomReported) {
				this.workspaceService.showNotification(`🔍 Zoom: ${pct}% (Font: ${fs}px)`);
			} else {
				this.initialZoomReported = true;
			}
		});

		// Update window title dynamically: [directory name] - [file name]
		effect(() => {
			const isReal = this.workspaceService.isRealWorkspace();
			const wsName = this.workspaceService.workspaceName();
			const active = this.workspaceService.activeFile();

			let windowTitle = 'Vector IDE';
			if (isReal && wsName && wsName !== 'NO FOLDER OPENED') {
				if (active && active.name) {
					windowTitle = `${wsName} - ${active.name}`;
				} else {
					windowTitle = `${wsName} - Vector IDE`;
				}
			} else if (active && active.name) {
				windowTitle = `${active.name} - Vector IDE`;
			}

			this.title.set(windowTitle);
			this.titleService.setTitle(windowTitle);

			if (isTauriApp()) {
				import('@tauri-apps/api/core')
					.then(({ invoke }) => {
						invoke('set_window_title', { title: windowTitle }).catch((err) => {
							console.warn('Failed to set Tauri window title via invoke:', err);
						});
					})
					.catch(() => {});

				import('@tauri-apps/api/window')
					.then(({ getCurrentWindow }) => {
						getCurrentWindow()
							.setTitle(windowTitle)
							.catch((err) => {
								console.warn(
									'Failed to set Tauri window title via window API:',
									err,
								);
							});
					})
					.catch(() => {});
			}
		});

		if (isTauriApp()) {
			import('@tauri-apps/api/event')
				.then(({ listen }) => {
					listen('window-close-requested', () => {
						this.workspaceService.promptCloseEditor();
					});
				})
				.catch((err) => {
					console.warn('Failed to listen to window-close-requested:', err);
				});
		}
	}

	onCursorChange(pos: { line: number; column: number }): void {
		this.cursor.set(pos);
	}

	@HostListener('window:beforeunload', ['$event'])
	onBeforeUnload(event: BeforeUnloadEvent): void {
		if (this.workspaceService.hasModifiedFiles()) {
			event.preventDefault();
			event.returnValue = '';
		}
	}

	@HostListener('window:keydown', ['$event'])
	onKeyDown(event: KeyboardEvent): void {
		const isCtrlOrCmd = event.ctrlKey || event.metaKey;
		const isShift = event.shiftKey;
		const code = event.code;
		const key = event.key ? event.key.toLowerCase() : '';

		if (isCtrlOrCmd && !isShift && (key === 'q' || code === 'KeyQ')) {
			event.preventDefault();
			this.workspaceService.promptCloseEditor();
			return;
		}

		// Diff navigation shortcuts: F7 / Shift+F7 (JetBrains standard) or Alt+F5 / Shift+Alt+F5 (VS Code standard)
		if (this.workspaceService.diffModeActive()) {
			if (event.key === 'F7' || code === 'F7') {
				event.preventDefault();
				if (isShift) {
					this.editorComponent?.prevDiff();
				} else {
					this.editorComponent?.nextDiff();
				}
				return;
			}
			if (event.altKey && (event.key === 'F5' || code === 'F5')) {
				event.preventDefault();
				if (isShift) {
					this.editorComponent?.prevDiff();
				} else {
					this.editorComponent?.nextDiff();
				}
				return;
			}
		}

		const activeEl = document.activeElement;
		const isInputFocused =
			activeEl &&
			(activeEl.tagName === 'INPUT' ||
				activeEl.tagName === 'TEXTAREA' ||
				(activeEl as HTMLElement).isContentEditable);

		if (!isInputFocused && (event.altKey || isCtrlOrCmd) && !isShift) {
			if (code === 'ArrowLeft' || event.key === 'ArrowLeft') {
				event.preventDefault();
				this.navigationHistoryService.navigateBack();
				return;
			}
			if (code === 'ArrowRight' || event.key === 'ArrowRight') {
				event.preventDefault();
				this.navigationHistoryService.navigateForward();
				return;
			}
		}

		if (isCtrlOrCmd && (key === 'p' || code === 'KeyP')) {
			event.preventDefault();
			this.workspaceService.openModal('file-search');
		} else if (isCtrlOrCmd && !isShift && (key === 'f' || code === 'KeyF')) {
			event.preventDefault();
			this.editorComponent?.triggerFind();
		} else if (isCtrlOrCmd && !isShift && (key === 'g' || code === 'KeyG')) {
			event.preventDefault();
			this.editorComponent?.triggerGotoLine();
		} else if (isCtrlOrCmd && isShift && (key === 'f' || code === 'KeyF')) {
			event.preventDefault();
			this.workspaceService.setSidebarView('search');
		} else if (isCtrlOrCmd && !isShift && (key === 'o' || code === 'KeyO')) {
			event.preventDefault();
			this.workspaceService.openDirectoryFromDisk();
		} else if (isCtrlOrCmd && !isShift && (key === 'n' || code === 'KeyN')) {
			event.preventDefault();
			this.workspaceService.openModal('new-file');
		} else if (isCtrlOrCmd && !isShift && (key === 's' || code === 'KeyS')) {
			event.preventDefault();
			this.workspaceService.saveCurrentFile();
		} else if (isCtrlOrCmd && !isShift && (key === 'b' || code === 'KeyB')) {
			event.preventDefault();
			this.workspaceService.toggleSidebar();
		} else if (isCtrlOrCmd && !isShift && (key === 'h' || code === 'KeyH')) {
			event.preventDefault();
			this.workspaceService.toggleHiddenFiles();
		} else if (isCtrlOrCmd && (event.key === '`' || event.key === '~' || code === 'Backquote')) {
			event.preventDefault();
			this.terminalService.toggleTerminal();
		} else if (event.key === 'F5' || (isCtrlOrCmd && (key === 'r' || code === 'KeyR'))) {
			event.preventDefault();
			this.workspaceService.refreshAll();
		} else if (
			isCtrlOrCmd &&
			(event.key === '+' || event.key === '=' || code === 'Equal' || code === 'NumpadAdd')
		) {
			event.preventDefault();
			this.zoomService.zoomIn();
		} else if (
			isCtrlOrCmd &&
			(event.key === '-' ||
				event.key === '_' ||
				code === 'Minus' ||
				code === 'NumpadSubtract')
		) {
			event.preventDefault();
			this.zoomService.zoomOut();
		} else if (isCtrlOrCmd && (event.key === '0' || code === 'Digit0' || code === 'Numpad0')) {
			event.preventDefault();
			this.zoomService.resetZoom();
		}
	}

	@HostListener('window:contextmenu', ['$event'])
	onGlobalContextMenu(event: MouseEvent): void {
		const target = event.target as HTMLElement | null;
		// If specialized context menu elements, Monaco Editor, or Terminal are clicked, allow them to handle it
		if (
			target?.closest('.monaco-editor') ||
			target?.closest('.monaco-menu-container') ||
			target?.closest('.tree-container') ||
			target?.closest('.clickable-title') ||
			target?.closest('.tree-context-menu') ||
			target?.closest('.global-context-menu') ||
			target?.closest('.terminal-dock') ||
			target?.closest('.tab-context-menu') ||
			target?.closest('.tab') ||
			event.defaultPrevented
		) {
			if (this.contextMenuVisible()) {
				this.closeContextMenu();
			}
			return;
		}

		// Prevent browser's native WebKit context menu
		event.preventDefault();

		this.contextTarget = event.target;
		const menuWidth = 195;
		const menuHeight = 160;
		const x = Math.min(event.clientX, window.innerWidth - menuWidth);
		const y = Math.min(event.clientY, window.innerHeight - menuHeight);
		this.contextMenuPosition.set({ x: Math.max(0, x), y: Math.max(0, y) });
		this.contextMenuVisible.set(true);
	}

	@HostListener('document:click')
	onDocumentClick(): void {
		if (this.contextMenuVisible()) {
			this.closeContextMenu();
		}
	}

	@HostListener('document:keydown.escape')
	onEscape(): void {
		if (this.contextMenuVisible()) {
			this.closeContextMenu();
		}
	}

	@HostListener('window:wheel', ['$event'])
	onWindowWheel(event: WheelEvent): void {
		if (this.contextMenuVisible()) {
			const target = event.target as HTMLElement | null;
			if (!target?.closest('.global-context-menu')) {
				this.closeContextMenu();
			}
		}
	}

	public closeContextMenu(): void {
		this.contextMenuVisible.set(false);
	}

	public async cutText(): Promise<void> {
		const target = this.contextTarget;
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
			const start = target.selectionStart ?? 0;
			const end = target.selectionEnd ?? 0;
			const selected = target.value.substring(start, end);
			if (selected) {
				if (typeof navigator !== 'undefined' && navigator.clipboard) {
					try {
						await navigator.clipboard.writeText(selected);
					} catch {
						document.execCommand('cut');
					}
				}
				target.setRangeText('', start, end, 'end');
				target.dispatchEvent(new Event('input', { bubbles: true }));
			}
		} else {
			document.execCommand('cut');
		}
		this.closeContextMenu();
	}

	public async copyText(): Promise<void> {
		const target = this.contextTarget;
		let selected = '';
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
			const start = target.selectionStart ?? 0;
			const end = target.selectionEnd ?? 0;
			selected = target.value.substring(start, end);
		} else {
			selected = window.getSelection()?.toString() || '';
		}

		if (selected) {
			if (typeof navigator !== 'undefined' && navigator.clipboard) {
				try {
					await navigator.clipboard.writeText(selected);
				} catch {
					document.execCommand('copy');
				}
			} else {
				document.execCommand('copy');
			}
		} else {
			document.execCommand('copy');
		}
		this.closeContextMenu();
	}

	public async pasteText(): Promise<void> {
		const target = this.contextTarget;
		let clipboardText = '';
		if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
			try {
				clipboardText = await navigator.clipboard.readText();
			} catch {
				// clipboard read blocked or unavailable
			}
		}

		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
			if (clipboardText) {
				const start = target.selectionStart ?? target.value.length;
				const end = target.selectionEnd ?? target.value.length;
				target.setRangeText(clipboardText, start, end, 'end');
				target.dispatchEvent(new Event('input', { bubbles: true }));
			} else {
				document.execCommand('paste');
			}
		} else {
			document.execCommand('paste');
		}
		this.closeContextMenu();
	}

	public refreshApp(): void {
		this.closeContextMenu();
		this.workspaceService.refreshAll();
	}
}
