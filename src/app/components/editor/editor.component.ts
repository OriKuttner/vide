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
  untracked,
} from '@angular/core';
import * as monaco from 'monaco-editor';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import { WorkspaceService } from '../../services/workspace.service';
import { InlineCompletionService } from '../../services/inline-completion.service';
import { AiService } from '../../services/ai.service';
import { ThemeService } from '../../services/theme.service';
import { ZoomService } from '../../services/zoom.service';
import { registerOmniFlux } from '../../languages/omniflux.language';
import { registerAllLanguageSnippets } from '../../languages/snippets.registry';
import {
  WorkspaceFile,
  isImageFile,
  detectLanguage,
  isMarkdownFile,
  isHtmlFile,
  isPreviewableFile,
} from '../../models/file.model';

@Component({
  selector: 'app-editor',
  standalone: true,
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
})
export class EditorComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('editorContainer', { static: true })
  private editorContainer!: ElementRef<HTMLDivElement>;

  @ViewChild('diffContainer', { static: true })
  private diffContainer!: ElementRef<HTMLDivElement>;

  public workspaceService = inject(WorkspaceService);
  public zoomService = inject(ZoomService);
  private inlineCompletionService = inject(InlineCompletionService);
  public aiService = inject(AiService);
  private themeService = inject(ThemeService);
  private sanitizer = inject(DomSanitizer);

  public readonly cursorChange = output<{ line: number; column: number }>();
  public readonly diffChunkCount = signal<number>(0);

  // Markdown & HTML Live Preview state
  public previewSplitPercent = signal<number>(50);
  public isResizingPreview = signal<boolean>(false);

  readonly isCurrentMarkdown = computed(() => {
    const f = this.workspaceService.activeFile();
    return f ? isMarkdownFile(f.name) : false;
  });

  readonly isCurrentHtml = computed(() => {
    const f = this.workspaceService.activeFile();
    return f ? isHtmlFile(f.name) : false;
  });

  readonly isCurrentPreviewable = computed(() => {
    const f = this.workspaceService.activeFile();
    return f ? isPreviewableFile(f.name) : false;
  });

  readonly isPreviewActive = computed(() => {
    const mode = this.workspaceService.previewMode();
    return (mode === 'split' || mode === 'full') && this.isCurrentPreviewable();
  });

  readonly isSplitPreview = computed(() => {
    return this.workspaceService.previewMode() === 'split' && this.isCurrentPreviewable();
  });

  readonly isFullPreview = computed(() => {
    return this.workspaceService.previewMode() === 'full' && this.isCurrentPreviewable();
  });

  readonly renderedMarkdownHtml = computed<SafeHtml>(() => {
    if (!this.isPreviewActive() || !this.isCurrentMarkdown()) {
      return '';
    }
    const f = this.workspaceService.activeFile();
    const rawContent = f?.content ?? '';
    try {
      const parsed = marked.parse(rawContent, {
        async: false,
        gfm: true,
        breaks: true,
      }) as string;
      return this.sanitizer.bypassSecurityTrustHtml(parsed);
    } catch (err) {
      console.error('Error parsing markdown:', err);
      return this.sanitizer.bypassSecurityTrustHtml('<div class="preview-error">Failed to parse Markdown</div>');
    }
  });

  readonly renderedHtmlDoc = computed<string>(() => {
    if (!this.isPreviewActive() || !this.isCurrentHtml()) {
      return '';
    }
    const f = this.workspaceService.activeFile();
    const rawContent = f?.content ?? '';
    const isDoc = /<!doctype\s+html|<html[\s>]/i.test(rawContent);
    if (isDoc) {
      return rawContent;
    }
    const isDark = this.themeService.currentTheme() === 'dark';
    const bg = isDark ? '#1e1e1e' : '#ffffff';
    const color = isDark ? '#d4d4d4' : '#1f2328';
    const fontSize = this.zoomService.editorFontSize();
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
      font-size: ${fontSize}px;
      margin: 16px;
      line-height: 1.5;
      background: ${bg};
      color: ${color};
    }
  </style>
</head>
<body>
${rawContent}
</body>
</html>`;
  });

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
  private aiThinkingWidget: AiThinkingWidget | null = null;

  constructor() {
    // Effect to layout AI thinking widget above cursor when generating state changes
    effect(() => {
      const isGenerating = this.aiService.isGenerating();
      if (this.editorInstance && this.aiThinkingWidget) {
        this.editorInstance.layoutContentWidget(this.aiThinkingWidget);
      }
    });

    // Effect to switch active file in Monaco or reset image viewer
    effect(
      () => {
        const active = this.workspaceService.activeFile();
        if (active) {
          untracked(() => {
            if (active.isImage || isImageFile(active.name)) {
              this.imageZoom.set(1.0);
              this.imageDimensions.set(null);
            } else if (this.editorInstance) {
              this.switchToFile(active);
            }
          });
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

    // Effect to re-layout Monaco editor when preview mode or split changes
    effect(() => {
      this.workspaceService.previewMode();
      this.previewSplitPercent();
      if (this.editorInstance) {
        setTimeout(() => {
          this.editorInstance?.layout();
        }, 30);
      }
    });
  }

  ngOnInit(): void {
    this.initMonacoEnvironment();
    registerOmniFlux(monaco);
    registerAllLanguageSnippets(monaco);
    this.inlineCompletionService.registerProviders(monaco);
    this.registerAiCodeActions();
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

    if (this.aiThinkingWidget && this.editorInstance) {
      this.editorInstance.removeContentWidget(this.aiThinkingWidget);
      this.aiThinkingWidget = null;
    }

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
      acceptSuggestionOnEnter: 'smart',
      wordBasedSuggestions: 'allDocuments',
      snippetSuggestions: 'top',
      stickyScroll: {
        enabled: true,
        maxLineCount: 5,
        defaultModel: 'foldingProviderModel',
      },
    });

    // Floating AI Thinking widget above cursor
    this.aiThinkingWidget = new AiThinkingWidget(this.editorInstance, () => this.aiService.isGenerating());
    this.editorInstance.addContentWidget(this.aiThinkingWidget);

    // Listen to cursor position changes
    this.editorInstance.onDidChangeCursorPosition((e) => {
      this.cursorChange.emit({
        line: e.position.lineNumber,
        column: e.position.column,
      });
      if (this.aiThinkingWidget && this.aiService.isGenerating()) {
        this.editorInstance?.layoutContentWidget(this.aiThinkingWidget);
      }
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
          (!activeFile.language || activeFile.language === 'plaintext') &&
          val.length < 50000
        ) {
          const detected = detectLanguage(activeFile.name, val);
          if (detected !== 'plaintext' && detected !== activeFile.language) {
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

    // Keyboard shortcut: Ctrl+Shift+V to toggle preview if active file is previewable
    this.editorInstance.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyV,
      () => {
        if (this.isCurrentPreviewable()) {
          this.workspaceService.togglePreview();
        }
      }
    );

    // Keyboard shortcut / Command: Ctrl+Alt+P (Cmd+Alt+P) to propagate edit pattern to following lines
    this.editorInstance.addAction({
      id: 'vide.ai.propagatePattern',
      label: '✨ AI: Propagate Edit Pattern to Following Lines',
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyP,
      ],
      contextMenuGroupId: 'modification',
      contextMenuOrder: 1.5,
      run: async (ed) => {
        await this.propagateEditPattern(ed);
      },
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
      if (this.isProgrammaticUpdate) return;
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

    this.isProgrammaticUpdate = true;
    try {
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
    } finally {
      this.isProgrammaticUpdate = false;
    }
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
      if ((!file.language || file.language === 'plaintext') && currentContent) {
        const detected = detectLanguage(file.name, currentContent);
        if (detected !== 'plaintext' && detected !== file.language) {
          file.language = detected;
          monaco.editor.setModelLanguage(model, detected);
          untracked(() => {
            this.workspaceService.updateFileLanguage(file.id, detected);
          });
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

  public onStartResizePreview(event: MouseEvent): void {
    event.preventDefault();
    this.isResizingPreview.set(true);

    const stageEl = this.editorContainer.nativeElement.parentElement;
    if (!stageEl) return;

    const onMouseMove = (e: MouseEvent) => {
      const rect = stageEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      const offsetX = e.clientX - rect.left;
      let percent = (offsetX / rect.width) * 100;
      percent = Math.max(20, Math.min(80, percent));
      this.previewSplitPercent.set(Math.round(percent * 10) / 10);
    };

    const onMouseUp = () => {
      this.isResizingPreview.set(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      this.editorInstance?.layout();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  private registerAiCodeActions(): void {
    const supportedLanguages = [
      'omniflux',
      'php',
      'typescript',
      'javascript',
      'c',
      'cpp',
      'python',
      'rust',
      'json',
      'html',
      'css',
      'shell',
      'perl',
    ];

    // Register global handler for AI syntax quick-fix command
    monaco.editor.registerCommand(
      'vide.ai.applySyntaxFix',
      async (_accessor: any, uri: monaco.Uri, range: monaco.IRange, message: string, lang: string) => {
        const model = monaco.editor.getModel(uri);
        if (!model) return;

        const snippet = model.getValueInRange(range);
        this.workspaceService.showNotification('✨ AI is repairing syntax error...');
        const fixed = await this.aiService.fixSyntaxError(snippet, message, lang);
        if (fixed && fixed.trim().length > 0) {
          model.pushEditOperations(
            [],
            [
              {
                range: range,
                text: fixed,
                forceMoveMarkers: true,
              },
            ],
            () => null
          );
          this.workspaceService.showNotification('✓ Syntax error fixed by AI');
        } else {
          this.workspaceService.showNotification('Could not generate syntax fix');
        }
      }
    );

    for (const lang of supportedLanguages) {
      monaco.languages.registerCodeActionProvider(lang, {
        provideCodeActions: (model, _range, context) => {
          if (!this.aiService.isEnabled() || !this.aiService.isServerOnline()) {
            return { actions: [], dispose: () => {} };
          }

          const markers = context.markers.filter(
            (m) =>
              m.severity === monaco.MarkerSeverity.Error ||
              m.severity === monaco.MarkerSeverity.Warning
          );

          if (markers.length === 0) {
            return { actions: [], dispose: () => {} };
          }

          const actions: monaco.languages.CodeAction[] = [];

          for (const marker of markers) {
            const startLine = Math.max(1, marker.startLineNumber - 2);
            const endLine = Math.min(model.getLineCount(), marker.endLineNumber + 2);
            const snippetRange = new monaco.Range(
              startLine,
              1,
              endLine,
              model.getLineMaxColumn(endLine)
            );

            actions.push({
              title: `✨ AI Fix: ${marker.message.substring(0, 55)}`,
              kind: 'quickfix',
              isPreferred: true,
              isAI: true,
              diagnostics: [marker],
              command: {
                id: 'vide.ai.applySyntaxFix',
                title: 'Apply AI Syntax Fix',
                arguments: [model.uri, snippetRange, marker.message, lang],
              },
            });
          }

          return {
            actions,
            dispose: () => {},
          };
        },
      });
    }
  }

  private async propagateEditPattern(ed: monaco.editor.ICodeEditor): Promise<void> {
    if (!this.aiService.isEnabled() || !this.aiService.isServerOnline()) {
      this.workspaceService.showNotification('AI server is offline. Check AI Settings.');
      return;
    }

    const model = ed.getModel();
    const selection = ed.getSelection();
    if (!model || !selection) return;

    let originalLine = '';
    let editedLine = '';
    let targetRange: monaco.Range | null = null;
    let targetLines: string[] = [];

    // Case 1: Multi-line selection. Line 1 is the template/edited line, remainder are targets.
    if (selection.startLineNumber < selection.endLineNumber) {
      const startLine = selection.startLineNumber;
      const endLine = selection.endLineNumber;
      editedLine = model.getLineContent(startLine);

      // Try to find originalLine from savedContent if available
      const activeFile = this.workspaceService.activeFile();
      const savedLines = activeFile?.savedContent ? activeFile.savedContent.split('\n') : [];
      originalLine = savedLines[startLine - 1] || editedLine;

      for (let ln = startLine + 1; ln <= endLine; ln++) {
        targetLines.push(model.getLineContent(ln));
      }
      targetRange = new monaco.Range(
        startLine + 1,
        1,
        endLine,
        model.getLineMaxColumn(endLine)
      );
    } else {
      // Case 2: Cursor on a single line.
      const currentLineNum = selection.positionLineNumber;
      editedLine = model.getLineContent(currentLineNum);

      const activeFile = this.workspaceService.activeFile();
      const savedLines = activeFile?.savedContent ? activeFile.savedContent.split('\n') : [];
      originalLine = savedLines[currentLineNum - 1] || '';

      if (!originalLine || originalLine === editedLine) {
        this.workspaceService.showNotification(
          'Select the edited line and target lines, or edit a saved line to propagate pattern.'
        );
        return;
      }

      // Collect next 1 to 5 non-empty lines as targets
      const maxLine = Math.min(model.getLineCount(), currentLineNum + 5);
      for (let ln = currentLineNum + 1; ln <= maxLine; ln++) {
        const content = model.getLineContent(ln);
        if (content.trim().length > 0) {
          targetLines.push(content);
        } else {
          break; // Stop at empty lines
        }
      }

      if (targetLines.length === 0) {
        this.workspaceService.showNotification('No following lines found to propagate pattern.');
        return;
      }

      const endTargetLine = currentLineNum + targetLines.length;
      targetRange = new monaco.Range(
        currentLineNum + 1,
        1,
        endTargetLine,
        model.getLineMaxColumn(endTargetLine)
      );
    }

    this.workspaceService.showNotification('✨ AI is propagating edit pattern...');
    const transformed = await this.aiService.suggestPatternEdits(originalLine, editedLine, targetLines);

    if (transformed && transformed.length === targetLines.length && targetRange) {
      model.pushEditOperations(
        [],
        [
          {
            range: targetRange,
            text: transformed.join('\n'),
            forceMoveMarkers: true,
          },
        ],
        () => null
      );
      this.workspaceService.showNotification(`✓ AI pattern applied to ${transformed.length} line(s)`);
    } else {
      this.workspaceService.showNotification('Could not propagate edit pattern');
    }
  }
}

class AiThinkingWidget implements monaco.editor.IContentWidget {
  public static readonly ID = 'vide.ai.thinking.widget';
  private readonly domNode: HTMLElement;

  constructor(
    private readonly editor: monaco.editor.IStandaloneCodeEditor,
    private readonly isGeneratingFn: () => boolean
  ) {
    this.domNode = document.createElement('div');
    this.domNode.className = 'monaco-ai-thinking-widget';
    this.domNode.innerHTML = `
      <div class="monaco-ai-thinking-pill" title="AI is thinking...">
        <span class="ai-widget-sparkle">✨</span>
        <span class="ai-widget-text">Thinking...</span>
      </div>
    `;
  }

  getId(): string {
    return AiThinkingWidget.ID;
  }

  getDomNode(): HTMLElement {
    return this.domNode;
  }

  getPosition(): monaco.editor.IContentWidgetPosition | null {
    if (!this.isGeneratingFn()) {
      this.domNode.style.display = 'none';
      return null;
    }

    const pos = this.editor.getPosition();
    if (!pos) {
      this.domNode.style.display = 'none';
      return null;
    }

    this.domNode.style.display = '';
    return {
      position: pos,
      preference: [
        monaco.editor.ContentWidgetPositionPreference.ABOVE,
        monaco.editor.ContentWidgetPositionPreference.BELOW,
      ],
    };
  }
}

