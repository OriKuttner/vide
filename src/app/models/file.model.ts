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
  handle?: any; // FileSystemFileHandle when opened from local disk
  rawFile?: File; // Raw file fallback
  fsPath?: string; // Absolute filesystem path in Tauri desktop mode
  isImage?: boolean; // True if file is an image (PNG, JPG, SVG, etc.)
  imageUrl?: string; // Blob URL or base64 data URL for preview
  fileSize?: number; // Size in bytes
  indentType?: 'tabs' | 'spaces';
  tabSize?: number;
  isIndentationCustom?: boolean;
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
  const lower = filename.toLowerCase();

  // Special extensionless files or exact names
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'dockerfile';
  if (lower === 'makefile' || lower === 'gnumakefile') return 'makefile';
  if (lower === '.gitignore' || lower === '.gitattributes' || lower === '.gitmodules') return 'properties';
  if (lower === '.env' || lower.startsWith('.env.')) return 'ini';

  if (lower.endsWith('.of')) return 'omniflux';
  if (lower.endsWith('.php') || lower.endsWith('.phtml') || lower.endsWith('.php8')) return 'php';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
  if (lower.endsWith('.pl') || lower.endsWith('.pm') || lower.endsWith('.t')) return 'perl';
  if (lower.endsWith('.c') || lower.endsWith('.h')) return 'c';
  if (
    lower.endsWith('.cpp') ||
    lower.endsWith('.cc') ||
    lower.endsWith('.cxx') ||
    lower.endsWith('.hpp')
  )
    return 'cpp';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.less')) return 'css';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.sql')) return 'sql';
  if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) return 'shell';
  if (lower.endsWith('.py') || lower.endsWith('.pyw')) return 'python';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.xml')) return 'xml';
  if (lower.endsWith('.rs')) return 'rust';
  if (isImageFile(filename)) return 'image';

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
      if (firstLine.includes('bash') || firstLine.includes('/sh') || firstLine.includes('zsh')) return 'shell';
      if (firstLine.includes('node') || firstLine.includes('deno') || firstLine.includes('bun')) return 'javascript';
      if (firstLine.includes('perl')) return 'perl';
      if (firstLine.includes('python')) return 'python';
    }

    const headerSnippet = trimmed.slice(0, 2048);

    // 2. PHP opening tags or content
    if (/<\?(php|=)/i.test(headerSnippet) || trimmed.startsWith('<?')) {
      return 'php';
    }

    // 3. HTML doctype or root tag
    if (/<!doctype\s+html|<html[\s>]/i.test(headerSnippet)) {
      return 'html';
    }

    // 4. XML prolog
    if (/<\?xml/i.test(headerSnippet)) {
      return 'xml';
    }

    // 5. JSON
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
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
    if (/^\s*(CREATE\s+TABLE|INSERT\s+INTO|SELECT\s+.*?\s+FROM|UPDATE\s+.*?\s+SET|ALTER\s+TABLE|DROP\s+TABLE)\b/i.test(trimmed)) {
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
  const lower = filename.toLowerCase();
  return lower.endsWith('.php') || lower.endsWith('.phtml') || lower.endsWith('.php8');
}

export function isPerlFile(filename?: string, lang?: string): boolean {
  if (lang === 'perl') return true;
  if (!filename) return false;
  const lower = filename.toLowerCase();
  return lower.endsWith('.pl') || lower.endsWith('.pm') || lower.endsWith('.t');
}


export interface CliFileToOpen {
  name: string;
  rel_path: string;
  fs_path: string;
}

export interface CliLaunchPayload {
  workspace_path: string | null;
  files: CliFileToOpen[];
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitSyncStatus {
  has_remote: boolean;
  remote_name?: string | null;
  upstream?: string | null;
  ahead: number;
  behind: number;
}
