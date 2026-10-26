/**
 * terminal.component.ts - Integrated PTY terminal component using xterm.js
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import {
	Component,
	ElementRef,
	ViewChild,
	AfterViewInit,
	OnDestroy,
	inject,
	effect,
	signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Terminal, ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { TerminalService } from '../../services/terminal.service';
import { WorkspaceService, isTauriApp } from '../../services/workspace.service';
import { ThemeService } from '../../services/theme.service';
import { ZoomService } from '../../services/zoom.service';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export const TERMINAL_LIGHT_THEME: ITheme = {
	background: '#ffffff',
	foreground: '#1e1e1e',
	cursor: '#1e1e1e',
	cursorAccent: '#ffffff',
	selectionBackground: 'rgba(0, 122, 204, 0.25)',
	selectionForeground: '#000000',
	black: '#000000',
	red: '#cf222e',
	green: '#116329',
	yellow: '#7d4e00',
	blue: '#0969da',
	magenta: '#8250df',
	cyan: '#1b7c83',
	white: '#57606a',
	brightBlack: '#57606a',
	brightRed: '#a40e26',
	brightGreen: '#1a7f37',
	brightYellow: '#633c01',
	brightBlue: '#218bff',
	brightMagenta: '#a475f9',
	brightCyan: '#3192aa',
	brightWhite: '#1e1e1e',
};

export const TERMINAL_DARK_THEME: ITheme = {
	background: '#181818',
	foreground: '#cccccc',
	cursor: '#ffffff',
	cursorAccent: '#181818',
	selectionBackground: 'rgba(255, 255, 255, 0.25)',
	black: '#000000',
	red: '#cd3131',
	green: '#0dbc79',
	yellow: '#e5e510',
	blue: '#2472c8',
	magenta: '#bc3fbc',
	cyan: '#11a8cd',
	white: '#e5e5e5',
	brightBlack: '#666666',
	brightRed: '#f14c4c',
	brightGreen: '#23d18b',
	brightYellow: '#f5f543',
	brightBlue: '#3b8eea',
	brightMagenta: '#d670d6',
	brightCyan: '#29b8db',
	brightWhite: '#ffffff',
};

@Component({
	selector: 'app-terminal',
	standalone: true,
	imports: [CommonModule],
	templateUrl: './terminal.component.html',
	styleUrl: './terminal.component.scss',
})
export class TerminalComponent implements AfterViewInit, OnDestroy {
	public terminalService = inject(TerminalService);
	public workspaceService = inject(WorkspaceService);
	public themeService = inject(ThemeService);
	public zoomService = inject(ZoomService);

	@ViewChild('terminalDock', { static: false })
	terminalDockRef?: ElementRef<HTMLDivElement>;

	@ViewChild('terminalContainer', { static: false })
	terminalContainerRef?: ElementRef<HTMLDivElement>;

	private term: Terminal | null = null;
	private fitAddon: FitAddon | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private unlistenData: UnlistenFn | null = null;
	private unlistenExit: UnlistenFn | null = null;
	private isInitialized = false;
	private lastWorkspacePath: string | null = null;

	// Panel dragging state
	public isResizing = signal<boolean>(false);
	public isMaximized = signal<boolean>(false);
	private preMaximizeHeight = 320;
	private startY = 0;
	private startHeight = 0;

	constructor() {
		// Whenever visibility becomes true, recalculate dimensions and focus
		effect(() => {
			const visible = this.terminalService.terminalVisible();
			if (visible && this.term && this.fitAddon) {
				requestAnimationFrame(() => {
					this.fit();
					this.term?.focus();
					setTimeout(() => this.fit(), 60);
				});
			}
		});

		// Auto-restart terminal when workspace folder changes
		effect(() => {
			const currentPath = this.workspaceService.nativeWorkspacePath();
			if (this.isInitialized) {
				if (currentPath !== this.lastWorkspacePath) {
					this.lastWorkspacePath = currentPath;
					this.terminalService.restartTerminal();
				}
			}
		});

		// Listen to restart trigger
		effect(() => {
			this.terminalService.restartTrigger();
			if (this.isInitialized) {
				this.term?.reset();
				this.applyTheme();
				this.initSession();
			}
		});

		// Sync font size dynamically with ZoomService editor font size
		effect(() => {
			this.zoomService.editorFontSize();
			this.applyFontSize();
		});

		// Sync theme dynamically with ThemeService (light / dark)
		effect(() => {
			this.themeService.currentTheme();
			this.applyTheme();
		});
	}

	ngAfterViewInit(): void {
		this.initTerminal();
	}

	public applyTheme(): void {
		if (!this.term) return;
		const isLight = this.themeService.currentTheme() === 'light';
		this.term.options.theme = isLight ? TERMINAL_LIGHT_THEME : TERMINAL_DARK_THEME;
	}

	public applyFontSize(): void {
		if (!this.term) return;
		const fs = this.zoomService.editorFontSize();
		this.term.options.fontSize = fs;
		setTimeout(() => this.fit(), 30);
	}

	private async initTerminal(): Promise<void> {
		if (!this.terminalContainerRef?.nativeElement) return;

		const isLight = this.themeService.currentTheme() === 'light';
		const initialFontSize = this.zoomService.editorFontSize();

		this.term = new Terminal({
			fontFamily: "Menlo, Monaco, 'Courier New', monospace",
			fontSize: initialFontSize,
			lineHeight: 1.15,
			cursorBlink: true,
			cursorStyle: 'block',
			scrollback: 10000,
			theme: isLight ? TERMINAL_LIGHT_THEME : TERMINAL_DARK_THEME,
		});

		this.fitAddon = new FitAddon();
		this.term.loadAddon(this.fitAddon);

		this.term.open(this.terminalContainerRef.nativeElement);
		this.applyTheme();

		// Forward keystrokes to PTY backend
		this.term.onData((data) => {
			if (isTauriApp()) {
				const currentSessionId = this.terminalService.activeSessionId();
				invoke('pty_write', { sessionId: currentSessionId, data }).catch((err) => {
					console.warn('Failed to write to PTY:', err);
				});
			}
		});

		// Forward terminal size changes to PTY backend
		this.term.onResize((size) => {
			if (isTauriApp()) {
				const currentSessionId = this.terminalService.activeSessionId();
				invoke('pty_resize', { sessionId: currentSessionId, cols: size.cols, rows: size.rows }).catch((err) => {
					console.warn('Failed to resize PTY:', err);
				});
			}
		});

		// Observe container size changes
		this.resizeObserver = new ResizeObserver(() => {
			if (this.terminalService.terminalVisible()) {
				this.fit();
			}
		});
		this.resizeObserver.observe(this.terminalContainerRef.nativeElement);

		this.isInitialized = true;
		this.lastWorkspacePath = this.workspaceService.nativeWorkspacePath();

		// Start integrated PTY session immediately
		await this.initSession();
	}

	private resolveCurrentDirectory(): string | undefined {
		// 1. Check native workspace path from WorkspaceService signal
		let cwd = this.workspaceService.nativeWorkspacePath();

		// 2. Fallback to active file directory if available
		if (!cwd) {
			const active = this.workspaceService.activeFile();
			if (active?.fsPath) {
				const lastSlash = active.fsPath.lastIndexOf('/');
				if (lastSlash > 0) {
					cwd = active.fsPath.substring(0, lastSlash);
				}
			}
		}

		return cwd || undefined;
	}

	private async initSession(): Promise<void> {
		if (!this.term || !this.fitAddon) return;

		const sessionId = this.terminalService.activeSessionId();

		// Clean up existing listeners
		if (this.unlistenData) {
			this.unlistenData();
			this.unlistenData = null;
		}
		if (this.unlistenExit) {
			this.unlistenExit();
			this.unlistenExit = null;
		}

		if (isTauriApp()) {
			try {
				// Listen for stdout/stderr bytes from Rust PTY
				this.unlistenData = await listen<string>(`pty-data:${sessionId}`, (event) => {
					this.term?.write(event.payload);
				});

				// Listen for process exit
				this.unlistenExit = await listen(`pty-exit:${sessionId}`, () => {
					this.term?.write('\r\n\x1b[33m[Process completed]\x1b[0m\r\n');
					this.terminalService.isSessionActive.set(false);
				});

				// Initial dimensions - default to standard 80x24 before first layout measurement
				let cols = 80;
				let rows = 24;
				const el = this.terminalContainerRef?.nativeElement;
				if (this.terminalService.terminalVisible() && el && el.offsetWidth >= 50 && el.offsetHeight >= 30) {
					try {
						this.fitAddon.fit();
						cols = Math.max(10, this.term.cols || 80);
						rows = Math.max(5, this.term.rows || 24);
					} catch {}
				}

				const cwd = this.resolveCurrentDirectory();

				// Open PTY in Rust with resolved cwd
				await invoke('pty_open', { sessionId, cwd, cols, rows });
				this.terminalService.isSessionActive.set(true);

				setTimeout(() => {
					if (this.terminalService.terminalVisible()) {
						this.fit();
						this.term?.focus();
					}
				}, 60);
			} catch (err: any) {
				this.term.write(`\r\n\x1b[31mFailed to start terminal session: ${err?.message || err}\x1b[0m\r\n`);
				this.terminalService.isSessionActive.set(false);
			}
		} else {
			this.term.write('\r\n\x1b[33mIntegrated terminal is only available in the desktop application.\x1b[0m\r\n');
		}
	}

	public fit(): void {
		if (!this.fitAddon || !this.term) return;
		if (!this.terminalService.terminalVisible()) return;
		const el = this.terminalContainerRef?.nativeElement;
		if (!el || el.offsetWidth < 50 || el.offsetHeight < 30) return;
		try {
			this.fitAddon.fit();
			if (isTauriApp() && this.term.cols && this.term.rows) {
				const sessionId = this.terminalService.activeSessionId();
				invoke('pty_resize', {
					sessionId,
					cols: this.term.cols,
					rows: this.term.rows,
				}).catch(() => {});
			}
		} catch {
			// Container may be hidden or detached momentarily
		}
	}

	public clearScreen(): void {
		this.term?.clear();
		this.term?.focus();
	}

	public restartSession(): void {
		this.terminalService.restartTerminal();
	}

	public openExternalTerminal(): void {
		const cwd = this.resolveCurrentDirectory();
		this.workspaceService.openSystemTerminal(cwd);
	}

	public closePanel(): void {
		this.terminalService.closeTerminal();
	}

	// Resizing panel logic
	public onStartResize(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		this.isResizing.set(true);
		this.startY = event.clientY;
		this.startHeight = this.terminalService.terminalHeight();

		document.body.style.cursor = 'row-resize';
		document.body.style.userSelect = 'none';

		const onMouseMove = (moveEvent: MouseEvent) => {
			const deltaY = this.startY - moveEvent.clientY;
			const maxH = Math.max(200, Math.floor(window.innerHeight * 0.85));
			const newHeight = Math.min(Math.max(140, this.startHeight + deltaY), maxH);
			if (this.terminalDockRef?.nativeElement) {
				this.terminalDockRef.nativeElement.style.height = `${newHeight}px`;
			}
			this.terminalService.setTerminalHeight(newHeight);
			this.fit();
		};

		const onMouseUp = () => {
			this.isResizing.set(false);
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
			this.fit();
		};

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
	}

	public onResetHeight(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		this.isMaximized.set(false);
		this.terminalService.setTerminalHeight(320);
		if (this.terminalDockRef?.nativeElement) {
			this.terminalDockRef.nativeElement.style.height = '320px';
		}
		setTimeout(() => this.fit(), 30);
	}

	public toggleMaximize(): void {
		const maxH = Math.max(300, Math.floor(window.innerHeight * 0.75));
		if (this.isMaximized()) {
			this.isMaximized.set(false);
			const h = this.preMaximizeHeight || 320;
			this.terminalService.setTerminalHeight(h);
			if (this.terminalDockRef?.nativeElement) {
				this.terminalDockRef.nativeElement.style.height = `${h}px`;
			}
		} else {
			this.preMaximizeHeight = this.terminalService.terminalHeight();
			this.isMaximized.set(true);
			this.terminalService.setTerminalHeight(maxH);
			if (this.terminalDockRef?.nativeElement) {
				this.terminalDockRef.nativeElement.style.height = `${maxH}px`;
			}
		}
		setTimeout(() => this.fit(), 30);
	}

	ngOnDestroy(): void {
		if (this.unlistenData) {
			this.unlistenData();
		}
		if (this.unlistenExit) {
			this.unlistenExit();
		}
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
		}
		if (this.term) {
			this.term.dispose();
		}
	}
}
