import { Component, ElementRef, ViewChild, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkspaceService } from '../../services/workspace.service';
import { ThemeService } from '../../services/theme.service';
import { WorkspaceFile, isImageFile, isOmniFluxFile, isPhpFile, isPerlFile, isPreviewableFile } from '../../models/file.model';

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

  @ViewChild('scrollArea', { static: false })
  public scrollArea?: ElementRef<HTMLElement>;

  constructor() {
    effect(() => {
      const activeId = this.workspaceService.activeFileId();
      if (activeId) {
        setTimeout(() => {
          const activeEl = this.scrollArea?.nativeElement?.querySelector('.tab.active');
          activeEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
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
    if (this.workspaceService.diffModeActive() && this.workspaceService.activeDiffFile()?.id === tab.id) {
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

  public getTabTooltip(tab: WorkspaceFile): string {
    if (tab.fsPath) {
      return tab.fsPath;
    }
    const nativeRoot = this.workspaceService.nativeWorkspacePath();
    if (nativeRoot && tab.path && !tab.path.startsWith('/')) {
      const cleanRoot = nativeRoot.endsWith('/') ? nativeRoot.slice(0, -1) : nativeRoot;
      const cleanRel = tab.path.startsWith('/') ? tab.path.slice(1) : tab.path;
      return `${cleanRoot}/${cleanRel}`;
    }
    return tab.path || tab.name;
  }
}
