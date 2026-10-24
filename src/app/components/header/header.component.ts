/**
 * header.component.ts - Top application header with menu actions and window controls
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkspaceService } from '../../services/workspace.service';
import { ThemeService } from '../../services/theme.service';

@Component({
	selector: 'app-header',
	standalone: true,
	imports: [CommonModule],
	templateUrl: './header.component.html',
	styleUrl: './header.component.scss',
})
export class HeaderComponent {
	public workspaceService = inject(WorkspaceService);
	public themeService = inject(ThemeService);
}
