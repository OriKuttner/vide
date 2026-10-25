/**
 * file.model.ts - Data models and interfaces for files, folders, and tabs
 * Part of Vector IDE
 * Written by: Ori Kuttner and Shira (Antigravity agent)
 */

export interface WorkspaceFile {
	id: string;
	name: string;
	path: string;
	language: string;
	content: string;
	originalContent?: string;
	savedContent?: string;
	gitStatus?: 'modified' | 'added' | 'deleted' | 'untracked';
	isLoaded?: boolean;
	isModified?: boolean;
	isPreview?: boolean;
	handle?: any; // FileSystemFileHandle when opened from local disk
	rawFile?: File; // Raw file fallback
	fsPath?: string; // Absolute filesystem path in Tauri desktop mode
	isImage?: boolean; // True if file is an image (PNG, JPG, SVG, etc.)
	imageUrl?: string; // Blob URL or base64 data URL for preview
	isBinary?: boolean; // True if file is a non-text, non-image binary file
	fileTypeDescription?: string; // Description from `file -b` or magic byte detection
	hexData?: HexViewResult; // Loaded hex view data
	fileSize?: number; // Size in bytes
	lastDiskMtime?: number; // Last known modification time in ms (for disk change signature)
	lastDiskSize?: number; // Last known size in bytes (for disk change signature)
	indentType?: 'tabs' | 'spaces';
	tabSize?: number;
	isIndentationCustom?: boolean;
	cursor?: { line: number; column: number };
	readOnly?: boolean;
	commitDiffInfo?: {
		commitHash: string;
		shortHash: string;
		originalTitle: string;
		modifiedTitle: string;
	};
}

export interface HexLine {
	offset: string;
	hex_part1: string;
	hex_part2: string;
	ascii: string;
}

export interface HexViewResult {
	total_size: number;
	file_type: string;
	lines: HexLine[];
	bytes_shown: number;
	has_more: boolean;
}

export interface FileInspectionResult {
	is_binary: boolean;
	file_type: string;
	mime_type: string;
	size: number;
}

export interface FileTreeNode {
	id: string;
	name: string;
	path: string;
	kind: 'file' | 'directory';
	language?: string;
	expanded?: boolean;
	isLoaded?: boolean;
	isLoading?: boolean;
	children?: FileTreeNode[];
	file?: WorkspaceFile;
	handle?: any; // Directory or file handle
	fsPath?: string; // Absolute filesystem path in Tauri desktop mode
	level: number;
}

export interface IFileSystemService {
	readFile(path: string): Promise<string>;
	saveFile(path: string, content: string): Promise<void>;
	listFiles(): Promise<WorkspaceFile[]>;
}

export function detectLanguageFromFilename(filename: string): string {
	let lower = filename.toLowerCase();

	// Strip trailing backup / temporary extensions (e.g. .php.bak -> .php)
	if (lower.endsWith('~')) {
		lower = lower.slice(0, -1);
	}
	for (const bExt of ['.bak', '.old', '.orig', '.backup', '.tmp']) {
		if (lower.endsWith(bExt)) {
			lower = lower.slice(0, -bExt.length);
			break;
		}
	}

	// Special extensionless files or exact names
	if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'dockerfile';
	if (lower === 'makefile' || lower === 'gnumakefile') return 'shell';
	if (lower === '.gitignore' || lower === '.gitattributes' || lower === '.gitmodules')
		return 'ini';
	if (lower === '.env' || lower.startsWith('.env.')) return 'ini';

	if (lower.endsWith('.of')) return 'omniflux';
	if (
		lower.endsWith('.php') ||
		lower.endsWith('.phtml') ||
		lower.endsWith('.php8') ||
		lower.endsWith('.inc')
	)
		return 'php';
	if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
	if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs'))
		return 'javascript';
	if (lower.endsWith('.pl') || lower.endsWith('.pm') || lower.endsWith('.t')) return 'perl';
	if (lower.endsWith('.c') || lower.endsWith('.h')) return 'c';
	if (
		lower.endsWith('.cpp') ||
		lower.endsWith('.cc') ||
		lower.endsWith('.cxx') ||
		lower.endsWith('.hpp')
	)
		return 'cpp';
	if (
		lower.endsWith('.html') ||
		lower.endsWith('.htm') ||
		lower.endsWith('.xhtml') ||
		lower.endsWith('.xht')
	)
		return 'html';
	if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.less')) return 'css';
	if (
		lower.endsWith('.json') ||
		lower.endsWith('.jsonc') ||
		lower.endsWith('.jsonld') ||
		lower.endsWith('.webmanifest')
	)
		return 'json';
	if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdx'))
		return 'markdown';
	if (lower.endsWith('.sql')) return 'sql';
	if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) return 'shell';
	if (lower.endsWith('.py') || lower.endsWith('.pyw')) return 'python';
	if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
	if (
		lower.endsWith('.xml') ||
		lower.endsWith('.opf') ||
		lower.endsWith('.ncx') ||
		lower.endsWith('.xsd') ||
		lower.endsWith('.xsl') ||
		lower.endsWith('.xslt') ||
		lower.endsWith('.plist') ||
		lower.endsWith('.xaml') ||
		lower.endsWith('.dtd') ||
		lower.endsWith('.rss') ||
		lower.endsWith('.atom') ||
		lower.endsWith('.kml') ||
		lower.endsWith('.gpx') ||
		lower.endsWith('.wsdl') ||
		lower.endsWith('.xlf') ||
		lower.endsWith('.xliff')
	)
		return 'xml';
	if (lower.endsWith('.rs')) return 'rust';
	if (isImageFile(filename)) return 'image';
	if (isBinaryFile(filename)) return 'binary';

	return 'plaintext';
}

/**
 * Detects programming language first by filename, and if ambiguous or plaintext,
 * inspects content signatures such as Shebang (#!), PHP tags, HTML/XML prologs, JSON, OmniFlux, SQL, etc.
 */
export function detectLanguage(filename: string, content?: string): string {
	const fromFilename = detectLanguageFromFilename(filename);

	// If filename clearly identified a specific language, trust it
	if (fromFilename !== 'plaintext') {
		return fromFilename;
	}

	// Inspect content for signatures
	if (content) {
		const trimmed = content.trim();
		if (!trimmed) return 'plaintext';

		// 1. Shebang line (#!/...)
		if (trimmed.startsWith('#!')) {
			const firstLine = trimmed.split('\n')[0].toLowerCase();
			if (firstLine.includes('omniflux') || firstLine.includes('/of')) return 'omniflux';
			if (firstLine.includes('php')) return 'php';
			if (
				firstLine.includes('bash') ||
				firstLine.includes('/sh') ||
				firstLine.includes('zsh')
			)
				return 'shell';
			if (
				firstLine.includes('node') ||
				firstLine.includes('deno') ||
				firstLine.includes('bun')
			)
				return 'javascript';
			if (firstLine.includes('perl')) return 'perl';
			if (firstLine.includes('python')) return 'python';
		}

		const headerSnippet = trimmed.slice(0, 2048);

		// 2. XML prolog (MUST be checked before PHP, since <?xml starts with <?)
		if (/<\?xml/i.test(headerSnippet)) {
			if (/<!doctype\s+html|<html[\s>]/i.test(headerSnippet)) {
				return 'html';
			}
			return 'xml';
		}

		// 3. HTML doctype or root tag
		if (/<!doctype\s+html|<html[\s>]/i.test(headerSnippet)) {
			return 'html';
		}

		// 4. XML root elements without prolog (e.g. <package, <ncx, <svg, <feed, <urlset)
		if (
			/^<[a-zA-Z0-9_\-]+(\s+xmlns|\s+version|\s+xsi:)/i.test(trimmed) ||
			/^<(package|ncx|feed|urlset|svg|rss|plist)\b/i.test(trimmed)
		) {
			return 'xml';
		}

		// 5. PHP opening tags (<?php, <?=, or <? without xml)
		if (
			/<\?(php|=)/i.test(headerSnippet) ||
			(trimmed.startsWith('<?') && !trimmed.startsWith('<?xml'))
		) {
			return 'php';
		}

		// 6. JSON
		if (
			(trimmed.startsWith('{') && trimmed.endsWith('}')) ||
			(trimmed.startsWith('[') && trimmed.endsWith(']'))
		) {
			try {
				JSON.parse(trimmed);
				return 'json';
			} catch {}
		}

		// 6. OmniFlux keywords
		if (/^(ROUTE|CONFIG|VIEW|MODEL|EVENT|STORAGE|TASK|PIPE|FN)\s+/m.test(trimmed)) {
			return 'omniflux';
		}

		// 7. SQL commands
		if (
			/^\s*(CREATE\s+TABLE|INSERT\s+INTO|SELECT\s+.*?\s+FROM|UPDATE\s+.*?\s+SET|ALTER\s+TABLE|DROP\s+TABLE)\b/i.test(
				trimmed,
			)
		) {
			return 'sql';
		}

		// 8. C / C++ includes
		if (/^#include\s+[<"]/m.test(trimmed)) {
			return 'cpp';
		}

		// 9. Rust declarations
		if (/^(pub\s+)?(fn|struct|enum|impl|trait)\s+[a-zA-Z_]/m.test(trimmed)) {
			return 'rust';
		}
	}

	return 'plaintext';
}

export function isImageFile(filename: string): boolean {
	if (!filename) return false;
	const lower = filename.toLowerCase();
	return (
		lower.endsWith('.png') ||
		lower.endsWith('.jpg') ||
		lower.endsWith('.jpeg') ||
		lower.endsWith('.gif') ||
		lower.endsWith('.webp') ||
		lower.endsWith('.svg') ||
		lower.endsWith('.ico') ||
		lower.endsWith('.bmp') ||
		lower.endsWith('.avif')
	);
}

export function isBinaryFile(filename?: string): boolean {
	if (!filename) return false;
	const lower = filename.toLowerCase();
	const binaryExts = [
		'.bin',
		'.exe',
		'.so',
		'.dll',
		'.dylib',
		'.o',
		'.a',
		'.pdf',
		'.zip',
		'.tar',
		'.gz',
		'.tgz',
		'.bz2',
		'.xz',
		'.7z',
		'.iso',
		'.deb',
		'.wasm',
		'.db',
		'.sqlite',
		'.sqlite3',
		'.pyc',
		'.class',
		'.jar',
		'.apk',
		'.dmg',
		'.pkg',
		'.rpm',
		'.msi',
		'.epub',
		'.mobi',
		'.azw3',
	];
	return binaryExts.some((ext) => lower.endsWith(ext));
}

export function getImageMimeType(filename: string): string {
	const lower = filename.toLowerCase();
	if (lower.endsWith('.png')) return 'image/png';
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
	if (lower.endsWith('.gif')) return 'image/gif';
	if (lower.endsWith('.webp')) return 'image/webp';
	if (lower.endsWith('.svg')) return 'image/svg+xml';
	if (lower.endsWith('.ico')) return 'image/x-icon';
	if (lower.endsWith('.bmp')) return 'image/bmp';
	if (lower.endsWith('.avif')) return 'image/avif';
	return 'application/octet-stream';
}

export function isOmniFluxFile(filename?: string, lang?: string): boolean {
	if (lang === 'omniflux') return true;
	if (!filename) return false;
	return filename.toLowerCase().endsWith('.of');
}

export function isPhpFile(filename?: string, lang?: string): boolean {
	if (lang === 'php') return true;
	if (!filename) return false;
	let lower = filename.toLowerCase();
	for (const bExt of ['.bak', '.old', '.orig', '.backup', '.tmp']) {
		if (lower.endsWith(bExt)) {
			lower = lower.slice(0, -bExt.length);
			break;
		}
	}
	return (
		lower.endsWith('.php') ||
		lower.endsWith('.phtml') ||
		lower.endsWith('.php8') ||
		lower.endsWith('.inc')
	);
}

export function isPerlFile(filename?: string, lang?: string): boolean {
	if (lang === 'perl') return true;
	if (!filename) return false;
	const lower = filename.toLowerCase();
	return lower.endsWith('.pl') || lower.endsWith('.pm') || lower.endsWith('.t');
}

export function isMarkdownFile(filename?: string, lang?: string): boolean {
	if (lang === 'markdown') return true;
	if (!filename) return false;
	const lower = filename.toLowerCase();
	return (
		lower.endsWith('.md') ||
		lower.endsWith('.markdown') ||
		lower.endsWith('.mdown') ||
		lower.endsWith('.mkd')
	);
}

export function isHtmlFile(filename?: string, lang?: string): boolean {
	if (lang === 'html') return true;
	if (!filename) return false;
	const lower = filename.toLowerCase();
	return (
		lower.endsWith('.html') ||
		lower.endsWith('.htm') ||
		lower.endsWith('.xhtml') ||
		lower.endsWith('.xht')
	);
}

export function isXmlFile(filename?: string, lang?: string): boolean {
	if (lang === 'xml') return true;
	if (!filename) return false;
	const lower = filename.toLowerCase();
	return (
		lower.endsWith('.xml') ||
		lower.endsWith('.opf') ||
		lower.endsWith('.ncx') ||
		lower.endsWith('.xsd') ||
		lower.endsWith('.xsl') ||
		lower.endsWith('.xslt') ||
		lower.endsWith('.plist') ||
		lower.endsWith('.xaml') ||
		lower.endsWith('.dtd') ||
		lower.endsWith('.rss') ||
		lower.endsWith('.atom') ||
		lower.endsWith('.kml') ||
		lower.endsWith('.gpx') ||
		lower.endsWith('.wsdl') ||
		lower.endsWith('.xlf') ||
		lower.endsWith('.xliff')
	);
}

export function isPreviewableFile(filename?: string, lang?: string): boolean {
	return isMarkdownFile(filename, lang) || isHtmlFile(filename, lang);
}

export interface CliFileToOpen {
	name: string;
	rel_path: string;
	fs_path: string;
}

export interface CliLaunchPayload {
	workspace_path: string | null;
	files: CliFileToOpen[];
	target_file?: string | null;
	highlight_start?: number | null;
	highlight_end?: number | null;
}

export interface GitCommit {
	hash: string;
	shortHash: string;
	author: string;
	date: string;
	message: string;
	tags?: string[];
}

export interface GitCommitFileChange {
	path: string;
	insertions: number;
	deletions: number;
	status: string;
}

export interface GitCommitDetails {
	hash: string;
	short_hash: string;
	author_name: string;
	author_email: string;
	author_date: string;
	author_date_relative: string;
	committer_name: string;
	committer_email: string;
	committer_date: string;
	subject: string;
	body: string;
	parents: string[];
	refs: string[];
	stat_summary: string;
	files: GitCommitFileChange[];
	patch: string;
}

export interface GitSyncStatus {
	has_remote: boolean;
	remote_name?: string | null;
	upstream?: string | null;
	ahead: number;
	behind: number;
}

export interface GitBranchItem {
	name: string;
	is_current: boolean;
	is_remote: boolean;
}
