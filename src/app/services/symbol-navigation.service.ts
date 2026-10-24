/**
 * symbol-navigation.service.ts - Symbol navigation and outline indexing service
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import { Injectable, inject } from '@angular/core';
import type * as MonacoType from 'monaco-editor';
import { WorkspaceService, GrepResult } from './workspace.service';
import { WorkspaceFile } from '../models/file.model';

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const IGNORED_KEYWORDS = new Set([
	'if',
	'else',
	'elseif',
	'for',
	'foreach',
	'while',
	'do',
	'switch',
	'case',
	'break',
	'continue',
	'return',
	'function',
	'class',
	'interface',
	'trait',
	'enum',
	'extends',
	'implements',
	'public',
	'protected',
	'private',
	'static',
	'final',
	'abstract',
	'const',
	'let',
	'var',
	'new',
	'try',
	'catch',
	'finally',
	'throw',
	'use',
	'namespace',
	'import',
	'export',
	'default',
	'from',
	'as',
	'true',
	'false',
	'null',
	'undefined',
	'void',
	'this',
	'self',
	'parent',
	'echo',
	'print',
	'include',
	'require',
	'include_once',
	'require_once',
	'die',
	'exit',
	'yield',
	'async',
	'await',
]);

const IGNORED_DIR_NAMES = new Set([
	'.git',
	'.vide',
	'node_modules',
	'vendor',
	'.cache',
	'dist',
	'build',
	'.angular',
]);

const BINARY_EXTENSIONS = new Set([
	'png',
	'jpg',
	'jpeg',
	'gif',
	'bmp',
	'webp',
	'ico',
	'svg',
	'zip',
	'tar',
	'gz',
	'7z',
	'rar',
	'pdf',
	'exe',
	'bin',
	'dll',
	'so',
	'dylib',
	'woff',
	'woff2',
	'ttf',
	'eot',
	'mp3',
	'mp4',
	'wav',
	'ogg',
	'mov',
	'avi',
	'mkv',
	'flac',
	'iso',
	'lock',
]);

function getLanguageFamily(ext: string): Set<string> {
	const clean = ext.toLowerCase().replace(/^\./, '');
	if (['php', 'phtml', 'php4', 'php5', 'php7', 'php8', 'inc'].includes(clean)) {
		return new Set(['php', 'phtml', 'inc']);
	}
	if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(clean)) {
		return new Set(['ts', 'tsx', 'js', 'jsx', 'html']);
	}
	if (['of', 'omniflux'].includes(clean)) {
		return new Set(['of', 'omniflux']);
	}
	if (['pl', 'pm', 'perl'].includes(clean)) {
		return new Set(['pl', 'pm', 'perl']);
	}
	if (['py', 'pyw'].includes(clean)) {
		return new Set(['py', 'pyw']);
	}
	if (['css', 'scss', 'sass', 'less'].includes(clean)) {
		return new Set(['css', 'scss', 'sass', 'less', 'html']);
	}
	if (['html', 'htm'].includes(clean)) {
		return new Set(['html', 'htm', 'ts', 'js', 'php']);
	}
	return new Set([clean]);
}

@Injectable({
	providedIn: 'root',
})
export class SymbolNavigationService {
	private readonly workspaceService = inject(WorkspaceService);
	private isRegistered = false;
	private monacoRef: typeof MonacoType | null = null;

	public registerProviders(monaco: typeof MonacoType): void {
		if (this.isRegistered) return;
		this.isRegistered = true;
		this.monacoRef = monaco;

		// Register universal Definition Provider for all languages ('*')
		monaco.languages.registerDefinitionProvider('*', {
			provideDefinition: async (model, position, token) => {
				return this.provideDefinition(model, position, token, monaco);
			},
		});

		// Register editor opener to handle cross-file navigation from definitions
		monaco.editor.registerEditorOpener({
			openCodeEditor: (source, resource, selectionOrPosition) => {
				return this.handleOpenCodeEditor(source, resource, selectionOrPosition);
			},
		});
	}

	public isLineFunctionDefinition(line: string): boolean {
		const trimmed = line.trim();
		if (
			!trimmed ||
			trimmed.startsWith('//') ||
			trimmed.startsWith('*') ||
			trimmed.startsWith('/*') ||
			trimmed.startsWith('#')
		) {
			return false;
		}

		if (
			/^(?:if|elseif|while|for|foreach|switch|catch|return|throw|echo|print)\b/.test(trimmed)
		) {
			return false;
		}
		if (/^(?:this\.|super\.|\$this->)/.test(trimmed)) {
			return false;
		}

		const defPatterns = [
			/(?:(?:public|protected|private|static|final|abstract)\s+)*function\s*(?:\*\s*)?(?:&\s*)?[a-zA-Z0-9_$]*\s*[\(<]/i,
			/^(?:(?:public|protected|private|static|async|override|readonly|get|set)\s+)+[a-zA-Z0-9_$]+\s*[\(<:=]/,
			/^[a-zA-Z0-9_$]+\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{?$/,
			/(?:export\s+)?(?:const|let|var)\s+[a-zA-Z0-9_$]+\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/,
			/^[a-zA-Z0-9_$]+\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/,
			/\b(?:proc|func|flow|action|task|component)\s+[a-zA-Z0-9_$]+/i,
			/\bsub\s+[a-zA-Z0-9_$]+/i,
			/\b(?:def|fn)\s+[a-zA-Z0-9_$]+/i,
			/\b(?:class|interface|trait|enum|struct)\s+[a-zA-Z0-9_$]+/i,
			/^(?:export\s+)?type\s+[a-zA-Z0-9_$]+\s*=/i,
		];

		return defPatterns.some((p) => p.test(trimmed));
	}

	public isCursorOnDefinition(
		model: MonacoType.editor.ITextModel,
		position: MonacoType.IPosition,
	): boolean {
		const line = model.getLineContent(position.lineNumber);
		if (this.isLineFunctionDefinition(line)) {
			return true;
		}

		if (position.lineNumber > 1) {
			const prevLine = model.getLineContent(position.lineNumber - 1);
			if (
				this.isLineFunctionDefinition(prevLine) &&
				!prevLine.includes('{') &&
				!prevLine.includes(';')
			) {
				return true;
			}
		}

		const symbolInfo = this.extractSymbolAtPosition(model, position, this.monacoRef);
		if (!symbolInfo) return false;

		const { queryWord, isVar, bareSymbol } = symbolInfo;
		if (bareSymbol.length < 2) return false;

		return this.isLineDefiningSymbol(line, queryWord, isVar);
	}

	public isLineDefiningSymbol(line: string, queryWord: string, isVar: boolean): boolean {
		if (isVar) {
			return false; // Function definition requested by user
		}

		const bareSymbol = queryWord.startsWith('$') ? queryWord.substring(1) : queryWord;
		const escaped = escapeRegex(bareSymbol);

		const funcPatterns = [
			new RegExp(
				`(?:(?:public|protected|private|static|final|abstract)\\s+)*function\\s*(?:\\*\\s*)?(?:&\\s*)?${escaped}\\s*[\\(<]`,
				'i',
			),
			new RegExp(`(?:func|proc|flow|action|task|component)\\s+${escaped}\\b`, 'i'),
			new RegExp(
				`(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*(?:\\*\\s*)?${escaped}\\s*[\\(<]`,
				'i',
			),
			new RegExp(
				`(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[a-zA-Z0-9_$]+)\\s*=>`,
			),
			new RegExp(`^(?:export\\s+)?type\\s+${escaped}\\s*=`),
			new RegExp(
				`(?:public|protected|private|static|async|override|get|set|readonly)\\s+(?:async\\s+)?${escaped}\\s*[\\(<:=]`,
			),
			new RegExp(`^\\s*${escaped}\\s*\\([^)]*\\)\\s*(?::\\s*[^{]+)?\\s*\\{?`),
			new RegExp(
				`^\\s*${escaped}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[a-zA-Z0-9_$]+)\\s*=>`,
			),
			new RegExp(`sub\\s+${escaped}\\b`, 'i'),
			new RegExp(`(?:def|fn)\\s+${escaped}\\b`, 'i'),
			new RegExp(`(?:class|interface|trait|enum|struct)\\s+${escaped}\\b`, 'i'),
		];

		return funcPatterns.some((p) => p.test(line));
	}

	public async triggerFindReferences(
		model: MonacoType.editor.ITextModel,
		position: MonacoType.IPosition,
	): Promise<void> {
		const symbolInfo = this.extractSymbolAtPosition(model, position, this.monacoRef);
		if (!symbolInfo) {
			this.workspaceService.showNotification('Place cursor on a symbol to find references');
			return;
		}

		const { queryWord, isVar, bareSymbol } = symbolInfo;
		if (bareSymbol.length < 2) return;

		this.workspaceService.pendingReferencesSymbol.set(queryWord);
		this.workspaceService.pendingReferences.set([]);
		this.workspaceService.isSearchingReferences.set(true);
		this.workspaceService.openModal('references');

		const results = await this.searchReferencesForSymbol(
			model,
			position,
			queryWord,
			isVar,
			bareSymbol,
		);
		this.workspaceService.pendingReferences.set(results);
		this.workspaceService.isSearchingReferences.set(false);
	}

	private async provideDefinition(
		model: MonacoType.editor.ITextModel,
		position: MonacoType.IPosition,
		token: MonacoType.CancellationToken,
		monaco: typeof MonacoType,
	): Promise<MonacoType.languages.Location[] | null> {
		const symbolInfo = this.extractSymbolAtPosition(model, position, monaco);
		if (!symbolInfo) return null;

		const { queryWord, isVar, bareSymbol } = symbolInfo;
		if (bareSymbol.length < 2) return null;
		if (!isVar && IGNORED_KEYWORDS.has(queryWord.toLowerCase())) {
			return null;
		}

		// If cursor is already on the definition line itself, do not show/jump to definition
		if (this.isCursorOnDefinition(model, position)) {
			return null;
		}

		// 1. First check the active model for immediate local definition (0ms)
		const currentMatches = this.findDefinitionsInContent(model.getValue(), queryWord, isVar);
		if (currentMatches.length > 0) {
			const locations: MonacoType.languages.Location[] = [];
			for (const m of currentMatches) {
				locations.push({
					uri: model.uri,
					range: new monaco.Range(m.lineNumber, m.startCol, m.lineNumber, m.endCol),
				});
			}
			return locations;
		}

		// 2. Check open tabs (already in memory, 0.5ms)
		const openTabs = this.workspaceService.openTabs();
		const activeFile = this.workspaceService.activeFile();
		const tabLocations: MonacoType.languages.Location[] = [];

		for (const tab of openTabs) {
			if (activeFile && tab.id === activeFile.id) continue;
			if (!tab.content || !tab.content.includes(bareSymbol)) continue;

			const tabMatches = this.findDefinitionsInContent(tab.content, queryWord, isVar);
			if (tabMatches.length > 0) {
				const tabUri = this.ensureModelForFile(tab, monaco);
				for (const m of tabMatches) {
					tabLocations.push({
						uri: tabUri,
						range: new monaco.Range(m.lineNumber, m.startCol, m.lineNumber, m.endCol),
					});
				}
			}
		}

		if (tabLocations.length > 0) {
			return tabLocations;
		}

		// 3. Search candidate files strictly filtered by language family (capped at 15 files)
		const allFiles = this.workspaceService.files();
		const currentExt = activeFile?.name.includes('.')
			? activeFile.name.substring(activeFile.name.lastIndexOf('.') + 1)
			: '';
		const family = getLanguageFamily(currentExt);

		const candidateFiles = allFiles.filter((f) => {
			if (activeFile && f.id === activeFile.id) return false;
			if (this.isBinaryOrIgnored(f.name, f.path)) return false;
			const ext = f.name.includes('.') ? f.name.substring(f.name.lastIndexOf('.') + 1) : '';
			return family.has(ext.toLowerCase());
		});

		// Sort candidate files:
		// A. Files that contain the symbol in their filename or path
		// B. Files in the same folder
		const currentDir =
			activeFile?.path && activeFile.path.includes('/')
				? activeFile.path.substring(0, activeFile.path.lastIndexOf('/'))
				: '';

		candidateFiles.sort((a, b) => {
			const aHasName = a.name.toLowerCase().includes(bareSymbol.toLowerCase()) ? 1 : 0;
			const bHasName = b.name.toLowerCase().includes(bareSymbol.toLowerCase()) ? 1 : 0;
			if (aHasName !== bHasName) return bHasName - aHasName;

			const aSameDir = currentDir && a.path.startsWith(currentDir) ? 1 : 0;
			const bSameDir = currentDir && b.path.startsWith(currentDir) ? 1 : 0;
			return bSameDir - aSameDir;
		});

		const diskLocations: MonacoType.languages.Location[] = [];
		const maxFilesToCheck = Math.min(candidateFiles.length, 15);

		for (let i = 0; i < maxFilesToCheck; i++) {
			if (token.isCancellationRequested) break;
			const file = candidateFiles[i];

			const content = await this.workspaceService.ensureFileContent(file);
			if (!content || !content.includes(bareSymbol)) continue;

			const matches = this.findDefinitionsInContent(content, queryWord, isVar);
			if (matches.length > 0) {
				const fileUri = this.ensureModelForFile(file, monaco);
				for (const m of matches) {
					diskLocations.push({
						uri: fileUri,
						range: new monaco.Range(m.lineNumber, m.startCol, m.lineNumber, m.endCol),
					});
				}
				// Stop as soon as definition is found
				break;
			}

			// Yield to UI thread every 3 files
			if ((i + 1) % 3 === 0) {
				await new Promise((r) => setTimeout(r, 0));
			}
		}

		return diskLocations.length > 0 ? diskLocations : null;
	}

	private async searchReferencesForSymbol(
		model: MonacoType.editor.ITextModel,
		originPosition: MonacoType.IPosition,
		_queryWord: string,
		isVar: boolean,
		bareSymbol: string,
	): Promise<GrepResult[]> {
		const results: GrepResult[] = [];
		const escaped = escapeRegex(bareSymbol);
		const regex = isVar
			? new RegExp(`\\$${escaped}\\b`, 'g')
			: new RegExp(`\\b${escaped}\\b`, 'g');

		const activeFile = this.workspaceService.activeFile();
		const currentLines = model.getValue().split('\n');

		// 1. Current model matches (0ms) - omit the current line user is on
		if (activeFile) {
			for (let i = 0; i < currentLines.length; i++) {
				const lineNum = i + 1;
				if (originPosition && lineNum === originPosition.lineNumber) {
					continue;
				}

				const line = currentLines[i];
				if (!line.includes(bareSymbol)) continue;
				regex.lastIndex = 0;
				let m: RegExpExecArray | null;
				let hasMatchOnLine = false;
				while ((m = regex.exec(line)) !== null) {
					if (!hasMatchOnLine) {
						results.push({
							file: activeFile,
							lineNumber: lineNum,
							lineText: line.trim(),
							matchStart: m.index,
							matchLength: m[0].length,
						});
						hasMatchOnLine = true;
					}
					if (m.index === regex.lastIndex) regex.lastIndex++;
				}
			}
		}

		// 2. Open tabs (0.5ms)
		const openTabs = this.workspaceService.openTabs();
		for (const tab of openTabs) {
			if (activeFile && tab.id === activeFile.id) continue;
			if (!tab.content || !tab.content.includes(bareSymbol)) continue;

			const lines = tab.content.split('\n');
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (!line.includes(bareSymbol)) continue;
				regex.lastIndex = 0;
				let m: RegExpExecArray | null;
				let hasMatchOnLine = false;
				while ((m = regex.exec(line)) !== null) {
					if (!hasMatchOnLine) {
						results.push({
							file: tab,
							lineNumber: i + 1,
							lineText: line.trim(),
							matchStart: m.index,
							matchLength: m[0].length,
						});
						hasMatchOnLine = true;
					}
					if (m.index === regex.lastIndex) regex.lastIndex++;
				}
			}
		}

		// 3. Other candidate files in the same language family (capped at 30 files)
		const allFiles = this.workspaceService.files();
		const currentExt = activeFile?.name.includes('.')
			? activeFile.name.substring(activeFile.name.lastIndexOf('.') + 1)
			: '';
		const family = getLanguageFamily(currentExt);

		const candidateFiles = allFiles.filter((f) => {
			if (activeFile && f.id === activeFile.id) return false;
			if (openTabs.some((t) => t.id === f.id)) return false;
			if (this.isBinaryOrIgnored(f.name, f.path)) return false;
			const ext = f.name.includes('.') ? f.name.substring(f.name.lastIndexOf('.') + 1) : '';
			return family.has(ext.toLowerCase());
		});

		const maxFilesToSearch = Math.min(candidateFiles.length, 30);
		for (let i = 0; i < maxFilesToSearch; i++) {
			if (results.length >= 100) break;
			const file = candidateFiles[i];

			const content = await this.workspaceService.ensureFileContent(file);
			if (!content || !content.includes(bareSymbol)) continue;

			const lines = content.split('\n');
			for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
				const line = lines[lineIdx];
				if (!line.includes(bareSymbol)) continue;
				regex.lastIndex = 0;
				let m: RegExpExecArray | null;
				let hasMatchOnLine = false;
				while ((m = regex.exec(line)) !== null) {
					if (!hasMatchOnLine) {
						results.push({
							file,
							lineNumber: lineIdx + 1,
							lineText: line.trim(),
							matchStart: m.index,
							matchLength: m[0].length,
						});
						hasMatchOnLine = true;
					}
					if (m.index === regex.lastIndex) regex.lastIndex++;
					if (results.length >= 100) break;
				}
				if (results.length >= 100) break;
			}

			if ((i + 1) % 4 === 0) {
				await new Promise((r) => setTimeout(r, 0));
			}
		}

		return results;
	}

	private extractSymbolAtPosition(
		model: MonacoType.editor.ITextModel,
		position: MonacoType.IPosition,
		_monaco?: typeof MonacoType | null,
	): { queryWord: string; isVar: boolean; bareSymbol: string } | null {
		let wordInfo = model.getWordAtPosition(position);
		const line = model.getLineContent(position.lineNumber);

		let isVar = false;
		let queryWord = '';

		if (!wordInfo) {
			// Check if cursor is directly on a $ character
			if (position.column <= line.length && line[position.column - 1] === '$') {
				wordInfo = model.getWordAtPosition({
					lineNumber: position.lineNumber,
					column: position.column + 1,
				} as any);
				if (wordInfo) {
					isVar = true;
					queryWord = '$' + wordInfo.word;
				}
			}
		} else {
			if (wordInfo.startColumn > 1 && line[wordInfo.startColumn - 2] === '$') {
				isVar = true;
				queryWord = '$' + wordInfo.word;
			} else {
				queryWord = wordInfo.word;
			}
		}

		if (!wordInfo || !queryWord) {
			return null;
		}

		const bareSymbol = isVar && queryWord.startsWith('$') ? queryWord.substring(1) : queryWord;
		return { queryWord, isVar, bareSymbol };
	}

	private findDefinitionsInContent(
		content: string,
		queryWord: string,
		isVar: boolean,
	): { lineNumber: number; startCol: number; endCol: number }[] {
		const results: { lineNumber: number; startCol: number; endCol: number }[] = [];
		const bareSymbol = isVar && queryWord.startsWith('$') ? queryWord.substring(1) : queryWord;
		const escaped = escapeRegex(bareSymbol);

		const patterns: RegExp[] = [];

		if (isVar) {
			// PHP / Perl variable assignment or property/parameter declaration
			patterns.push(
				new RegExp(
					`(?:(?:public|protected|private|static|var)\\s+)?\\$${escaped}\\s*=`,
					'i',
				),
			);
			patterns.push(
				new RegExp(`(?:function|fn|sub)\\s+[^\\(]*\\([^\\)]*\\$${escaped}\\b`, 'i'),
			);
		} else {
			// Functions & Methods (PHP, JS/TS, OmniFlux, Perl, Go, Rust, etc.)
			patterns.push(
				new RegExp(
					`(?:(?:public|protected|private|static|final|abstract)\\s+)*function\\s+(?:&\\s*)?${escaped}\\s*\\(`,
					'i',
				),
			);
			patterns.push(
				new RegExp(
					`(?:func|proc|flow|action|task|component|service|endpoint)\\s+${escaped}\\b`,
					'i',
				),
			);
			patterns.push(
				new RegExp(
					`(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*(?:\\*\\s*)?${escaped}\\s*[\\(<]`,
					'i',
				),
			);
			patterns.push(
				new RegExp(
					`(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[a-zA-Z0-9_$]+)\\s*=>`,
				),
			);
			patterns.push(
				new RegExp(
					`(?:public|protected|private|static|async|get|set|readonly)\\s+(?:async\\s+)?${escaped}\\s*[\\(<:=]`,
				),
			);
			patterns.push(new RegExp(`^\\s*${escaped}\\s*\\([^)]*\\)\\s*(?::\\s*[^{]+)?\\{`));
			patterns.push(new RegExp(`sub\\s+${escaped}\\b`, 'i'));
			patterns.push(new RegExp(`(?:def|fn)\\s+${escaped}\\b`, 'i'));

			// Classes, Interfaces, Types, Traits, Enums
			patterns.push(
				new RegExp(`(?:class|interface|trait|enum|type|struct)\\s+${escaped}\\b`, 'i'),
			);
			patterns.push(
				new RegExp(`(?:const\\s+${escaped}\\s*=|define\\s*\\(\\s*['"]${escaped}['"])`, 'i'),
			);
			patterns.push(new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\b\\s*[:=]`));
			patterns.push(new RegExp(`(?:state|prop|var|const|model|data)\\s+${escaped}\\b`, 'i'));
		}

		const lines = content.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line.includes(bareSymbol)) continue;

			for (const pat of patterns) {
				const m = pat.exec(line);
				if (m) {
					const sym = isVar ? '$' + bareSymbol : bareSymbol;
					let idx = line.indexOf(sym, m.index);
					if (idx === -1) {
						idx = line.indexOf(bareSymbol, m.index);
					}
					if (idx === -1) {
						idx = line.indexOf(bareSymbol);
					}
					if (idx !== -1) {
						const startCol = idx + 1;
						const endCol =
							startCol + (line.startsWith('$', idx) ? sym.length : bareSymbol.length);
						results.push({ lineNumber: i + 1, startCol, endCol });
						break;
					}
				}
			}
		}

		return results;
	}

	private handleOpenCodeEditor(
		_source: MonacoType.editor.ICodeEditor,
		resource: MonacoType.Uri,
		selectionOrPosition?: MonacoType.IRange | MonacoType.IPosition,
	): boolean {
		const uriStr = resource.toString();
		const prefix = 'inmemory://workspace/';
		if (!uriStr.startsWith(prefix)) return false;

		const rawId = decodeURIComponent(uriStr.substring(prefix.length));
		const allFiles = this.workspaceService.files();
		const file = allFiles.find((f) => f.id === rawId || f.path === rawId || f.name === rawId);
		if (!file) return false;

		let line = 1;
		let col = 1;
		if (selectionOrPosition) {
			if ('startLineNumber' in selectionOrPosition) {
				line = selectionOrPosition.startLineNumber;
				col = selectionOrPosition.startColumn;
			} else if ('lineNumber' in selectionOrPosition) {
				line = selectionOrPosition.lineNumber;
				col = selectionOrPosition.column;
			}
		}

		this.workspaceService.jumpToLine(file, line, col);
		return true;
	}

	private ensureModelForFile(file: WorkspaceFile, monaco: typeof MonacoType): MonacoType.Uri {
		const safeId = encodeURIComponent(file.id || file.path || file.name);
		const uri = monaco.Uri.parse(`inmemory://workspace/${safeId}`);
		let model = monaco.editor.getModel(uri);
		if (!model || model.isDisposed()) {
			const lang = file.language || 'plaintext';
			model = monaco.editor.createModel(file.content ?? '', lang, uri);
		}
		return uri;
	}

	private isBinaryOrIgnored(filename: string, filepath?: string): boolean {
		if (filepath) {
			const parts = filepath.split('/');
			for (const part of parts) {
				if (IGNORED_DIR_NAMES.has(part)) return true;
			}
		}
		const ext = filename.split('.').pop()?.toLowerCase() || '';
		return BINARY_EXTENSIONS.has(ext);
	}
}
