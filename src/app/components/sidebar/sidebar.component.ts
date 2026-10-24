/**
 * sidebar.component.ts - Sidebar component managing file tree, search, and git status
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import { Component, inject, signal, computed, ViewChild, ElementRef, effect, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkspaceService, GrepResult, FileGrepGroup } from '../../services/workspace.service';
import { AiService } from '../../services/ai.service';
import { WorkspaceFile, FileTreeNode, isImageFile, isOmniFluxFile, isPhpFile, isPerlFile, isBinaryFile } from '../../models/file.model';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  public workspaceService = inject(WorkspaceService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);

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
      this.workspaceService.isScanning();
      this.workspaceService.scanProgress();
      this.workspaceService.fileTree();
      this.cdr.detectChanges();
    });

    effect(() => {
      const view = this.workspaceService.sidebarView();
      if (view === 'search') {
        setTimeout(() => {
          this.searchInputRef?.nativeElement?.focus();
          this.searchInputRef?.nativeElement?.select();
        }, 60);
      }
    });

    effect(() => {
      const activeId = this.workspaceService.activeFileId();
      this.workspaceService.fileTree();
      if (activeId) {
        setTimeout(() => {
          const activeEl = document.querySelector('.tree-row.file.active');
          if (activeEl) {
            activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }, 120);
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

  public isBinaryNode(item: WorkspaceFile | FileTreeNode | undefined | null): boolean {
    if (!item) return false;
    if ('isBinary' in item && item.isBinary) return true;
    const lang = ('language' in item ? item.language : '') || '';
    if (lang === 'binary') return true;
    const name = item.name || '';
    return isBinaryFile(name);
  }

  public getFileIcon(file: WorkspaceFile | FileTreeNode): string {
    if (this.isBinaryNode(file)) {
      return 'BIN';
    }
    if (file.language === 'image' || isImageFile(file.name)) {
      return 'IMG';
    }
    switch (file.language) {
      case 'binary':
        return 'BIN';
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
      case 'xml':
        return 'XML';
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

  public onDeleteFileFromTree(node: any, event: MouseEvent): void {
    event.stopPropagation();
    const file = node?.file || (node?.path ? node : this.workspaceService.files().find((f: any) => f.path === node?.path || f.id === node?.id));
    if (file) {
      this.workspaceService.confirmDeleteFile(file);
    }
  }

  public onUntrackFile(file: WorkspaceFile, event: MouseEvent): void {
    event.stopPropagation();
    this.workspaceService.confirmGitUntrackFile(file);
  }

  // Git Commit & History state
  public aiService = inject(AiService);
  public commitMessage = signal<string>('');
  public commitsExpanded = signal<boolean>(true);
  public readonly isPushing = signal<boolean>(false);
  public readonly isCommitting = signal<boolean>(false);
  public readonly isCommitAndPushing = signal<boolean>(false);
  public readonly isGeneratingCommitNote = signal<boolean>(false);

  public async generateAiCommitNote(): Promise<void> {
    const wsPath = this.workspaceService.nativeWorkspacePath();
    if (!wsPath) {
      this.workspaceService.showNotification('Workspace path not available');
      return;
    }

    if (!this.aiService.isServerOnline()) {
      this.workspaceService.showNotification('AI server is offline. Check AI Settings.');
      return;
    }

    this.isGeneratingCommitNote.set(true);
    this.workspaceService.showNotification('✨ AI is generating commit note...');
    try {
      const note = await this.aiService.generateCommitNote(wsPath);
      this.commitMessage.set(note);
      this.workspaceService.showNotification('✓ Commit note generated');
    } catch (err: any) {
      this.workspaceService.showNotification(`AI Error: ${err.message || err}`);
    } finally {
      this.isGeneratingCommitNote.set(false);
      this.cdr.detectChanges();
    }
  }

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
    if (
      !msg ||
      !this.canCommit() ||
      this.isCommitting() ||
      this.workspaceService.isCommitting() ||
      this.isPushing() ||
      this.workspaceService.isPushing()
    ) {
      return;
    }

    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

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

  public async submitCommitAndPush(): Promise<void> {
    const msg = this.commitMessage().trim();
    if (
      !msg ||
      !this.canCommit() ||
      this.isCommitting() ||
      this.workspaceService.isCommitting() ||
      this.isPushing() ||
      this.workspaceService.isPushing()
    ) {
      return;
    }

    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    this.isCommitAndPushing.set(true);
    this.isCommitting.set(true);
    this.cdr.detectChanges();
    await new Promise((r) => setTimeout(r, 40));

    try {
      const success = await this.workspaceService.commitChanges(msg);
      if (success) {
        this.commitMessage.set('');
        await this.workspaceService.pushChanges();
      }
    } finally {
      this.ngZone.run(() => {
        this.isCommitting.set(false);
        this.isCommitAndPushing.set(false);
        this.cdr.detectChanges();
      });
    }
  }

  public async submitPush(): Promise<void> {
    if (this.isPushing() || this.workspaceService.isPushing() || this.isCommitting() || this.workspaceService.isCommitting()) return;

    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

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
