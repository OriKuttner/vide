export interface WorkspaceFile {
  id: string;
  name: string;
  path: string;
  language: string;
  content: string;
  originalContent?: string;
  gitStatus?: 'modified' | 'added' | 'deleted' | 'untracked';
  isLoaded?: boolean;
  isModified?: boolean;
  handle?: any; // FileSystemFileHandle when opened from local disk
  rawFile?: File; // Raw file fallback
  fsPath?: string; // Absolute filesystem path in Tauri desktop mode
  isImage?: boolean; // True if file is an image (PNG, JPG, SVG, etc.)
  imageUrl?: string; // Blob URL or base64 data URL for preview
  fileSize?: number; // Size in bytes
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

  if (lower.endsWith('.of')) return 'omniflux';
  if (lower.endsWith('.php') || lower.endsWith('.phtml')) return 'php';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
  if (lower.endsWith('.pl') || lower.endsWith('.pm')) return 'perl';
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
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'shell';
  if (lower.endsWith('.py') || lower.endsWith('.pyw')) return 'python';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.xml')) return 'xml';
  if (lower.endsWith('.rs')) return 'rust';
  if (isImageFile(filename)) return 'image';

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
