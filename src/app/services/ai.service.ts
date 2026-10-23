import { Injectable, signal, computed } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { isTauriApp } from './workspace.service';

export interface GeminiModelOption {
	id: string;
	name: string;
	description: string;
}

export const GEMINI_MODELS: GeminiModelOption[] = [
	{
		id: 'gemini-3.5-flash-lite',
		name: 'Gemini 3.5 Flash-Lite (Recommended - Fast & Free Tier)',
		description: 'A cost-efficient model optimized for high-volume coding and agentic tasks.',
	},
	{
		id: 'gemini-3.8-flash',
		name: 'Gemini 3.8 Flash (High Intelligence - Code & Software Engineering)',
		description: 'Most intelligent Flash model, engineered for software engineering and complex workflows.',
	},
	{
		id: 'gemini-3.6-flash',
		name: 'Gemini 3.6 Flash (Fast & General Multimodal)',
		description: 'Balanced speed and multimodal capabilities across everyday coding tasks.',
	},
	{
		id: 'gemini-3.1-flash-lite',
		name: 'Gemini 3.1 Flash-Lite (Lightweight & High-Volume)',
		description: 'Lightweight model optimized for high-frequency completion tasks.',
	},
	{
		id: 'gemini-2.5-flash',
		name: 'Gemini 2.5 Flash',
		description: 'Stable 2.5 generation Flash model.',
	},
	{
		id: 'gemini-2.5-flash-lite',
		name: 'Gemini 2.5 Flash-Lite',
		description: 'Lightweight 2.5 generation model.',
	},
];

@Injectable({
	providedIn: 'root',
})
export class AiService {
	readonly availableModels = GEMINI_MODELS;

	// Gemini Configuration signals
	readonly geminiApiKey = signal<string>(
		typeof window !== 'undefined'
			? localStorage.getItem('vide_gemini_api_key') || ''
			: ''
	);

	readonly geminiModel = signal<string>(
		(() => {
			if (typeof window === 'undefined') return 'gemini-3.5-flash-lite';
			const saved = localStorage.getItem('vide_gemini_model');
			if (saved && GEMINI_MODELS.some((m) => m.id === saved)) {
				return saved;
			}
			return 'gemini-3.5-flash-lite';
		})()
	);

	readonly isConfigured = computed(() => this.geminiApiKey().trim().length > 0);

	readonly isEnabled = signal<boolean>(
		typeof window !== 'undefined'
			? localStorage.getItem('vide_ai_enabled') !== 'false'
			: true
	);

	// Status signals (isServerOnline reflects whether Gemini is configured and enabled)
	readonly isServerOnline = computed(() => this.isConfigured() && this.isEnabled());
	readonly isCheckingHealth = signal<boolean>(false);
	readonly isGenerating = signal<boolean>(false);
	readonly lastApiError = signal<string | null>(null);

	constructor() {}

	public setGeminiApiKey(key: string): void {
		const cleaned = key.trim();
		this.geminiApiKey.set(cleaned);
		if (typeof window !== 'undefined') {
			localStorage.setItem('vide_gemini_api_key', cleaned);
		}
		this.lastApiError.set(null);
	}

	public setGeminiModel(model: string): void {
		const cleaned = model.trim();
		this.geminiModel.set(cleaned);
		if (typeof window !== 'undefined') {
			localStorage.setItem('vide_gemini_model', cleaned);
		}
	}

	public async testGeminiConnection(): Promise<boolean> {
		if (!this.isConfigured()) return false;
		this.isCheckingHealth.set(true);
		this.lastApiError.set(null);
		try {
			const apiKey = this.geminiApiKey().trim();
			const model = this.geminiModel();
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

			const resp = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
					generationConfig: { maxOutputTokens: 5 },
				}),
			});

			if (!resp.ok) {
				const errJson = await resp.json().catch(() => null);
				const msg = errJson?.error?.message || `HTTP ${resp.status} ${resp.statusText}`;
				this.lastApiError.set(msg);
				return false;
			}

			this.lastApiError.set(null);
			return true;
		} catch (err: any) {
			this.lastApiError.set(err?.message || 'Network connection failed');
			return false;
		} finally {
			this.isCheckingHealth.set(false);
		}
	}

	public toggleEnabled(): void {
		const newVal = !this.isEnabled();
		this.isEnabled.set(newVal);
		if (typeof window !== 'undefined') {
			localStorage.setItem('vide_ai_enabled', newVal.toString());
		}
	}

	/**
	 * 1. Fill-In-The-Middle (FIM) Completion for inline ghost text
	 */
	public async getInfillCompletion(
		prefix: string,
		suffix: string,
		abortSignal?: AbortSignal
	): Promise<string | null> {
		if (!this.isConfigured() || !this.isEnabled()) {
			return null;
		}

		this.isGenerating.set(true);
		try {
			const apiKey = this.geminiApiKey().trim();
			const model = this.geminiModel();
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

			const systemInstruction =
				'You are an inline code completion assistant (Fill-In-The-Middle). You are given code BEFORE the cursor (<PREFIX>) and code AFTER the cursor (<SUFFIX>). Your job is to output ONLY the code that should be inserted directly at the cursor between PREFIX and SUFFIX. Never repeat any code from PREFIX or SUFFIX. Do not include markdown code fences (```). Do not include any explanations. Output pure code only.';

			const prompt = `<PREFIX>\n${prefix}\n</PREFIX>\n<SUFFIX>\n${suffix}\n</SUFFIX>`;

			const resp = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					system_instruction: {
						parts: [{ text: systemInstruction }],
					},
					contents: [
						{
							role: 'user',
							parts: [{ text: prompt }],
						},
					],
					generationConfig: {
						temperature: 0.1,
						maxOutputTokens: 64,
						stopSequences: ['\n\n', '```', '</PREFIX>', '<SUFFIX>'],
					},
				}),
				signal: abortSignal,
			});

			if (!resp.ok) {
				return null;
			}

			const data = await resp.json();
			const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
			return this.cleanCompletion(text);
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
			throw new Error('AI is disabled or unconfigured. Please check AI Settings.');
		}

		this.isGenerating.set(true);
		try {
			const diff = await invoke<string>('get_git_diff_for_commit', { repoPath });
			const trimmedDiff = diff.trim();
			if (!trimmedDiff) {
				return 'chore: update project files';
			}

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
		if (!this.isConfigured() || !this.isEnabled()) {
			return null;
		}

		try {
			const apiKey = this.geminiApiKey().trim();
			const model = this.geminiModel();
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

			const systemMsg = messages.find((m) => m.role === 'system')?.content;
			const userMsg = messages
				.filter((m) => m.role !== 'system')
				.map((m) => m.content)
				.join('\n\n');

			const body: any = {
				contents: [{ role: 'user', parts: [{ text: userMsg }] }],
				generationConfig: {
					temperature,
					maxOutputTokens: 500,
				},
			};

			if (systemMsg) {
				body.system_instruction = {
					parts: [{ text: systemMsg }],
				};
			}

			const resp = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});

			if (!resp.ok) {
				return null;
			}

			const data = await resp.json();
			return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
		} catch (err) {
			console.error('Gemini query failed:', err);
			return null;
		}
	}

	private cleanCompletion(text: string | null | undefined): string | null {
		if (!text) return null;
		let cleaned = text
			.replace(/<\|fim_prefix\|>|<\|fim_suffix\|>|<\|fim_middle\|>|<\|endoftext\|>/g, '')
			.replace(/<\|file_separator\|>/g, '')
			.replace(/<\/?PREFIX>/gi, '')
			.replace(/<\/?SUFFIX>/gi, '');

		if (cleaned.startsWith('```')) {
			const firstLineEnd = cleaned.indexOf('\n');
			const lastFence = cleaned.lastIndexOf('```');
			if (firstLineEnd !== -1 && lastFence > firstLineEnd) {
				cleaned = cleaned.substring(firstLineEnd + 1, lastFence);
			} else {
				cleaned = cleaned.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '');
			}
		}

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
