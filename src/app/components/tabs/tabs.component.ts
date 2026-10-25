/**
 * tabs.component.ts - Tab bar component managing open file tabs and active buffer
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import {
	Component,
	ElementRef,
	ViewChild,
	HostListener,
	effect,
	inject,
	signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkspaceService } from '../../services/workspace.service';
import { ThemeService } from '../../services/theme.service';
import {
	NavigationHistoryService,
	NavigationEntry,
} from '../../services/navigation-history.service';
import {
	WorkspaceFile,
	isImageFile,
	isOmniFluxFile,
	isPhpFile,
	isPerlFile,
	isPreviewableFile,
	isBinaryFile,
} from '../../models/file.model';

@Component({
	selector: 'app-tabs',
	standalone: true,
	imports: [CommonModule],
	templateUrl: './tabs.component.html',
	styleUrl: './tabs.component.scss',
})
export class TabsComponent {
	public workspaceService = inject(WorkspaceService);
	public themeService = inject(ThemeService);
	public navigationHistoryService = inject(NavigationHistoryService);
	private elementRef = inject(ElementRef);

	@ViewChild('scrollArea', { static: false })
	public scrollArea?: ElementRef<HTMLElement>;

	constructor() {
		effect(() => {
			const activeId = this.workspaceService.activeFileId();
			if (activeId) {
				setTimeout(() => {
					const activeEl = this.scrollArea?.nativeElement?.querySelector('.tab.active');
					activeEl?.scrollIntoView({
						behavior: 'smooth',
						block: 'nearest',
						inline: 'nearest',
					});
				}, 50);
			}
		});
	}

	public onTabsWheel(event: WheelEvent): void {
		if (!this.scrollArea?.nativeElement) {
			return;
		}
		if (event.deltaY !== 0) {
			this.scrollArea.nativeElement.scrollLeft += event.deltaY;
			event.preventDefault();
		}
	}

	public isImage(tab: WorkspaceFile): boolean {
		return !!tab.isImage || isImageFile(tab.name);
	}

	public isBinary(tab: WorkspaceFile): boolean {
		return !!tab.isBinary || tab.language === 'binary' || isBinaryFile(tab.name);
	}

	public isOmniFlux(tab: WorkspaceFile): boolean {
		return isOmniFluxFile(tab.name, tab.language);
	}

	public isPhp(tab: WorkspaceFile): boolean {
		return isPhpFile(tab.name, tab.language);
	}

	public isPerl(tab: WorkspaceFile): boolean {
		return isPerlFile(tab.name, tab.language);
	}

	public isPreviewable(tab: WorkspaceFile): boolean {
		return isPreviewableFile(tab.name, tab.language);
	}

	public onOpenDiff(tab: WorkspaceFile, event: MouseEvent): void {
		event.stopPropagation();
		if (
			this.workspaceService.diffModeActive() &&
			this.workspaceService.activeDiffFile()?.id === tab.id
		) {
			this.workspaceService.closeDiffView();
		} else {
			this.workspaceService.openDiffView(tab);
		}
	}

	public onToggleTabPreview(tab: WorkspaceFile, event: MouseEvent): void {
		event.stopPropagation();
		if (tab.id !== this.workspaceService.activeFileId()) {
			this.workspaceService.openFile(tab);
			this.workspaceService.setPreviewMode('split');
		} else {
			this.workspaceService.togglePreview();
		}
	}

	public tabContextMenu = signal<{ tab: WorkspaceFile; x: number; y: number } | null>(null);

	public onTabDblClick(tab: WorkspaceFile): void {
		this.workspaceService.pinTab(tab.id);
	}

	public onTabContextMenu(event: MouseEvent, tab: WorkspaceFile): void {
		event.preventDefault();
		event.stopPropagation();
		const x = Math.min(event.clientX, window.innerWidth - 200);
		const y = Math.min(event.clientY, window.innerHeight - 250);
		this.tabContextMenu.set({ tab, x, y });
	}

	public closeTabContextMenu(): void {
		this.tabContextMenu.set(null);
	}

	public pinTabFromContext(): void {
		const menu = this.tabContextMenu();
		if (menu) {
			this.workspaceService.pinTab(menu.tab.id);
		}
		this.closeTabContextMenu();
	}

	public closeTabFromContext(): void {
		const menu = this.tabContextMenu();
		if (menu) {
			this.workspaceService.closeTab(menu.tab.id);
		}
		this.closeTabContextMenu();
	}

	public closeOtherTabsFromContext(): void {
		const menu = this.tabContextMenu();
		if (menu) {
			this.workspaceService.closeOtherTabs(menu.tab.id);
		}
		this.closeTabContextMenu();
	}

	public closeRightTabsFromContext(): void {
		const menu = this.tabContextMenu();
		if (menu) {
			this.workspaceService.closeTabsToRight(menu.tab.id);
		}
		this.closeTabContextMenu();
	}

	public closeSavedTabsFromContext(): void {
		this.workspaceService.closeUnmodifiedTabs();
		this.closeTabContextMenu();
	}

	public closeAllTabsFromContext(): void {
		this.workspaceService.closeAllTabs();
		this.closeTabContextMenu();
	}

	public getTabTooltip(tab: WorkspaceFile): string {
		let pathStr = tab.path || tab.name;
		if (tab.fsPath) {
			pathStr = tab.fsPath;
		} else {
			const nativeRoot = this.workspaceService.nativeWorkspacePath();
			if (nativeRoot && tab.path && !tab.path.startsWith('/')) {
				const cleanRoot = nativeRoot.endsWith('/') ? nativeRoot.slice(0, -1) : nativeRoot;
				const cleanRel = tab.path.startsWith('/') ? tab.path.slice(1) : tab.path;
				pathStr = `${cleanRoot}/${cleanRel}`;
			}
		}
		return tab.isPreview
			? `${pathStr} • (Preview - double-click or edit to keep open)`
			: pathStr;
	}

	@HostListener('document:click', ['$event'])
	public onDocumentClick(event: MouseEvent): void {
		if (this.tabContextMenu()) {
			this.closeTabContextMenu();
		}
		if (this.navigationHistoryService.isDropdownOpen()) {
			const navWrapper = this.elementRef.nativeElement.querySelector('.nav-stack-wrapper');
			if (navWrapper && !navWrapper.contains(event.target as Node)) {
				this.navigationHistoryService.closeDropdown();
			}
		}
	}

	@HostListener('document:keydown.escape')
	public onEscapeKey(): void {
		if (this.tabContextMenu()) {
			this.closeTabContextMenu();
		}
		if (this.navigationHistoryService.isDropdownOpen()) {
			this.navigationHistoryService.closeDropdown();
		}
	}

	public onSelectNavigationEntry(entry: NavigationEntry, originalIndex: number): void {
		this.navigationHistoryService.jumpToEntry(entry, originalIndex);
	}

	public onRemoveNavigationEntry(event: MouseEvent, originalIndex: number): void {
		event.stopPropagation();
		this.navigationHistoryService.removeEntryByIndex(originalIndex);
	}

	public formatTimeAgo(timestamp: number): string {
		const diffMs = Date.now() - timestamp;
		const diffSec = Math.floor(diffMs / 1000);
		if (diffSec < 60) return 'just now';
		const diffMin = Math.floor(diffSec / 60);
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHr = Math.floor(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h ago`;
		return `${Math.floor(diffHr / 24)}d ago`;
	}

	public getDirectoryPath(filePath: string): string {
		const parts = filePath.split('/');
		if (parts.length <= 1) return '';
		parts.pop();
		return parts.join('/');
	}
}
