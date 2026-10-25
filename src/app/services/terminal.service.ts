/**
 * terminal.service.ts - Service managing integrated terminal sessions and panel visibility
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import { Injectable, signal, inject } from '@angular/core';
import { WorkspaceService, isTauriApp } from './workspace.service';
import { invoke } from '@tauri-apps/api/core';

@Injectable({
	providedIn: 'root',
})
export class TerminalService {
	private workspaceService = inject(WorkspaceService);

	// Panel visibility & size state
	public readonly terminalVisible = signal<boolean>(false);
	public readonly terminalHeight = signal<number>(320);
	public readonly activeSessionId = signal<string>('default');
	public readonly isSessionActive = signal<boolean>(false);

	// Restart trigger counter to notify component to re-init session
	public readonly restartTrigger = signal<number>(0);

	public toggleTerminal(): void {
		this.terminalVisible.update((v) => !v);
	}

	public openTerminal(): void {
		this.terminalVisible.set(true);
	}

	public closeTerminal(): void {
		// Only hide the UI panel; do NOT kill the background process or clear buffer
		this.terminalVisible.set(false);
	}

	public setTerminalHeight(h: number): void {
		// Clamp between 100px and 80% of window height
		const maxH = Math.max(200, window.innerHeight * 0.8);
		const clamped = Math.min(Math.max(100, h), maxH);
		this.terminalHeight.set(clamped);
	}

	public async restartTerminal(): Promise<void> {
		const oldSessionId = this.activeSessionId();
		if (isTauriApp()) {
			try {
				await invoke('pty_close', { sessionId: oldSessionId });
			} catch (e) {
				console.warn('Failed to close PTY session:', e);
			}
		}
		this.activeSessionId.set(`term_${Date.now()}`);
		this.restartTrigger.update((n) => n + 1);
	}

	public async killTerminal(): Promise<void> {
		const sessionId = this.activeSessionId();
		if (isTauriApp()) {
			try {
				await invoke('pty_close', { sessionId });
			} catch (e) {
				console.warn('Failed to close PTY session:', e);
			}
		}
		this.isSessionActive.set(false);
		this.terminalVisible.set(false);
	}
}
