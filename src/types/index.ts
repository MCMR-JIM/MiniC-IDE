export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
}

export interface TabFile {
  path: string;
  name: string;
  content: string;
  modified: boolean;
  language: string;
}

export interface CompileResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
}

export interface ContextMenuItem {
  label?: string;
  action?: string;
  shortcut?: string;
  separator?: boolean;
  disabled?: boolean;
}

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  context?: Record<string, unknown>;
}
