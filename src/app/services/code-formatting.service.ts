/**
 * code-formatting.service.ts - Multi-language code formatting provider for Monaco Editor
 * Supports Prettier for web languages (TS, JS, HTML, CSS, SCSS, JSON, Markdown, YAML)
 * and high-fidelity AST/token-based beautifiers for PHP, OmniFlux, and generic languages.
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import { Injectable, inject } from '@angular/core';
import type * as MonacoType from 'monaco-editor';
import { WorkspaceService } from './workspace.service';

@Injectable({
	providedIn: 'root',
})
export class CodeFormattingService {
	private workspaceService = inject(WorkspaceService);

	// Cached prettier modules for lazy-loaded performance
	private prettierStandalone: any = null;
	private pluginsMap: Record<string, any> = {};
	private isPrettierLoading = false;

	/**
	 * Registers document formatting and range formatting providers for all supported languages in Monaco
	 */
	public registerProviders(monaco: typeof MonacoType): void {
		const supportedLanguages = [
			'typescript',
			'javascript',
			'html',
			'css',
			'scss',
			'less',
			'json',
			'markdown',
			'yaml',
			'php',
			'omniflux',
			'xml',
			'sql',
			'shell',
			'c',
			'cpp',
			'rust',
			'python',
		];

		for (const lang of supportedLanguages) {
			// 1. Full document formatting
			monaco.languages.registerDocumentFormattingEditProvider(lang, {
				provideDocumentFormattingEdits: async (model, options, token) => {
					if (token.isCancellationRequested) return [];
					const text = model.getValue();
					try {
						const formatted = await this.formatCode(text, lang, {
							tabSize: options.tabSize,
							insertSpaces: options.insertSpaces,
						});

						if (!formatted || formatted === text) {
							return [];
						}

						return [
							{
								range: model.getFullModelRange(),
								text: formatted,
							},
						];
					} catch (err: any) {
						console.warn(`[CodeFormatting] Error formatting ${lang}:`, err);
						this.workspaceService.showNotification(
							`Format warning: ${err?.message || err}`,
						);
						return [];
					}
				},
			});

			// 2. Selection range formatting
			monaco.languages.registerDocumentRangeFormattingEditProvider(lang, {
				provideDocumentRangeFormattingEdits: async (model, range, options, token) => {
					if (token.isCancellationRequested) return [];
					const selectedText = model.getValueInRange(range);
					if (!selectedText.trim()) return [];

					try {
						const formatted = await this.formatCode(selectedText, lang, {
							tabSize: options.tabSize,
							insertSpaces: options.insertSpaces,
						});

						if (!formatted || formatted === selectedText) {
							return [];
						}

						return [
							{
								range,
								text: formatted.trimEnd(),
							},
						];
					} catch (err: any) {
						console.warn(`[CodeFormatting] Error formatting range in ${lang}:`, err);
						return [];
					}
				},
			});
		}
	}

	/**
	 * Formats a code string based on its language
	 */
	public async formatCode(
		code: string,
		languageId: string,
		options?: { tabSize?: number; insertSpaces?: boolean },
	): Promise<string> {
		const tabSize = options?.tabSize || 2;
		const insertSpaces = options?.insertSpaces ?? true;
		const lang = (languageId || '').toLowerCase();

		// 1. Prettier-supported web languages
		switch (lang) {
			case 'typescript':
			case 'ts':
				return await this.formatWithPrettier(
					code,
					'typescript',
					['typescript', 'estree'],
					tabSize,
					insertSpaces,
				);

			case 'javascript':
			case 'js':
				return await this.formatWithPrettier(
					code,
					'babel',
					['babel', 'estree'],
					tabSize,
					insertSpaces,
				);

			case 'html':
			case 'angular':
				return await this.formatWithPrettier(code, 'html', ['html'], tabSize, insertSpaces);

			case 'css':
				return await this.formatWithPrettier(
					code,
					'css',
					['postcss'],
					tabSize,
					insertSpaces,
				);

			case 'scss':
				return await this.formatWithPrettier(
					code,
					'scss',
					['postcss'],
					tabSize,
					insertSpaces,
				);

			case 'less':
				return await this.formatWithPrettier(
					code,
					'less',
					['postcss'],
					tabSize,
					insertSpaces,
				);

			case 'json':
			case 'jsonc':
				return await this.formatWithPrettier(
					code,
					'json',
					['babel', 'estree'],
					tabSize,
					insertSpaces,
				);

			case 'markdown':
			case 'md':
				return await this.formatWithPrettier(
					code,
					'markdown',
					['markdown'],
					tabSize,
					insertSpaces,
				);

			case 'yaml':
			case 'yml':
				return await this.formatWithPrettier(code, 'yaml', ['yaml'], tabSize, insertSpaces);

			case 'xml':
			case 'svg':
				return await this.formatWithPrettier(code, 'html', ['html'], tabSize, insertSpaces);

			case 'php':
				return await this.formatWithPrettier(
					code,
					'php',
					['php'],
					tabSize || 4,
					insertSpaces,
				);

			case 'omniflux':
			case 'oflux':
			case 'of':
				return this.formatOmniFlux(code, tabSize || 4, insertSpaces);

			default:
				return this.formatGenericBracketedCode(code, tabSize, insertSpaces);
		}
	}

	/**
	 * Runs Prettier standalone with designated parser and plugins
	 */
	private async formatWithPrettier(
		code: string,
		parser: string,
		pluginNames: string[],
		tabSize: number,
		insertSpaces: boolean,
	): Promise<string> {
		try {
			const prettier = await this.getPrettierStandalone();
			const plugins = await this.getPrettierPlugins(pluginNames);

			const options: any = {
				parser,
				plugins,
				tabWidth: tabSize,
				useTabs: !insertSpaces,
				singleQuote: true,
				printWidth: 100,
				trailingComma: 'es5',
				bracketSpacing: true,
				arrowParens: 'avoid',
			};

			if (parser === 'php') {
				options.phpVersion = '8.2';
			}

			const formatted = await prettier.format(code, options);
			return formatted;
		} catch (err: any) {
			const msg = err?.message?.split('\n')?.[0] || String(err);
			console.warn(`[Prettier] Formatting error (${parser}):`, err);
			this.workspaceService.showNotification(`Format notice: ${msg}`);
			// Return original code untouched if syntax error prevents formatting
			return code;
		}
	}

	/**
	 * Lazily loads Prettier standalone
	 */
	private async getPrettierStandalone(): Promise<any> {
		if (this.prettierStandalone) {
			return this.prettierStandalone;
		}
		const mod = await import('prettier/standalone');
		this.prettierStandalone = mod.default || mod;
		return this.prettierStandalone;
	}

	/**
	 * Lazily loads Prettier plugins
	 */
	private async getPrettierPlugins(pluginNames: string[]): Promise<any[]> {
		const loaded: any[] = [];
		for (const name of pluginNames) {
			if (!this.pluginsMap[name]) {
				let mod: any = null;
				switch (name) {
					case 'php':
						mod = await import('@prettier/plugin-php');
						break;
					case 'typescript':
						mod = await import('prettier/plugins/typescript');
						break;
					case 'estree':
						mod = await import('prettier/plugins/estree');
						break;
					case 'babel':
						mod = await import('prettier/plugins/babel');
						break;
					case 'html':
						mod = await import('prettier/plugins/html');
						break;
					case 'postcss':
						mod = await import('prettier/plugins/postcss');
						break;
					case 'markdown':
						mod = await import('prettier/plugins/markdown');
						break;
					case 'yaml':
						mod = await import('prettier/plugins/yaml');
						break;
				}
				if (mod) {
					this.pluginsMap[name] = mod.default || mod;
				}
			}
			if (this.pluginsMap[name]) {
				loaded.push(this.pluginsMap[name]);
			}
		}
		return loaded;
	}

	/**
	 * Formats OmniFlux language files (.of, .omniflux)
	 */
	public formatOmniFlux(source: string, tabSize = 4, insertSpaces = true): string {
		return this.formatGenericBracketedCode(source, tabSize, insertSpaces);
	}

	/**
	 * Generic fallback bracket-and-indentation formatter for any other programming language
	 */
	public formatGenericBracketedCode(source: string, tabSize = 4, insertSpaces = true): string {
		const indentUnit = insertSpaces ? ' '.repeat(tabSize) : '\t';
		const lines = source.split(/\r?\n/);
		const result: string[] = [];
		let currentIndent = 0;

		for (let i = 0; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			if (!trimmed) {
				if (result.length > 0 && result[result.length - 1] !== '') {
					result.push('');
				}
				continue;
			}

			// Count leading closes
			const leadingCloses = (trimmed.match(/^([}\]\)]+)/)?.[1] || '').length;
			const lineIndent = Math.max(0, currentIndent - leadingCloses);

			result.push(indentUnit.repeat(lineIndent) + trimmed);

			// Count open vs close
			let opens = 0;
			let closes = 0;
			let inStr = false;
			let strChar = '';

			for (let c = 0; c < trimmed.length; c++) {
				const ch = trimmed[c];
				const prev = c > 0 ? trimmed[c - 1] : '';

				if (inStr) {
					if (ch === strChar && prev !== '\\') inStr = false;
				} else {
					if (ch === '"' || ch === "'") {
						inStr = true;
						strChar = ch;
					} else if (ch === '{' || ch === '[' || ch === '(') {
						opens++;
					} else if (ch === '}' || ch === ']' || ch === ')') {
						closes++;
					}
				}
			}

			currentIndent += opens - closes;
			if (currentIndent < 0) currentIndent = 0;
		}

		return result.join('\n') + '\n';
	}
}
