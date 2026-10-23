/**
 * assistant.service.ts - Vector AI Chat Assistant service powered by Google Gemini with project workspace tools
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import { Injectable, inject, signal, computed } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { AiService } from './ai.service';
import { WorkspaceService, isTauriApp, terminalLog } from './workspace.service';

export interface AssistantInfo {
  identifier: string;
  name: string;
  title: string;
  image?: string;
  greeting: string;
}

export interface ThinkingStep {
  type: 'thought' | 'tool';
  text: string;
  tool?: string;
  done?: boolean;
  timestamp?: string;
}

export interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant' | 'system';
  message: string;
  model?: string;
  elapsed?: number;
  tokens?: number;
  executed_tools?: string | null;
  thoughts?: string | null;
  steps?: ThinkingStep[];
  tm?: string;
  created_at?: string;
}

export const VECTOR_AGENT: AssistantInfo = {
  identifier: 'vector-ai',
  name: 'Vector AI',
  title: 'Senior Coding Assistant',
  greeting: 'Hello! I am Vector AI, your coding assistant. Ask me questions about your code, active files, or have me inspect, navigate, and edit files in your workspace.'
};

@Injectable({
  providedIn: 'root'
})
export class AssistantService {
  private aiService = inject(AiService);
  private workspaceService = inject(WorkspaceService);

  readonly assistants = signal<AssistantInfo[]>([VECTOR_AGENT]);
  readonly currentAgent = signal<AssistantInfo>(VECTOR_AGENT);

  readonly sessionToken = signal<string | null>('local-gemini');
  readonly isAuthenticated = computed(() => this.aiService.isChatConfigured());

  readonly feed = signal<ChatMessage[]>(this.getInitialFeed());
  readonly isLoading = signal<boolean>(false);
  readonly isRefreshing = signal<boolean>(false);
  readonly isFeedLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  // Floating agent button visibility (persisted in localStorage)
  readonly showFloatingButton = signal<boolean>(this.getInitialFloatingButtonState());

  // Chat window open state
  readonly isChatOpen = signal<boolean>(false);

  // Live thinking steps state
  readonly isAwaitingResponse = signal<boolean>(false);
  readonly isToolRunning = signal<boolean>(false);
  readonly agentThought = signal<string>('');
  readonly thinkingSteps = signal<ThinkingStep[]>([]);

  private sharedAudioCtx: AudioContext | null = null;
  private activeAbortController: AbortController | null = null;

  constructor() {}

  private getInitialFeed(): ChatMessage[] {
    if (typeof localStorage !== 'undefined') {
      try {
        const cached = localStorage.getItem('vide_chat_feed');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
    }
    return [];
  }

  private saveFeedToStorage(messages: ChatMessage[]): void {
    if (typeof localStorage !== 'undefined') {
      try {
        // Keep the last 50 messages to prevent unbounded growth
        const trimmed = messages.slice(-50);
        localStorage.setItem('vide_chat_feed', JSON.stringify(trimmed));
      } catch {}
    }
  }

  private getInitialFloatingButtonState(): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
      return localStorage.getItem('vide_show_agent_floating_btn') === 'true';
    } catch {
      return false;
    }
  }

  public setShowFloatingButton(val: boolean): void {
    this.showFloatingButton.set(val);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('vide_show_agent_floating_btn', val ? 'true' : 'false');
      } catch {}
    }
  }

  public toggleFloatingButton(): void {
    this.setShowFloatingButton(!this.showFloatingButton());
  }

  public openChat(): void {
    this.isChatOpen.set(true);
  }

  public closeChat(): void {
    this.isChatOpen.set(false);
  }

  public toggleChat(): void {
    this.isChatOpen.set(!this.isChatOpen());
  }

  public async selectAgent(agent: AssistantInfo): Promise<void> {
    this.currentAgent.set(agent);
  }

  public async loadAssistants(): Promise<void> {
    // Single local Vector agent
    this.assistants.set([VECTOR_AGENT]);
  }

  public async refresh(): Promise<void> {
    this.errorMessage.set(null);
  }

  public clearFeed(): void {
    this.feed.set([]);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('vide_chat_feed');
    }
  }

  public cancelCurrentRequest(): void {
    terminalLog('AI_CHAT', 'User clicked Stop Generation. Aborting active request...');
    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort('User cancelled request');
      } catch (e) {}
      this.activeAbortController = null;
    }
    this.isLoading.set(false);
    this.isAwaitingResponse.set(false);
    this.feed.update(f => [
      ...f,
      {
        role: 'system',
        message: 'Generation stopped by user.',
        tm: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      }
    ]);
    terminalLog('AI_CHAT', 'Active request aborted and state reset to idle.');
  }

  // --- Gemini Tools Definition ---
  private getGeminiTools() {
    return [
      {
        functionDeclarations: [
          {
            name: 'list_files',
            description: 'Lists files and directories in the current project workspace. Optionally inside a relative subdirectory.',
            parameters: {
              type: 'OBJECT',
              properties: {
                subpath: {
                  type: 'STRING',
                  description: 'Optional relative subdirectory path inside the project workspace (e.g. "src/app"). Defaults to root.'
                }
              }
            }
          },
          {
            name: 'read_file',
            description: 'Reads the text content of a project file (read-only). Restricted strictly to files inside the project workspace.',
            parameters: {
              type: 'OBJECT',
              properties: {
                path: {
                  type: 'STRING',
                  description: 'Relative path of the project file to read (e.g. "src/app/models/file.model.ts").'
                }
              },
              required: ['path']
            }
          },
          {
            name: 'replace_text',
            description: 'Replaces specific target text with replacement text in a project file (or currently active file in the editor).',
            parameters: {
              type: 'OBJECT',
              properties: {
                target: {
                  type: 'STRING',
                  description: 'Exact text string to find and replace in the file.'
                },
                replacement: {
                  type: 'STRING',
                  description: 'New replacement text to insert.'
                },
                path: {
                  type: 'STRING',
                  description: 'Optional relative path of the file to edit. If omitted, edits the currently active file.'
                },
                all: {
                  type: 'BOOLEAN',
                  description: 'Whether to replace all occurrences (true) or just the first occurrence (false). Default: false.'
                }
              },
              required: ['target', 'replacement']
            }
          },
          {
            name: 'open_file',
            description: 'Opens a project file in the editor tabs and makes it the active file.',
            parameters: {
              type: 'OBJECT',
              properties: {
                path: {
                  type: 'STRING',
                  description: 'Relative path of the project file to open.'
                }
              },
              required: ['path']
            }
          },
          {
            name: 'set_cursor',
            description: 'Moves the editor cursor to a specific line number (and optional column) in the active file.',
            parameters: {
              type: 'OBJECT',
              properties: {
                line: {
                  type: 'INTEGER',
                  description: 'Target line number (1-indexed).'
                },
                column: {
                  type: 'INTEGER',
                  description: 'Target column number (1-indexed, default: 1).'
                }
              },
              required: ['line']
            }
          }
        ]
      }
    ];
  }

  // --- Safe Workspace Tools Execution ---
  private async executeListFiles(subpath?: string): Promise<{ files: Array<{ name: string; path: string; is_dir: boolean; size: number }> } | { error: string }> {
    const ws = this.workspaceService.nativeWorkspacePath();
    if (!ws) {
      return { error: 'No workspace directory currently open.' };
    }

    const cleanSub = (subpath || '').replace(/^[/\\]+/, '').replace(/\.\.[/\\]/g, '');
    const targetDir = cleanSub ? `${ws}/${cleanSub}` : ws;

    if (!targetDir.startsWith(ws)) {
      return { error: 'Access denied: Directory traversal outside workspace is forbidden.' };
    }

    try {
      if (isTauriApp()) {
        const entries = await invoke<Array<{ name: string; path: string; is_dir: boolean; size: number }>>('read_dir_entries', {
          dirPath: targetDir,
          showHidden: false
        });
        const relativeList = entries.map(e => ({
          name: e.name,
          path: e.path.startsWith(ws) ? e.path.substring(ws.length).replace(/^[/\\]+/, '') : e.path,
          is_dir: e.is_dir,
          size: e.size
        }));
        return { files: relativeList };
      } else {
        const rel = this.workspaceService.files().map(f => ({
          name: f.name,
          path: f.path,
          is_dir: false,
          size: f.fileSize || 0
        }));
        return { files: rel };
      }
    } catch (err: any) {
      return { error: err?.message || 'Failed to list directory.' };
    }
  }

  private async executeReadFile(filePath: string): Promise<{ path: string; content?: string; error?: string }> {
    const ws = this.workspaceService.nativeWorkspacePath();
    const cleanPath = (filePath || '').trim().replace(/^[/\\]+/, '');

    if (cleanPath.includes('..')) {
      return { path: cleanPath, error: 'Access denied: Cannot read outside workspace.' };
    }

    // Check open file buffers first (for uncommitted in-memory edits)
    const openFile = this.workspaceService.files().find(f => f.path === cleanPath || (f.fsPath && f.fsPath.endsWith(cleanPath)));
    if (openFile && typeof openFile.content === 'string') {
      const content = openFile.content.length > 80000
        ? openFile.content.substring(0, 80000) + '\n\n...[file truncated for length]'
        : openFile.content;
      return { path: cleanPath, content };
    }

    if (!ws) {
      return { path: cleanPath, error: 'No workspace open to read from disk.' };
    }

    const fullPath = `${ws}/${cleanPath}`;
    if (!fullPath.startsWith(ws)) {
      return { path: cleanPath, error: 'Access denied: Cannot read outside workspace.' };
    }

    try {
      if (isTauriApp()) {
        const diskContent = await invoke<string>('read_file_text', { filePath: fullPath });
        const content = diskContent.length > 80000
          ? diskContent.substring(0, 80000) + '\n\n...[file truncated for length]'
          : diskContent;
        return { path: cleanPath, content };
      } else {
        return { path: cleanPath, error: 'File reading is only available in desktop app.' };
      }
    } catch (err: any) {
      return { path: cleanPath, error: `Failed to read file: ${err?.message || err}` };
    }
  }

  // --- Gemini API with Timeout & Automatic Fallback ---
  private async executeGeminiCallWithFallback(
    primaryModel: string,
    apiKey: string,
    payload: any,
    signal: AbortSignal
  ): Promise<{ data: any; effectiveModel: string }> {
    const fallbackModel = primaryModel === 'gemini-3.5-flash-lite' ? 'gemini-2.5-flash' : 'gemini-3.5-flash-lite';

    try {
      terminalLog('AI_CALL', `Calling primary model: ${primaryModel}`);
      const data = await this.fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${primaryModel}:generateContent?key=${apiKey}`,
        payload,
        signal,
        35000,
        primaryModel
      );
      terminalLog('AI_CALL', `Primary model ${primaryModel} responded successfully.`);
      return { data, effectiveModel: primaryModel };
    } catch (err: any) {
      if (signal.aborted && !err?.message?.includes('timed out')) {
        terminalLog('AI_CALL', `Call to ${primaryModel} was aborted.`);
        throw err;
      }

      const isTimeout = err?.message?.includes('timed out');
      const isOverloadedOrUnavailable =
        err?.message?.includes('503') ||
        err?.message?.includes('429') ||
        err?.message?.includes('500') ||
        err?.message?.includes('404') ||
        err?.message?.includes('Overloaded') ||
        err?.message?.includes('Resource has been exhausted') ||
        err?.message?.includes('Failed to fetch') ||
        err?.message?.includes('NetworkError');

      terminalLog('AI_WARN', `Primary model ${primaryModel} failed. Reason: ${err?.message || err}. isTimeout=${isTimeout}, isOverloaded=${isOverloadedOrUnavailable}`);

      if ((isTimeout || isOverloadedOrUnavailable) && fallbackModel !== primaryModel) {
        terminalLog('AI_FALLBACK', `Activating fallback: ${primaryModel} -> ${fallbackModel}...`);
        this.thinkingSteps.update(steps => [
          ...steps,
          {
            type: 'tool',
            text: `⚠️ Model ${primaryModel} ${isTimeout ? 'timed out after 35s' : 'unavailable/overloaded'}. Falling back to ${fallbackModel}...`,
            tool: 'fallback',
            done: true,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
          }
        ]);

        const data = await this.fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/${fallbackModel}:generateContent?key=${apiKey}`,
          payload,
          signal,
          35000,
          fallbackModel
        );
        terminalLog('AI_FALLBACK', `Fallback model ${fallbackModel} responded successfully.`);
        return { data, effectiveModel: `${fallbackModel} (fallback)` };
      }

      throw err;
    }
  }

  private async fetchWithTimeout(
    url: string,
    payload: any,
    parentSignal: AbortSignal,
    timeoutMs: number,
    modelName: string
  ): Promise<any> {
    const controller = new AbortController();
    let isTimedOut = false;

    const onParentAbort = () => {
      controller.abort();
    };
    parentSignal.addEventListener('abort', onParentAbort, { once: true });

    const timer = setTimeout(() => {
      isTimedOut = true;
      controller.abort();
    }, timeoutMs);

    const startTime = Date.now();
    const payloadStr = JSON.stringify(payload);
    terminalLog('AI_HTTP', `POST -> ${modelName} (Timeout: ${timeoutMs / 1000}s, Payload size: ${payloadStr.length} bytes)...`);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payloadStr,
        signal: controller.signal
      });

      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
      terminalLog('AI_HTTP', `HTTP ${resp.status} ${resp.statusText} from ${modelName} in ${elapsedSec}s`);

      if (!resp.ok) {
        const errData = await resp.json().catch(() => null);
        const msg = errData?.error?.message || `HTTP ${resp.status} ${resp.statusText}`;
        terminalLog('AI_HTTP_ERROR', `Request to ${modelName} failed (${resp.status}): ${msg}`);
        throw new Error(msg);
      }

      return await resp.json();
    } catch (err: any) {
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
      if (isTimedOut) {
        terminalLog('AI_HTTP_TIMEOUT', `Request to ${modelName} TIMED OUT after ${elapsedSec}s!`);
        throw new Error(`Model ${modelName} request timed out after ${timeoutMs / 1000} seconds`);
      }
      if (parentSignal.aborted) {
        terminalLog('AI_HTTP', `Request to ${modelName} aborted by client after ${elapsedSec}s`);
      } else {
        terminalLog('AI_HTTP_ERROR', `Fetch error for ${modelName} after ${elapsedSec}s: ${err?.message || err}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  }

  // --- Send Message & Agent Turn Execution ---
  public async sendMessage(text: string): Promise<boolean> {
    terminalLog('AI_CHAT', `sendMessage called with message length: ${text?.length || 0}`);
    const trimmed = text.trim();
    if (!trimmed) {
      terminalLog('AI_CHAT', 'sendMessage ignored: empty input');
      return false;
    }
    if (this.isLoading()) {
      terminalLog('AI_CHAT_WARN', 'sendMessage ignored: assistant is already busy loading. Use the Stop button to cancel current operation.');
      return false;
    }

    const apiKey = this.aiService.effectiveChatApiKey().trim();
    if (!apiKey) {
      terminalLog('AI_CHAT_ERROR', 'Google Gemini API key is missing! Please configure it in AI Settings.');
      this.errorMessage.set('Google Gemini API Key is required. Please configure it in AI Settings.');
      return false;
    }
    terminalLog('AI_CHAT', `Using API Key (length: ${apiKey.length}, starts with: ${apiKey.substring(0, 6)}...)`);

    const startTime = Date.now();
    const userMsg: ChatMessage = {
      id: Date.now(),
      role: 'user',
      message: trimmed,
      tm: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    };

    const currentFeed = [...this.feed(), userMsg];
    this.feed.set(currentFeed);
    this.saveFeedToStorage(currentFeed);

    this.isLoading.set(true);
    this.isAwaitingResponse.set(true);
    this.thinkingSteps.set([]);
    this.agentThought.set('');
    this.errorMessage.set(null);
    this.activeAbortController = new AbortController();
    this.playThinkingStartSound();

    try {
      // Build Gemini contents array with active file & cursor context on the latest turn
      const primaryModel = this.aiService.chatModel();
      let effectiveModelUsed = primaryModel;
      terminalLog('AI_CHAT', `Configured chat model: ${primaryModel}`);

      const geminiContents: any[] = [];
      const historyToInclude = currentFeed.slice(-10); // Last 10 messages for multi-turn context

      for (let i = 0; i < historyToInclude.length; i++) {
        const m = historyToInclude[i];
        if (m.role === 'user') {
          let prompt = m.message;
          // Inject active editor context into the latest message (capped at 50,000 characters)
          if (i === historyToInclude.length - 1) {
            const active = this.workspaceService.activeFile();
            if (active) {
              const cur = active.cursor || { line: 1, column: 1 };
              let fileContent = active.content || '';
              if (fileContent.length > 50000) {
                fileContent = fileContent.substring(0, 50000) + '\n\n...[file truncated for context size limit]';
              }
              prompt += `\n\n[Active File Context in Editor: "${active.path}" | Cursor: Line ${cur.line}, Col ${cur.column}]\n\`\`\`\n${fileContent}\n\`\`\``;
              terminalLog('AI_CHAT', `Injected active file context: "${active.path}" (${fileContent.length} chars, cursor: L${cur.line}:C${cur.column})`);
            } else {
              terminalLog('AI_CHAT', 'No active editor file to attach.');
            }
          }
          geminiContents.push({
            role: 'user',
            parts: [{ text: prompt }]
          });
        } else if (m.role === 'assistant') {
          geminiContents.push({
            role: 'model',
            parts: [{ text: m.message }]
          });
        }
      }

      // Tool-Calling Loop (up to 5 iterations for successive tool invocations)
      let finalReply = '';
      let executedToolsRecord: string[] = [];
      const maxToolTurns = 5;

      for (let turn = 0; turn < maxToolTurns; turn++) {
        terminalLog('AI_CHAT', `Starting turn ${turn + 1}/${maxToolTurns} with model ${primaryModel}...`);
        const payload: any = {
          system_instruction: {
            parts: [{ text: this.aiService.chatSystemPrompt() }]
          },
          contents: geminiContents,
          tools: this.getGeminiTools(),
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 4096
          }
        };

        const { data, effectiveModel } = await this.executeGeminiCallWithFallback(
          primaryModel,
          apiKey,
          payload,
          this.activeAbortController.signal
        );
        effectiveModelUsed = effectiveModel;

        const candidate = data.candidates?.[0]?.content;
        const candidateParts: any[] = candidate?.parts || [];

        // Check if Gemini invoked function calls
        const functionCalls = candidateParts.filter((p: any) => p.functionCall);

        if (functionCalls.length > 0) {
          terminalLog('AI_TOOL', `Model requested ${functionCalls.length} tool invocation(s): ${functionCalls.map(c => c.functionCall.name).join(', ')}`);
          geminiContents.push({
            role: 'model',
            parts: candidateParts
          });

          for (const callObj of functionCalls) {
            const call = callObj.functionCall;
            const toolName = call.name;
            const toolArgs = call.args || {};

            let stepLabel = `Running: ${toolName}`;
            if (toolName === 'read_file') {
              stepLabel = `Reading file: ${toolArgs.path}`;
            } else if (toolName === 'list_files') {
              stepLabel = `Listing directory: ${toolArgs.subpath || '.'}`;
            } else if (toolName === 'replace_text') {
              stepLabel = `Replacing text in: ${toolArgs.path || 'active file'}`;
            } else if (toolName === 'open_file') {
              stepLabel = `Opening file: ${toolArgs.path}`;
            } else if (toolName === 'set_cursor') {
              stepLabel = `Moving cursor to line ${toolArgs.line}`;
            }

            terminalLog('AI_TOOL', `Executing tool "${toolName}" (args: ${JSON.stringify(toolArgs)})`);
            const toolStartTime = Date.now();

            const stepIndex = this.thinkingSteps().length;
            this.thinkingSteps.update(steps => [
              ...steps,
              {
                type: 'tool',
                text: stepLabel,
                tool: toolName,
                done: false,
                timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
              }
            ]);
            this.playToolStartSound();

            let toolResult: any;
            if (toolName === 'read_file') {
              toolResult = await this.executeReadFile(toolArgs.path);
            } else if (toolName === 'list_files') {
              toolResult = await this.executeListFiles(toolArgs.subpath);
            } else if (toolName === 'replace_text') {
              toolResult = await this.workspaceService.replaceTextInFile(
                toolArgs.target,
                toolArgs.replacement,
                toolArgs.path,
                toolArgs.all
              );
            } else if (toolName === 'open_file') {
              const opened = await this.workspaceService.openFileByPath(toolArgs.path);
              toolResult = opened
                ? { success: true, message: `Opened ${toolArgs.path}` }
                : { success: false, message: `File not found: ${toolArgs.path}` };
            } else if (toolName === 'set_cursor') {
              const active = this.workspaceService.activeFile();
              if (active) {
                await this.workspaceService.jumpToLine(active, toolArgs.line, toolArgs.column || 1);
                toolResult = { success: true, message: `Cursor moved to line ${toolArgs.line}` };
              } else {
                toolResult = { success: false, message: 'No active file in editor' };
              }
            } else {
              toolResult = { error: `Unknown tool: ${toolName}` };
            }

            const toolElapsedSec = ((Date.now() - toolStartTime) / 1000).toFixed(2);
            terminalLog('AI_TOOL', `Tool "${toolName}" finished in ${toolElapsedSec}s. Result: ${JSON.stringify(toolResult).substring(0, 150)}`);

            executedToolsRecord.push(stepLabel);

            // Mark tool step done
            this.thinkingSteps.update(steps =>
              steps.map((s, idx) => (idx === stepIndex ? { ...s, done: true } : s))
            );
            this.playToolDoneSound();

            // Append function response turn for Gemini
            geminiContents.push({
              role: 'function',
              parts: [
                {
                  functionResponse: {
                    name: toolName,
                    response: toolResult
                  }
                }
              ]
            });
          }

          // Continue loop to receive Gemini's reasoning on the tool output
          continue;
        }

        // If no function call, extract final assistant text
        const textParts = candidateParts.filter((p: any) => p.text).map((p: any) => p.text);
        finalReply = textParts.join('').trim();
        terminalLog('AI_CHAT', `Turn complete. Model returned text response (${finalReply.length} chars).`);
        break;
      }

      if (!finalReply) {
        finalReply = 'No response received from the model.';
      }

      const elapsed = Math.round((Date.now() - startTime) / 100) / 10;
      terminalLog('AI_CHAT', `Assistant finished response in ${elapsed}s (Model: ${effectiveModelUsed}).`);

      const assistantMsg: ChatMessage = {
        id: Date.now(),
        role: 'assistant',
        message: finalReply,
        model: effectiveModelUsed,
        elapsed,
        executed_tools: executedToolsRecord.length > 0 ? executedToolsRecord.join(', ') : null,
        steps: this.thinkingSteps().length > 0 ? [...this.thinkingSteps()] : undefined,
        tm: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      };

      const updatedFeed = [...this.feed(), assistantMsg];
      this.feed.set(updatedFeed);
      this.saveFeedToStorage(updatedFeed);

      this.playChimeSound();
      return true;
    } catch (err: any) {
      if (err?.name === 'AbortError' && !err?.message?.includes('timed out')) {
        terminalLog('AI_CHAT', 'Chat request aborted by user.');
        return false;
      }
      terminalLog('AI_CHAT_ERROR', `Chat generation failed: ${err?.message || err}`);
      console.error('[AssistantService] Chat generation error:', err);
      const errMsg = err?.message || 'Error communicating with Gemini API';
      this.errorMessage.set(errMsg);
      this.feed.update(f => [
        ...f,
        {
          role: 'system',
          message: `⚠️ Error: ${errMsg}`,
          tm: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
      return false;
    } finally {
      this.activeAbortController = null;
      this.isLoading.set(false);
      this.isAwaitingResponse.set(false);
      terminalLog('AI_CHAT', 'Assistant session state reset to idle.');
    }
  }

  // --- Web Audio Synthesizer Tones ---
  private getAudioContext(): AudioContext | null {
    try {
      if (typeof window === 'undefined') return null;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;

      if (!this.sharedAudioCtx || this.sharedAudioCtx.state === 'closed') {
        this.sharedAudioCtx = new AudioCtx();
      }
      if (this.sharedAudioCtx.state === 'suspended') {
        this.sharedAudioCtx.resume().catch(() => {});
      }
      return this.sharedAudioCtx;
    } catch (e) {
      return null;
    }
  }

  private playSynthTone(freqs: number[], rampTime: number, totalDuration: number, type: OscillatorType = 'sine', maxGain = 0.28): void {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      const startTime = ctx.currentTime;
      osc.frequency.setValueAtTime(freqs[0], startTime);
      if (freqs.length > 1) {
        osc.frequency.exponentialRampToValueAtTime(freqs[freqs.length - 1], startTime + rampTime);
      }

      gain.gain.setValueAtTime(maxGain, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + totalDuration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + totalDuration);

      setTimeout(() => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch (e) {}
      }, Math.round((totalDuration + 0.1) * 1000));
    } catch (e) {}
  }

  public playChimeSound(): void {
    this.playSynthTone([587.33, 880], 0.12, 0.30, 'sine', 0.32);
  }

  public playThinkingStartSound(): void {
    this.playSynthTone([329.63, 440], 0.10, 0.28, 'sine', 0.22);
  }

  public playToolStartSound(): void {
    this.playSynthTone([392, 523.25], 0.12, 0.30, 'sine', 0.30);
  }

  public playToolDoneSound(): void {
    this.playSynthTone([523.25, 659.25, 783.99], 0.14, 0.32, 'sine', 0.32);
  }
}
