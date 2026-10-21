import {
  Component,
  ElementRef,
  ViewChild,
  OnInit,
  AfterViewInit,
  OnDestroy,
  effect,
  inject,
  output,
  signal,
  computed,
} from '@angular/core';
import * as monaco from 'monaco-editor';
import { WorkspaceService } from '../../services/workspace.service';
import { InlineCompletionService } from '../../services/inline-completion.service';
import { ThemeService } from '../../services/theme.service';
import { ZoomService } from '../../services/zoom.service';
import { registerOmniFlux } from '../../languages/omniflux.language';
import { registerAllLanguageSnippets } from '../../languages/snippets.registry';
import { WorkspaceFile, isImageFile, detectLanguage } from '../../models/file.model';

@Component({
  selector: 'app-editor',
  standalone: true,
  template: `
    <div class="editor-wrapper">
      @if (workspaceService.diffModeActive() && workspaceService.activeDiffFile(); as diffFile) {
        <div class="meld-diff-toolbar">
          <div class="diff-left-section">
            <span class="meld-tag">MELD DIFF</span>
            <span class="diff-file-name">{{ diffFile.name }}</span>
            <span
              class="diff-status-badge"
              [class.status-m]="diffFile.gitStatus === 'modified'"
              [class.status-a]="diffFile.gitStatus === 'added'"
              [class.status-u]="diffFile.gitStatus === 'untracked'"
            >
              {{ diffFile.gitStatus === 'added' ? 'Added' : diffFile.gitStatus === 'untracked' ? 'Untracked' : 'Modified' }}
            </span>
            @if (diffChunkCount() > 0) {
              <span class="diff-chunk-pill">
                {{ diffChunkCount() }} difference{{ diffChunkCount() === 1 ? '' : 's' }}
              </span>
            }
          </div>

          <div class="diff-center-headers">
            <div class="pane-header original-pane-header">
              <span class="legend-indicator red">●</span>
              <span class="pane-title">HEAD (Commit Baseline)</span>
              <span class="pane-tag">Read-only</span>
            </div>
            <div class="pane-separator">⇄</div>
            <div class="pane-header modified-pane-header">
              <span class="legend-indicator green">●</span>
              <span class="pane-title">Working Tree (Local Changes)</span>
              <span class="pane-tag editable">Editable</span>
            </div>
          </div>

          <div class="diff-right-actions">
            <button
              type="button"
              class="diff-action-btn view-toggle-btn"
              [class.active]="workspaceService.diffRenderSideBySide()"
              (click)="workspaceService.toggleDiffSideBySide()"
              [title]="workspaceService.diffRenderSideBySide() ? 'Switch to Unified Inline View' : 'Switch to Side-by-Side (Meld) View'"
            >
              <span class="btn-icon">{{ workspaceService.diffRenderSideBySide() ? '◫' : '☰' }}</span>
              <span>{{ workspaceService.diffRenderSideBySide() ? 'Side-by-Side' : 'Inline' }}</span>
            </button>

            <button
              type="button"
              class="diff-action-btn revert-btn"
              (click)="discardChanges(diffFile.id)"
              title="Discard all local changes in this file (Restore HEAD)"
            >
              <span class="btn-icon">⎌</span>
              <span>Discard Changes</span>
            </button>

            <button
              type="button"
              class="diff-action-btn close-btn"
              (click)="workspaceService.closeDiffView()"
              title="Close Diff View (Return to Editor)"
            >
              <span class="btn-icon">✕</span>
              <span>Close Diff</span>
            </button>
          </div>
        </div>
      }

      <div class="editor-stage">
        @if (activeFileIsImage(); as imgFile) {
          <div class="image-viewer-container">
            <div class="image-viewer-toolbar">
              <div class="img-left-meta">
                <span class="img-badge">
                  <svg class="img-badge-svg" viewBox="0 0 16 16" fill="currentColor">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M14.5 2h-13l-.5.5v11l.5.5h13l.5-.5v-11l-.5-.5zm-.5 11H2V3h12v10zm-3.5-7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm1 6.5l-3-4-2.5 3.2-1.5-1.7-2 2.5h9z"/>
                  </svg>
                  IMAGE
                </span>
                <span class="img-filename">{{ imgFile.name }}</span>
                @if (imageDimensions(); as dims) {
                  <span class="img-dims">{{ dims.width }} × {{ dims.height }} px</span>
                }
                @if (imgFile.fileSize) {
                  <span class="img-size">{{ formatFileSize(imgFile.fileSize) }}</span>
                }
              </div>

              <div class="img-zoom-toolbar">
                <button type="button" class="img-tool-btn" (click)="zoomImgOut()" title="Zoom Out">−</button>
                <span class="img-zoom-label">{{ Math.round(imageZoom() * 100) }}%</span>
                <button type="button" class="img-tool-btn" (click)="zoomImgIn()" title="Zoom In">+</button>
                <button type="button" class="img-tool-btn" (click)="resetImgZoom()" title="Original Size (100%)">1:1</button>
                <button type="button" class="img-tool-btn" (click)="fitImgToWindow()" title="Fit to Window">Fit</button>
              </div>
            </div>

            <div class="image-stage-viewport" (wheel)="onImgWheel($event)">
              @if (imgFile.imageUrl) {
                <div class="checkerboard-backdrop">
                  <img
                    [src]="imgFile.imageUrl"
                    [alt]="imgFile.name"
                    [style.transform]="'scale(' + imageZoom() + ')'"
                    (load)="onImgLoad($event)"
                    class="previewed-image"
                  />
                </div>
              } @else {
                <div class="img-loading">
                  <div class="mini-spinner"></div>
                  <span>Loading image preview...</span>
                </div>
              }
            </div>
          </div>
        }

        @if (!workspaceService.activeFile() && !workspaceService.diffModeActive()) {
          <div class="welcome-stage">
            <div class="welcome-box">
              <!-- 1. Centered Vector Logo -->
              <div class="logo-wrapper">
                <img class="welcome-logo" src="vector-logo.png" alt="Vector Logo" width="88" height="88" />
              </div>

              <!-- 2. Centered Open Folder CTA -->
              <div class="welcome-main-action">
                <button
                  type="button"
                  class="open-folder-cta"
                  (click)="workspaceService.openDirectoryFromDisk()"
                  title="Open Folder (Ctrl+O)"
                >
                  <span class="cta-icon">📁</span>
                  <span class="cta-text">Open Folder</span>
                  <span class="cta-kbd">Ctrl+O</span>
                </button>
                @if (workspaceService.isDesktop()) {
                  <button
                    type="button"
                    class="open-path-cta"
                    (click)="workspaceService.openModal('open-folder-path')"
                    title="Open Folder by Path"
                  >
                    ⌨ Open by Path...
                  </button>
                }
              </div>

              <!-- 3. Squares with names of recent folders -->
              @if (workspaceService.recentWorkspaces().length > 0) {
                <div class="recent-tiles-section">
                  <span class="recent-section-title">Recent Folders</span>
                  <div class="recent-tiles-grid">
                    @for (item of workspaceService.recentWorkspaces(); track item.path) {
                      <div
                        class="recent-tile"
                        (click)="workspaceService.openRecentByPath(item.path)"
                        [title]="item.path"
                      >
                        <button
                          type="button"
                          class="tile-remove-btn"
                          (click)="workspaceService.removeRecentWorkspace(item.path, $event)"
                          title="Remove from recent"
                        >
                          ×
                        </button>
                        <div class="tile-icon-box">
                          <svg class="tile-folder-svg" width="36" height="36" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.826a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31zM2.19 4a1 1 0 0 0-.996 1.09l.637 7a1 1 0 0 0 .995.91h10.348a1 1 0 0 0 .995-.91l.637-7A1 1 0 0 0 13.81 4H2.19zm4.69-1.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139C1.72 3.042 1.95 3 2.19 3h7.638a3.003 3.003 0 0 1-.947-.707L8.053 1.465A1 1 0 0 0 7.34 1H6.172a1 1 0 0 0-.707.293L4.757 2.293z"/>
                          </svg>
                        </div>
                        <span class="tile-name">{{ item.name }}</span>
                        <span class="tile-path">{{ item.path }}</span>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          </div>
        }

        <div
          #editorContainer
          class="monaco-host"
          [class.hidden-pane]="workspaceService.diffModeActive() || activeFileIsImage()"
        ></div>
        <div
          #diffContainer
          class="monaco-diff-host"
          [class.hidden-pane]="!workspaceService.diffModeActive() || activeFileIsImage()"
        ></div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .editor-wrapper {
        width: 100%;
        height: 100%;
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        background-color: var(--bg-editor, #ffffff);
      }
      .editor-stage {
        flex: 1;
        width: 100%;
        height: 100%;
        position: relative;
        min-height: 0;
        overflow: hidden;
      }
      .monaco-host,
      .monaco-diff-host {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        visibility: visible;
        pointer-events: auto;
        z-index: 1;

        &.hidden-pane {
          visibility: hidden;
          pointer-events: none;
          z-index: 0;
        }
      }

      /* Image Viewer */
      .image-viewer-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background-color: var(--bg-editor, #ffffff);
        z-index: 2;
        overflow: hidden;

        .image-viewer-toolbar {
          height: 42px;
          min-height: 42px;
          background-color: var(--bg-tabs-bar, #ececec);
          border-bottom: 1px solid var(--border-color, #e5e5e5);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          user-select: none;
          gap: 12px;

          .img-left-meta {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 13.5px;

            .img-badge {
              background: linear-gradient(135deg, #10b981, #059669);
              color: #ffffff;
              font-size: 11px;
              font-weight: 800;
              letter-spacing: 0.5px;
              padding: 2px 7px;
              border-radius: 4px;
              display: inline-flex;
              align-items: center;
              gap: 5px;

              .img-badge-svg {
                width: 13px;
                height: 13px;
                display: block;
              }
            }

            .img-filename {
              font-weight: 600;
              color: var(--text-primary, #1e1e1e);
            }

            .img-dims,
            .img-size {
              font-size: 12px;
              color: var(--text-muted, #717171);
              background-color: rgba(0, 0, 0, 0.05);
              padding: 2px 8px;
              border-radius: 10px;
            }
          }

          .img-zoom-toolbar {
            display: flex;
            align-items: center;
            gap: 6px;

            .img-tool-btn {
              background-color: var(--bg-btn, #ffffff);
              border: 1px solid var(--border-color, #cccccc);
              color: var(--text-primary, #333333);
              font-size: 13px;
              font-weight: 600;
              padding: 4px 10px;
              border-radius: 4px;
              cursor: pointer;
              transition: all 0.15s ease;

              &:hover {
                background-color: var(--bg-btn-hover, #e6e6e6);
                border-color: #999999;
              }
            }

            .img-zoom-label {
              font-size: 12.5px;
              font-weight: 600;
              color: var(--text-secondary, #555555);
              min-width: 45px;
              text-align: center;
            }
          }
        }

        .image-stage-viewport {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: auto;
          padding: 24px;
          background-color: var(--bg-editor, #ffffff);

          .checkerboard-backdrop {
            background-color: #ffffff;
            background-image:
              linear-gradient(45deg, #e4e4e4 25%, transparent 25%),
              linear-gradient(-45deg, #e4e4e4 25%, transparent 25%),
              linear-gradient(45deg, transparent 75%, #e4e4e4 75%),
              linear-gradient(-45deg, transparent 75%, #e4e4e4 75%);
            background-size: 20px 20px;
            background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
            padding: 16px;
            border-radius: 6px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
            display: inline-flex;
            align-items: center;
            justify-content: center;

            .previewed-image {
              max-width: 100%;
              max-height: 100%;
              object-fit: contain;
              transition: transform 0.1s ease-out;
              transform-origin: center center;
              image-rendering: auto;
            }
          }

          .img-loading {
            display: flex;
            align-items: center;
            gap: 10px;
            color: var(--text-muted, #717171);
            font-size: 14px;

            .mini-spinner {
              width: 18px;
              height: 18px;
              border: 2px solid rgba(0, 122, 204, 0.2);
              border-top-color: #007acc;
              border-radius: 50%;
              animation: spin 0.8s linear infinite;
            }
          }
        }
      }

      :host-context(body.theme-dark) {
        .image-stage-viewport .checkerboard-backdrop {
          background-color: #252526;
          background-image:
            linear-gradient(45deg, #333333 25%, transparent 25%),
            linear-gradient(-45deg, #333333 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #333333 75%),
            linear-gradient(-45deg, transparent 75%, #333333 75%);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        }
      }

      /* Meld-style Diff Toolbar */
      .meld-diff-toolbar {
        height: 46px;
        min-height: 46px;
        background-color: var(--bg-tabs-bar, #ececec);
        border-bottom: 1px solid var(--border-color, #e5e5e5);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 14px;
        user-select: none;
        gap: 14px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

        .diff-left-section {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;

          .meld-tag {
            background: linear-gradient(135deg, #007acc, #005a9e);
            color: #ffffff;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.5px;
            padding: 3px 8px;
            border-radius: 4px;
          }

          .diff-file-name {
            font-size: 14.5px;
            font-weight: 600;
            color: var(--text-primary, #1e1e1e);
            white-space: nowrap;
          }

          .diff-status-badge {
            font-size: 12px;
            font-weight: 700;
            padding: 2px 7px;
            border-radius: 4px;

            &.status-m {
              background-color: rgba(217, 119, 6, 0.15);
              color: #d97706;
            }

            &.status-a {
              background-color: rgba(22, 163, 74, 0.15);
              color: #16a34a;
            }

            &.status-u {
              background-color: rgba(16, 185, 129, 0.15);
              color: #10b981;
            }
          }

          .diff-chunk-pill {
            font-size: 12px;
            color: var(--text-muted, #717171);
            background-color: rgba(0, 0, 0, 0.05);
            padding: 2px 8px;
            border-radius: 10px;
          }
        }

        .diff-center-headers {
          display: flex;
          align-items: center;
          gap: 14px;

          .pane-header {
            display: flex;
            align-items: center;
            gap: 7px;
            font-size: 13.5px;
            font-weight: 600;

            .legend-indicator {
              font-size: 13px;

              &.red {
                color: #d32f2f;
              }

              &.green {
                color: #2e7d32;
              }
            }

            .pane-title {
              color: var(--text-primary, #333333);
            }

            .pane-tag {
              font-size: 11px;
              padding: 2px 6px;
              border-radius: 3px;
              background-color: rgba(0, 0, 0, 0.06);
              color: var(--text-muted, #666666);
              font-weight: normal;

              &.editable {
                background-color: rgba(46, 125, 50, 0.12);
                color: #2e7d32;
                font-weight: 600;
              }
            }
          }

          .pane-separator {
            color: var(--text-muted, #888888);
            font-size: 15px;
          }
        }

        .diff-right-actions {
          display: flex;
          align-items: center;
          gap: 8px;

          .diff-action-btn {
            background-color: var(--bg-btn, #ffffff);
            border: 1px solid var(--border-color, #cccccc);
            color: var(--text-primary, #333333);
            font-size: 13px;
            font-weight: 500;
            padding: 5px 12px;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s ease;

            &:hover {
              background-color: var(--bg-btn-hover, #e6e6e6);
              border-color: #999999;
            }

            .btn-icon {
              font-size: 14px;
            }

            &.view-toggle-btn.active {
              background-color: var(--bg-item-active, #e2effd);
              border-color: #007acc;
              color: #007acc;
            }

            &.revert-btn:hover {
              background-color: #fee2e2;
              border-color: #ef4444;
              color: #b91c1c;
            }

            &.close-btn:hover {
              background-color: var(--bg-item-hover, #f0f0f0);
              color: #1e1e1e;
            }
          }
        }
      }

      .welcome-stage {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow-y: auto;
        background-color: var(--bg-editor, #1e1e1e);
        user-select: none;
        z-index: 10;
        padding: 40px 20px;

        .welcome-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          max-width: 680px;
          width: 100%;
          text-align: center;
          margin: auto;

          .logo-wrapper {
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 24px;

            .welcome-logo {
              display: block;
              filter: drop-shadow(0 6px 18px rgba(0, 0, 0, 0.25));
              transition: transform 0.25s ease;

              &:hover {
                transform: scale(1.05);
              }
            }
          }

          .welcome-main-action {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            margin-bottom: 36px;

            .open-folder-cta {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              gap: 12px;
              padding: 12px 32px;
              font-size: 15px;
              font-family: inherit;
              font-weight: 600;
              color: #ffffff;
              background-color: #007acc;
              border: 1px solid #007acc;
              border-radius: 6px;
              cursor: pointer;
              box-shadow: 0 4px 14px rgba(0, 122, 204, 0.35);
              transition: all 0.18s ease;

              &:hover {
                background-color: #0062a3;
                border-color: #0062a3;
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(0, 122, 204, 0.45);
              }

              .cta-icon {
                font-size: 18px;
              }

              .cta-text {
                letter-spacing: 0.3px;
              }

              .cta-kbd {
                font-size: 11px;
                opacity: 0.85;
                background: rgba(255, 255, 255, 0.16);
                padding: 2px 7px;
                border-radius: 4px;
              }
            }

            .open-path-cta {
              background: transparent;
              border: none;
              color: var(--text-muted, #8c8c8c);
              font-size: 12px;
              font-family: inherit;
              cursor: pointer;
              text-decoration: underline;
              padding: 4px 8px;
              transition: color 0.15s ease;

              &:hover {
                color: #007acc;
              }
            }
          }

          .recent-tiles-section {
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 100%;
            border-top: 1px solid var(--border-color, #2b2b2b);
            padding-top: 26px;

            .recent-section-title {
              font-size: 12px;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 1px;
              color: var(--text-muted, #8c8c8c);
              margin-bottom: 18px;
            }

            .recent-tiles-grid {
              display: flex;
              flex-wrap: wrap;
              justify-content: center;
              gap: 16px;
              max-width: 640px;
              width: 100%;

              .recent-tile {
                width: 136px;
                height: 136px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 16px 10px;
                background-color: var(--bg-sidebar, #252526);
                border: 1px solid var(--border-color, #333333);
                border-radius: 10px;
                cursor: pointer;
                position: relative;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);

                &:hover {
                  border-color: #007acc;
                  transform: translateY(-4px);
                  box-shadow: 0 8px 22px rgba(0, 122, 204, 0.25);
                  background-color: var(--bg-item-hover, #2a2d2e);

                  .tile-remove-btn {
                    opacity: 1;
                  }
                }

                .tile-remove-btn {
                  position: absolute;
                  top: 6px;
                  right: 6px;
                  width: 20px;
                  height: 20px;
                  border-radius: 50%;
                  border: none;
                  background: rgba(128, 128, 128, 0.15);
                  color: var(--text-muted, #8c8c8c);
                  font-size: 13px;
                  line-height: 1;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  cursor: pointer;
                  opacity: 0;
                  transition: all 0.15s ease;

                  &:hover {
                    background: #e53935;
                    color: #ffffff;
                  }
                }

                .tile-icon-box {
                  width: 44px;
                  height: 44px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  color: var(--color-icon-folder, #dcb67a);
                  margin-bottom: 10px;

                  .tile-folder-svg {
                    width: 36px;
                    height: 36px;
                    display: block;
                  }
                }

                .tile-name {
                  font-size: 13px;
                  font-weight: 600;
                  color: var(--text-primary, #e0e0e0);
                  max-width: 114px;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  white-space: nowrap;
                  margin-bottom: 4px;
                }

                .tile-path {
                  font-size: 10px;
                  color: var(--text-muted, #8c8c8c);
                  max-width: 114px;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  white-space: nowrap;
                }
              }
            }
          }
        }
      }
    `,
  ],
})
export class EditorComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('editorContainer', { static: true })
  private editorContainer!: ElementRef<HTMLDivElement>;

  @ViewChild('diffContainer', { static: true })
  private diffContainer!: ElementRef<HTMLDivElement>;

  public workspaceService = inject(WorkspaceService);
  public zoomService = inject(ZoomService);
  private inlineCompletionService = inject(InlineCompletionService);
  private themeService = inject(ThemeService);

  public readonly cursorChange = output<{ line: number; column: number }>();
  public readonly diffChunkCount = signal<number>(0);

  // Image viewer state
  readonly Math = Math;
  public imageZoom = signal<number>(1.0);
  public imageDimensions = signal<{ width: number; height: number } | null>(null);

  readonly activeFileIsImage = computed(() => {
    const f = this.workspaceService.activeFile();
    if (!f) return null;
    if (f.isImage || isImageFile(f.name)) return f;
    return null;
  });

  private editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;
  private diffEditorInstance: monaco.editor.IStandaloneDiffEditor | null = null;
  private fileModels = new Map<string, monaco.editor.ITextModel>();
  private originalDiffModels = new Map<string, monaco.editor.ITextModel>();
  private resizeObserver: ResizeObserver | null = null;
  private isProgrammaticUpdate = false;

  constructor() {
    // Effect to switch active file in Monaco or reset image viewer
    effect(
      () => {
        const active = this.workspaceService.activeFile();
        if (active) {
          if (active.isImage || isImageFile(active.name)) {
            this.imageZoom.set(1.0);
            this.imageDimensions.set(null);
          } else if (this.editorInstance) {
            this.switchToFile(active);
          }
        }
      },
      { allowSignalWrites: true }
    );

    // Effect to reactively update editor font size when zoom changes
    effect(() => {
      const fontSize = this.zoomService.editorFontSize();
      const lineHeight = Math.round(fontSize * 1.5);
      if (this.editorInstance) {
        this.editorInstance.updateOptions({
          fontSize,
          lineHeight,
        });
      }
      if (this.diffEditorInstance) {
        this.diffEditorInstance.getOriginalEditor().updateOptions({
          fontSize,
          lineHeight,
        });
        this.diffEditorInstance.getModifiedEditor().updateOptions({
          fontSize,
          lineHeight,
        });
      }
    });

    // Effect to switch Monaco theme reactively
    effect(() => {
      const theme = this.themeService.currentTheme();
      const monacoTheme = theme === 'light' ? 'vector-light' : 'vector-dark';
      monaco.editor.setTheme(monacoTheme);
    });

    // Effect to handle diff mode and file changes
    effect(() => {
      const isDiff = this.workspaceService.diffModeActive();
      const diffFile = this.workspaceService.activeDiffFile();
      if (isDiff && diffFile) {
        if (!this.diffEditorInstance) {
          this.createDiffEditor();
        }
        this.setupDiffModels(diffFile);
        setTimeout(() => {
          this.diffEditorInstance?.layout();
        }, 0);
      } else {
        setTimeout(() => {
          this.editorInstance?.layout();
        }, 0);
      }
    });

    // Effect to toggle diff renderSideBySide
    effect(() => {
      const sideBySide = this.workspaceService.diffRenderSideBySide();
      if (this.diffEditorInstance) {
        this.diffEditorInstance.updateOptions({
          renderSideBySide: sideBySide,
        });
      }
    });

    // Effect to jump to line (e.g. from Grep search)
    effect(() => {
      const jump = this.workspaceService.pendingLineJump();
      if (jump && this.editorInstance) {
        this.editorInstance.revealLineInCenter(jump.lineNumber);
        this.editorInstance.setPosition({ lineNumber: jump.lineNumber, column: jump.column || 1 });
        this.editorInstance.focus();
        this.workspaceService.pendingLineJump.set(null);
      }
    });

    // Effect to toggle Sticky Scroll dynamically
    effect(() => {
      const enabled = this.workspaceService.stickyScrollEnabled();
      if (this.editorInstance) {
        this.editorInstance.updateOptions({
          stickyScroll: {
            enabled,
            maxLineCount: 5,
            defaultModel: 'foldingProviderModel',
          },
        });
      }
    });

    // Effect to update Monaco model language
    effect(() => {
      const change = this.workspaceService.pendingLanguageChange();
      if (change && this.editorInstance) {
        const model = this.fileModels.get(change.fileId);
        if (model) {
          monaco.editor.setModelLanguage(model, change.language);
        }
        this.workspaceService.pendingLanguageChange.set(null);
      }
    });

    // Effect to trigger redetect indentation for active file on demand
    effect(
      () => {
        const fileId = this.workspaceService.pendingRedetectIndentation();
        if (fileId && this.editorInstance) {
          const model = this.fileModels.get(fileId);
          const active = this.workspaceService.activeFile();
          if (model && active && active.id === fileId) {
            const defInsertSpaces = this.workspaceService.defaultIndentType() === 'spaces';
            const defTabSize = this.workspaceService.defaultTabSize();
            model.detectIndentation(defInsertSpaces, defTabSize);
            this.syncIndentationFromModel(model, active);
          }
          this.workspaceService.pendingRedetectIndentation.set(null);
        }
      },
      { allowSignalWrites: true }
    );

    // Effect to update indentation options
    effect(() => {
      const isTabs = this.workspaceService.indentType() === 'tabs';
      const size = this.workspaceService.tabSize();
      if (this.editorInstance) {
        this.editorInstance.updateOptions({
          insertSpaces: !isTabs,
          tabSize: size,
        });
        const model = this.editorInstance.getModel();
        if (model) {
          const currentOpts = model.getOptions();
          if (currentOpts.insertSpaces !== !isTabs || currentOpts.tabSize !== size) {
            model.updateOptions({
              insertSpaces: !isTabs,
              tabSize: size,
            });
          }
        }
      }
      if (this.diffEditorInstance) {
        this.diffEditorInstance.getOriginalEditor().updateOptions({
          insertSpaces: !isTabs,
          tabSize: size,
        });
        this.diffEditorInstance.getModifiedEditor().updateOptions({
          insertSpaces: !isTabs,
          tabSize: size,
        });
      }
    });
  }

  ngOnInit(): void {
    this.initMonacoEnvironment();
    registerOmniFlux(monaco);
    registerAllLanguageSnippets(monaco);
    this.inlineCompletionService.registerProviders(monaco);
    this.setupThemes();
    this.createEditor();
    this.createDiffEditor();
  }

  ngAfterViewInit(): void {
    requestAnimationFrame(() => {
      this.editorInstance?.layout();
      this.diffEditorInstance?.layout();
    });
  }

  ngOnDestroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    for (const model of this.fileModels.values()) {
      model.dispose();
    }
    this.fileModels.clear();

    for (const model of this.originalDiffModels.values()) {
      model.dispose();
    }
    this.originalDiffModels.clear();

    this.editorInstance?.dispose();
    this.diffEditorInstance?.dispose();
  }

  private initMonacoEnvironment(): void {
    if (typeof window !== 'undefined' && !(window as any).MonacoEnvironment) {
      (window as any).MonacoEnvironment = {
        getWorker: (_: any, label: string) => {
          if (label === 'json') {
            return new Worker(new URL('../../workers/json.worker', import.meta.url), {
              type: 'module',
            });
          }
          if (label === 'css' || label === 'scss' || label === 'less') {
            return new Worker(new URL('../../workers/css.worker', import.meta.url), {
              type: 'module',
            });
          }
          if (label === 'html' || label === 'handlebars' || label === 'razor') {
            return new Worker(new URL('../../workers/html.worker', import.meta.url), {
              type: 'module',
            });
          }
          if (label === 'typescript' || label === 'javascript') {
            return new Worker(new URL('../../workers/ts.worker', import.meta.url), {
              type: 'module',
            });
          }
          return new Worker(new URL('../../workers/editor.worker', import.meta.url), {
            type: 'module',
          });
        },
      };

      // Configure TypeScript & JavaScript defaults for IntelliSense & diagnostics
      const tsLang = (monaco.languages as any).typescript;
      if (tsLang) {
        tsLang.typescriptDefaults?.setDiagnosticsOptions({
          noSemanticValidation: false,
          noSyntaxValidation: false,
        });
        tsLang.javascriptDefaults?.setDiagnosticsOptions({
          noSemanticValidation: false,
          noSyntaxValidation: false,
        });
        tsLang.typescriptDefaults?.setCompilerOptions({
          target: 99, // ESNext
          allowNonTextExtensions: true,
          moduleResolution: 2, // NodeJs
          module: 1, // CommonJS
          noEmit: true,
          esModuleInterop: true,
          allowJs: true,
        });
        tsLang.javascriptDefaults?.setCompilerOptions({
          target: 99, // ESNext
          allowNonTextExtensions: true,
          moduleResolution: 2, // NodeJs
          module: 1, // CommonJS
          noEmit: true,
          esModuleInterop: true,
          allowJs: true,
        });
      }
    }
  }

  private setupThemes(): void {
    // Light theme (Default)
    monaco.editor.defineTheme('vector-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'keyword.routing', foreground: '006699', fontStyle: 'bold' },
        { token: 'keyword.other.http', foreground: '795E26', fontStyle: 'bold' },
        { token: 'variable.name', foreground: '001080' },
        { token: 'support.function', foreground: '795E26' },
        { token: 'keyword', foreground: 'AF00DB' },
        { token: 'storage.type', foreground: '0000FF' },
        { token: 'string', foreground: 'A31515' },
        { token: 'number', foreground: '098658' },
        { token: 'comment', foreground: '008000', fontStyle: 'italic' },
      ],
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#1e1e1e',
        'editorCursor.foreground': '#000000',
        'editor.lineHighlightBackground': '#f5f5f5',
        'editorLineNumber.foreground': '#237893',
        'editorLineNumber.activeForeground': '#0b216f',
        'editor.selectionBackground': '#add6ff',
        'editor.inactiveSelectionBackground': '#e5ebf1',
        // VS Code style diff colors
        'diffEditor.insertedTextBackground': 'rgba(46, 160, 67, 0.35)',
        'diffEditor.insertedLineBackground': 'rgba(46, 160, 67, 0.20)',
        'diffEditor.removedTextBackground': 'rgba(248, 81, 73, 0.28)',
        'diffEditor.removedLineBackground': 'rgba(248, 81, 73, 0.14)',
        'diffEditorGutter.insertedLineGutterBackground': 'rgba(46, 160, 67, 0.50)',
        'diffEditorGutter.removedLineGutterBackground': 'rgba(248, 81, 73, 0.45)',
        'diffEditor.diagonalFill': '#efefef',
      },
    });

    // Dark theme
    monaco.editor.defineTheme('vector-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword.routing', foreground: '4EC9B0', fontStyle: 'bold' },
        { token: 'keyword.other.http', foreground: 'DCDCAA', fontStyle: 'bold' },
        { token: 'variable.name', foreground: '9CDCFE' },
        { token: 'support.function', foreground: 'DCDCAA' },
        { token: 'keyword', foreground: 'C586C0' },
        { token: 'storage.type', foreground: '569CD6' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
      ],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#d4d4d4',
        'editorCursor.foreground': '#aeafad',
        'editor.lineHighlightBackground': '#2a2d2e',
        'editorLineNumber.foreground': '#858585',
        'editorLineNumber.activeForeground': '#c6c6c6',
        'editor.selectionBackground': '#264f78',
        'editor.inactiveSelectionBackground': '#3a3d41',
        // VS Code style diff colors
        'diffEditor.insertedTextBackground': 'rgba(46, 160, 67, 0.35)',
        'diffEditor.insertedLineBackground': 'rgba(46, 160, 67, 0.20)',
        'diffEditor.removedTextBackground': 'rgba(248, 81, 73, 0.30)',
        'diffEditor.removedLineBackground': 'rgba(248, 81, 73, 0.15)',
        'diffEditorGutter.insertedLineGutterBackground': 'rgba(46, 160, 67, 0.50)',
        'diffEditorGutter.removedLineGutterBackground': 'rgba(248, 81, 73, 0.45)',
        'diffEditor.diagonalFill': '#2a2d2e',
      },
    });
  }

  private createEditor(): void {
    const active = this.workspaceService.activeFile();
    const initialModel = active ? this.getOrCreateModel(active) : null;

    const initialMonacoTheme =
      this.themeService.currentTheme() === 'light' ? 'vector-light' : 'vector-dark';

    this.editorInstance = monaco.editor.create(this.editorContainer.nativeElement, {
      model: initialModel,
      theme: initialMonacoTheme,
      fontSize: this.zoomService.editorFontSize(),
      fontWeight: '500',
      lineHeight: Math.round(this.zoomService.editorFontSize() * 1.5),
      mouseWheelZoom: true,
      wordWrap: 'on',
      tabSize: 4,
      insertSpaces: false,
      detectIndentation: true,
      fontFamily:
        "'Consolas', 'Ubuntu Mono', 'DejaVu Sans Mono', 'Noto Sans Hebrew', 'Courier New', monospace",
      fontLigatures: true,
      lineNumbers: 'on',
      roundedSelection: false,
      scrollBeyondLastLine: false,
      readOnly: false,
      cursorBlinking: 'smooth',
      smoothScrolling: true,
      contextmenu: true,
      minimap: { enabled: true },
      automaticLayout: false,
      inlineSuggest: {
        enabled: true,
        mode: 'subwordSmart',
        showToolbar: 'always',
      },
      suggest: {
        preview: true,
        showIcons: true,
        snippetsPreventQuickSuggestions: false,
      },
      quickSuggestions: {
        other: true,
        comments: true,
        strings: true,
      },
      suggestOnTriggerCharacters: true,
      tabCompletion: 'on',
      acceptSuggestionOnEnter: 'on',
      wordBasedSuggestions: 'allDocuments',
      snippetSuggestions: 'top',
      stickyScroll: {
        enabled: true,
        maxLineCount: 5,
        defaultModel: 'foldingProviderModel',
      },
    });

    // Listen to cursor position changes
    this.editorInstance.onDidChangeCursorPosition((e) => {
      this.cursorChange.emit({
        line: e.position.lineNumber,
        column: e.position.column,
      });
    });

    // Listen to content changes
    this.editorInstance.onDidChangeModelContent(() => {
      if (this.isProgrammaticUpdate) return;
      const activeFile = this.workspaceService.activeFile();
      if (activeFile && this.editorInstance) {
        const val = this.editorInstance.getValue();
        this.workspaceService.updateContent(activeFile.id, val);
        const model = this.editorInstance.getModel();
        if (
          model &&
          (activeFile.language === 'plaintext' || model.getLanguageId() === 'plaintext') &&
          val.length < 50000
        ) {
          const detected = detectLanguage(activeFile.name, val);
          if (detected !== 'plaintext' && detected !== model.getLanguageId()) {
            activeFile.language = detected;
            monaco.editor.setModelLanguage(model, detected);
            this.workspaceService.updateFileLanguage(activeFile.id, detected);
          }
        }
      }
    });

    // Keyboard shortcut: Ctrl+S (Cmd+S) to save active file
    this.editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      this.workspaceService.saveCurrentFile();
    });

    // Keyboard shortcuts for Zoom In / Out / Reset
    this.editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Equal, () => {
      this.zoomService.zoomIn();
    });
    this.editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Minus, () => {
      this.zoomService.zoomOut();
    });
    this.editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Digit0, () => {
      this.zoomService.resetZoom();
    });
    this.editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.NumpadAdd, () => {
      this.zoomService.zoomIn();
    });
    this.editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.NumpadSubtract, () => {
      this.zoomService.zoomOut();
    });
    this.editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Numpad0, () => {
      this.zoomService.resetZoom();
    });

    // Precision resize handling for both standard and diff editor
    this.resizeObserver = new ResizeObserver(() => {
      this.editorInstance?.layout();
      this.diffEditorInstance?.layout();
    });
    this.resizeObserver.observe(this.editorContainer.nativeElement);
    this.resizeObserver.observe(this.diffContainer.nativeElement);
  }

  private createDiffEditor(): void {
    if (this.diffEditorInstance) return;

    const initialTheme =
      this.themeService.currentTheme() === 'light' ? 'vector-light' : 'vector-dark';

    this.diffEditorInstance = monaco.editor.createDiffEditor(this.diffContainer.nativeElement, {
      theme: initialTheme,
      fontSize: this.zoomService.editorFontSize(),
      fontWeight: '500',
      lineHeight: Math.round(this.zoomService.editorFontSize() * 1.5),
      mouseWheelZoom: true,
      wordWrap: 'on',
      fontFamily:
        "'Consolas', 'Ubuntu Mono', 'DejaVu Sans Mono', 'Noto Sans Hebrew', 'Courier New', monospace",
      fontLigatures: true,
      lineNumbers: 'on',
      roundedSelection: false,
      scrollBeyondLastLine: false,
      readOnly: false,
      originalEditable: false,
      renderSideBySide: this.workspaceService.diffRenderSideBySide(),
      enableSplitViewResizing: true,
      splitViewDefaultRatio: 0.5,
      cursorBlinking: 'smooth',
      smoothScrolling: true,
      contextmenu: true,
      automaticLayout: true,
      diffWordWrap: 'on',
      renderIndicators: true,
      ignoreTrimWhitespace: false,
    });

    const isTabs = this.workspaceService.indentType() === 'tabs';
    const size = this.workspaceService.tabSize();
    this.diffEditorInstance.getOriginalEditor().updateOptions({
      insertSpaces: !isTabs,
      tabSize: size,
    });
    this.diffEditorInstance.getModifiedEditor().updateOptions({
      insertSpaces: !isTabs,
      tabSize: size,
    });

    // Modified editor content changes sync back to WorkspaceService
    this.diffEditorInstance.getModifiedEditor().onDidChangeModelContent(() => {
      const activeDiff = this.workspaceService.activeDiffFile();
      if (activeDiff && this.diffEditorInstance) {
        const val = this.diffEditorInstance.getModifiedEditor().getValue();
        this.workspaceService.updateContent(activeDiff.id, val);
      }
    });

    // Cursor position in modified editor
    this.diffEditorInstance.getModifiedEditor().onDidChangeCursorPosition((e) => {
      this.cursorChange.emit({
        line: e.position.lineNumber,
        column: e.position.column,
      });
    });

    // Track diff changes count
    this.diffEditorInstance.onDidUpdateDiff(() => {
      const changes = this.diffEditorInstance?.getLineChanges();
      this.diffChunkCount.set(changes ? changes.length : 0);
    });

    // Ctrl+S shortcut to save file while in diff view
    this.diffEditorInstance.getModifiedEditor().addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => {
        this.workspaceService.saveCurrentFile();
      }
    );

    // Zoom shortcuts for diff editor
    this.diffEditorInstance.getModifiedEditor().addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Equal,
      () => {
        this.zoomService.zoomIn();
      }
    );
    this.diffEditorInstance.getModifiedEditor().addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Minus,
      () => {
        this.zoomService.zoomOut();
      }
    );
    this.diffEditorInstance.getModifiedEditor().addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Digit0,
      () => {
        this.zoomService.resetZoom();
      }
    );
  }

  private setupDiffModels(file: WorkspaceFile): void {
    if (!this.diffEditorInstance) return;

    // Modified model (Working tree)
    const modModel = this.getOrCreateModel(file);
    if (modModel.getValue() !== file.content) {
      modModel.setValue(file.content);
    }

    // Original model (HEAD baseline)
    const safeId = encodeURIComponent(file.id || file.path || file.name);
    const origUri = monaco.Uri.parse(`inmemory://diff-original/${safeId}`);
    let origModel = this.originalDiffModels.get(file.id);
    const originalText = file.originalContent !== undefined ? file.originalContent : file.content;

    if (!origModel) {
      const existing = monaco.editor.getModel(origUri);
      if (existing) {
        origModel = existing;
      } else {
        origModel = monaco.editor.createModel(originalText, file.language, origUri);
      }
      const modOpts = modModel.getOptions();
      origModel.updateOptions({
        insertSpaces: modOpts.insertSpaces,
        tabSize: modOpts.tabSize,
      });
      this.originalDiffModels.set(file.id, origModel);
    }

    if (origModel.getValue() !== originalText) {
      origModel.setValue(originalText);
    }

    this.diffEditorInstance.setModel({
      original: origModel,
      modified: modModel,
    });

    requestAnimationFrame(() => {
      this.diffEditorInstance?.layout();
      this.diffEditorInstance?.getOriginalEditor().layout();
      this.diffEditorInstance?.getModifiedEditor().layout();
    });
  }

  public discardChanges(fileId: string): void {
    this.workspaceService.revertFile(fileId);
    const file = this.workspaceService.files().find((f) => f.id === fileId);
    if (file) {
      const modModel = this.fileModels.get(fileId);
      if (modModel && file.originalContent !== undefined) {
        modModel.setValue(file.originalContent);
      }
      this.workspaceService.closeDiffView();
    }
  }

  private switchToFile(file: WorkspaceFile): void {
    if (!this.editorInstance) return;
    this.isProgrammaticUpdate = true;
    try {
      const model = this.getOrCreateModel(file);
      if (this.editorInstance.getModel() !== model) {
        this.editorInstance.setModel(model);
        this.editorInstance.focus();
      }
      const content = file.content ?? '';
      if (model.getValue() !== content) {
        const viewState = this.editorInstance.saveViewState();
        model.setValue(content);
        if (viewState) {
          this.editorInstance.restoreViewState(viewState);
        }
        if (!file.isIndentationCustom) {
          const defInsertSpaces = this.workspaceService.defaultIndentType() === 'spaces';
          const defTabSize = this.workspaceService.defaultTabSize();
          model.detectIndentation(defInsertSpaces, defTabSize);
        }
      }

      // Detect language from content if currently plaintext
      const currentContent = file.content ?? model.getValue();
      if ((file.language === 'plaintext' || model.getLanguageId() === 'plaintext') && currentContent) {
        const detected = detectLanguage(file.name, currentContent);
        if (detected !== 'plaintext' && detected !== model.getLanguageId()) {
          file.language = detected;
          monaco.editor.setModelLanguage(model, detected);
          this.workspaceService.updateFileLanguage(file.id, detected);
        }
      }

      this.syncIndentationFromModel(model, file);
    } catch (err) {
      console.error('Error switching to file in Monaco:', err);
    } finally {
      this.isProgrammaticUpdate = false;
    }

    this.editorInstance.layout();
    requestAnimationFrame(() => {
      this.editorInstance?.layout();
    });
    setTimeout(() => {
      this.editorInstance?.layout();
    }, 50);
  }

  private getOrCreateModel(file: WorkspaceFile): monaco.editor.ITextModel {
    let model = this.fileModels.get(file.id);
    if (!model) {
      const safeId = encodeURIComponent(file.id || file.path || file.name);
      const uri = monaco.Uri.parse(`inmemory://workspace/${safeId}`);
      const existing = monaco.editor.getModel(uri);

      let initialLang = file.language || 'plaintext';
      if (initialLang === 'plaintext' && file.content) {
        const detected = detectLanguage(file.name, file.content);
        if (detected !== 'plaintext') {
          initialLang = detected;
          file.language = detected;
        }
      }

      const textModel: monaco.editor.ITextModel =
        existing ?? monaco.editor.createModel(file.content ?? '', initialLang, uri);

      if (file.isIndentationCustom && file.tabSize !== undefined) {
        textModel.updateOptions({
          insertSpaces: file.indentType === 'spaces',
          tabSize: file.tabSize,
        });
      } else {
        const defInsertSpaces = this.workspaceService.defaultIndentType() === 'spaces';
        const defTabSize = this.workspaceService.defaultTabSize();
        textModel.detectIndentation(defInsertSpaces, defTabSize);
      }

      textModel.onDidChangeOptions(() => {
        const active = this.workspaceService.activeFile();
        if (active && active.id === file.id) {
          this.syncIndentationFromModel(textModel, active);
        }
      });

      model = textModel;
      this.fileModels.set(file.id, model);
    }
    return model;
  }

  private syncIndentationFromModel(model: monaco.editor.ITextModel, file: WorkspaceFile): void {
    const opts = model.getOptions();
    const type: 'tabs' | 'spaces' = opts.insertSpaces ? 'spaces' : 'tabs';
    const size = opts.tabSize;
    file.indentType = type;
    file.tabSize = size;
    queueMicrotask(() => {
      this.workspaceService.syncActiveIndentation(type, size);
    });
  }

  public zoomImgIn(): void {
    const next = Math.min(5.0, Math.round((this.imageZoom() + 0.2) * 10) / 10);
    this.imageZoom.set(next);
  }

  public zoomImgOut(): void {
    const next = Math.max(0.2, Math.round((this.imageZoom() - 0.2) * 10) / 10);
    this.imageZoom.set(next);
  }

  public resetImgZoom(): void {
    this.imageZoom.set(1.0);
  }

  public fitImgToWindow(): void {
    this.imageZoom.set(0.85);
  }

  public onImgWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.deltaY < 0) {
      this.zoomImgIn();
    } else {
      this.zoomImgOut();
    }
  }

  public onImgLoad(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img) {
      this.imageDimensions.set({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    }
  }

  public formatFileSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
}
