import { Component, input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkspaceService } from '../../services/workspace.service';
import { ZoomService } from '../../services/zoom.service';
import { AiService } from '../../services/ai.service';

@Component({
  selector: 'app-status-bar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <footer class="status-bar">
      <div class="left-group">
        @if (workspaceService.gitBranch()) {
          <button
            type="button"
            class="status-btn branch-btn"
            (click)="workspaceService.openModal('git-branches')"
            [title]="'Current Git Branch: ' + workspaceService.gitBranch() + ' (Click to switch or create branch)'"
          >
            <span class="icon">⎇</span> {{ workspaceService.gitBranch() }}
          </button>
        }

        <button
          type="button"
          class="status-btn git-changes-badge"
          (click)="workspaceService.toggleSidebarView('git-changes')"
          title="Click to view changed files compared to last commit"
        >
          <span class="git-diff-symbol">±</span>
          <span>{{ workspaceService.changedFiles().length }} changed</span>
        </button>

        @if (workspaceService.isRealWorkspace()) {
          <button
            type="button"
            class="status-btn terminal-badge"
            (click)="workspaceService.openSystemTerminal()"
            [title]="'Open System Terminal in ' + (workspaceService.nativeWorkspacePath() || 'workspace')"
          >
            <svg class="terminal-svg" viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
              <path d="M0 3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3zm2-1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H2z"/>
              <path d="M5.854 5.646a.5.5 0 0 1 0 .708L3.707 8.5l2.147 2.146a.5.5 0 0 1-.708.708l-2.5-2.5a.5.5 0 0 1 0-.708l2.5-2.5a.5.5 0 0 1 .708 0zM8 10.5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1-.5-.5z"/>
            </svg>
            <span>Terminal</span>
          </button>
        }

        @if (workspaceService.diffModeActive() && workspaceService.activeDiffFile(); as activeDiff) {
          <button
            type="button"
            class="status-btn active-diff-badge"
            (click)="workspaceService.closeDiffView()"
            title="Currently in Meld Diff mode - Click to return to Editor"
          >
            <span class="diff-icon">◫</span>
            <span>Diff: {{ activeDiff.name }}</span>
            <span class="close-x">✕</span>
          </button>
        }

        @if (workspaceService.statusNotification()) {
          <span class="status-item notification">
            📢 {{ workspaceService.statusNotification() }}
          </span>
        }
      </div>

      <div class="right-group">
        <span class="status-item">
          Ln {{ cursor().line }}, Col {{ cursor().column }}
        </span>

        <button
          type="button"
          class="status-btn"
          (click)="workspaceService.openModal('indentation')"
          title="Select Indentation Mode"
        >
          {{ indentationLabel() }}
        </button>

        <span class="status-item">UTF-8</span>

        <button
          type="button"
          class="status-btn zoom-badge"
          (click)="cycleZoom()"
          [title]="'Zoom: ' + zoomService.zoomPercentage() + '% (Ctrl + / Ctrl - to zoom, Ctrl 0 to reset)'"
        >
          <span class="zoom-icon">🔍</span>
          <span>{{ zoomService.zoomPercentage() }}%</span>
        </button>

        <button
          type="button"
          class="status-btn language-badge"
          (click)="workspaceService.openModal('change-language')"
          title="Select Language Mode (Change Syntax Coloring)"
        >
          {{ activeLanguageLabel() }}
        </button>

        <button
          type="button"
          class="status-btn ai-badge"
          [class.online]="aiService.isServerOnline() && !aiService.isGenerating()"
          [class.thinking]="aiService.isGenerating()"
          [class.offline]="!aiService.isServerOnline()"
          (click)="workspaceService.openModal('ai-settings')"
          [title]="aiService.isGenerating() ? 'AI is generating code...' : (aiService.isServerOnline() ? 'AI Server Online (' + aiService.endpoint() + ') - Click for Settings' : 'AI Server Offline - Click to Configure / Start')"
        >
          <span class="ai-sparkle" [class.spinning]="aiService.isGenerating()">✨</span>
          <span>AI: {{ aiService.isGenerating() ? 'Thinking...' : (aiService.isServerOnline() ? 'Online' : 'Offline') }}</span>
        </button>
      </div>
    </footer>
  `,
  styles: [
    `
      .status-bar {
        height: 28px;
        background-color: #007acc;
        color: #ffffff;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 14px;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        user-select: none;
      }

      .left-group,
      .right-group {
        display: flex;
        align-items: center;
        gap: 14px;
      }

      .status-item {
        display: flex;
        align-items: center;
        gap: 5px;
        cursor: default;

        &.branch {
          font-weight: 600;
          letter-spacing: 0.2px;

          .icon {
            font-size: 14px;
          }
        }

        &.notification {
          background-color: #388a34;
          padding: 2px 10px;
          border-radius: 4px;
          font-weight: 600;
          animation: fadeIn 0.2s ease;
        }
      }

      .status-btn {
        background: transparent;
        border: none;
        color: #ffffff;
        font-size: 13px;
        font-family: inherit;
        padding: 3px 8px;
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 5px;
        transition: background-color 0.15s ease;

        &:hover {
          background-color: rgba(255, 255, 255, 0.2);
        }

        &.git-changes-badge {
          background-color: rgba(255, 255, 255, 0.15);
          font-weight: 600;
          border-radius: 4px;
          padding: 2px 9px;
          display: flex;
          align-items: center;
          gap: 5px;

          .git-diff-symbol {
            font-weight: 700;
            font-size: 15px;
          }

          &:hover {
            background-color: rgba(255, 255, 255, 0.3);
          }
        }

        &.terminal-badge {
          background-color: rgba(255, 255, 255, 0.12);
          font-weight: 500;
          padding: 2px 8px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          gap: 5px;

          &:hover {
            background-color: rgba(255, 255, 255, 0.25);
          }

          .terminal-svg {
            display: block;
          }
        }

        &.active-diff-badge {
          background-color: #2e7d32;
          font-weight: 600;
          border-radius: 4px;
          padding: 2px 9px;
          display: flex;
          align-items: center;
          gap: 6px;

          .diff-icon {
            font-size: 14px;
          }

          .close-x {
            opacity: 0.8;
            font-size: 12px;
            margin-left: 2px;
          }

          &:hover {
            background-color: #1b5e20;
          }
        }

        &.zoom-badge {
          font-weight: 600;
          letter-spacing: 0.2px;
          background-color: rgba(255, 255, 255, 0.12);

          .zoom-icon {
            font-size: 11px;
            opacity: 0.9;
          }

          &:hover {
            background-color: rgba(255, 255, 255, 0.25);
          }
        }

        &.language-badge {
          font-weight: 700;
        }

        &.ai-badge {
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 1px 7px;
          border-radius: 3px;

          &.online {
            background-color: rgba(46, 160, 67, 0.28);
            color: #d4f7dc;
            .ai-sparkle {
              color: #56d364;
            }
          }

          &.thinking {
            background: linear-gradient(135deg, rgba(138, 43, 226, 0.45), rgba(75, 0, 130, 0.45));
            color: #f3e8ff;
            border: 1px solid rgba(192, 132, 252, 0.55);
            animation: pulse-glow 1.4s ease-in-out infinite alternate;
            .ai-sparkle {
              color: #f3e8ff;
              display: inline-block;
            }
          }

          &.offline {
            background-color: rgba(255, 255, 255, 0.08);
            opacity: 0.85;
            .ai-sparkle {
              color: #ffd166;
            }
          }

          .spinning {
            display: inline-block;
            animation: sparkle-spin 1.2s linear infinite;
          }
        }
      }

      @keyframes sparkle-spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      @keyframes pulse-glow {
        0% {
          box-shadow: 0 0 3px rgba(168, 85, 247, 0.3);
        }
        100% {
          box-shadow: 0 0 10px rgba(168, 85, 247, 0.8);
        }
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(2px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `,
  ],
})
export class StatusBarComponent {
  public cursor = input<{ line: number; column: number }>({ line: 1, column: 1 });

  public workspaceService = inject(WorkspaceService);
  public zoomService = inject(ZoomService);
  public aiService = inject(AiService);

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
    const lang = file.language;
    switch (lang.toLowerCase()) {
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
