/**
 * search-modal.component.ts - Command palette, quick open, search & AI settings modal dialog
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import {
  Component,
  ElementRef,
  ViewChild,
  HostListener,
  inject,
  signal,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WorkspaceService, GrepResult } from '../../services/workspace.service';
import { AiService } from '../../services/ai.service';
import { AssistantService } from '../../services/assistant.service';
import { WorkspaceFile, isOmniFluxFile, isPhpFile, isPerlFile, GitBranchItem, GitCommitDetails } from '../../models/file.model';

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
  templateUrl: './search-modal.component.html',
  styleUrl: './search-modal.component.scss',
})
export class SearchModalComponent {
  @ViewChild('inputField') private inputField?: ElementRef<HTMLInputElement>;

  public workspaceService = inject(WorkspaceService);
  public aiService = inject(AiService);
  public assistantService = inject(AssistantService);

  public inputValue = signal<string>('');
  public grepResults = signal<GrepResult[]>([]);
  public fileResults = signal<WorkspaceFile[]>([]);
  public isSearching = signal<boolean>(false);

  // Indentation configuration state
  public selectedIndentType = signal<'tabs' | 'spaces'>('tabs');
  public selectedTabSize = signal<number>(4);
  public initialIndentType = signal<'tabs' | 'spaces'>('tabs');
  public initialTabSize = signal<number>(4);

  // Language selection state
  public languageResults = signal<LanguageItem[]>(SUPPORTED_LANGUAGES);

  // Git Branches & Tags state
  public filteredBranches = signal<GitBranchItem[]>([]);
  public filteredTags = signal<string[]>([]);
  public tagMessage = signal<string>('');

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
        } else if (mode === 'git-branches') {
          this.filteredBranches.set(this.workspaceService.gitBranches());
          this.filteredTags.set(this.workspaceService.gitTags());
        } else if (mode === 'git-create-tag') {
          this.tagMessage.set('');
        } else if (mode === 'indentation') {
          this.selectedIndentType.set(this.workspaceService.indentType());
          this.selectedTabSize.set(this.workspaceService.tabSize());
          this.initialIndentType.set(this.workspaceService.indentType());
          this.initialTabSize.set(this.workspaceService.tabSize());
        } else if (mode === 'open-folder-path') {
          this.inputValue.set(this.workspaceService.nativeWorkspacePath() || '/home/ori/work/vide');
        } else if (mode === 'ai-settings') {
          // Gemini cloud settings
        }

        setTimeout(() => {
          this.inputField?.nativeElement?.focus();
        }, 50);
      }
    });

    effect(() => {
      const branches = this.workspaceService.gitBranches();
      const tags = this.workspaceService.gitTags();
      if (this.workspaceService.activeModal() === 'git-branches') {
        const q = this.inputValue().trim().toLowerCase();
        if (!q) {
          this.filteredBranches.set(branches);
          this.filteredTags.set(tags);
        } else {
          this.filteredBranches.set(branches.filter((b) => b.name.toLowerCase().includes(q)));
          this.filteredTags.set(tags.filter((t) => t.toLowerCase().includes(q)));
        }
      }
    });
  }

  public async testGeminiKey(): Promise<void> {
    const success = await this.aiService.testGeminiConnection();
    if (success) {
      this.workspaceService.showNotification('✓ Gemini API connection successful!');
    } else {
      const err = this.aiService.lastApiError() || 'Connection failed';
      this.workspaceService.showNotification(`Gemini API Error: ${err}`);
    }
  }

  public async testChatKey(): Promise<void> {
    const success = await this.aiService.testChatGeminiConnection();
    if (success) {
      this.workspaceService.showNotification('✓ Chat Gemini API connection successful!');
    } else {
      const err = this.aiService.lastChatApiError() || 'Connection failed';
      this.workspaceService.showNotification(`Chat Gemini API Error: ${err}`);
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
      case 'git-branches':
        return 'Git: Switch or Create Branch';
      case 'git-create-tag':
        return 'Git: Create Tag';
      case 'unsaved-changes':
        return 'Save Changes?';
      case 'ai-settings':
        return 'AI Assistant Configuration (Google Gemini)';
      case 'references':
        return `References: ${this.workspaceService.pendingReferencesSymbol()}`;
      case 'git-commit-details': {
        const c = this.workspaceService.pendingCommitDetails();
        return c ? `Commit ${c.short_hash}: ${c.subject}` : 'Git Commit Details';
      }
      default:
        return '';
    }
  }

  public getLabel(): string {
    switch (this.workspaceService.activeModal()) {
      case 'unsaved-changes':
      case 'ai-settings':
      case 'references':
      case 'git-commit-details':
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
      case 'git-branches':
        return 'Select a branch to checkout, or type a new name to create:';
      case 'git-create-tag':
        return 'Enter tag name (e.g. v1.0.0):';
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
    } else if (mode === 'git-branches') {
      const q = val.trim().toLowerCase();
      const all = this.workspaceService.gitBranches();
      const allTags = this.workspaceService.gitTags();
      if (!q) {
        this.filteredBranches.set(all);
        this.filteredTags.set(allTags);
      } else {
        this.filteredBranches.set(all.filter((b) => b.name.toLowerCase().includes(q)));
        this.filteredTags.set(allTags.filter((t) => t.toLowerCase().includes(q)));
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
    } else if (mode === 'git-branches') {
      if (!val) {
        const first = this.filteredBranches()[0];
        if (first) {
          this.selectBranch(first);
        } else {
          const firstTag = this.filteredTags()[0];
          if (firstTag) this.selectTag(firstTag);
        }
      } else {
        const exact = this.workspaceService.gitBranches().find((b) => b.name.toLowerCase() === val.toLowerCase());
        const exactTag = this.workspaceService.gitTags().find((t) => t.toLowerCase() === val.toLowerCase());
        if (exact) {
          this.selectBranch(exact);
        } else if (exactTag) {
          this.selectTag(exactTag);
        } else {
          this.createAndSwitchBranch(val);
        }
      }
    } else if (mode === 'git-create-tag') {
      this.submitCreateTag();
    } else if (mode === 'grep') {
      const results = this.grepResults();
      if (results.length > 0) {
        this.workspaceService.jumpToLine(results[0].file, results[0].lineNumber);
      }
    }
  }

  public canCreateBranchFromInput(): boolean {
    const q = this.inputValue().trim();
    if (!q) return false;
    const inBranches = this.workspaceService.gitBranches().some(
      (b) => b.name.toLowerCase() === q.toLowerCase() || b.name.toLowerCase() === `origin/${q.toLowerCase()}`
    );
    const inTags = this.workspaceService.gitTags().some((t) => t.toLowerCase() === q.toLowerCase());
    return !inBranches && !inTags;
  }

  public selectBranch(branch: GitBranchItem): void {
    if (branch.is_current) {
      this.close();
      return;
    }
    this.close();
    this.workspaceService.switchGitBranch(branch.name);
  }

  public selectTag(tagName: string): void {
    this.close();
    this.workspaceService.switchGitBranch(tagName);
  }

  public createAndSwitchBranch(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.close();
    this.workspaceService.createGitBranch(trimmed, true);
  }

  public openCreateTagModal(): void {
    this.workspaceService.openModal('git-create-tag');
  }

  public submitCreateTag(): void {
    const name = this.inputValue().trim();
    if (!name) return;
    const msg = this.tagMessage().trim();
    this.close();
    this.workspaceService.createGitTag(name, msg || undefined);
  }

  public async setFolderQuickPath(path: string): Promise<void> {
    this.inputValue.set(path);
    await this.workspaceService.openDirectoryByPath(path);
  }

  public applyIndentation(): void {
    this.workspaceService.setIndentation(this.selectedIndentType(), this.selectedTabSize());
  }

  public convertIndentation(): void {
    this.workspaceService.convertActiveFileIndentation(
      this.selectedIndentType(),
      this.selectedTabSize(),
      this.initialIndentType(),
      this.initialTabSize()
    );
    this.close();
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

  @HostListener('window:keydown.escape')
  public onEscapeKey(): void {
    if (this.workspaceService.activeModal()) {
      this.close();
    }
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

  public jumpToReference(result: GrepResult): void {
    this.workspaceService.jumpToLine(result.file, result.lineNumber);
    this.close();
  }

  // --- Git Commit Details modal state & helpers ---
  public copiedStates = signal<{ [key: string]: boolean }>({});

  public copyToClipboard(text: string, key: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        this.copiedStates.update((s) => ({ ...s, [key]: true }));
        setTimeout(() => {
          this.copiedStates.update((s) => ({ ...s, [key]: false }));
        }, 2000);
      });
    }
  }

  public isCopied(key: string): boolean {
    return !!this.copiedStates()[key];
  }

  public analyzeCommitWithAi(commit: GitCommitDetails): void {
    const fileList = commit.files
      .map((f) => `• [${f.status}] ${f.path} (+${f.insertions}, -${f.deletions})`)
      .join('\n');
    const prompt = `Please analyze and explain this Git commit (${commit.short_hash}): "${commit.subject}".\n\nAuthor: ${commit.author_name} <${commit.author_email}>\nDate: ${commit.author_date} (${commit.author_date_relative})\nSummary: ${commit.stat_summary}\n\nChanged Files:\n${fileList}\n\nCommit Message:\n${commit.subject}\n${commit.body ? '\n' + commit.body : ''}\n\nPlease walk through the architectural intent, key logic modifications, and potential implications of these changes.`;

    this.assistantService.openChat();
    this.assistantService.sendMessage(prompt);
  }

  public async openFileFromCommit(path: string): Promise<void> {
    this.close();
    await this.workspaceService.openFileByPath(path);
  }

  public canExplainWithAi(): boolean {
    return this.assistantService.showFloatingButton() && this.aiService.isChatConfigured();
  }

  public getAiExplainTooltip(): string {
    if (!this.aiService.isChatConfigured()) {
      return 'Please configure an API key in AI Settings to use AI explanations';
    }
    if (!this.assistantService.showFloatingButton()) {
      return 'Please enable "Show Floating Agent Button" in AI Settings to use AI explanations';
    }
    return 'Analyze and explain this commit with Vector AI';
  }
}
