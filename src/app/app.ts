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
	}

	onCursorChange(pos: { line: number; column: number }): void {
		this.cursor.set(pos);
	}

	@HostListener('window:keydown', ['$event'])
	onKeyDown(event: KeyboardEvent): void {
		if ((event.ctrlKey || event.metaKey) && event.key === 'p') {
			event.preventDefault();
			this.workspaceService.openModal('file-search');
		} else if ((event.ctrlKey || event.metaKey) && (event.key === 'o' || event.key === 'O')) {
			event.preventDefault();
			this.workspaceService.openDirectoryFromDisk();
		} else if ((event.ctrlKey || event.metaKey) && (event.key === 'n' || event.key === 'N')) {
			event.preventDefault();
			this.workspaceService.openModal('new-file');
		} else if (
			(event.ctrlKey || event.metaKey) &&
			event.shiftKey &&
			(event.key === 'F' || event.key === 'f')
		) {
			event.preventDefault();
			this.workspaceService.setSidebarView('search');
		} else if ((event.ctrlKey || event.metaKey) && event.key === 's') {
			event.preventDefault();
			this.workspaceService.saveCurrentFile();
		} else if ((event.ctrlKey || event.metaKey) && (event.key === 'b' || event.key === 'B')) {
			event.preventDefault();
			this.workspaceService.toggleSidebar();
		} else if ((event.ctrlKey || event.metaKey) && (event.key === 'h' || event.key === 'H')) {
			event.preventDefault();
			this.workspaceService.toggleHiddenFiles();
		} else if (
			event.key === 'F5' ||
			((event.ctrlKey || event.metaKey) && (event.key === 'r' || event.key === 'R'))
		) {
			event.preventDefault();
			this.workspaceService.refreshAll();
		} else if (
			(event.ctrlKey || event.metaKey) &&
			(event.key === '+' ||
				event.key === '=' ||
				event.code === 'Equal' ||
				event.code === 'NumpadAdd')
		) {
			event.preventDefault();
			this.zoomService.zoomIn();
		} else if (
			(event.ctrlKey || event.metaKey) &&
			(event.key === '-' ||
				event.key === '_' ||
				event.code === 'Minus' ||
				event.code === 'NumpadSubtract')
		) {
			event.preventDefault();
			this.zoomService.zoomOut();
		} else if (
			(event.ctrlKey || event.metaKey) &&
			(event.key === '0' || event.code === 'Digit0' || event.code === 'Numpad0')
		) {
			event.preventDefault();
			this.zoomService.resetZoom();
		}
	}
}
