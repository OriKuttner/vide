/**
 * editor-config.service.ts - Parses and applies .editorconfig rules
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

import { Injectable, signal } from '@angular/core';

export interface EditorConfigProperties {
	indentStyle?: 'tabs' | 'spaces';
	indentSize?: number;
	tabWidth?: number;
	endOfLine?: 'lf' | 'crlf' | 'cr';
	charset?: string;
	trimTrailingWhitespace?: boolean;
	insertFinalNewline?: boolean;
	maxLineLength?: number | 'off';
}

interface EditorConfigSection {
	pattern: string;
	regex: RegExp;
	properties: EditorConfigProperties;
}

@Injectable({
	providedIn: 'root',
})
export class EditorConfigService {
	// Raw parsed sections from the active .editorconfig
	private readonly sections = signal<EditorConfigSection[]>([]);

	// Flag indicating if a valid .editorconfig is active in the current workspace
	public readonly hasConfig = signal<boolean>(false);

	/**
	 * Clears the loaded config
	 */
	public clear(): void {
		this.sections.set([]);
		this.hasConfig.set(false);
	}

	/**
	 * Parses .editorconfig file content into structured rules
	 */
	public loadConfigFromContent(content: string): void {
		if (!content || !content.trim()) {
			this.clear();
			return;
		}

		const lines = content.split(/\r?\n/);
		const parsedSections: EditorConfigSection[] = [];
		let currentSection: EditorConfigSection | null = null;

		for (let line of lines) {
			line = line.trim();
			// Skip empty lines and comments
			if (!line || line.startsWith('#') || line.startsWith(';')) {
				continue;
			}

			// Section header e.g. [*], [*.ts], [*.{js,ts}]
			if (line.startsWith('[') && line.endsWith(']')) {
				const pattern = line.slice(1, -1).trim();
				const regex = this.globToRegex(pattern);
				currentSection = {
					pattern,
					regex,
					properties: {},
				};
				parsedSections.push(currentSection);
				continue;
			}

			// Key-value pair
			const eqIdx = line.indexOf('=');
			if (eqIdx !== -1) {
				const key = line.slice(0, eqIdx).trim().toLowerCase();
				const val = line.slice(eqIdx + 1).trim().toLowerCase();

				// If no section defined yet, properties belong to root/global
				if (!currentSection) {
					currentSection = {
						pattern: '*',
						regex: /(^|\/).*$/,
						properties: {},
					};
					parsedSections.push(currentSection);
				}

				this.applyProperty(currentSection.properties, key, val);
			}
		}

		this.sections.set(parsedSections);
		this.hasConfig.set(parsedSections.length > 0);
	}

	/**
	 * Resolves the merged EditorConfig rules for a given file name or relative path
	 */
	public getPropertiesForFile(filePathOrName: string): EditorConfigProperties {
		const normalized = (filePathOrName || '').replace(/\\/g, '/');
		const merged: EditorConfigProperties = {};

		for (const section of this.sections()) {
			if (section.regex.test(normalized) || section.regex.test(normalized.split('/').pop() || '')) {
				Object.assign(merged, section.properties);
			}
		}

		return merged;
	}

	/**
	 * Applies save-time rules (trim trailing whitespace, insert final newline, line endings)
	 */
	public applySaveRules(content: string, filePathOrName: string): string {
		if (!this.hasConfig() || content === null || content === undefined) {
			return content;
		}

		const rules = this.getPropertiesForFile(filePathOrName);
		let result = content;

		// 1. Trim trailing whitespace from lines
		if (rules.trimTrailingWhitespace === true) {
			result = result.replace(/[ \t]+$/gm, '');
		}

		// 2. Insert final newline
		if (rules.insertFinalNewline === true) {
			if (result.length > 0 && !result.endsWith('\n')) {
				result += rules.endOfLine === 'crlf' ? '\r\n' : '\n';
			}
		}

		// 3. Normalize line endings if specified
		if (rules.endOfLine === 'lf') {
			result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		} else if (rules.endOfLine === 'crlf') {
			result = result.replace(/\r?\n/g, '\r\n');
		}

		return result;
	}

	/**
	 * Parses property value into typed object
	 */
	private applyProperty(props: EditorConfigProperties, key: string, val: string): void {
		switch (key) {
			case 'indent_style':
				if (val === 'tab') props.indentStyle = 'tabs';
				else if (val === 'space') props.indentStyle = 'spaces';
				break;
			case 'indent_size':
				if (val === 'tab') {
					props.indentSize = props.tabWidth || 4;
				} else {
					const num = parseInt(val, 10);
					if (!isNaN(num) && num > 0) props.indentSize = num;
				}
				break;
			case 'tab_width': {
				const num = parseInt(val, 10);
				if (!isNaN(num) && num > 0) props.tabWidth = num;
				break;
			}
			case 'end_of_line':
				if (val === 'lf' || val === 'crlf' || val === 'cr') props.endOfLine = val;
				break;
			case 'charset':
				props.charset = val;
				break;
			case 'trim_trailing_whitespace':
				props.trimTrailingWhitespace = val === 'true';
				break;
			case 'insert_final_newline':
				props.insertFinalNewline = val === 'true';
				break;
			case 'max_line_length':
				if (val === 'off') props.maxLineLength = 'off';
				else {
					const num = parseInt(val, 10);
					if (!isNaN(num) && num > 0) props.maxLineLength = num;
				}
				break;
		}
	}

	/**
	 * Converts an EditorConfig glob pattern to RegExp
	 */
	private globToRegex(glob: string): RegExp {
		if (glob === '*') {
			return /.*/;
		}

		let pattern = glob;
		// Handle {a,b,c} expansion
		pattern = pattern.replace(/\{([^}]+)\}/g, (_, group) => {
			const sub = group.split(',').map((s: string) => this.escapeRegex(s.trim())).join('|');
			return `(${sub})`;
		});

		// Escape special regex chars except * and ?
		pattern = pattern
			.replace(/[.+^${}()|[\]\\]/g, '\\$&')
			.replace(/\*\*/g, '§§DOUBLE_STAR§§')
			.replace(/\*/g, '[^/]*')
			.replace(/§§DOUBLE_STAR§§/g, '.*')
			.replace(/\?/g, '[^/]');

		return new RegExp(`(^|/)${pattern}$`, 'i');
	}

	private escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
}
