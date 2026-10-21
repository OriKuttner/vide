import {
  Component,
  ElementRef,
  ViewChild,
  inject,
  signal,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WorkspaceService, GrepResult } from '../../services/workspace.service';
import { AiService } from '../../services/ai.service';
import { WorkspaceFile, isOmniFluxFile, isPhpFile, isPerlFile } from '../../models/file.model';

export interface LanguageItem {
  id: string;
  name: string;
  badge: string;
  extensions: string;
}

const SUPPORTED_LANGUAGES: LanguageItem[] = [
  { id: 'omniflux', name: 'OmniFlux', badge: 'OF', extensions: '.of' },
  { id: 'php', name: 'PHP', badge: 'PHP', extensions: '.php' },
  { id: 'typescript', name: 'TypeScript', badge: 'TS', extensions: '.ts, .tsx' },
  { id: 'javascript', name: 'JavaScript', badge: 'JS', extensions: '.js, .jsx, .mjs' },
  { id: 'perl', name: 'Perl', badge: 'PL', extensions: '.pl, .pm' },
  { id: 'c', name: 'C', badge: 'C', extensions: '.c, .h' },
  { id: 'cpp', name: 'C++', badge: 'C++', extensions: '.cpp, .cc, .hpp' },
  { id: 'json', name: 'JSON', badge: '{}', extensions: '.json' },
  { id: 'html', name: 'HTML', badge: '<>', extensions: '.html, .htm' },
  { id: 'css', name: 'CSS', badge: '#', extensions: '.css, .scss' },
  { id: 'markdown', name: 'Markdown', badge: 'MD', extensions: '.md' },
  { id: 'shell', name: 'Bash / Shell', badge: 'SH', extensions: '.sh, .bash' },
  { id: 'python', name: 'Python', badge: 'PY', extensions: '.py, .pyw' },
  { id: 'plaintext', name: 'Plain Text', badge: 'TXT', extensions: '.txt' },
];

@Component({
  selector: 'app-search-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (workspaceService.activeModal()) {
      <div class="modal-backdrop" (click)="close()">
        <div class="modal-card" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <span class="modal-title">{{ getTitle() }}</span>
            <button class="close-x" (click)="close()">×</button>
          </div>

          @if (workspaceService.activeModal() !== 'indentation' && workspaceService.activeModal() !== 'unsaved-changes' && workspaceService.activeModal() !== 'ai-settings' && workspaceService.activeModal() !== 'ai-download' && workspaceService.activeModal() !== 'delete-file-confirm' && workspaceService.activeModal() !== 'git-untrack-confirm') {
            <div class="input-container">
              <label class="input-label" [for]="'modal-search-input'">{{ getLabel() }}</label>
              <input
                id="modal-search-input"
                #inputField
                type="text"
                class="modal-input"
                [ngModel]="inputValue()"
                (ngModelChange)="onInputChange($event)"
                (keydown.enter)="onEnter()"
                (keydown.escape)="close()"
              />
            </div>
          }

          @if (workspaceService.activeModal() === 'unsaved-changes' && workspaceService.pendingUnsavedFile(); as unsavedFile) {
            <div class="unsaved-modal-body">
              <div class="unsaved-warning-icon">
                <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div class="unsaved-message-box">
                <h3 class="unsaved-title">Do you want to save the changes you made to "{{ unsavedFile.name }}"?</h3>
                <p class="unsaved-desc">Your changes will be lost if you don't save them.</p>
              </div>
            </div>
            <div class="action-footer unsaved-footer">
              <button type="button" class="btn btn-secondary" (click)="cancelUnsavedClose()">Cancel</button>
              <button type="button" class="btn btn-danger" (click)="discardAndClose()">Don't Save</button>
              <button type="button" class="btn btn-primary" (click)="saveAndClose()">Save</button>
            </div>
          }

          @if (workspaceService.activeModal() === 'delete-file-confirm' && workspaceService.pendingDeleteFile(); as delFile) {
            <div class="unsaved-modal-body">
              <div class="unsaved-warning-icon delete-icon">
                <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="#ef4444" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div class="unsaved-message-box">
                <h3 class="unsaved-title">Delete "{{ delFile.name }}" permanently?</h3>
                <p class="unsaved-desc">Are you sure you want to permanently delete this file from disk? This action cannot be undone.</p>
              </div>
            </div>
            <div class="action-footer unsaved-footer">
              <button type="button" class="btn btn-secondary" (click)="cancelDeleteFile()">Cancel</button>
              <button type="button" class="btn btn-danger" (click)="executeDeleteFile(delFile)">Delete Permanently</button>
            </div>
          }

          @if (workspaceService.activeModal() === 'git-untrack-confirm' && workspaceService.pendingGitUntrackFile(); as untrackFile) {
            <div class="unsaved-modal-body">
              <div class="unsaved-warning-icon untrack-icon">
                <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="#f59e0b" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div class="unsaved-message-box">
                @if (untrackFile.gitStatus === 'untracked') {
                  <h3 class="unsaved-title">Remove untracked file "{{ untrackFile.name }}"?</h3>
                  <p class="unsaved-desc">This file has never been committed. You can add it to .gitignore to keep it on disk, or delete it permanently from disk.</p>
                } @else {
                  <h3 class="unsaved-title">Remove "{{ untrackFile.name }}" from Git tracking?</h3>
                  <p class="unsaved-desc">The file will remain safely on your disk, but will be staged for removal from Git in the next commit and added to .gitignore.</p>
                }
              </div>
            </div>
            <div class="action-footer unsaved-footer">
              <button type="button" class="btn btn-secondary" (click)="cancelGitUntrack()">Cancel</button>
              @if (untrackFile.gitStatus === 'untracked') {
                <button type="button" class="btn btn-danger" (click)="executeDeleteUntrackedFile(untrackFile)">Delete from Disk</button>
                <button type="button" class="btn btn-primary" (click)="executeGitUntrack(untrackFile, true)">Ignore in .gitignore</button>
              } @else {
                <button type="button" class="btn btn-primary" (click)="executeGitUntrack(untrackFile, true)">Remove from Git & Ignore</button>
              }
            </div>
          }

          @if (workspaceService.isIndexing()) {
            <div class="indexing-banner">
              <span class="indexing-pulse">●</span>
              <span>Indexing project in background ({{ workspaceService.indexedFileCount() }} files)...</span>
            </div>
          }

          @if (workspaceService.activeModal() === 'indentation') {
            <div class="config-card">
              <div class="config-section">
                <span class="config-section-title">Indentation Character</span>
                <div class="choice-group">
                  <button
                    type="button"
                    class="choice-btn"
                    [class.selected]="selectedIndentType() === 'tabs'"
                    (click)="selectedIndentType.set('tabs')"
                  >
                    ⇥ Tabs (Real Tab character)
                  </button>
                  <button
                    type="button"
                    class="choice-btn"
                    [class.selected]="selectedIndentType() === 'spaces'"
                    (click)="selectedIndentType.set('spaces')"
                  >
                    ␣ Spaces
                  </button>
                </div>
              </div>

              <div class="config-section">
                <span class="config-section-title">Tab / Indent Size</span>
                <div class="size-group">
                  @for (s of [2, 4, 8]; track s) {
                    <button
                      type="button"
                      class="size-btn"
                      [class.selected]="selectedTabSize() === s"
                      (click)="selectedTabSize.set(s)"
                    >
                      {{ s }} spaces
                    </button>
                  }
                </div>
              </div>

              <div class="action-footer has-left-action">
                <button
                  type="button"
                  class="btn btn-secondary detect-btn"
                  (click)="autoDetectIndentation()"
                  title="Auto-detect indentation from active file content"
                >
                  ⟳ Auto-Detect from File
                </button>
                <div class="footer-buttons">
                  <button type="button" class="btn btn-secondary" (click)="close()">Cancel</button>
                  <button type="button" class="btn btn-primary" (click)="applyIndentation()">Apply</button>
                </div>
              </div>
            </div>
          }

          @if (workspaceService.activeModal() === 'ai-settings') {
            <div class="ai-config-card">
              <div class="ai-status-row">
                <div class="status-indicator-box">
                  <span
                    class="status-dot"
                    [class.online]="aiService.isServerOnline()"
                    [class.offline]="!aiService.isServerOnline()"
                  ></span>
                  <span class="status-text">
                    {{ aiService.isServerOnline() ? 'llama-server is Online & Connected' : 'llama-server is Offline' }}
                  </span>
                </div>
                <button
                  type="button"
                  class="btn-check-health"
                  [disabled]="aiService.isCheckingHealth()"
                  (click)="aiService.checkHealth()"
                >
                  {{ aiService.isCheckingHealth() ? 'Checking...' : '🔄 Check Connection' }}
                </button>
              </div>

              <div class="ai-field-group">
                <label class="ai-label">Server Endpoint URL</label>
                <input
                  type="text"
                  class="ai-input"
                  [ngModel]="aiService.endpoint()"
                  (ngModelChange)="aiService.setEndpoint($event)"
                />
              </div>

              <div class="ai-field-group">
                <label class="ai-label">Model File Path (.gguf)</label>
                <input
                  type="text"
                  class="ai-input"
                  [ngModel]="aiService.modelPath()"
                  (ngModelChange)="aiService.setModelPath($event)"
                />
                <span class="ai-hint">e.g. ~/models/qwen2.5-coder-1.5b-base.Q4_K_M.gguf</span>
              </div>

              <div class="ai-field-group">
                <label class="ai-label">llama-server Binary Path (Optional)</label>
                <input
                  type="text"
                  class="ai-input"
                  [ngModel]="aiService.binaryPath()"
                  (ngModelChange)="aiService.setBinaryPath($event)"
                />
                <span class="ai-hint">Leave blank to search ~/.vide/bin/llama-server or system PATH</span>
              </div>

              <div class="ai-features-box">
                <div class="feature-item">
                  <span class="feature-icon">✨</span>
                  <div class="feature-desc">
                    <strong>Inline Autocomplete (FIM):</strong> Real-time ghost text while typing, press Tab to accept.
                  </div>
                </div>
                <div class="feature-item">
                  <span class="feature-icon">⚡</span>
                  <div class="feature-desc">
                    <strong>Pattern Edit Propagation (Ctrl+Alt+P):</strong> Propagates multi-line edit transformations to following lines.
                  </div>
                </div>
                <div class="feature-item">
                  <span class="feature-icon">💡</span>
                  <div class="feature-desc">
                    <strong>Syntax Quick-Fix:</strong> Automated QuickFix lightbulb on parser and syntax errors.
                  </div>
                </div>
                <div class="feature-item">
                  <span class="feature-icon">📝</span>
                  <div class="feature-desc">
                    <strong>Git Commit Note:</strong> Generates Conventional Commit messages from staged/working diff.
                  </div>
                </div>
              </div>

              <div class="action-footer ai-modal-footer">
                @if (aiService.sidecarStatus()?.running) {
                  <button type="button" class="btn btn-danger" (click)="aiService.stopSidecar()">
                    ⏹ Stop Sidecar (PID: {{ aiService.sidecarStatus()?.pid }})
                  </button>
                } @else {
                  <button type="button" class="btn btn-primary" (click)="startAiSidecar()">
                    ▶ Start llama-server (Sidecar)
                  </button>
                }
                <button
                  type="button"
                  class="btn btn-secondary"
                  (click)="aiService.toggleEnabled()"
                >
                  {{ aiService.isEnabled() ? 'Disable AI Features' : 'Enable AI Features' }}
                </button>
                <button type="button" class="btn btn-secondary" (click)="close()">
                  Close
                </button>
              </div>
            </div>
          }

          @if (workspaceService.activeModal() === 'ai-download') {
            <div class="ai-download-card">
              <div class="ai-download-header-box">
                <div class="ai-download-icon-box">
                  <span class="ai-large-icon">🤖</span>
                </div>
                <div class="ai-download-texts">
                  <h3 class="ai-download-title">Preparing Local AI Engine (Qwen 2.5 Coder)</h3>
                  <p class="ai-download-subtitle">
                    Downloading model weights (~986 MB) for full offline local intelligence.
                  </p>
                </div>
              </div>

              <div class="ai-download-progress-container">
                <div class="progress-bar-track">
                  <div
                    class="progress-bar-fill"
                    [style.width.%]="aiService.downloadProgress()?.percent || 0"
                  ></div>
                </div>

                <div class="progress-status-row">
                  <span class="progress-percent">
                    {{ (aiService.downloadProgress()?.percent || 0).toFixed(1) }}%
                  </span>
                  <span class="progress-bytes">
                    {{ formatBytes(aiService.downloadProgress()?.downloaded_bytes) }} / {{ formatBytes(aiService.downloadProgress()?.total_bytes || 986500000) }}
                  </span>
                </div>
              </div>

              @if (aiService.downloadProgress()?.error) {
                <div class="ai-download-error">
                  ⚠ {{ aiService.downloadProgress()?.error }}
                </div>
              }

              <div class="ai-download-info-note">
                <span class="info-bulb">ℹ</span>
                <span>
                  This download happens only once. Once downloaded, all AI features (Ghost text completions,
                  syntax repairs, and Git commit notes) execute 100% locally and privately on your machine
                  without sending code to external servers.
                </span>
              </div>

              <div class="action-footer ai-modal-footer">
                @if (aiService.isDownloadingModel()) {
                  <button type="button" class="btn btn-secondary" (click)="cancelModelDownload()">
                    Cancel Download
                  </button>
                } @else {
                  <button type="button" class="btn btn-primary" (click)="startModelDownload()">
                    Start Download
                  </button>
                  <button type="button" class="btn btn-secondary" (click)="close()">
                    Close
                  </button>
                }
              </div>
            </div>
          }

          @if (workspaceService.activeModal() === 'change-language') {
            <div class="results-list">
              @for (lang of languageResults(); track lang.id) {
                <div class="result-item" (click)="selectLanguage(lang.id)">
                  <span class="file-badge">{{ lang.badge }}</span>
                  <span class="file-name">{{ lang.name }}</span>
                  <span class="file-dir">{{ lang.extensions }}</span>
                </div>
              }
              @if (languageResults().length === 0) {
                <div class="no-results">No languages matching query</div>
              }
            </div>
          }

          @if (workspaceService.activeModal() === 'grep') {
            <div class="results-list">
              @if (isSearching()) {
                <div class="searching-indicator">
                  <div class="mini-spinner"></div>
                  <span>Searching through workspace files...</span>
                </div>
              } @else if (grepResults().length > 0) {
                <div class="results-meta">
                  <span>{{ grepResults().length }} match(es) in {{ getUniqueFileCount(grepResults()) }} file(s)</span>
                </div>
                @for (result of grepResults(); track result.file.id + ':' + result.lineNumber) {
                  <div
                    class="result-item"
                    (click)="workspaceService.jumpToLine(result.file, result.lineNumber)"
                  >
                    <span class="file-path">{{ result.file.path }}:{{ result.lineNumber }}</span>
                    <span class="line-snippet">{{ result.lineText }}</span>
                  </div>
                }
              } @else if (inputValue().trim().length >= 2) {
                <div class="no-results">No matching text found</div>
              }
            </div>
          }

          @if (workspaceService.activeModal() === 'file-search') {
            <div class="results-list">
              @if (fileResults().length > 0) {
                <div class="results-meta">
                  <span>{{ fileResults().length }} files found (of {{ workspaceService.files().length }})</span>
                </div>
              }
              @for (file of fileResults(); track file.id) {
                <div class="result-item" (click)="selectFile(file)">
                  @if (isOmniFlux(file)) {
                    <span class="file-badge icon-badge" title="OmniFlux">
                      <img src="omniflux-icon.png" class="file-badge-img" alt="OmniFlux" />
                    </span>
                  } @else if (isPhp(file)) {
                    <span class="file-badge icon-badge" title="PHP">
                      <img src="php-elephant.svg" class="file-badge-img" alt="PHP" />
                    </span>
                  } @else if (isPerl(file)) {
                    <span class="file-badge icon-badge" title="Perl">
                      <img src="perl-onion.svg" class="file-badge-img" alt="Perl" />
                    </span>
                  } @else {
                    <span class="file-badge">{{ getFileBadge(file) }}</span>
                  }
                  <span class="file-name">{{ file.name }}</span>
                  <span class="file-dir">{{ file.path }}</span>
                </div>
              }
              @if (fileResults().length === 0) {
                <div class="no-results">No files matching query</div>
              }
            </div>
          }

          @if (workspaceService.activeModal() === 'open-folder-path') {
            <div class="quick-paths-container">
              <span class="quick-paths-title">Quick Select Paths:</span>
              <div class="quick-paths-grid">
                <button
                  type="button"
                  class="path-chip"
                  (click)="setFolderQuickPath('/home/ori/work/vide')"
                >
                  📁 /home/ori/work/vide
                </button>
                <button
                  type="button"
                  class="path-chip"
                  (click)="setFolderQuickPath('~/work/vide')"
                >
                  📁 ~/work/vide
                </button>
                <button
                  type="button"
                  class="path-chip"
                  (click)="setFolderQuickPath('/home/ori/work')"
                >
                  📁 /home/ori/work
                </button>
                @if (workspaceService.parentWorkspacePath(); as parent) {
                  <button
                    type="button"
                    class="path-chip parent-chip"
                    (click)="setFolderQuickPath(parent)"
                  >
                    ⬆ Parent ({{ parent }})
                  </button>
                }
              </div>
            </div>
            <div class="action-footer">
              <button class="btn btn-secondary" (click)="close()">Cancel</button>
              <button class="btn btn-primary" (click)="onEnter()">Open Folder</button>
            </div>
          }

          @if (
            workspaceService.activeModal() === 'new-file' ||
            workspaceService.activeModal() === 'new-folder'
          ) {
            <div class="action-footer">
              <button class="btn btn-secondary" (click)="close()">Cancel</button>
              <button class="btn btn-primary" (click)="onEnter()">Create</button>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      .modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding-top: 60px;
        z-index: 9999;
      }

      .modal-card {
        width: 620px;
        max-width: 90vw;
        max-height: 80vh;
        background-color: var(--bg-editor, #ffffff);
        color: var(--text-primary, #1e1e1e);
        border: 1px solid var(--border-color, #cccccc);
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 18px;
        background-color: var(--bg-tabs-bar, #ececec);
        border-bottom: 1px solid var(--border-color, #e5e5e5);

        .modal-title {
          font-weight: 600;
          font-size: 15px;
        }

        .close-x {
          background: transparent;
          border: none;
          font-size: 20px;
          cursor: pointer;
          color: var(--text-muted, #717171);
          line-height: 1;

          &:hover {
            color: var(--text-primary, #1e1e1e);
          }
        }
      }

      .input-container {
        padding: 16px 18px 10px 18px;
        display: flex;
        flex-direction: column;
        gap: 7px;

        .input-label {
          font-size: 13.5px;
          font-weight: 500;
          color: var(--text-secondary, #555555);
        }

        .modal-input {
          height: 38px;
          padding: 0 12px;
          border: 1px solid var(--border-color, #cccccc);
          border-radius: 4px;
          background-color: var(--bg-search, #ffffff);
          color: var(--text-primary, #1e1e1e);
          font-size: 15px;
          outline: none;

          &:focus {
            border-color: #007acc;
            box-shadow: 0 0 0 1px #007acc;
          }
        }
      }

      .quick-paths-container {
        padding: 0 18px 14px 18px;
        display: flex;
        flex-direction: column;
        gap: 8px;

        .quick-paths-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary, #555555);
        }

        .quick-paths-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .path-chip {
          background-color: var(--bg-item-hover, #ececec);
          border: 1px solid var(--border-color, #cccccc);
          color: var(--text-primary, #1e1e1e);
          font-size: 13px;
          font-weight: 500;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s ease;
          font-family: monospace;

          &:hover {
            background-color: var(--bg-item-active, #e2effd);
            border-color: #007acc;
            color: #007acc;
          }

          &.parent-chip {
            background-color: rgba(217, 119, 6, 0.1);
            border-color: rgba(217, 119, 6, 0.4);
            color: #d97706;

            &:hover {
              background-color: rgba(217, 119, 6, 0.2);
              border-color: #d97706;
            }
          }
        }
      }

      .indexing-banner {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 18px;
        background-color: var(--bg-badge, #e8e8e8);
        color: var(--text-secondary, #555555);
        font-size: 12px;
        font-weight: 500;
        border-bottom: 1px solid var(--border-color, #e5e5e5);

        .indexing-pulse {
          color: #10b981;
          font-size: 11px;
          animation: pulse 1s infinite alternate;
        }
      }

      @keyframes pulse {
        from {
          opacity: 0.3;
        }
        to {
          opacity: 1;
        }
      }

      .results-meta {
        font-size: 12px;
        color: var(--text-muted, #717171);
        padding: 6px 12px 8px 12px;
        font-weight: 600;
        border-bottom: 1px solid var(--border-color, #f0f0f0);
        margin-bottom: 4px;
      }

      .results-list {
        flex: 1;
        overflow-y: auto;
        max-height: 380px;
        padding: 6px 8px 12px 8px;
      }

      .result-item {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 8px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        transition: background-color 0.1s;

        &:hover {
          background-color: var(--bg-item-hover, #ececec);
        }

        .file-path {
          font-weight: 600;
          color: #007acc;
          white-space: nowrap;
          font-size: 13.5px;
        }

        .line-snippet {
          color: var(--text-secondary, #555555);
          font-family: monospace;
          font-size: 13px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .file-badge {
          font-size: 11px;
          font-weight: bold;
          padding: 2px 6px;
          border-radius: 3px;
          background-color: #007acc;
          color: #ffffff;
          display: inline-flex;
          align-items: center;
          justify-content: center;

          &.icon-badge {
            background-color: transparent !important;
            padding: 0;
            min-width: 24px;
            width: 24px;
            height: 20px;

            .file-badge-img {
              width: 18px;
              height: 18px;
              object-fit: contain;
              display: block;
            }
          }
        }

        .file-name {
          font-weight: 600;
          font-size: 14px;
        }

        .file-dir {
          font-size: 12.5px;
          color: var(--text-muted, #717171);
          margin-left: auto;
        }
      }

      .searching-indicator {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 16px;
        color: var(--text-muted, #717171);
        font-size: 13px;

        .mini-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(0, 122, 204, 0.2);
          border-top-color: #007acc;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .no-results {
        padding: 18px;
        text-align: center;
        color: var(--text-muted, #717171);
        font-size: 13px;
      }

      .config-card {
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 18px;
      }

      .config-section {
        display: flex;
        flex-direction: column;
        gap: 8px;

        .config-section-title {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--text-secondary, #555555);
        }
      }

      .choice-group,
      .size-group {
        display: flex;
        gap: 8px;
      }

      .choice-btn,
      .size-btn {
        flex: 1;
        padding: 10px 14px;
        font-size: 14px;
        font-weight: 500;
        border: 1px solid var(--border-color, #cccccc);
        background-color: var(--bg-item-hover, #f3f3f3);
        color: var(--text-primary, #1e1e1e);
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s ease;

        &:hover {
          background-color: var(--bg-btn-hover, #e0e0e0);
          border-color: #999999;
        }

        &.selected {
          background-color: #007acc;
          color: #ffffff;
          border-color: #007acc;
          font-weight: 600;
        }
      }

      .action-footer {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        padding: 12px 18px;
        background-color: var(--bg-tabs-bar, #ececec);
        border-top: 1px solid var(--border-color, #e5e5e5);

        &.has-left-action {
          justify-content: space-between;

          .footer-buttons {
            display: flex;
            align-items: center;
            gap: 8px;
          }
        }

        .btn {
          padding: 6px 16px;
          border-radius: 4px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;

          &.btn-secondary {
            background-color: transparent;
            border: 1px solid var(--border-color, #cccccc);
            color: var(--text-primary, #333333);

            &:hover {
              background-color: var(--bg-btn-hover, #dcdcdc);
            }
          }

          &.btn-primary {
            background-color: #007acc;
            border: 1px solid #007acc;
            color: #ffffff;

            &:hover {
              background-color: #0066b8;
            }
          }

          &.btn-danger {
            background-color: #d32f2f;
            border: 1px solid #c62828;
            color: #ffffff;

            &:hover {
              background-color: #b71c1c;
            }
          }
        }
      }

      .unsaved-modal-body {
        padding: 24px 22px 18px 22px;
        display: flex;
        align-items: flex-start;
        gap: 16px;

        .unsaved-warning-icon {
          color: #f59e0b;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding-top: 2px;
        }

        .unsaved-message-box {
          display: flex;
          flex-direction: column;
          gap: 6px;

          .unsaved-title {
            margin: 0;
            font-size: 15px;
            font-weight: 600;
            color: var(--text-primary, #1e1e1e);
            line-height: 1.4;
          }

          .unsaved-desc {
            margin: 0;
            font-size: 13.5px;
            color: var(--text-secondary, #555555);
            line-height: 1.4;
          }
        }
      }

      .unsaved-footer {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 12px 20px;
        background-color: var(--bg-tabs-bar, #ececec);
        border-top: 1px solid var(--border-color, #e5e5e5);
      }

      .ai-config-card {
        padding: 16px 20px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        max-height: 75vh;
        overflow-y: auto;
      }

      .ai-status-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background-color: var(--bg-item-hover, #f5f5f5);
        padding: 10px 14px;
        border-radius: 6px;
        border: 1px solid var(--border-color, #e0e0e0);

        .status-indicator-box {
          display: flex;
          align-items: center;
          gap: 8px;

          .status-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;

            &.online {
              background-color: #2ea44f;
              box-shadow: 0 0 6px rgba(46, 164, 79, 0.6);
            }

            &.offline {
              background-color: #cf222e;
            }
          }

          .status-text {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-primary, #1e1e1e);
          }
        }

        .btn-check-health {
          background: none;
          border: 1px solid var(--border-color, #ccc);
          border-radius: 4px;
          padding: 4px 10px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          color: var(--text-primary, #1e1e1e);

          &:hover {
            background-color: var(--bg-btn-hover, #e0e0e0);
          }
        }
      }

      .ai-field-group {
        display: flex;
        flex-direction: column;
        gap: 4px;

        .ai-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary, #444);
        }

        .ai-input {
          padding: 8px 10px;
          font-size: 13px;
          border: 1px solid var(--border-color, #ccc);
          border-radius: 4px;
          background-color: var(--bg-primary, #fff);
          color: var(--text-primary, #1e1e1e);
          outline: none;

          &:focus {
            border-color: #007acc;
          }
        }

        .ai-hint {
          font-size: 11px;
          color: var(--text-muted, #717171);
        }
      }

      .ai-features-box {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        background-color: rgba(137, 87, 229, 0.05);
        border: 1px solid rgba(137, 87, 229, 0.2);
        padding: 12px;
        border-radius: 6px;

        .feature-item {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 11.5px;
          line-height: 1.4;
          color: var(--text-primary, #1e1e1e);

          .feature-icon {
            font-size: 14px;
            flex-shrink: 0;
          }
        }
      }

      .ai-modal-footer {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        margin-top: 6px;
      }

      .ai-download-card {
        padding: 20px 22px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .ai-download-header-box {
        display: flex;
        align-items: center;
        gap: 14px;

        .ai-download-icon-box {
          width: 44px;
          height: 44px;
          border-radius: 8px;
          background: rgba(137, 87, 229, 0.12);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;

          .ai-large-icon {
            font-size: 24px;
          }
        }

        .ai-download-texts {
          display: flex;
          flex-direction: column;
          gap: 2px;

          .ai-download-title {
            margin: 0;
            font-size: 15px;
            font-weight: 600;
            color: var(--text-primary, #1e1e1e);
          }

          .ai-download-subtitle {
            margin: 0;
            font-size: 13px;
            color: var(--text-secondary, #666);
          }
        }
      }

      .ai-download-progress-container {
        display: flex;
        flex-direction: column;
        gap: 8px;
        background-color: var(--bg-item-hover, #f8f8f8);
        border: 1px solid var(--border-color, #e0e0e0);
        padding: 14px;
        border-radius: 6px;

        .progress-bar-track {
          width: 100%;
          height: 10px;
          background-color: var(--border-color, #e0e0e0);
          border-radius: 5px;
          overflow: hidden;

          .progress-bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #8957e5, #007acc);
            border-radius: 5px;
            transition: width 0.2s ease;
          }
        }

        .progress-status-row {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary, #555);

          .progress-percent {
            color: #007acc;
          }
        }
      }

      .ai-download-error {
        background-color: rgba(207, 34, 46, 0.1);
        border: 1px solid rgba(207, 34, 46, 0.3);
        color: #cf222e;
        padding: 10px 12px;
        border-radius: 4px;
        font-size: 12.5px;
      }

      .ai-download-info-note {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        background-color: rgba(0, 122, 204, 0.08);
        border: 1px solid rgba(0, 122, 204, 0.2);
        padding: 10px 12px;
        border-radius: 4px;
        font-size: 12px;
        line-height: 1.45;
        color: var(--text-secondary, #444);

        .info-bulb {
          font-size: 14px;
          color: #007acc;
          flex-shrink: 0;
        }
      }
    `,
  ],
})
export class SearchModalComponent {
  @ViewChild('inputField') private inputField?: ElementRef<HTMLInputElement>;

  public workspaceService = inject(WorkspaceService);
  public aiService = inject(AiService);

  public inputValue = signal<string>('');
  public grepResults = signal<GrepResult[]>([]);
  public fileResults = signal<WorkspaceFile[]>([]);
  public isSearching = signal<boolean>(false);

  // Indentation configuration state
  public selectedIndentType = signal<'tabs' | 'spaces'>('tabs');
  public selectedTabSize = signal<number>(4);

  // Language selection state
  public languageResults = signal<LanguageItem[]>(SUPPORTED_LANGUAGES);

  private searchDebounceTimer?: any;

  constructor() {
    effect(() => {
      const mode = this.workspaceService.activeModal();
      if (mode) {
        this.inputValue.set('');
        this.grepResults.set([]);
        if (mode === 'file-search') {
          this.fileResults.set(this.workspaceService.findFiles(''));
        } else if (mode === 'change-language') {
          this.languageResults.set(SUPPORTED_LANGUAGES);
        } else if (mode === 'indentation') {
          this.selectedIndentType.set(this.workspaceService.indentType());
          this.selectedTabSize.set(this.workspaceService.tabSize());
        } else if (mode === 'open-folder-path') {
          this.inputValue.set(this.workspaceService.nativeWorkspacePath() || '/home/ori/work/vide');
        } else if (mode === 'ai-settings') {
          this.aiService.checkHealth();
          this.aiService.refreshSidecarStatus();
        }

        if (mode !== 'indentation' && mode !== 'ai-settings' && mode !== 'ai-download') {
          setTimeout(() => {
            this.inputField?.nativeElement.focus();
            if (mode === 'open-folder-path') {
              this.inputField?.nativeElement.select();
            }
          }, 50);
        }
      }
    });
  }

  public async startAiSidecar(): Promise<void> {
    try {
      const modelStatus = await this.aiService.checkModelStatus();
      if (!modelStatus?.exists) {
        this.workspaceService.openModal('ai-download');
        return;
      }
      this.workspaceService.showNotification('Starting llama-server sidecar...');
      await this.aiService.startSidecar();
      this.workspaceService.showNotification('✓ llama-server sidecar started');
    } catch (err: any) {
      this.workspaceService.showNotification(`Error: ${err.message || err}`);
    }
  }

  public formatBytes(bytes?: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  public async startModelDownload(): Promise<void> {
    try {
      this.workspaceService.showNotification('Starting Qwen2.5-Coder model download...');
      await this.aiService.downloadModel();
      this.workspaceService.showNotification('✓ Model downloaded successfully!');
      this.workspaceService.openModal('ai-settings');
    } catch (err: any) {
      this.workspaceService.showNotification(`Download error: ${err.message || err}`);
    }
  }

  public async cancelModelDownload(): Promise<void> {
    try {
      await this.aiService.cancelDownload();
      this.workspaceService.showNotification('Model download cancelled');
    } catch (err: any) {
      this.workspaceService.showNotification(`Cancel error: ${err.message || err}`);
    }
  }

  public getTitle(): string {
    switch (this.workspaceService.activeModal()) {
      case 'new-file':
        return 'Create New File';
      case 'new-folder':
        return 'Create New Folder';
      case 'open-folder-path':
        return 'Open Folder by Path';
      case 'grep':
        return 'Search Text in Files (Grep)';
      case 'file-search':
        return 'Find File (Quick Open)';
      case 'indentation':
        return 'Configure Indentation';
      case 'change-language':
        return 'Select Language Mode';
      case 'unsaved-changes':
        return 'Save Changes?';
      case 'ai-settings':
        return 'AI Assistant Configuration (llama-server)';
      case 'ai-download':
        return 'Preparing Local AI Assistant (Qwen 2.5 Coder)';
      default:
        return '';
    }
  }

  public getLabel(): string {
    switch (this.workspaceService.activeModal()) {
      case 'unsaved-changes':
      case 'ai-settings':
      case 'ai-download':
        return '';
      case 'new-file':
        return 'Enter new file name and extension (e.g. app.of, service.ts):';
      case 'new-folder':
        return 'Enter new directory name:';
      case 'open-folder-path':
        return 'Enter directory path to open (e.g. ~/work/vide or /home/ori/work/vide):';
      case 'grep':
        return 'Search query (word or phrase):';
      case 'file-search':
        return 'Type file name to filter:';
      case 'change-language':
        return 'Select language mode (type to filter):';
      default:
        return 'Search:';
    }
  }

  public onInputChange(val: string): void {
    this.inputValue.set(val);
    const mode = this.workspaceService.activeModal();

    if (mode === 'file-search') {
      this.fileResults.set(this.workspaceService.findFiles(val));
    } else if (mode === 'change-language') {
      const q = val.trim().toLowerCase();
      if (!q) {
        this.languageResults.set(SUPPORTED_LANGUAGES);
      } else {
        this.languageResults.set(
          SUPPORTED_LANGUAGES.filter(
            (l) =>
              l.name.toLowerCase().includes(q) ||
              l.id.toLowerCase().includes(q) ||
              l.extensions.toLowerCase().includes(q)
          )
        );
      }
    } else if (mode === 'grep') {
      clearTimeout(this.searchDebounceTimer);
      if (val.trim().length >= 2) {
        this.isSearching.set(true);
        this.searchDebounceTimer = setTimeout(async () => {
          const res = await this.workspaceService.grepFiles(val);
          this.grepResults.set(res);
          this.isSearching.set(false);
        }, 250);
      } else {
        this.grepResults.set([]);
        this.isSearching.set(false);
      }
    }
  }

  public async onEnter(): Promise<void> {
    const mode = this.workspaceService.activeModal();
    const val = this.inputValue().trim();

    if (mode === 'new-file' && val) {
      await this.workspaceService.createNewFile(val);
    } else if (mode === 'new-folder' && val) {
      this.workspaceService.createNewFolder(val);
    } else if (mode === 'open-folder-path' && val) {
      await this.workspaceService.openDirectoryByPath(val);
    } else if (mode === 'file-search') {
      const files = this.fileResults();
      if (files.length > 0) {
        this.selectFile(files[0]);
      }
    } else if (mode === 'change-language') {
      const langs = this.languageResults();
      if (langs.length > 0) {
        this.selectLanguage(langs[0].id);
      }
    } else if (mode === 'grep') {
      const results = this.grepResults();
      if (results.length > 0) {
        this.workspaceService.jumpToLine(results[0].file, results[0].lineNumber);
      }
    }
  }

  public async setFolderQuickPath(path: string): Promise<void> {
    this.inputValue.set(path);
    await this.workspaceService.openDirectoryByPath(path);
  }

  public applyIndentation(): void {
    this.workspaceService.setIndentation(this.selectedIndentType(), this.selectedTabSize());
  }

  public autoDetectIndentation(): void {
    this.workspaceService.redetectActiveFileIndentation();
    this.selectedIndentType.set(this.workspaceService.indentType());
    this.selectedTabSize.set(this.workspaceService.tabSize());
    this.close();
  }

  public selectLanguage(languageId: string): void {
    this.workspaceService.changeActiveFileLanguage(languageId);
  }

  public selectFile(file: WorkspaceFile): void {
    this.workspaceService.openFile(file);
    this.close();
  }

  public close(): void {
    this.workspaceService.closeModal();
  }

  public async saveAndClose(): Promise<void> {
    const file = this.workspaceService.pendingUnsavedFile();
    if (file) {
      await this.workspaceService.saveFile(file);
      this.workspaceService.forceCloseTab(file.id);
    }
    this.close();
  }

  public discardAndClose(): void {
    const file = this.workspaceService.pendingUnsavedFile();
    if (file) {
      this.workspaceService.discardChangesAndCloseTab(file.id);
    }
    this.close();
  }

  public cancelUnsavedClose(): void {
    this.workspaceService.pendingUnsavedFile.set(null);
    this.close();
  }

  public cancelDeleteFile(): void {
    this.workspaceService.pendingDeleteFile.set(null);
    this.close();
  }

  public async executeDeleteFile(file: WorkspaceFile): Promise<void> {
    await this.workspaceService.deleteFilePermanently(file);
  }

  public cancelGitUntrack(): void {
    this.workspaceService.pendingGitUntrackFile.set(null);
    this.close();
  }

  public async executeGitUntrack(file: WorkspaceFile, addToGitignore: boolean): Promise<void> {
    await this.workspaceService.untrackFileFromGit(file, addToGitignore);
  }

  public async executeDeleteUntrackedFile(file: WorkspaceFile): Promise<void> {
    await this.workspaceService.deleteFilePermanently(file);
  }

  public getFileBadge(file: WorkspaceFile): string {
    const ext = file.name.split('.').pop()?.toUpperCase() || 'FILE';
    return ext;
  }

  public isOmniFlux(file: WorkspaceFile): boolean {
    return isOmniFluxFile(file.name, file.language);
  }

  public isPhp(file: WorkspaceFile): boolean {
    return isPhpFile(file.name, file.language);
  }

  public isPerl(file: WorkspaceFile): boolean {
    return isPerlFile(file.name, file.language);
  }

  public getUniqueFileCount(results: GrepResult[]): number {
    const ids = new Set(results.map((r) => r.file.id));
    return ids.size;
  }
}
