/**
 * app.ts - Root component orchestrating IDE layout, shortcuts, and dialogs
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import { Component, HostListener, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { TabsComponent } from './components/tabs/tabs.component';
import { EditorComponent } from './components/editor/editor.component';
import { StatusBarComponent } from './components/status-bar/status-bar.component';
import { SearchModalComponent } from './components/search-modal/search-modal.component';
import { AgentChatComponent } from './components/agent-chat/agent-chat.component';
import { isTauriApp, WorkspaceService } from './services/workspace.service';
import { ZoomService } from './services/zoom.service';
import { NavigationHistoryService } from './services/navigation-history.service';

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
	],
	templateUrl: './app.html',
	styleUrl: './app.scss',
})
export class App {
	public workspaceService = inject(WorkspaceService);
	public zoomService = inject(ZoomService);
	public navigationHistoryService = inject(NavigationHistoryService);
	private titleService = inject(Title);
	readonly title = signal('Vector IDE');
	readonly cursor = signal<{ line: number; column: number }>({ line: 1, column: 1 });

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
						getCurrentWindow().setTitle(windowTitle).catch((err) => {
							console.warn('Failed to set Tauri window title via window API:', err);
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

		if (event.altKey && !isCtrlOrCmd && !isShift) {
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
		} else if (
			event.key === 'F5' ||
			(isCtrlOrCmd && (key === 'r' || code === 'KeyR'))
		) {
			event.preventDefault();
			this.workspaceService.refreshAll();
		} else if (
			isCtrlOrCmd &&
			(event.key === '+' ||
				event.key === '=' ||
				code === 'Equal' ||
				code === 'NumpadAdd')
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
		} else if (
			isCtrlOrCmd &&
			(event.key === '0' || code === 'Digit0' || code === 'Numpad0')
		) {
			event.preventDefault();
			this.zoomService.resetZoom();
		}
	}
}
