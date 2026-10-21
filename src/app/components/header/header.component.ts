import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkspaceService } from '../../services/workspace.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="header">
      <div class="left-section">
        <img class="app-logo-img" src="vector-logo-32.png" alt="Vector" width="18" height="18" />
        <span class="app-title">Vector-IDE</span>
        @if (workspaceService.activeFile(); as file) {
          <span class="active-file-indicator">
            - {{ file.name }}
          </span>
        }
      </div>

      <div class="center-section">
        <button
          class="nav-action-btn"
          title="Open Folder from Disk (Browse)"
          (click)="workspaceService.openDirectoryFromDisk()"
        >
          📁 Open Folder
        </button>

        @if (workspaceService.isDesktop()) {
          <button
            class="nav-action-btn"
            title="Open Folder by Path (Direct input)"
            (click)="workspaceService.openModal('open-folder-path')"
          >
            ⌨ Path...
          </button>
        }

        <button
          class="nav-action-btn"
          title="Save Active File (Ctrl+S)"
          (click)="workspaceService.saveCurrentFile()"
        >
          💾 Save
        </button>

        <div class="search-box" (click)="workspaceService.openModal('file-search')">
          <span class="search-icon">🔍</span>
          <span class="search-placeholder">Vector IDE - Search files or symbols</span>
        </div>
      </div>

      <div class="right-section">
        <button
          class="theme-toggle-btn"
          (click)="themeService.toggleTheme()"
          [title]="'Switch to ' + (themeService.currentTheme() === 'light' ? 'Dark' : 'Light') + ' Mode'"
        >
          @if (themeService.currentTheme() === 'light') {
            <span class="theme-icon">🌙</span> Dark Mode
          } @else {
            <span class="theme-icon">☀️</span> Light Mode
          }
        </button>
        <span class="feature-tag">OmniFlux Ready</span>
        <span class="feature-tag">LSP Ready</span>
      </div>
    </header>
  `,
  styles: [
    `
      .header {
        height: 44px;
        background-color: var(--bg-header, #f3f3f3);
        color: var(--text-primary, #333333);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 16px;
        font-size: 14px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        user-select: none;
        border-bottom: 1px solid var(--border-color, #e5e5e5);
        transition: background-color 0.2s ease, border-color 0.2s ease;
      }

      .left-section {
        display: flex;
        align-items: center;
        gap: 10px;

        .app-logo-img {
          width: 18px;
          height: 18px;
          display: block;
          object-fit: contain;
          border-radius: 3px;
        }

        .app-title {
          font-weight: 700;
          font-size: 15px;
          color: var(--text-primary, #333333);
        }

        .active-file-indicator {
          color: var(--text-muted, #717171);
          font-size: 13.5px;
        }
      }

      .center-section {
        flex: 1;
        max-width: 620px;
        margin: 0 16px;
        display: flex;
        align-items: center;
        gap: 8px;

        .nav-action-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          background-color: var(--bg-btn, #e6e6e6);
          color: var(--text-primary, #333333);
          border: 1px solid var(--border-color, #cccccc);
          border-radius: 4px;
          padding: 4px 10px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          white-space: nowrap;
          transition: background-color 0.15s, border-color 0.15s;

          &:hover {
            background-color: var(--bg-btn-hover, #dcdcdc);
            border-color: #007acc;
          }
        }

        .search-box {
          flex: 1;
          background-color: var(--bg-search, #ffffff);
          border: 1px solid var(--border-color, #cecece);
          border-radius: 4px;
          height: 30px;
          display: flex;
          align-items: center;
          padding: 0 12px;
          gap: 8px;
          color: var(--text-muted, #717171);
          font-size: 13.5px;
          cursor: pointer;
          transition: border-color 0.2s ease;

          &:hover {
            border-color: #007acc;
          }
        }
      }

      .right-section {
        display: flex;
        align-items: center;
        gap: 10px;

        .theme-toggle-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          background-color: var(--bg-btn, #e4e4e4);
          color: var(--text-primary, #333333);
          border: 1px solid var(--border-color, #cccccc);
          border-radius: 4px;
          padding: 5px 12px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.15s, border-color 0.15s;

          &:hover {
            background-color: var(--bg-btn-hover, #d8d8d8);
            border-color: #007acc;
          }

          .theme-icon {
            font-size: 14px;
          }
        }

        .feature-tag {
          background-color: #007acc;
          color: #ffffff;
          padding: 4px 10px;
          border-radius: 3px;
          font-size: 12px;
          font-weight: 500;
        }
      }
    `,
  ],
})
export class HeaderComponent {
  public workspaceService = inject(WorkspaceService);
  public themeService = inject(ThemeService);
}
