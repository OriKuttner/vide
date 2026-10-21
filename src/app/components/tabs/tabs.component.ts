import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkspaceService } from '../../services/workspace.service';
import { ThemeService } from '../../services/theme.service';
import { WorkspaceFile, isImageFile, isOmniFluxFile, isPhpFile, isPerlFile, isPreviewableFile } from '../../models/file.model';

@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tabs-header-bar">
      @if (!workspaceService.sidebarVisible()) {
        <button
          class="open-sidebar-btn"
          (click)="workspaceService.toggleSidebar()"
          title="Show Primary Side Bar (Ctrl+B)"
        >
          <svg class="svg-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M0 3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3zm5-1v12h9a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H5zM4 2H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h2V2z"/>
          </svg>
          <span>Explorer</span>
        </button>
      }

      <div class="tabs-scroll-area">
        @for (tab of workspaceService.openTabs(); track tab.id) {
          <div
            class="tab"
            [class.active]="tab.id === workspaceService.activeFileId()"
            (click)="workspaceService.openFile(tab)"
          >
            <span class="tab-title">
              @if (workspaceService.diffModeActive() && workspaceService.activeDiffFile()?.id === tab.id) {
                <span class="tab-diff-icon">◫</span>
              } @else if (isImage(tab)) {
                <svg class="tab-img-icon" viewBox="0 0 16 16" fill="currentColor">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M14.5 2h-13l-.5.5v11l.5.5h13l.5-.5v-11l-.5-.5zm-.5 11H2V3h12v10zm-3.5-7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm1 6.5l-3-4-2.5 3.2-1.5-1.7-2 2.5h9z"/>
                </svg>
              } @else if (isOmniFlux(tab)) {
                <img src="omniflux-icon-16.png" class="tab-lang-img" alt="OmniFlux" />
              } @else if (isPhp(tab)) {
                <img src="php-elephant.svg" class="tab-lang-img" alt="PHP" />
              } @else if (isPerl(tab)) {
                <img src="perl-onion.svg" class="tab-lang-img" alt="Perl" />
              }
              {{ tab.name }}
            </span>
            @if (isPreviewable(tab)) {
              <button
                type="button"
                class="tab-preview-btn"
                [class.active]="tab.id === workspaceService.activeFileId() && workspaceService.previewMode() !== 'none'"
                [title]="(tab.id === workspaceService.activeFileId() && workspaceService.previewMode() !== 'none') ? 'Close Preview (Ctrl+Shift+V)' : 'Open Live Preview (Ctrl+Shift+V)'"
                (click)="onToggleTabPreview(tab, $event)"
              >
                <svg class="svg-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            }
            @if (workspaceService.hasGitChanges(tab)) {
              <button
                type="button"
                class="tab-git-btn"
                title="View Git Diff"
                (click)="onOpenDiff(tab, $event)"
              >
                <svg class="svg-icon" viewBox="0 0 16 16" fill="currentColor">
                  <path fill-rule="evenodd" d="M11.75 2a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zm-7.5 0a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM4.25 10.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM3.5 3.75a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0zm7.5 0a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0zm-7.5 8.5a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z"/>
                  <path fill-rule="evenodd" d="M5 5.5V11h-1.5V5.5H5zm2.75 2a3.75 3.75 0 0 1 3.75-3.75h.5V5.25h-.5A2.25 2.25 0 0 0 9.25 7.5v.75H7.75V7.5z"/>
                </svg>
              </button>
            }
            @if (workspaceService.isFileModified(tab)) {
              <span class="modified-dot" title="Unsaved changes">●</span>
            }
            <button
              class="close-btn"
              title="Close (Ctrl+W)"
              (click)="workspaceService.closeTab(tab.id, $event)"
            >
              ×
            </button>
          </div>
        }
      </div>

      <div class="tabs-actions">
        @if (workspaceService.activeFile(); as active) {
          @if (active.isModified || active.gitStatus || active.originalContent !== undefined) {
            <button
              class="action-btn diff-btn"
              [class.active]="workspaceService.diffModeActive()"
              (click)="workspaceService.toggleCurrentFileDiff()"
              [title]="workspaceService.diffModeActive() ? 'Close Meld Diff View (Return to Editor)' : 'Open Meld Side-by-Side Diff for Current File'"
            >
              <span class="diff-icon">◫</span>
            </button>
          }
        }

        <button
          class="action-btn sidebar-btn"
          [class.active]="workspaceService.sidebarVisible()"
          (click)="workspaceService.toggleSidebar()"
          [title]="workspaceService.sidebarVisible() ? 'Hide Primary Side Bar (Ctrl+B)' : 'Show Primary Side Bar (Ctrl+B)'"
        >
          <svg class="svg-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M0 3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3zm5-1v12h9a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H5zM4 2H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h2V2z"/>
          </svg>
        </button>

        <button
          class="action-btn sticky-btn"
          [class.active]="workspaceService.stickyScrollEnabled()"
          (click)="workspaceService.toggleStickyScroll()"
          [title]="'Sticky Scroll: ' + (workspaceService.stickyScrollEnabled() ? 'Enabled (Click to disable)' : 'Disabled (Click to enable)')"
        >
          <svg class="svg-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.98-1.767.432-.548-.548.237-1.572.432-1.768l3.182-3.182-2.828-2.828a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 0 1 1.013.16l3.134-3.133a2.772 2.772 0 0 1-.04-.461c0-.43.109-1.022.589-1.503a.5.5 0 0 1 .353-.146z"/>
          </svg>
        </button>

        <button
          class="action-btn theme-btn"
          (click)="themeService.toggleTheme()"
          [title]="'Switch to ' + (themeService.currentTheme() === 'light' ? 'Dark' : 'Light') + ' Mode'"
        >
          @if (themeService.currentTheme() === 'light') {
            <span>🌙</span>
          } @else {
            <span>☀️</span>
          }
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .tabs-header-bar {
        height: 38px;
        background-color: var(--bg-tabs-bar, #ececec);
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid var(--border-color, #e5e5e5);
        user-select: none;
        overflow: hidden;
        transition: background-color 0.2s ease, border-color 0.2s ease;

        .open-sidebar-btn {
          display: flex;
          align-items: center;
          gap: 7px;
          height: 100%;
          padding: 0 14px;
          background-color: var(--bg-tabs-bar, #ececec);
          border: none;
          border-right: 1px solid var(--border-color, #e5e5e5);
          color: var(--text-primary, #1e1e1e);
          font-size: 13.5px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.15s ease, color 0.15s ease;

          .svg-icon {
            width: 16px;
            height: 16px;
            display: block;
          }

          &:hover {
            background-color: var(--bg-item-hover, #dedede);
            color: #007acc;
          }
        }
      }

      .tabs-scroll-area {
        display: flex;
        align-items: center;
        height: 100%;
        overflow-x: auto;
        flex: 1;

        &::-webkit-scrollbar {
          height: 3px;
        }
      }

      .tab {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 14px;
        height: 100%;
        background-color: var(--bg-tab-inactive, #dedede);
        color: var(--text-tab-inactive, #555555);
        font-size: 14px;
        border-right: 1px solid var(--border-color, #e5e5e5);
        cursor: pointer;
        transition: background-color 0.1s, color 0.1s;
        border-top: 2px solid transparent;

        &:hover {
          background-color: var(--bg-tab-hover, #e6e6e6);
          color: var(--text-primary, #1e1e1e);
        }

        &.active {
          background-color: var(--bg-editor, #ffffff);
          color: var(--text-tab-active, #007acc);
          font-weight: 500;
          border-top: 2px solid #007acc;
        }

        .tab-title {
          white-space: nowrap;
          display: flex;
          align-items: center;
          gap: 5px;

          .tab-diff-icon {
            color: #007acc;
            font-size: 14px;
          }

          .tab-img-icon {
            width: 14px;
            height: 14px;
            color: #107c41;
            display: block;
          }

          .tab-lang-img {
            width: 15px;
            height: 15px;
            object-fit: contain;
            display: block;
            flex-shrink: 0;
          }
        }

        .tab-git-btn {
          background: transparent;
          border: none;
          padding: 2px 3px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #007acc;
          cursor: pointer;
          border-radius: 3px;
          opacity: 0.85;
          margin-left: 2px;
          transition: opacity 0.15s ease, background-color 0.15s ease;

          &:hover {
            opacity: 1;
            background-color: rgba(0, 122, 204, 0.15);
          }

          .svg-icon {
            width: 13px;
            height: 13px;
          }
        }

        .tab-preview-btn {
          background: transparent;
          border: none;
          padding: 2px 3px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted, #717171);
          cursor: pointer;
          border-radius: 3px;
          opacity: 0.75;
          margin-left: 2px;
          transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;

          &:hover {
            opacity: 1;
            color: #007acc;
            background-color: rgba(0, 122, 204, 0.15);
          }

          &.active {
            opacity: 1;
            color: #007acc;
            background-color: rgba(0, 122, 204, 0.2);
          }

          .svg-icon {
            width: 13px;
            height: 13px;
            display: block;
          }
        }

        .modified-dot {
          font-size: 11px;
          color: #111111;
          line-height: 1;
          display: inline-block;
          margin-left: 3px;
          margin-right: 2px;
          user-select: none;
        }

        :host-context(.theme-dark) .modified-dot,
        body.theme-dark .modified-dot {
          color: #ffffff;
        }

        :host-context(.theme-dark) .tab-preview-btn,
        body.theme-dark .tab-preview-btn {
          color: #9d9d9d;

          &:hover {
            color: #ffffff;
            background-color: rgba(255, 255, 255, 0.15);
          }

          &.active {
            color: #3794ff;
            background-color: rgba(55, 148, 255, 0.25);
          }
        }

        .close-btn {
          background: transparent;
          border: none;
          color: inherit;
          font-size: 17px;
          line-height: 1;
          padding: 2px 5px;
          border-radius: 3px;
          cursor: pointer;
          opacity: 0.7;

          &:hover {
            opacity: 1;
            background-color: rgba(0, 0, 0, 0.1);
          }
        }
      }

      .tabs-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 0 10px;
        height: 100%;
        border-left: 1px solid var(--border-color, #e5e5e5);
        flex-shrink: 0;

        .action-btn {
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-primary, #333333);
          font-size: 14px;
          padding: 4px 7px;
          min-width: 28px;
          height: 26px;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: background-color 0.15s, border-color 0.15s;

          .svg-icon {
            width: 16px;
            height: 16px;
            display: block;
          }

          &:hover {
            background-color: var(--bg-btn-hover, #dcdcdc);
            border-color: var(--border-color, #cccccc);
          }

          &.sidebar-btn {
            color: var(--text-muted, #717171);
            opacity: 0.7;
            transition: all 0.15s ease;

            .svg-icon {
              width: 16px;
              height: 16px;
              display: block;
            }

            &:hover {
              opacity: 1;
            }

            &.active {
              color: #007acc;
              opacity: 1;
              background-color: var(--bg-item-active, #e2effd);
              border-color: rgba(0, 122, 204, 0.3);
            }
          }

          &.diff-btn {
            color: var(--text-muted, #717171);
            font-size: 15px;
            font-weight: 700;

            &:hover {
              color: #007acc;
            }

            &.active {
              color: #007acc;
              background-color: var(--bg-item-active, #e2effd);
              border-color: rgba(0, 122, 204, 0.3);
            }
          }

          &.theme-btn {
            font-size: 15px;
          }

          &.sticky-btn {
            color: var(--text-muted, #717171);
            opacity: 0.6;
            transition: all 0.15s ease;

            .svg-icon {
              width: 16px;
              height: 16px;
              display: block;
            }

            &:hover {
              opacity: 0.9;
            }

            &.active {
              color: #007acc;
              opacity: 1;
              background-color: var(--bg-item-active, #e2effd);
              border-color: rgba(0, 122, 204, 0.3);
            }
          }
        }
      }

      :host-context(body.theme-dark) .tabs-actions,
      body.theme-dark .tabs-actions {
        border-left-color: var(--border-color, #333333);

        .action-btn {
          color: var(--text-primary, #cccccc);

          &:hover {
            background-color: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 255, 0.15);
          }
        }
      }
    `,
  ],
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
