/**
 * status-bar.component.ts - Status bar component displaying cursor position, language, and git branch
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import { Component, input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkspaceService } from '../../services/workspace.service';
import { ZoomService } from '../../services/zoom.service';
import { AiService } from '../../services/ai.service';
import { TerminalService } from '../../services/terminal.service';
import { isBinaryFile } from '../../models/file.model';

@Component({
	selector: 'app-status-bar',
	standalone: true,
	imports: [CommonModule],
	templateUrl: './status-bar.component.html',
	styleUrl: './status-bar.component.scss',
})
export class StatusBarComponent {
	public cursor = input<{ line: number; column: number }>({ line: 1, column: 1 });

	public workspaceService = inject(WorkspaceService);
	public zoomService = inject(ZoomService);
	public aiService = inject(AiService);
	public terminalService = inject(TerminalService);

	public onTerminalContextMenu(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		this.workspaceService.openSystemTerminal();
	}

	public cycleZoom(): void {
		const cur = this.zoomService.zoomPercentage();
		if (cur >= 150) {
			this.zoomService.resetZoom();
		} else if (cur >= 120) {
			this.zoomService.setZoom(1.5);
		} else if (cur >= 100) {
			this.zoomService.setZoom(1.2);
		} else {
			this.zoomService.setZoom(1.0);
		}
	}

	public indentationLabel(): string {
		const isTabs = this.workspaceService.indentType() === 'tabs';
		const size = this.workspaceService.tabSize();
		return isTabs ? `Tab Size: ${size}` : `Spaces: ${size}`;
	}

	public activeLanguageLabel(): string {
		const file = this.workspaceService.activeFile();
		if (!file) return 'Plain Text';
		if (file.isBinary || file.language === 'binary' || isBinaryFile(file.name)) {
			return 'Binary';
		}
		const lang = file.language || 'plaintext';
		switch (lang.toLowerCase()) {
			case 'binary':
				return 'Binary';
			case 'omniflux':
				return 'OmniFlux';
			case 'typescript':
				return 'TypeScript';
			case 'javascript':
				return 'JavaScript';
			case 'php':
				return 'PHP';
			case 'perl':
				return 'Perl';
			case 'c':
				return 'C';
			case 'cpp':
				return 'C++';
			case 'json':
				return 'JSON';
			case 'html':
				return 'HTML';
			case 'xml':
				return 'XML';
			case 'css':
				return 'CSS';
			case 'markdown':
				return 'Markdown';
			case 'shell':
			case 'bash':
				return 'Bash';
			case 'python':
				return 'Python';
			case 'plaintext':
				return 'Plain Text';
			default:
				return lang.toUpperCase();
		}
	}
}
