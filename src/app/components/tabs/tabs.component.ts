import { Component, inject } from '@angular/core';
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
}
