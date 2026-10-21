import { Injectable, signal, computed, inject, NgZone } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { isTauriApp } from './workspace.service';

export interface AiSidecarStatus {
  running: boolean;
  pid?: number;
  port: number;
  model_path?: string;
}

export interface AiModelStatus {
  exists: boolean;
  path: string;
  size_bytes: number;
  default_url: string;
}

export interface AiDownloadProgress {
  percent: number;
  downloaded_bytes: number;
  total_bytes: number;
  is_complete: boolean;
  error?: string;
}

@Injectable({
  providedIn: 'root',
})
export class AiService {
  private readonly ngZone = inject(NgZone);

  // Configuration signals
  readonly endpoint = signal<string>(
    typeof window !== 'undefined'
      ? localStorage.getItem('vide_ai_endpoint') || 'http://127.0.0.1:8080'
      : 'http://127.0.0.1:8080'
  );

  readonly modelPath = signal<string>(
    typeof window !== 'undefined'
      ? localStorage.getItem('vide_ai_model_path') || ''
      : ''
  );

  readonly binaryPath = signal<string>(
    typeof window !== 'undefined'
      ? localStorage.getItem('vide_ai_binary_path') || ''
      : ''
  );

  readonly isEnabled = signal<boolean>(
    typeof window !== 'undefined'
      ? localStorage.getItem('vide_ai_enabled') !== 'false'
      : true
  );

  // Status signals
  readonly isServerOnline = signal<boolean>(false);
  readonly isCheckingHealth = signal<boolean>(false);
  readonly isGenerating = signal<boolean>(false);
  readonly sidecarStatus = signal<AiSidecarStatus | null>(null);

  // Download signals
  readonly isDownloadingModel = signal<boolean>(false);
  readonly downloadProgress = signal<AiDownloadProgress | null>(null);
  readonly modelStatus = signal<AiModelStatus | null>(null);

  private healthCheckInterval: any = null;

  constructor() {
    this.initHealthPolling();
    this.refreshSidecarStatus();
  }

  public setEndpoint(url: string): void {
    const cleaned = url.trim().replace(/\/+$/, '');
    this.endpoint.set(cleaned);
    if (typeof window !== 'undefined') {
      localStorage.setItem('vide_ai_endpoint', cleaned);
    }
    this.checkHealth();
  }

  public setModelPath(path: string): void {
    const cleaned = path.trim();
    this.modelPath.set(cleaned);
    if (typeof window !== 'undefined') {
      localStorage.setItem('vide_ai_model_path', cleaned);
    }
  }

  public setBinaryPath(path: string): void {
    const cleaned = path.trim();
    this.binaryPath.set(cleaned);
    if (typeof window !== 'undefined') {
      localStorage.setItem('vide_ai_binary_path', cleaned);
    }
  }

  public toggleEnabled(): void {
    const newVal = !this.isEnabled();
    this.isEnabled.set(newVal);
    if (typeof window !== 'undefined') {
      localStorage.setItem('vide_ai_enabled', newVal.toString());
    }
  }

  public async checkModelStatus(customPath?: string): Promise<AiModelStatus | null> {
    if (!isTauriApp()) return null;
    try {
      const status = await invoke<AiModelStatus>('check_ai_model_status', {
        customPath: customPath || this.modelPath() || undefined,
      });
      this.modelStatus.set(status);
      if (status.exists && !this.modelPath()) {
        this.setModelPath(status.path);
      }
      return status;
    } catch (err) {
      console.error('Failed to check AI model status:', err);
      return null;
    }
  }

  public async downloadModel(customPath?: string, customUrl?: string): Promise<string> {
    if (!isTauriApp()) throw new Error('Model download is only supported in desktop mode.');

    this.isDownloadingModel.set(true);
    let unlisten: UnlistenFn | null = null;

    try {
      unlisten = await listen<AiDownloadProgress>('ai-download-progress', (event) => {
        this.ngZone.run(() => {
          this.downloadProgress.set(event.payload);
        });
      });

      const finalPath = await invoke<string>('download_ai_model', {
        customPath: customPath || this.modelPath() || undefined,
        customUrl: customUrl || undefined,
      });

      this.setModelPath(finalPath);
      await this.checkModelStatus(finalPath);
      return finalPath;
    } finally {
      if (unlisten) unlisten();
      this.isDownloadingModel.set(false);
    }
  }

  public async cancelDownload(): Promise<void> {
    if (!isTauriApp()) return;
    try {
      await invoke('cancel_ai_model_download');
    } catch {
      // ignore
    } finally {
      this.isDownloadingModel.set(false);
    }
  }

  public async startSidecar(): Promise<void> {
    if (!isTauriApp()) return;
    try {
      let model = this.modelPath();
      const status = await this.checkModelStatus(model);

      if (!status || !status.exists) {
        throw new Error('MODEL_NOT_FOUND');
      }

      model = status.path;
      const bin = this.binaryPath() || undefined;
      const sidecarStatus = await invoke<AiSidecarStatus>('start_ai_sidecar', {
        binaryPath: bin,
        modelPath: model,
        port: 8080,
        nGpuLayers: 99,
        contextSize: 4096,
      });
      this.sidecarStatus.set(sidecarStatus);
      await this.checkHealth();
    } catch (err: any) {
      console.error('Failed to start llama-server sidecar:', err);
      throw err;
    }
  }

  public async stopSidecar(): Promise<void> {
    if (!isTauriApp()) return;
    try {
      const status = await invoke<AiSidecarStatus>('stop_ai_sidecar');
      this.sidecarStatus.set(status);
      this.isServerOnline.set(false);
    } catch (err: any) {
      console.error('Failed to stop llama-server sidecar:', err);
      throw err;
    }
  }

  public async refreshSidecarStatus(): Promise<void> {
    if (!isTauriApp()) return;
    try {
      const status = await invoke<AiSidecarStatus>('get_ai_sidecar_status');
      this.sidecarStatus.set(status);
    } catch {
      // Ignore if not supported
    }
  }

  /**
   * Pings the server to verify if llama-server or any OpenAI compatible endpoint is alive
   */
  public async checkHealth(): Promise<boolean> {
    if (!this.isEnabled()) {
      this.isServerOnline.set(false);
      return false;
    }

    this.isCheckingHealth.set(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    try {
      // llama-server provides /health
      const resp = await fetch(`${this.endpoint()}/health`, {
        signal: controller.signal,
      }).catch(async () => {
        // Fallback to /v1/models if /health is not implemented (e.g., standard OpenAI/Ollama)
        return await fetch(`${this.endpoint()}/v1/models`, {
          signal: controller.signal,
        });
      });

      clearTimeout(timeoutId);
      const ok = resp && resp.ok;
      this.isServerOnline.set(!!ok);
      return !!ok;
    } catch {
      clearTimeout(timeoutId);
      this.isServerOnline.set(false);
      return false;
    } finally {
      this.isCheckingHealth.set(false);
    }
  }

  private initHealthPolling(): void {
    if (typeof window === 'undefined') return;
    this.checkHealth();
    this.healthCheckInterval = setInterval(() => {
      this.checkHealth();
      this.refreshSidecarStatus();
    }, 15000);
  }

  /**
   * 1. Fill-In-The-Middle (FIM) Completion for inline ghost text
   */
  public async getInfillCompletion(
    prefix: string,
    suffix: string,
    abortSignal?: AbortSignal
  ): Promise<string | null> {
    if (!this.isEnabled() || !this.isServerOnline()) {
      return null;
    }

    this.isGenerating.set(true);
    try {
      // Option A: Try native llama-server /infill endpoint
      const infillPayload = {
        input_prefix: prefix,
        input_suffix: suffix,
        n_predict: 48,
        temperature: 0.1,
        top_k: 40,
        stop: [
          '\n\n',
          '```',
          '<|endoftext|>',
          '<|fim_prefix|>',
          '<|fim_suffix|>',
          '<|fim_middle|>',
          '<|file_separator|>',
        ],
      };

      const resp = await fetch(`${this.endpoint()}/infill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(infillPayload),
        signal: abortSignal,
      });

      if (resp.ok) {
        const data = await resp.json();
        const text = data.content;
        return this.cleanCompletion(text);
      }

      // Option B: Fallback to /v1/completions using standard Qwen/DeepSeek FIM tokens
      const prompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
      const compResp = await fetch(`${this.endpoint()}/v1/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          max_tokens: 48,
          temperature: 0.1,
          stop: ['\n\n', '```', '<|endoftext|>', '<|fim_prefix|>'],
        }),
        signal: abortSignal,
      });

      if (compResp.ok) {
        const compData = await compResp.json();
        const text = compData.choices?.[0]?.text;
        return this.cleanCompletion(text);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        // Silently ignore non-fatal completion network errors
      }
    } finally {
      this.isGenerating.set(false);
    }

    return null;
  }

  /**
   * 2. Pattern / Next Edit Suggestions:
   * Given an edit on a line, propagates the transformation pattern to subsequent target lines.
   */
  public async suggestPatternEdits(
    originalLine: string,
    editedLine: string,
    targetLines: string[]
  ): Promise<string[] | null> {
    if (!this.isEnabled() || !this.isServerOnline() || targetLines.length === 0) {
      return null;
    }

    this.isGenerating.set(true);
    try {
      const prompt = `You are a code refactoring engine.
The user modified a line of code as follows:
[Original]: ${originalLine}
[Edited]: ${editedLine}

Apply the exact same transformation pattern to each of the following lines:
${targetLines.map((line, idx) => `[Target ${idx + 1}]: ${line}`).join('\n')}

Output ONLY the transformed lines in order, one per line. Do not write explanations, markdown fences, or prefixes.`;

      const response = await this.queryChatCompletion([
        { role: 'system', content: 'You are a precise code transformation tool. Output only raw code.' },
        { role: 'user', content: prompt },
      ]);

      if (!response) return null;

      const lines = response
        .split('\n')
        .map((l) => l.trimEnd())
        .filter((l) => l.length > 0);

      // Clean any [Target n]: prefix if model echoed it
      const cleaned = lines.map((l) => l.replace(/^\[Target \d+\]:\s*/, ''));
      return cleaned.length === targetLines.length ? cleaned : null;
    } catch (err) {
      console.error('Failed to generate pattern edits:', err);
      return null;
    } finally {
      this.isGenerating.set(false);
    }
  }

  /**
   * 3. Syntax Error Quick-Fix:
   * Given an error message, language, and the offending code snippet, returns the corrected code replacement.
   */
  public async fixSyntaxError(
    codeSnippet: string,
    errorMessage: string,
    language: string
  ): Promise<string | null> {
    if (!this.isEnabled() || !this.isServerOnline()) {
      return null;
    }

    this.isGenerating.set(true);
    try {
      const prompt = `Language: ${language}
Syntax error: "${errorMessage}"

Problematic code snippet:
\`\`\`${language}
${codeSnippet}
\`\`\`

Fix the syntax error in the snippet above (such as missing commas, unclosed brackets, typo in function name, etc.).
Output ONLY the corrected code snippet replacement. Do not include explanations.`;

      const response = await this.queryChatCompletion([
        {
          role: 'system',
          content: 'You are an automated syntax error fixer. Output ONLY the fixed replacement code without markdown formatting.',
        },
        { role: 'user', content: prompt },
      ]);

      if (!response) return null;
      return this.stripCodeFences(response);
    } catch (err) {
      console.error('Failed to fix syntax error:', err);
      return null;
    } finally {
      this.isGenerating.set(false);
    }
  }

  /**
   * 4. Git Commit Note Generator:
   * Generates a concise Conventional Commit message based on git diff.
   */
  public async generateCommitNote(repoPath: string): Promise<string> {
    if (!isTauriApp()) {
      throw new Error('Git operations are only supported in desktop mode.');
    }
    if (!this.isEnabled() || !this.isServerOnline()) {
      throw new Error('AI server is offline. Please start llama-server or check AI Settings.');
    }

    this.isGenerating.set(true);
    try {
      const diff = await invoke<string>('get_git_diff_for_commit', { repoPath });
      const trimmedDiff = diff.trim();
      if (!trimmedDiff) {
        return 'chore: update project files';
      }

      // Limit diff size to ~4000 characters to stay within context window
      const truncatedDiff =
        trimmedDiff.length > 4000
          ? trimmedDiff.substring(0, 4000) + '\n\n...[diff truncated for length]'
          : trimmedDiff;

      const prompt = `Based on the following git diff, generate a concise Git commit message following the Conventional Commits format (feat:, fix:, refactor:, chore:, style:, test:, docs:).
Keep the summary line under 72 characters.
Output ONLY the commit message, without quotes or additional text.

Git Diff:
${truncatedDiff}`;

      const response = await this.queryChatCompletion([
        {
          role: 'system',
          content: 'You are an expert software developer writing clean, standardized Conventional Commits.',
        },
        { role: 'user', content: prompt },
      ]);

      const note = response?.trim() || 'chore: update files';
      // Strip outer quotes if added
      return note.replace(/^["']|["']$/g, '');
    } catch (err: any) {
      console.error('Failed to generate commit note:', err);
      throw err;
    } finally {
      this.isGenerating.set(false);
    }
  }

  /**
   * General Chat / Instruct query helper
   */
  private async queryChatCompletion(
    messages: { role: string; content: string }[],
    temperature = 0.2
  ): Promise<string | null> {
    try {
      const resp = await fetch(`${this.endpoint()}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          temperature,
          max_tokens: 300,
        }),
      });

      if (!resp.ok) {
        // Fallback to /completion if chat endpoint is not available
        const lastUser = messages.find((m) => m.role === 'user')?.content || '';
        const rawResp = await fetch(`${this.endpoint()}/completion`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: lastUser,
            n_predict: 300,
            temperature,
          }),
        });
        if (rawResp.ok) {
          const rawData = await rawResp.json();
          return rawData.content || null;
        }
        return null;
      }

      const data = await resp.json();
      return data.choices?.[0]?.message?.content || null;
    } catch (err) {
      console.error('Chat completion failed:', err);
      return null;
    }
  }

  private cleanCompletion(text: string | null | undefined): string | null {
    if (!text) return null;
    // Strip special tokens if echoed
    let cleaned = text
      .replace(/<\|fim_prefix\|>|<\|fim_suffix\|>|<\|fim_middle\|>|<\|endoftext\|>/g, '')
      .replace(/<\|file_separator\|>/g, '');

    // If suggestion starts with whitespace followed by newlines only, ignore
    if (/^\s*$/.test(cleaned)) {
      return null;
    }

    return cleaned;
  }

  private stripCodeFences(text: string): string {
    const trimmed = text.trim();
    if (trimmed.startsWith('```')) {
      const firstLineEnd = trimmed.indexOf('\n');
      const lastFence = trimmed.lastIndexOf('```');
      if (firstLineEnd !== -1 && lastFence > firstLineEnd) {
        return trimmed.substring(firstLineEnd + 1, lastFence).trim();
      }
    }
    return trimmed;
  }
}
