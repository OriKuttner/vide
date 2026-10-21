import { Component, inject, signal, computed, ViewChild, ElementRef, effect, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkspaceService, GrepResult, FileGrepGroup } from '../../services/workspace.service';
import { WorkspaceFile, FileTreeNode, isImageFile, isOmniFluxFile, isPhpFile, isPerlFile } from '../../models/file.model';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <aside
      class="sidebar"
      [style.width.px]="workspaceService.sidebarWidth()"
    >
      <div class="sidebar-header">
        <div class="header-actions">
          <button
            class="icon-btn btn-save"
            title="Save File (Ctrl+S)"
            (click)="workspaceService.saveCurrentFile()"
          >
            <svg class="svg-icon" viewBox="0 0 16 16">
              <path
                class="part-main"
                d="M13.85 4.15l-2-2A.5.5 0 0 0 11.5 2H2.5A1.5 1.5 0 0 0 1 3.5v9A1.5 1.5 0 0 0 2.5 14h11a1.5 1.5 0 0 0 1.5-1.5V4.5a.5.5 0 0 0-.15-.35zM4 3h6v2H4V3zm7 10H5v-4h6v4zm2-.5a.5.5 0 0 1-.5.5H12V8a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v5.5H2.5a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5H3v3a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V2.5l2 2V12.5z"
              />
              <rect class="part-accent" x="5.5" y="9.5" width="5" height="3" rx="0.5" />
            </svg>
          </button>
          <button
            class="icon-btn btn-new-folder"
            title="New Folder"
            (click)="workspaceService.openModal('new-folder')"
          >
            <svg class="svg-icon" viewBox="0 0 16 16">
              <path
                class="part-folder"
                d="M14.5 4h-5.79l-1.35-1.35A.5.5 0 0 0 7 2.5H2a1 1 0 0 0-1 1V13a1 1 0 0 0 1 1h6.5a.5.5 0 0 0 0-1H2V4.5h5.21l1.35 1.35a.5.5 0 0 0 .35.15H14v2.5a.5.5 0 0 0 1 0V4.5a.5.5 0 0 0-.5-.5z"
              />
              <path
                class="part-plus"
                d="M12.5 9a.5.5 0 0 0-.5.5V11H10.5a.5.5 0 0 0 0 1H12v1.5a.5.5 0 0 0 1 0V12h1.5a.5.5 0 0 0 0-1H13V9.5a.5.5 0 0 0-.5-.5z"
              />
            </svg>
          </button>
          <button
            class="icon-btn btn-new-file"
            title="New File"
            (click)="workspaceService.openModal('new-file')"
          >
            <svg class="svg-icon" viewBox="0 0 16 16">
              <path
                class="part-file"
                d="M9 1.5H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h5.5a.5.5 0 0 0 0-1H3V2.5h5.5V5a1 1 0 0 0 1 1h2.5v2.5a.5.5 0 0 0 1 0V5.71a1 1 0 0 0-.29-.71l-3.5-3.5A1 1 0 0 0 9 1.5zm.5 1.21L12.29 5H9.5V2.71z"
              />
              <path
                class="part-plus"
                d="M12.5 9a.5.5 0 0 0-.5.5V11H10.5a.5.5 0 0 0 0 1H12v1.5a.5.5 0 0 0 1 0V12h1.5a.5.5 0 0 0 0-1H13V9.5a.5.5 0 0 0-.5-.5z"
              />
            </svg>
          </button>
          <button
            class="icon-btn btn-grep"
            [class.active]="workspaceService.sidebarView() === 'search'"
            title="Search in Files (Ctrl+Shift+F)"
            (click)="workspaceService.toggleSidebarView('search')"
          >
            <svg class="svg-icon" viewBox="0 0 16 16">
              <path
                class="part-lens"
                fill-rule="evenodd"
                clip-rule="evenodd"
                d="M6 2a4 4 0 1 0 2.47 7.15l2.69 2.7a.5.5 0 0 0 .7-.71l-2.69-2.69A4 4 0 0 0 6 2zm-3 4a3 3 0 1 1 6 0 3 3 0 0 1-6 0z"
              />
              <rect class="part-lines" x="9.5" y="3" width="5.5" height="1.2" rx="0.6" />
              <rect class="part-lines" x="9.5" y="5.4" width="4.5" height="1.2" rx="0.6" />
              <rect class="part-lines" x="9.5" y="7.8" width="5.5" height="1.2" rx="0.6" />
            </svg>
          </button>
          <button
            class="icon-btn btn-git"
            [class.active]="workspaceService.sidebarView() === 'git-changes'"
            title="Source Control / Git Changes"
            (click)="workspaceService.toggleSidebarView('git-changes')"
          >
            <svg class="svg-icon" viewBox="0 0 16 16" fill="currentColor">
              <path fill-rule="evenodd" d="M11.75 2a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zm-7.5 0a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM4.25 10.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM3.5 3.75a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0zm7.5 0a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0zm-7.5 8.5a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z"/>
              <path fill-rule="evenodd" d="M5 5.5V11h-1.5V5.5H5zm2.75 2a3.75 3.75 0 0 1 3.75-3.75h.5V5.25h-.5A2.25 2.25 0 0 0 9.25 7.5v.75H7.75V7.5z"/>
            </svg>
            @if (workspaceService.changedFiles().length > 0) {
              <span class="badge-count">{{ workspaceService.changedFiles().length }}</span>
            }
          </button>
          <button
            class="icon-btn btn-find-file"
            title="Find File (Ctrl+P)"
            (click)="workspaceService.openModal('file-search')"
          >
            <svg class="svg-icon" viewBox="0 0 16 16">
              <path
                class="part-file"
                d="M9 1.5H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4.5a.5.5 0 0 0 0-1H3V2.5h5.5V5a1 1 0 0 0 1 1h2.5v1.5a.5.5 0 0 0 1 0V5.71a1 1 0 0 0-.29-.71l-3.5-3.5A1 1 0 0 0 9 1.5zm.5 1.21L12.29 5H9.5V2.71z"
              />
              <path
                class="part-lens"
                fill-rule="evenodd"
                clip-rule="evenodd"
                d="M12 9a2.5 2.5 0 1 0 1.54 4.46l1.31 1.31a.5.5 0 0 0 .7-.71l-1.3-1.31A2.5 2.5 0 0 0 12 9zm-1.5 2.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z"
              />
            </svg>
          </button>
          <button
            class="icon-btn btn-hidden"
            [class.active]="workspaceService.showHiddenFiles()"
            title="Toggle Hidden Files (Ctrl+H)"
            (click)="workspaceService.toggleHiddenFiles()"
          >
            <svg class="svg-icon" viewBox="0 0 16 16" fill="currentColor">
              @if (workspaceService.showHiddenFiles()) {
                <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z"/>
                <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/>
              } @else {
                <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/>
                <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/>
                <path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12-.708.708z"/>
              }
            </svg>
          </button>
          <button
            class="icon-btn btn-collapse"
            title="Hide Side Bar (Ctrl+B)"
            (click)="workspaceService.toggleSidebar()"
          >
            <svg class="svg-icon" viewBox="0 0 16 16" fill="currentColor">
              <path fill-rule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
            </svg>
          </button>
        </div>
      </div>

      @if (workspaceService.sidebarView() === 'explorer') {
        <div class="section-title">
          <div class="title-left">
            <span class="workspace-label" [title]="workspaceService.nativeWorkspacePath() || workspaceService.workspaceName()">
              {{ workspaceService.workspaceName() }}
            </span>
          </div>
          <div class="title-actions">
            @if (workspaceService.parentWorkspacePath(); as parent) {
              <button
                type="button"
                class="parent-up-btn"
                (click)="workspaceService.openParentDirectory()"
                [title]="'Go up to parent folder: ' + parent"
              >
                ⬆
              </button>
            }
            <button
              type="button"
              class="hidden-toggle-btn"
              [class.active]="workspaceService.showHiddenFiles()"
              (click)="workspaceService.toggleHiddenFiles()"
              title="Toggle Hidden Files (Ctrl+H)"
            >
              <svg class="svg-btn-icon" viewBox="0 0 16 16" fill="currentColor">
                @if (workspaceService.showHiddenFiles()) {
                  <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z"/>
                  <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/>
                } @else {
                  <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/>
                  <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/>
                  <path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12-.708.708z"/>
                }
              </svg>
            </button>
            @if (workspaceService.isRealWorkspace()) {
              <button
                type="button"
                class="close-folder-icon-btn"
                (click)="workspaceService.closeWorkspace()"
                title="Close Folder (Return to Welcome / Recent)"
              >
                <svg class="svg-btn-icon" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
                </svg>
              </button>
            }
          </div>
        </div>

        @if (workspaceService.recentWorkspaceName() && !workspaceService.isRealWorkspace()) {
          <div
            class="recent-banner"
            (click)="workspaceService.openRecentWorkspace()"
            [title]="'Reopen ' + workspaceService.recentWorkspaceName()"
          >
            <span class="recent-icon">⚡</span>
            <div class="recent-info">
              <span class="recent-label">Recent folder</span>
              <span class="recent-title">{{ workspaceService.recentWorkspaceName() }}</span>
            </div>
            <span class="recent-action">Open →</span>
          </div>
        }

        <div class="tree-container">
          @if (workspaceService.isScanning()) {
            <div class="scanning-overlay">
              <div class="spinner"></div>
              <span class="scan-title">Loading Workspace...</span>
              <span class="scan-subtitle">{{ workspaceService.scanProgress() }}</span>
            </div>
          } @else {
            <ng-template #nodeTemplate let-nodes>
              @for (node of nodes; track node.id) {
                @if (node.kind === 'directory') {
                  <div
                    class="tree-row directory"
                    [style.padding-left.px]="node.level * 16 + 10"
                    (click)="workspaceService.toggleFolder(node)"
                  >
                    <span class="chevron" [class.expanded]="node.expanded">▶</span>
                    <span class="folder-icon">{{ node.expanded ? '📂' : '📁' }}</span>
                    <span class="node-name">{{ node.name }}</span>
                    @if (node.isLoading) {
                      <span class="loading-dot">⌛</span>
                    }
                  </div>
                  @if (node.expanded && node.children && node.children.length > 0) {
                    <ng-container
                      *ngTemplateOutlet="nodeTemplate; context: { $implicit: node.children }"
                    />
                  }
                } @else {
                  <div
                    class="tree-row file"
                    [class.active]="node.file && node.file.id === workspaceService.activeFileId()"
                    [style.padding-left.px]="node.level * 16 + 22"
                    (click)="node.file && workspaceService.openFile(node.file)"
                  >
                    @if (isImageNode(node.file || node)) {
                      <span class="file-badge image-badge" title="Image">
                        <svg class="file-icon-svg" viewBox="0 0 16 16" fill="currentColor">
                          <path fill-rule="evenodd" clip-rule="evenodd" d="M14.5 2h-13l-.5.5v11l.5.5h13l.5-.5v-11l-.5-.5zm-.5 11H2V3h12v10zm-3.5-7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm1 6.5l-3-4-2.5 3.2-1.5-1.7-2 2.5h9z"/>
                        </svg>
                      </span>
                    } @else if (isOmniFluxNode(node.file || node)) {
                      <span class="file-badge icon-badge" title="OmniFlux">
                        <img src="omniflux-icon.png" class="file-badge-img" alt="OmniFlux" />
                      </span>
                    } @else if (isPhpNode(node.file || node)) {
                      <span class="file-badge icon-badge" title="PHP">
                        <img src="php-elephant.svg" class="file-badge-img" alt="PHP" />
                      </span>
                    } @else if (isPerlNode(node.file || node)) {
                      <span class="file-badge icon-badge" title="Perl">
                        <img src="perl-onion.svg" class="file-badge-img" alt="Perl" />
                      </span>
                    } @else {
                      <span class="file-badge" [attr.data-lang]="node.language">{{
                        getFileIcon(node.file || node)
                      }}</span>
                    }
                    <span class="node-name" [title]="node.path">{{ node.name }}</span>
                    <div class="row-status-indicators">
                      @if (workspaceService.hasGitChanges(node.file || node)) {
                        <button
                          type="button"
                          class="tree-git-btn"
                          title="Open Git Diff"
                          (click)="onOpenDiffForNode(node, $event)"
                        >
                          <svg class="svg-icon" viewBox="0 0 16 16" fill="currentColor">
                            <path fill-rule="evenodd" d="M11.75 2a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zm-7.5 0a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM4.25 10.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM3.5 3.75a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0zm7.5 0a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0zm-7.5 8.5a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z"/>
                            <path fill-rule="evenodd" d="M5 5.5V11h-1.5V5.5H5zm2.75 2a3.75 3.75 0 0 1 3.75-3.75h.5V5.25h-.5A2.25 2.25 0 0 0 9.25 7.5v.75H7.75V7.5z"/>
                          </svg>
                        </button>
                      }
                      @if (workspaceService.isFileModified(node.file || node)) {
                        <span class="dirty-dot" title="Unsaved changes">●</span>
                      }
                    </div>
                  </div>
                }
              }
            </ng-template>

            @if (!workspaceService.isRealWorkspace()) {
              <div class="empty-folder-state">
                <span class="empty-folder-title">No Folder Opened</span>
                <p class="empty-folder-desc">You have not yet opened a folder.</p>
                <button
                  type="button"
                  class="open-folder-main-btn"
                  (click)="workspaceService.openDirectoryFromDisk()"
                >
                  📁 Open Folder
                </button>
              </div>
            } @else if (workspaceService.fileTree().length === 0) {
              <div class="empty-folder-state empty-workspace-state">
                <span class="empty-workspace-icon">📂</span>
                <span class="empty-folder-title">Folder is Empty</span>
                <p class="empty-folder-desc">No files in this folder yet.</p>
                <div class="empty-workspace-btn-group">
                  <button
                    type="button"
                    class="empty-btn new-file-btn"
                    (click)="workspaceService.openModal('new-file')"
                  >
                    <span>+</span> New File
                  </button>
                  <button
                    type="button"
                    class="empty-btn new-folder-btn"
                    (click)="workspaceService.openModal('new-folder')"
                  >
                    <span>📁+</span> New Folder
                  </button>
                </div>
              </div>
            } @else {
              <ng-container
                *ngTemplateOutlet="nodeTemplate; context: { $implicit: workspaceService.fileTree() }"
              />
            }
          }
        </div>

        <div class="sidebar-footer">
          <button class="open-folder-btn" (click)="workspaceService.openDirectoryFromDisk()">
            <span>📁 Browse Folder...</span>
          </button>
          @if (workspaceService.isDesktop()) {
            <button class="open-folder-btn path-btn" (click)="workspaceService.openModal('open-folder-path')">
              <span>⌨ Open by Path...</span>
            </button>
          }
        </div>
      } @else if (workspaceService.sidebarView() === 'search') {
        <!-- SEARCH VIEW in Left Panel -->
        <div class="search-panel">
          <div class="search-panel-header">
            <span class="search-panel-title">SEARCH</span>
            <div class="search-panel-actions">
              <button
                class="panel-action-btn"
                title="Back to Files (Explorer)"
                (click)="workspaceService.setSidebarView('explorer')"
              >
                <span>📁 Files</span>
              </button>
              <button
                class="panel-action-btn icon-only"
                title="Refresh Search"
                (click)="runSearch()"
              >
                <svg viewBox="0 0 16 16" fill="currentColor">
                  <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                  <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
                </svg>
              </button>
              <button
                class="panel-action-btn icon-only"
                title="Clear Search"
                (click)="clearSearch()"
              >
                <svg viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
                </svg>
              </button>
              <button
                class="panel-action-btn icon-only"
                [title]="allCollapsed() ? 'Expand All' : 'Collapse All'"
                (click)="toggleCollapseAll()"
              >
                <svg viewBox="0 0 16 16" fill="currentColor">
                  @if (allCollapsed()) {
                    <path d="M1 8a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 0 1h-13A.5.5 0 0 1 1 8zM8 1a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-1 0v-13A.5.5 0 0 1 8 1z"/>
                  } @else {
                    <path d="M1 8a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 0 1h-13A.5.5 0 0 1 1 8z"/>
                  }
                </svg>
              </button>
            </div>
          </div>

          <div class="search-form-container">
            <div class="search-input-wrapper">
              <input
                #searchInput
                type="text"
                class="sidebar-search-input"
                [value]="searchQuery()"
                (input)="onSearchInput($event)"
                (keydown.enter)="runSearch()"
              />
              <div class="search-options">
                <button
                  type="button"
                  class="option-toggle-btn"
                  [class.active]="matchCase()"
                  (click)="toggleMatchCase()"
                  title="Match Case (Alt+C)"
                >
                  Aa
                </button>
                <button
                  type="button"
                  class="option-toggle-btn"
                  [class.active]="wholeWord()"
                  (click)="toggleWholeWord()"
                  title="Match Whole Word (Alt+W)"
                >
                  \b
                </button>
                <button
                  type="button"
                  class="option-toggle-btn"
                  [class.active]="useRegex()"
                  (click)="toggleRegex()"
                  title="Use Regular Expression (Alt+R)"
                >
                  .*
                </button>
              </div>
            </div>
          </div>

          <div class="search-status-bar">
            @if (isSearching()) {
              <span class="status-searching">⌛ Searching files...</span>
            } @else if (!searchQuery().trim()) {
              <span class="status-hint">Type a term and press Enter</span>
            } @else if (searchFileGroups().length === 0) {
              <span class="status-no-results">No results found.</span>
            } @else {
              <span class="status-count">
                {{ totalMatchesCount() }} result{{ totalMatchesCount() === 1 ? '' : 's' }} in {{ searchFileGroups().length }} file{{ searchFileGroups().length === 1 ? '' : 's' }}
              </span>
            }
          </div>

          <div class="search-results-tree">
            @for (group of searchFileGroups(); track group.file.id) {
              <div class="file-group">
                <div class="file-group-header" (click)="toggleGroup(group)">
                  <span class="chevron" [class.expanded]="group.expanded">▶</span>
                  @if (isImageNode(group.file)) {
                    <span class="file-badge image-badge" title="Image">
                      <svg class="file-icon-svg" viewBox="0 0 16 16" fill="currentColor">
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M14.5 2h-13l-.5.5v11l.5.5h13l.5-.5v-11l-.5-.5zm-.5 11H2V3h12v10zm-3.5-7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm1 6.5l-3-4-2.5 3.2-1.5-1.7-2 2.5h9z"/>
                      </svg>
                    </span>
                  } @else if (isOmniFluxNode(group.file)) {
                    <span class="file-badge icon-badge" title="OmniFlux">
                      <img src="omniflux-icon.png" class="file-badge-img" alt="OmniFlux" />
                    </span>
                  } @else if (isPhpNode(group.file)) {
                    <span class="file-badge icon-badge" title="PHP">
                      <img src="php-elephant.svg" class="file-badge-img" alt="PHP" />
                    </span>
                  } @else if (isPerlNode(group.file)) {
                    <span class="file-badge icon-badge" title="Perl">
                      <img src="perl-onion.svg" class="file-badge-img" alt="Perl" />
                    </span>
                  } @else {
                    <span class="file-badge" [attr.data-lang]="group.file.language">{{
                      getFileIcon(group.file)
                    }}</span>
                  }
                  <span class="group-file-name" [title]="group.file.path">{{ group.file.name }}</span>
                  <span class="group-file-dir" [title]="group.file.path">{{ getFileDir(group.file.path) }}</span>
                  <span class="group-count-badge">{{ group.matches.length }}</span>
                </div>

                @if (group.expanded) {
                  <div class="file-group-matches">
                    @for (m of group.matches; track m.lineNumber + ':' + (m.matchStart ?? 0)) {
                      <div class="match-item" (click)="selectMatch(m)">
                        <span class="match-line-num">{{ m.lineNumber }}:</span>
                        <span class="match-line-text" [innerHTML]="formatMatchPreview(m)"></span>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </div>
        </div>
      } @else if (workspaceService.sidebarView() === 'git-changes') {
        <!-- GIT CHANGES / SOURCE CONTROL PANEL -->
        <div class="git-panel">
          <div class="git-panel-header">
            <div class="git-header-left">
              <span class="git-panel-title">SOURCE CONTROL</span>
              @if (workspaceService.gitBranch()) {
                <span class="git-branch-tag">⎇ {{ workspaceService.gitBranch() }}</span>
                @if (workspaceService.gitSyncStatus()?.has_remote) {
                  @if ((workspaceService.gitSyncStatus()?.ahead ?? 0) > 0) {
                    <span class="git-sync-tag ahead" title="{{ workspaceService.gitSyncStatus()?.ahead }} commit(s) ahead">
                      ↑{{ workspaceService.gitSyncStatus()?.ahead }}
                    </span>
                  }
                  @if ((workspaceService.gitSyncStatus()?.behind ?? 0) > 0) {
                    <span class="git-sync-tag behind" title="{{ workspaceService.gitSyncStatus()?.behind }} commit(s) behind">
                      ↓{{ workspaceService.gitSyncStatus()?.behind }}
                    </span>
                  }
                }
              }
            </div>
            <div class="git-panel-actions">
              <button
                class="panel-action-btn icon-only"
                title="Refresh Git Status"
                (click)="workspaceService.refreshGitStatus()"
              >
                <svg viewBox="0 0 16 16" fill="currentColor">
                  <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                  <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
                </svg>
              </button>
              <button
                class="panel-action-btn"
                title="Back to Files (Explorer)"
                (click)="workspaceService.setSidebarView('explorer')"
              >
                <span>📁 Files</span>
              </button>
            </div>
          </div>

          <!-- Commit Note & Action Section -->
          @if (workspaceService.gitBranch()) {
            @if (workspaceService.changedFiles().length > 0) {
              <div class="git-commit-box">
                @if (isCommitting() || workspaceService.isCommitting()) {
                  <div class="git-progress-bar">
                    <div class="progress-bar-indicator"></div>
                  </div>
                }
                <div class="commit-input-wrapper">
                  <label class="commit-label">Commit Note</label>
                  <textarea
                    class="commit-textarea"
                    [value]="commitMessage()"
                    [disabled]="isCommitting() || workspaceService.isCommitting()"
                    (input)="onCommitMessageChange($event)"
                    (keydown.control.enter)="submitCommit()"
                    (keydown.meta.enter)="submitCommit()"
                    rows="2"
                  ></textarea>
                </div>
                <button
                  type="button"
                  class="btn-commit"
                  [class.loading]="isCommitting() || workspaceService.isCommitting()"
                  [disabled]="!canCommit() || isCommitting() || workspaceService.isCommitting()"
                  (click)="submitCommit()"
                >
                  @if (isCommitting() || workspaceService.isCommitting()) {
                    <span class="btn-spinner"></span>
                    <span>Committing...</span>
                  } @else {
                    <span>✓ Commit</span>
                  }
                </button>
              </div>
            } @else if (workspaceService.gitSyncStatus()?.has_remote && (workspaceService.gitSyncStatus()?.ahead ?? 0) > 0) {
              <div class="git-commit-box">
                @if (isPushing() || workspaceService.isPushing()) {
                  <div class="git-progress-bar">
                    <div class="progress-bar-indicator push"></div>
                  </div>
                }
                <button
                  type="button"
                  class="btn-push"
                  [class.loading]="isPushing() || workspaceService.isPushing()"
                  [disabled]="isPushing() || workspaceService.isPushing()"
                  (click)="submitPush()"
                >
                  @if (isPushing() || workspaceService.isPushing()) {
                    <span class="btn-spinner"></span>
                    <span>Pushing to remote...</span>
                  } @else {
                    <svg class="push-icon" viewBox="0 0 16 16" fill="currentColor">
                      <path fill-rule="evenodd" d="M8 12a.5.5 0 0 0 .5-.5V5.707l2.146 2.147a.5.5 0 0 0 .708-.708l-3-3a.5.5 0 0 0-.708 0l-3 3a.5.5 0 1 0 .708.708L7.5 5.707V11.5a.5.5 0 0 0 .5.5z"/>
                    </svg>
                    <span>Push ({{ workspaceService.gitSyncStatus()?.ahead }} {{ (workspaceService.gitSyncStatus()?.ahead ?? 0) === 1 ? 'commit' : 'commits' }})</span>
                  }
                </button>
              </div>
            }
          }

          <div class="git-changes-container">
            <div class="git-changes-header">
              <span class="git-changes-title">CHANGES</span>
              <span class="changes-count-pill">{{ workspaceService.changedFiles().length }}</span>
            </div>

            <div class="git-files-list">
              @if (!workspaceService.isRealWorkspace()) {
                <div class="empty-changes-msg">
                  <span class="empty-icon">📁</span>
                  <span>No folder opened.</span>
                </div>
              } @else if (!workspaceService.gitBranch()) {
                <div class="empty-changes-msg">
                  <span class="empty-icon">ℹ</span>
                  <span>The current folder is not a Git repository.</span>
                </div>
              } @else if (workspaceService.changedFiles().length === 0) {
                <div class="empty-changes-msg">
                  <span class="empty-icon">✓</span>
                  <span>No changes detected against commit baseline.</span>
                </div>
              } @else {
                @for (file of workspaceService.changedFiles(); track file.id) {
                  <div
                    class="git-file-row"
                    [class.active]="workspaceService.diffModeActive() && workspaceService.activeDiffFile()?.id === file.id"
                    (click)="workspaceService.openDiffView(file)"
                    title="Click to view Meld Side-by-Side Diff"
                  >
                    @if (isImageNode(file)) {
                      <span class="file-icon-badge image-badge" title="Image">
                        <svg class="file-icon-svg" viewBox="0 0 16 16" fill="currentColor">
                          <path fill-rule="evenodd" clip-rule="evenodd" d="M14.5 2h-13l-.5.5v11l.5.5h13l.5-.5v-11l-.5-.5zm-.5 11H2V3h12v10zm-3.5-7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm1 6.5l-3-4-2.5 3.2-1.5-1.7-2 2.5h9z"/>
                        </svg>
                      </span>
                    } @else if (isOmniFluxNode(file)) {
                      <span class="file-icon-badge icon-badge" title="OmniFlux">
                        <img src="omniflux-icon.png" class="file-badge-img" alt="OmniFlux" />
                      </span>
                    } @else if (isPhpNode(file)) {
                      <span class="file-icon-badge icon-badge" title="PHP">
                        <img src="php-elephant.svg" class="file-badge-img" alt="PHP" />
                      </span>
                    } @else if (isPerlNode(file)) {
                      <span class="file-icon-badge icon-badge" title="Perl">
                        <img src="perl-onion.svg" class="file-badge-img" alt="Perl" />
                      </span>
                    } @else {
                      <span class="file-icon-badge" [attr.data-lang]="file.language">{{ getFileIcon(file) }}</span>
                    }
                    <div class="git-file-meta">
                      <span class="git-file-name">{{ file.name }}</span>
                      <span class="git-file-path">{{ file.path }}</span>
                    </div>
                    <div class="git-file-actions">
                      <button
                        type="button"
                        class="git-action-btn revert-btn"
                        title="Discard changes (Revert to HEAD)"
                        (click)="onRevertFile(file, $event)"
                      >
                        ⎌
                      </button>
                      <button
                        type="button"
                        class="git-action-btn diff-btn"
                        title="Open Meld Side-by-Side Diff"
                        (click)="onOpenDiff(file, $event)"
                      >
                        ◫
                      </button>
                      <span
                        class="status-letter-badge"
                        [class.badge-m]="file.gitStatus === 'modified'"
                        [class.badge-a]="file.gitStatus === 'added'"
                        [class.badge-u]="file.gitStatus === 'untracked'"
                      >
                        {{ file.gitStatus === 'added' ? 'A' : file.gitStatus === 'untracked' ? 'U' : 'M' }}
                      </span>
                    </div>
                  </div>
                }
              }
            </div>
          </div>

          <!-- Recent Commits Section -->
          @if (workspaceService.gitBranch()) {
            <div class="git-commits-container">
              <div class="git-commits-header" (click)="toggleCommitsExpanded()">
                <div class="git-commits-header-left">
                  <span class="toggle-icon">{{ commitsExpanded() ? '▾' : '▸' }}</span>
                  <span class="git-commits-title">RECENT COMMITS</span>
                </div>
                <span class="commits-count-pill">{{ workspaceService.recentCommits().length }}</span>
              </div>
              @if (commitsExpanded()) {
                <div class="git-commits-list">
                  @if (workspaceService.isLoadingCommits()) {
                    <div class="empty-commits-msg">Loading commits...</div>
                  } @else if (workspaceService.recentCommits().length === 0) {
                    <div class="empty-commits-msg">No commits found.</div>
                  } @else {
                    @for (commit of workspaceService.recentCommits(); track commit.hash) {
                      <div class="git-commit-row" [title]="commit.hash">
                        <div class="commit-row-top">
                          <span class="commit-hash">{{ commit.shortHash }}</span>
                          <span class="commit-msg">{{ commit.message }}</span>
                        </div>
                        <div class="commit-row-meta">
                          <span class="commit-author">{{ commit.author }}</span>
                          <span class="commit-date">{{ commit.date }}</span>
                        </div>
                      </div>
                    }
                  }
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- Sidebar Resize Handle -->
      <div
        class="sidebar-resizer"
        [class.active]="isResizing()"
        (mousedown)="onStartResize($event)"
        (dblclick)="onResetWidth($event)"
        title="Drag to resize sidebar (double-click to reset)"
      ></div>
    </aside>
  `,
  styles: [
    `
      .sidebar {
        position: relative;
        min-width: 180px;
        max-width: 1200px;
        flex-shrink: 0;
        height: 100%;
        background-color: var(--bg-sidebar, #f8f8f8);
        color: var(--text-primary, #333333);
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--border-color, #e5e5e5);
        user-select: none;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial,
          sans-serif;
        transition: background-color 0.2s ease, border-color 0.2s ease;
      }

      .sidebar-resizer {
        position: absolute;
        top: 0;
        right: -3px;
        width: 6px;
        height: 100%;
        cursor: col-resize;
        z-index: 100;
        user-select: none;
        transition: background-color 0.15s ease;

        &:hover,
        &.active {
          background-color: #007acc;
        }
      }

      .sidebar-header {
        padding: 6px 3px 6px 8px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.8px;
        color: var(--text-muted, #717171);
        display: flex;
        align-items: center;
        border-bottom: 1px solid var(--border-color, #e5e5e5);

        .header-actions {
          display: flex;
          align-items: center;
          gap: 3px;
          width: 100%;
        }

        .icon-btn {
          background: transparent;
          border: none;
          cursor: pointer;
          padding: 4px 5px;
          border-radius: 4px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: background-color 0.15s ease, transform 0.12s ease;

          &:hover {
            background-color: var(--bg-item-hover, #ececec);
            transform: translateY(-1px);
          }

          &:active {
            transform: translateY(0);
          }

          .svg-icon {
            width: 17px;
            height: 17px;
            display: block;
          }

          /* Color styles per action button */
          &.btn-save {
            .part-main {
              fill: var(--color-icon-save);
            }
            .part-accent {
              fill: var(--color-icon-save-accent);
            }
          }

          &.btn-new-folder {
            .part-folder {
              fill: var(--color-icon-folder);
            }
            .part-plus {
              fill: var(--color-icon-plus);
            }
          }

          &.btn-new-file {
            .part-file {
              fill: var(--color-icon-file);
            }
            .part-plus {
              fill: var(--color-icon-plus);
            }
          }

          &.btn-grep {
            .part-lens {
              fill: var(--color-icon-grep-lens);
            }
            .part-lines {
              fill: var(--color-icon-grep-lines);
            }
          }

          &.btn-git {
            position: relative;
            color: #007acc;

            &.active {
              background-color: var(--bg-item-active, #e2effd);
              border-radius: 4px;
            }

            .badge-count {
              position: absolute;
              top: -2px;
              right: -2px;
              background-color: #007acc;
              color: #ffffff;
              font-size: 9px;
              font-weight: 700;
              line-height: 1;
              padding: 1px 4px;
              border-radius: 6px;
              pointer-events: none;
            }
          }

          &.btn-find-file {
            .part-file {
              fill: var(--color-icon-find-file);
            }
            .part-lens {
              fill: var(--color-icon-find-lens);
            }
          }

          &.btn-collapse {
            color: var(--text-muted, #717171);
            margin-left: auto;
            margin-right: 0;
            padding: 4px 6px;

            &:hover {
              color: var(--text-primary, #1e1e1e);
            }
          }
        }
      }

      .section-title {
        padding: 8px 12px;
        font-size: 13px;
        font-weight: 700;
        color: var(--text-secondary, #555555);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        border-bottom: 1px solid var(--border-color, #e5e5e5);

        .title-left {
          display: flex;
          align-items: center;
          gap: 6px;
          overflow: hidden;
          min-width: 0;

          .arrow {
            font-size: 9px;
            color: var(--text-muted, #8c8c8c);
          }

          .workspace-label {
            font-size: 13px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

        }

        .title-actions {
          display: flex;
          align-items: center;
          gap: 4px;

          .parent-up-btn,
          .hidden-toggle-btn,
          .close-folder-icon-btn {
            background-color: var(--bg-btn, #e4e4e4);
            color: var(--text-primary, #333333);
            border: 1px solid var(--border-color, #cccccc);
            border-radius: 3px;
            padding: 2px 7px;
            font-size: 11.5px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
            white-space: nowrap;
            display: inline-flex;
            align-items: center;
            justify-content: center;

            .svg-btn-icon {
              width: 14px;
              height: 14px;
              display: block;
            }

            &:hover {
              background-color: var(--accent-color, #007acc);
              color: #ffffff;
              border-color: #007acc;
            }

            &.active {
              background-color: var(--accent-color, #007acc);
              color: #ffffff;
              border-color: #007acc;
            }

            &.close-folder-icon-btn:hover {
              background-color: #d32f2f;
              border-color: #d32f2f;
              color: #ffffff;
            }
          }
        }
      }

      .recent-banner {
        margin: 6px 10px;
        padding: 8px 10px;
        background-color: rgba(0, 122, 204, 0.08);
        border: 1px solid var(--accent-color, #007acc);
        border-radius: 4px;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        transition: background-color 0.15s, transform 0.1s;

        &:hover {
          background-color: rgba(0, 122, 204, 0.16);
          transform: translateY(-1px);
        }

        .recent-icon {
          font-size: 15px;
          color: #e5a00d;
        }

        .recent-info {
          display: flex;
          flex-direction: column;
          flex: 1;
          overflow: hidden;
          min-width: 0;

          .recent-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            opacity: 0.7;
          }

          .recent-title {
            font-size: 13px;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: var(--accent-color, #007acc);
          }
        }

        .recent-action {
          font-size: 12px;
          font-weight: 600;
          color: var(--accent-color, #007acc);
          white-space: nowrap;
        }
      }

      .tree-container {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding-top: 4px;
        position: relative;
      }

      .scanning-overlay {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 16px;
        gap: 12px;
        text-align: center;

        .spinner {
          width: 30px;
          height: 30px;
          border: 3px solid rgba(0, 122, 204, 0.2);
          border-top-color: #007acc;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        .scan-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary, #333333);
        }

        .scan-subtitle {
          font-size: 12px;
          color: var(--text-muted, #8c8c8c);
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }

      .empty-folder-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
        text-align: center;
        gap: 12px;

        .empty-folder-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary, #cccccc);
        }

        .empty-folder-desc {
          font-size: 12px;
          color: var(--text-muted, #8c8c8c);
          margin: 0;
          line-height: 1.4;
        }

        .open-folder-main-btn {
          margin-top: 8px;
          padding: 7px 16px;
          font-size: 12px;
          font-family: inherit;
          font-weight: 500;
          color: #ffffff;
          background-color: var(--accent-color, #007acc);
          border: none;
          border-radius: 4px;
          cursor: pointer;
          transition: background-color 0.15s ease;

          &:hover {
            background-color: #0062a3;
          }
        }

        &.empty-workspace-state {
          .empty-workspace-icon {
            font-size: 28px;
            opacity: 0.65;
            margin-bottom: 2px;
          }

          .empty-workspace-btn-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
            width: 100%;
            max-width: 170px;
            margin-top: 6px;

            .empty-btn {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
              padding: 7px 14px;
              font-size: 12px;
              font-family: inherit;
              font-weight: 500;
              border-radius: 4px;
              cursor: pointer;
              transition: all 0.15s ease;

              &.new-file-btn {
                color: #ffffff;
                background-color: var(--accent-color, #007acc);
                border: 1px solid var(--accent-color, #007acc);

                &:hover {
                  background-color: #0062a3;
                  border-color: #0062a3;
                }
              }

              &.new-folder-btn {
                color: var(--text-primary, #cccccc);
                background-color: rgba(255, 255, 255, 0.06);
                border: 1px solid var(--border-color, #333333);

                &:hover {
                  background-color: rgba(255, 255, 255, 0.12);
                }
              }
            }
          }
        }
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      @keyframes gitProgressAnim {
        0% {
          transform: translateX(-100%);
        }
        50% {
          transform: translateX(120%);
        }
        100% {
          transform: translateX(250%);
        }
      }

      .tree-row {
        display: flex;
        align-items: center;
        height: 29px;
        line-height: 29px;
        font-size: 14px;
        cursor: pointer;
        gap: 7px;
        transition: background-color 0.15s ease;
        padding-right: 12px;

        &:hover {
          background-color: var(--bg-item-hover, #ececec);
        }

        &.directory {
          font-weight: 600;
          color: var(--text-primary, #333333);

          .chevron {
            font-size: 10px;
            color: var(--text-muted, #8c8c8c);
            display: inline-block;
            transition: transform 0.15s ease;
            width: 14px;
            text-align: center;

            &.expanded {
              transform: rotate(90deg);
            }
          }

          .folder-icon {
            font-size: 16px;
          }

          .loading-dot {
            font-size: 12px;
            margin-left: auto;
          }
        }

        &.file {
          &.active {
            background-color: var(--bg-item-active, #e2effd);
            color: var(--text-item-active, #005fb8);
            font-weight: 500;
          }
        }

        .file-badge {
          font-size: 11px;
          font-weight: bold;
          padding: 1px 5px;
          border-radius: 3px;
          min-width: 26px;
          text-align: center;
          line-height: 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;

          &.image-badge {
            background-color: #107c41;
            color: #ffffff;
            padding: 1px 5px;

            .file-icon-svg {
              width: 14px;
              height: 14px;
              display: block;
            }
          }

          &.icon-badge {
            background-color: transparent !important;
            padding: 0;
            min-width: 26px;
            width: 26px;
            height: 18px;
            display: inline-flex;
            align-items: center;
            justify-content: center;

            .file-badge-img {
              width: 16px;
              height: 16px;
              object-fit: contain;
              display: block;
            }
          }

          &[data-lang='omniflux'] {
            background-color: #ff5722;
            color: #fff;
          }
          &[data-lang='typescript'] {
            background-color: #3178c6;
            color: #fff;
          }
          &[data-lang='javascript'] {
            background-color: #f7df1e;
            color: #000;
          }
          &[data-lang='php'] {
            background-color: #777bb4;
            color: #fff;
          }
          &[data-lang='perl'] {
            background-color: #39457e;
            color: #fff;
          }
          &[data-lang='c'] {
            background-color: #555555;
            color: #fff;
          }
          &[data-lang='cpp'] {
            background-color: #00599c;
            color: #fff;
          }
          &[data-lang='json'] {
            background-color: #cbcb41;
            color: #000;
          }
          &[data-lang='html'] {
            background-color: #e44d26;
            color: #fff;
          }
          &[data-lang='css'] {
            background-color: #264de4;
            color: #fff;
          }
          &[data-lang='markdown'] {
            background-color: #083fa1;
            color: #fff;
          }
          &[data-lang='shell'] {
            background-color: #4eaa25;
            color: #fff;
          }
          &[data-lang='python'] {
            background-color: #3572a5;
            color: #fff;
          }
          &[data-lang='image'] {
            background-color: #107c41;
            color: #fff;
            font-size: 13px;
          }
        }

        .node-name {
          flex: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .row-status-indicators {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
          padding-right: 2px;
        }

        .tree-git-btn {
          background: transparent;
          border: none;
          padding: 1px 2px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #007acc;
          cursor: pointer;
          border-radius: 3px;
          opacity: 0.85;
          transition: opacity 0.15s ease, background-color 0.15s ease, transform 0.15s ease;

          &:hover {
            opacity: 1;
            transform: scale(1.15);
            background-color: rgba(0, 122, 204, 0.15);
          }

          .svg-icon {
            width: 13px;
            height: 13px;
          }
        }

        .dirty-dot {
          font-size: 11px;
          color: #111111;
          line-height: 1;
          display: inline-block;
          user-select: none;
        }

        :host-context(.theme-dark) .dirty-dot,
        body.theme-dark .dirty-dot {
          color: #ffffff;
        }
      }

      .sidebar-footer {
        padding: 10px;
        border-top: 1px solid var(--border-color, #e5e5e5);
        display: flex;
        flex-direction: column;
        gap: 8px;

        .recent-btn {
          width: 100%;
          padding: 7px 12px;
          background-color: var(--accent-color, #007acc);
          color: #ffffff;
          border: none;
          border-radius: 4px;
          font-size: 13.5px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          transition: opacity 0.15s;

          &:hover {
            opacity: 0.9;
          }
        }

        .open-folder-btn {
          width: 100%;
          padding: 7px 12px;
          background-color: var(--bg-btn, #e6e6e6);
          color: var(--text-primary, #333333);
          border: 1px solid var(--border-color, #cccccc);
          border-radius: 4px;
          font-size: 13.5px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: background-color 0.15s, border-color 0.15s;

          &:hover {
            background-color: var(--bg-btn-hover, #dcdcdc);
            border-color: #007acc;
          }

          &.path-btn {
            background-color: transparent;
            border-style: dashed;
            font-size: 13px;
          }
        }
      }

      /* Search Panel in Left Sidebar (VS Code style) */
      .search-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;

        .search-panel-header {
          padding: 6px 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid var(--border-color, #e5e5e5);

          .search-panel-title {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.5px;
            color: var(--text-secondary, #555555);
          }

          .search-panel-actions {
            display: flex;
            align-items: center;
            gap: 4px;

            .panel-action-btn {
              background: transparent;
              border: 1px solid transparent;
              border-radius: 3px;
              color: var(--text-secondary, #555555);
              font-size: 11px;
              padding: 2px 6px;
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 4px;
              transition: all 0.15s;

              &:hover {
                background-color: var(--bg-hover, #e8e8e8);
                color: var(--text-primary, #333333);
              }

              &.icon-only {
                padding: 2px 4px;
                svg {
                  width: 13px;
                  height: 13px;
                }
              }
            }
          }
        }

        .search-form-container {
          padding: 8px 10px 4px 10px;

          .search-input-wrapper {
            display: flex;
            align-items: center;
            background-color: var(--bg-input, #ffffff);
            border: 1px solid var(--border-color, #cccccc);
            border-radius: 3px;
            overflow: hidden;
            transition: border-color 0.15s;

            &:focus-within {
              border-color: var(--accent-color, #007acc);
              outline: 1px solid var(--accent-color, #007acc);
            }

            .sidebar-search-input {
              flex: 1;
              border: none;
              outline: none;
              background: transparent;
              color: var(--text-primary, #333333);
              font-size: 12px;
              padding: 5px 8px;
              min-width: 0;
            }

            .search-options {
              display: flex;
              align-items: center;
              gap: 2px;
              padding-right: 4px;

              .option-toggle-btn {
                background: transparent;
                border: 1px solid transparent;
                border-radius: 2px;
                font-size: 11px;
                font-family: monospace;
                padding: 1px 4px;
                color: var(--text-muted, #8c8c8c);
                cursor: pointer;
                transition: all 0.15s;

                &:hover {
                  background-color: var(--bg-hover, #e8e8e8);
                  color: var(--text-primary, #333333);
                }

                &.active {
                  background-color: var(--accent-color, #007acc);
                  color: #ffffff;
                  border-color: var(--accent-color, #007acc);
                }
              }
            }
          }
        }

        .search-status-bar {
          padding: 4px 10px 6px 10px;
          font-size: 11px;
          color: var(--text-muted, #8c8c8c);
          border-bottom: 1px solid var(--border-color, #e5e5e5);
        }

        .search-results-tree {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding-top: 4px;

          .file-group {
            margin-bottom: 2px;

            .file-group-header {
              display: flex;
              align-items: center;
              gap: 6px;
              padding: 4px 10px;
              cursor: pointer;
              user-select: none;
              font-size: 12px;
              transition: background-color 0.1s;

              &:hover {
                background-color: var(--bg-hover, #e8e8e8);
              }

              .chevron {
                font-size: 8px;
                color: var(--text-muted, #8c8c8c);
                transition: transform 0.15s ease;
                width: 10px;
                text-align: center;

                &.expanded {
                  transform: rotate(90deg);
                }
              }

              .group-file-name {
                font-weight: 600;
                color: var(--text-primary, #333333);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              }

              .group-file-dir {
                font-size: 10px;
                color: var(--text-muted, #8c8c8c);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-left: 2px;
              }

              .group-count-badge {
                margin-left: auto;
                font-size: 10px;
                padding: 1px 6px;
                border-radius: 8px;
                background-color: var(--bg-badge, #e0e0e0);
                color: var(--text-secondary, #555555);
                font-weight: 500;
              }
            }

            .file-group-matches {
              display: flex;
              flex-direction: column;

              .match-item {
                display: flex;
                align-items: baseline;
                gap: 8px;
                padding: 3px 10px 3px 26px;
                font-size: 11px;
                font-family: monospace;
                cursor: pointer;
                white-space: pre;
                overflow: hidden;
                text-overflow: ellipsis;
                transition: background-color 0.1s;

                &:hover {
                  background-color: var(--bg-hover, #e8e8e8);
                }

                .match-line-num {
                  color: var(--text-muted, #8c8c8c);
                  min-width: 22px;
                  text-align: right;
                  font-size: 10px;
                }

                .match-line-text {
                  color: var(--text-primary, #333333);
                  overflow: hidden;
                  text-overflow: ellipsis;

                  .search-highlight {
                    background-color: rgba(234, 179, 8, 0.4);
                    color: inherit;
                    border-radius: 2px;
                    font-weight: 600;
                  }
                }
              }
            }
          }
        }
      }

      /* Git / Source Control Panel */
      .git-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;

        .git-panel-header {
          padding: 8px 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid var(--border-color, #e5e5e5);

          .git-header-left {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .git-panel-title {
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.5px;
            color: var(--text-secondary, #555555);
          }

          .git-branch-tag {
            font-size: 12px;
            background: rgba(0, 122, 204, 0.12);
            color: #007acc;
            padding: 2px 7px;
            border-radius: 3px;
            font-weight: 600;
          }

          .git-sync-tag {
            font-size: 11px;
            padding: 1px 6px;
            border-radius: 9px;
            font-weight: 700;
            display: inline-flex;
            align-items: center;

            &.ahead {
              background: rgba(46, 160, 67, 0.18);
              color: #2ea043;
            }

            &.behind {
              background: rgba(229, 83, 75, 0.18);
              color: #e5534b;
            }
          }

          .panel-action-btn {
            background: transparent;
            border: 1px solid var(--border-color, #dcdcdc);
            padding: 3px 8px;
            font-size: 12px;
            border-radius: 3px;
            cursor: pointer;
            color: var(--text-primary, #333333);
            display: flex;
            align-items: center;
            gap: 5px;

            &:hover {
              background-color: var(--bg-item-hover, #ececec);
              border-color: #007acc;
            }
          }
        }

        .git-commit-box {
          position: relative;
          overflow: hidden;
          flex-shrink: 0;
          padding: 10px 12px;
          border-bottom: 1px solid var(--border-color, #e5e5e5);
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: var(--bg-secondary, #fafafa);

          .git-progress-bar {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: rgba(0, 0, 0, 0.08);
            overflow: hidden;
            z-index: 25;

            .progress-bar-indicator {
              width: 45%;
              height: 100%;
              background: #007acc;
              border-radius: 2px;
              animation: gitProgressAnim 1s infinite ease-in-out;

              &.push {
                background: #2ea043;
                box-shadow: 0 0 6px rgba(46, 160, 67, 0.7);
              }
            }
          }

          .commit-input-wrapper {
            display: flex;
            flex-direction: column;
            gap: 4px;

            .commit-label {
              font-size: 11px;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              color: var(--text-muted, #717171);
            }

            .commit-textarea {
              width: 100%;
              box-sizing: border-box;
              resize: vertical;
              min-height: 48px;
              font-family: inherit;
              font-size: 12.5px;
              padding: 6px 8px;
              border: 1px solid var(--border-color, #dcdcdc);
              border-radius: 4px;
              background-color: var(--bg-primary, #ffffff);
              color: var(--text-primary, #1e1e1e);
              outline: none;
              line-height: 1.4;

              &:focus {
                border-color: #007acc;
                box-shadow: 0 0 0 1px #007acc;
              }
            }
          }

          .btn-commit,
          .btn-push {
            background-color: #007acc;
            color: #ffffff;
            border: none;
            padding: 7px 12px;
            font-size: 12px;
            font-weight: 600;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 7px;
            transition: background-color 0.15s ease, opacity 0.15s ease;

            &:hover:not(:disabled) {
              background-color: #0062a3;
            }

            &:disabled:not(.loading) {
              opacity: 0.5;
              cursor: not-allowed;
            }

            &.loading {
              opacity: 1 !important;
              cursor: wait !important;
              pointer-events: none;
            }

            .btn-spinner {
              width: 14px;
              height: 14px;
              border: 2px solid rgba(255, 255, 255, 0.4);
              border-top-color: #ffffff;
              border-radius: 50%;
              animation: spin 0.65s linear infinite;
              display: inline-block;
              flex-shrink: 0;
            }

            .push-icon {
              width: 14px;
              height: 14px;
            }
          }

          .btn-push {
            background-color: #238636;

            &:hover:not(:disabled) {
              background-color: #2ea043;
            }

            &.loading {
              background-color: #238636 !important;
            }
          }
        }

        .git-changes-container {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;

          .git-changes-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 14px 8px;
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.5px;
            color: var(--text-muted, #717171);

            .changes-count-pill {
              background-color: var(--bg-item-active, #e2effd);
              color: #007acc;
              font-size: 12px;
              padding: 2px 7px;
              border-radius: 8px;
              font-weight: 700;
            }
          }

          .git-files-list {
            display: flex;
            flex-direction: column;
            gap: 1px;
          }

          .empty-changes-msg {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 30px 16px;
            color: var(--text-muted, #888888);
            font-size: 13.5px;
            text-align: center;

            .empty-icon {
              font-size: 26px;
              color: #388a34;
            }
          }

          .git-file-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 14px;
            cursor: pointer;
            transition: background-color 0.12s ease;

            &:hover {
              background-color: var(--bg-item-hover, #ececec);

              .git-file-actions .git-action-btn {
                opacity: 1;
              }
            }

            &.active {
              background-color: var(--bg-item-active, #e2effd);
            }

            .file-icon-badge {
              font-size: 13px;
              font-weight: 700;
              width: 24px;
              text-align: center;
              color: var(--text-muted, #717171);
              display: inline-flex;
              align-items: center;
              justify-content: center;

              &.image-badge {
                color: #107c41;

                .file-icon-svg {
                  width: 15px;
                  height: 15px;
                  display: block;
                }
              }

              &.icon-badge {
                background-color: transparent !important;
                padding: 0;
                width: 24px;
                height: 18px;
                display: inline-flex;
                align-items: center;
                justify-content: center;

                .file-badge-img {
                  width: 16px;
                  height: 16px;
                  object-fit: contain;
                  display: block;
                }
              }

              &[data-lang='image'] {
                color: #107c41;
                font-size: 14px;
              }
            }

            .git-file-meta {
              flex: 1;
              display: flex;
              flex-direction: column;
              min-width: 0;

              .git-file-name {
                font-size: 14.5px;
                font-weight: 500;
                color: var(--text-primary, #1e1e1e);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              }

              .git-file-path {
                font-size: 12px;
                color: var(--text-muted, #888888);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              }
            }

            .git-file-actions {
              display: flex;
              align-items: center;
              gap: 4px;

              .git-action-btn {
                background: transparent;
                border: none;
                cursor: pointer;
                padding: 2px 6px;
                border-radius: 3px;
                color: var(--text-muted, #717171);
                font-size: 14px;
                opacity: 0;
                transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;

                &:hover {
                  background-color: rgba(0, 0, 0, 0.08);
                  color: var(--text-primary, #1e1e1e);
                }

                &.diff-btn:hover {
                  color: #007acc;
                }

                &.revert-btn:hover {
                  color: #d32f2f;
                }
              }

              .status-letter-badge {
                font-size: 13px;
                font-weight: 700;
                width: 18px;
                text-align: center;

                &.badge-m {
                  color: #d97706;
                }

                &.badge-a {
                  color: #16a34a;
                }

                &.badge-u {
                  color: #10b981;
                }
              }
            }
          }
        }

        .git-commits-container {
          flex-shrink: 0;
          max-height: 250px;
          display: flex;
          flex-direction: column;
          border-top: 1px solid var(--border-color, #e5e5e5);
          background: var(--bg-secondary, #fafafa);

          .git-commits-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            cursor: pointer;
            user-select: none;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.5px;
            color: var(--text-muted, #717171);

            &:hover {
              background-color: var(--bg-item-hover, #ececec);
            }

            .git-commits-header-left {
              display: flex;
              align-items: center;
              gap: 6px;
            }

            .toggle-icon {
              font-size: 10px;
              width: 12px;
            }

            .commits-count-pill {
              background-color: var(--bg-item-active, #e2effd);
              color: #007acc;
              font-size: 11px;
              padding: 1px 6px;
              border-radius: 8px;
              font-weight: 700;
            }
          }

          .git-commits-list {
            flex: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            padding-bottom: 6px;

            .empty-commits-msg {
              padding: 14px;
              text-align: center;
              font-size: 12px;
              color: var(--text-muted, #888888);
            }

            .git-commit-row {
              display: flex;
              flex-direction: column;
              gap: 3px;
              padding: 6px 12px;
              border-bottom: 1px solid rgba(0, 0, 0, 0.04);
              cursor: default;
              transition: background-color 0.12s ease;

              &:hover {
                background-color: var(--bg-item-hover, #ececec);
              }

              .commit-row-top {
                display: flex;
                align-items: baseline;
                gap: 6px;
                min-width: 0;

                .commit-hash {
                  font-family: monospace;
                  font-size: 11px;
                  background: rgba(0, 122, 204, 0.1);
                  color: #007acc;
                  padding: 1px 5px;
                  border-radius: 3px;
                  font-weight: 600;
                  flex-shrink: 0;
                }

                .commit-msg {
                  font-size: 12px;
                  font-weight: 500;
                  color: var(--text-primary, #1e1e1e);
                  white-space: nowrap;
                  overflow: hidden;
                  text-overflow: ellipsis;
                }
              }

              .commit-row-meta {
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-size: 11px;
                color: var(--text-muted, #888888);
                padding-left: 2px;

                .commit-author {
                  white-space: nowrap;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  max-width: 130px;
                }

                .commit-date {
                  white-space: nowrap;
                  flex-shrink: 0;
                }
              }
            }
          }
        }
      }
    `,
  ],
})
export class SidebarComponent {
  public workspaceService = inject(WorkspaceService);

  @ViewChild('searchInput') searchInputRef?: ElementRef<HTMLInputElement>;

  // Search state signals
  public searchQuery = signal<string>('');
  public matchCase = signal<boolean>(false);
  public wholeWord = signal<boolean>(false);
  public useRegex = signal<boolean>(false);
  public isSearching = signal<boolean>(false);
  public searchFileGroups = signal<FileGrepGroup[]>([]);
  public allCollapsed = signal<boolean>(false);

  public totalMatchesCount = computed(() => {
    return this.searchFileGroups().reduce((acc, g) => acc + g.matches.length, 0);
  });

  private searchDebounceTimer?: any;

  constructor() {
    effect(() => {
      const view = this.workspaceService.sidebarView();
      if (view === 'search') {
        setTimeout(() => {
          this.searchInputRef?.nativeElement?.focus();
          this.searchInputRef?.nativeElement?.select();
        }, 60);
      }
    });
  }

  public onSearchInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.searchQuery.set(val);

    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.runSearch();
    }, 250);
  }

  public async runSearch(): Promise<void> {
    const query = this.searchQuery().trim();
    if (!query) {
      this.searchFileGroups.set([]);
      this.isSearching.set(false);
      return;
    }

    this.isSearching.set(true);
    try {
      const rawResults = await this.workspaceService.grepFiles(query, {
        matchCase: this.matchCase(),
        wholeWord: this.wholeWord(),
        isRegex: this.useRegex(),
      });

      const map = new Map<string, FileGrepGroup>();
      for (const r of rawResults) {
        let g = map.get(r.file.id);
        if (!g) {
          g = { file: r.file, matches: [], expanded: true };
          map.set(r.file.id, g);
        }
        g.matches.push(r);
      }

      this.searchFileGroups.set(Array.from(map.values()));
      this.allCollapsed.set(false);
    } finally {
      this.isSearching.set(false);
    }
  }

  public clearSearch(): void {
    this.searchQuery.set('');
    this.searchFileGroups.set([]);
    this.searchInputRef?.nativeElement?.focus();
  }

  public toggleMatchCase(): void {
    this.matchCase.update((v) => !v);
    this.runSearch();
  }

  public toggleWholeWord(): void {
    this.wholeWord.update((v) => !v);
    this.runSearch();
  }

  public toggleRegex(): void {
    this.useRegex.update((v) => !v);
    this.runSearch();
  }

  public toggleGroup(group: FileGrepGroup): void {
    group.expanded = !group.expanded;
  }

  public toggleCollapseAll(): void {
    const next = !this.allCollapsed();
    this.allCollapsed.set(next);
    const groups = this.searchFileGroups();
    for (const g of groups) {
      g.expanded = !next;
    }
    this.searchFileGroups.set([...groups]);
  }

  public async selectMatch(m: GrepResult): Promise<void> {
    await this.workspaceService.openFile(m.file);
    this.workspaceService.pendingLineJump.set({
      lineNumber: m.lineNumber,
      column: (m.matchStart ?? 0) + 1,
    });
  }

  public formatMatchPreview(m: GrepResult): string {
    const text = m.lineText;
    const term = this.searchQuery().trim();
    if (!term) return this.escapeHtml(text);

    try {
      const flags = this.matchCase() ? 'g' : 'gi';
      const pattern = this.useRegex() ? term : term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reg = new RegExp(this.wholeWord() ? `\\b${pattern}\\b` : pattern, flags);
      return this.escapeHtml(text).replace(
        reg,
        (match) => `<span class="search-highlight">${match}</span>`
      );
    } catch {
      return this.escapeHtml(text);
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  public getFileDir(path: string): string {
    const slashIdx = path.lastIndexOf('/');
    return slashIdx !== -1 ? path.substring(0, slashIdx) : '';
  }

  public isImageNode(item: WorkspaceFile | FileTreeNode | undefined | null): boolean {
    if (!item) return false;
    const name = item.name || '';
    const lang = ('language' in item ? item.language : '') || '';
    return lang === 'image' || isImageFile(name);
  }

  public isOmniFluxNode(item: WorkspaceFile | FileTreeNode | undefined | null): boolean {
    if (!item) return false;
    const name = item.name || '';
    const lang = ('language' in item ? item.language : '') || '';
    return isOmniFluxFile(name, lang);
  }

  public isPhpNode(item: WorkspaceFile | FileTreeNode | undefined | null): boolean {
    if (!item) return false;
    const name = item.name || '';
    const lang = ('language' in item ? item.language : '') || '';
    return isPhpFile(name, lang);
  }

  public isPerlNode(item: WorkspaceFile | FileTreeNode | undefined | null): boolean {
    if (!item) return false;
    const name = item.name || '';
    const lang = ('language' in item ? item.language : '') || '';
    return isPerlFile(name, lang);
  }


  public getFileIcon(file: WorkspaceFile | FileTreeNode): string {
    if (file.language === 'image' || isImageFile(file.name)) {
      return 'IMG';
    }
    switch (file.language) {
      case 'image':
        return 'IMG';
      case 'omniflux':
        return 'OF';
      case 'typescript':
        return 'TS';
      case 'javascript':
        return 'JS';
      case 'php':
        return 'PHP';
      case 'perl':
        return 'PL';
      case 'c':
        return 'C';
      case 'cpp':
        return 'C++';
      case 'json':
        return '{}';
      case 'html':
        return '<>';
      case 'css':
        return '#';
      case 'markdown':
        return 'MD';
      case 'shell':
      case 'bash':
        return 'SH';
      case 'python':
        return 'PY';
      default:
        return 'TXT';
    }
  }

  public onOpenDiff(file: WorkspaceFile, event: MouseEvent): void {
    event.stopPropagation();
    this.workspaceService.openDiffView(file);
  }

  public onOpenDiffForNode(node: FileTreeNode, event: MouseEvent): void {
    event.stopPropagation();
    const file = node.file || this.workspaceService.files().find((f) => f.path === node.path || f.id === node.id);
    if (file) {
      if (this.workspaceService.diffModeActive() && this.workspaceService.activeDiffFile()?.id === file.id) {
        this.workspaceService.closeDiffView();
      } else {
        this.workspaceService.openDiffView(file);
      }
    }
  }

  public onRevertFile(file: WorkspaceFile, event: MouseEvent): void {
    event.stopPropagation();
    this.workspaceService.revertFile(file.id);
  }

  private readonly cdr = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);

  // Git Commit & History state
  public commitMessage = signal<string>('');
  public commitsExpanded = signal<boolean>(true);
  public readonly isPushing = signal<boolean>(false);
  public readonly isCommitting = signal<boolean>(false);

  public canCommit = computed(() => {
    return (
      this.workspaceService.changedFiles().length > 0 &&
      this.commitMessage().trim().length > 0
    );
  });

  public onCommitMessageChange(event: Event): void {
    const val = (event.target as HTMLTextAreaElement).value;
    this.commitMessage.set(val);
  }

  public async submitCommit(): Promise<void> {
    const msg = this.commitMessage().trim();
    if (!msg || !this.canCommit() || this.isCommitting() || this.workspaceService.isCommitting()) return;

    this.isCommitting.set(true);
    this.cdr.detectChanges();
    await new Promise((r) => setTimeout(r, 40));

    try {
      const success = await this.workspaceService.commitChanges(msg);
      if (success) {
        this.commitMessage.set('');
      }
    } finally {
      this.ngZone.run(() => {
        this.isCommitting.set(false);
        this.cdr.detectChanges();
      });
    }
  }

  public async submitPush(): Promise<void> {
    if (this.isPushing() || this.workspaceService.isPushing()) return;

    this.isPushing.set(true);
    this.cdr.detectChanges();
    await new Promise((r) => setTimeout(r, 40));

    try {
      await this.workspaceService.pushChanges();
    } finally {
      this.ngZone.run(() => {
        this.isPushing.set(false);
        this.cdr.detectChanges();
      });
    }
  }

  public toggleCommitsExpanded(): void {
    this.commitsExpanded.update((v) => !v);
  }

  // Sidebar Resizing state
  public isResizing = signal<boolean>(false);
  private startX = 0;
  private startWidth = 0;

  public onStartResize(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isResizing.set(true);
    this.startX = event.clientX;
    this.startWidth = this.workspaceService.sidebarWidth();

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - this.startX;
      const newWidth = this.startWidth + deltaX;
      this.workspaceService.setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      this.isResizing.set(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  public onResetWidth(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.workspaceService.setSidebarWidth(250);
  }
}
