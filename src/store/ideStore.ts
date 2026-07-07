import { create } from 'zustand';
import { TabFile, FileEntry, CompileResult, ContextMenuState, FileIdentity } from '../types';

interface IDEState {
  // Tabs
  tabs: TabFile[];
  activeTabPath: string | null;
  // File tree
  projectRoot: string | null;
  fileTree: FileEntry[];
  expandedDirs: Set<string>;
  // Output
  outputLines: string[];
  compileResult: CompileResult | null;
  isCompiling: boolean;
  isRunning: boolean;
  runningFilePath: string | null;
  // Layout
  sidebarWidth: number;
  outputHeight: number;
  sidebarVisible: boolean;
  outputVisible: boolean;
  // Context menu
  contextMenu: ContextMenuState;
  // Cursor position
  cursorPosition: { line: number; col: number };
  setCursorPosition: (pos: { line: number; col: number }) => void;
  // Default encoding for new files (from system/terminal code page)
  defaultEncoding: string;
  setDefaultEncoding: (enc: string) => void;
  setTabEncoding: (path: string, encoding: string) => void;
  // Output panel
  setOutputVisible: (v: boolean) => void;
  // Find/Replace
  findVisible: boolean;
  findQuery: string;
  replaceQuery: string;
  findMatchCase: boolean;
  findRegex: boolean;
  // Actions
  openTab: (file: TabFile) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  updateTabContent: (path: string, content: string) => void;
  markTabSaved: (path: string) => void;
  remapPathReferences: (oldPath: string, newPath: string, isDir: boolean) => void;
  setTabFileIdentity: (path: string, fileIdentity: FileIdentity | null) => void;
  setProjectRoot: (root: string | null) => void;
  setFileTree: (tree: FileEntry[]) => void;
  toggleDir: (path: string) => void;
  appendOutput: (line: string) => void;
  clearOutput: () => void;
  setCompileResult: (result: CompileResult | null) => void;
  setIsCompiling: (v: boolean) => void;
  setIsRunning: (v: boolean) => void;
  setRunningFilePath: (path: string | null) => void;
  setSidebarWidth: (w: number) => void;
  setOutputHeight: (h: number) => void;
  toggleSidebar: () => void;
  toggleOutput: () => void;
  showContextMenu: (menu: ContextMenuState) => void;
  hideContextMenu: () => void;
  setFindVisible: (v: boolean) => void;
  setFindQuery: (q: string) => void;
  setReplaceQuery: (q: string) => void;
  setFindMatchCase: (v: boolean) => void;
  setFindRegex: (v: boolean) => void;
}

const normalizePathForCompare = (path: string): string =>
  path.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();

const remapPath = (path: string | null, oldPath: string, newPath: string, isDir: boolean): string | null => {
  if (!path) return path;
  if (!isDir) return path === oldPath ? newPath : path;

  const normalizedPath = normalizePathForCompare(path);
  const normalizedOldPath = normalizePathForCompare(oldPath);
  if (normalizedPath !== normalizedOldPath && !normalizedPath.startsWith(`${normalizedOldPath}/`)) {
    return path;
  }

  return `${newPath}${path.slice(oldPath.length)}`;
};

const getBaseName = (path: string): string => {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
};

export const useIDEStore = create<IDEState>((set) => ({
  tabs: [],
  activeTabPath: null,
  projectRoot: null,
  fileTree: [],
  expandedDirs: new Set(),
  outputLines: [],
  compileResult: null,
  isCompiling: false,
  isRunning: false,
  runningFilePath: null,
  sidebarWidth: 240,
  outputHeight: 200,
  sidebarVisible: true,
  outputVisible: true,
  contextMenu: { visible: false, x: 0, y: 0, items: [] },
  cursorPosition: { line: 1, col: 1 },
  setCursorPosition: (pos) => set({ cursorPosition: pos }),
  defaultEncoding: 'UTF-8',
  setDefaultEncoding: (enc) => set({ defaultEncoding: enc }),
  setTabEncoding: (path, encoding) => set((state) => ({
    tabs: state.tabs.map((t) =>
      t.path === path ? { ...t, encoding, modified: true } : t,
    ),
  })),
  setOutputVisible: (v) => set({ outputVisible: v }),
  findVisible: false,
  findQuery: '',
  replaceQuery: '',
  findMatchCase: false,
  findRegex: false,

  openTab: (file) => set((state) => {
    const exists = state.tabs.find(t => t.path === file.path);
    if (exists) return { activeTabPath: file.path };
    return { tabs: [...state.tabs, file], activeTabPath: file.path };
  }),

  closeTab: (path) => set((state) => {
    const newTabs = state.tabs.filter(t => t.path !== path);
    let newActive = state.activeTabPath;
    if (state.activeTabPath === path) {
      const idx = state.tabs.findIndex(t => t.path === path);
      newActive = newTabs[Math.min(idx, newTabs.length - 1)]?.path ?? null;
    }
    return { tabs: newTabs, activeTabPath: newActive };
  }),

  setActiveTab: (path) => set({ activeTabPath: path }),

  updateTabContent: (path, content) => set((state) => ({
    tabs: state.tabs.map(t =>
      t.path === path ? { ...t, content, modified: true } : t
    )
  })),

  markTabSaved: (path) => set((state) => ({
    tabs: state.tabs.map(t =>
      t.path === path ? { ...t, modified: false } : t
    )
  })),

  remapPathReferences: (oldPath, newPath, isDir) => set((state) => {
    const tabs = state.tabs.map((tab) => {
      const nextPath = remapPath(tab.path, oldPath, newPath, isDir);
      if (nextPath === tab.path) return tab;
      return {
        ...tab,
        path: nextPath ?? tab.path,
        name: getBaseName(nextPath ?? tab.path),
      };
    });

    const expandedDirs = new Set<string>();
    state.expandedDirs.forEach((path) => {
      expandedDirs.add(remapPath(path, oldPath, newPath, isDir) ?? path);
    });

    return {
      tabs,
      activeTabPath: remapPath(state.activeTabPath, oldPath, newPath, isDir),
      runningFilePath: remapPath(state.runningFilePath, oldPath, newPath, isDir),
      projectRoot: remapPath(state.projectRoot, oldPath, newPath, isDir),
      expandedDirs,
    };
  }),

  setTabFileIdentity: (path, fileIdentity) => set((state) => ({
    tabs: state.tabs.map((t) =>
      t.path === path ? { ...t, fileIdentity } : t,
    ),
  })),

  setProjectRoot: (root) => set({ projectRoot: root }),
  setFileTree: (tree) => set({ fileTree: tree }),

  toggleDir: (path) => set((state) => {
    const next = new Set(state.expandedDirs);
    if (next.has(path)) next.delete(path); else next.add(path);
    return { expandedDirs: next };
  }),

  appendOutput: (line) => set((state) => ({ outputLines: [...state.outputLines, line] })),
  clearOutput: () => set({ outputLines: [] }),
  setCompileResult: (result) => set({ compileResult: result }),
  setIsCompiling: (v) => set({ isCompiling: v }),
  setIsRunning: (v) => set({ isRunning: v }),
  setRunningFilePath: (path) => set({ runningFilePath: path }),
  setSidebarWidth: (w) => set({ sidebarWidth: w }),
  setOutputHeight: (h) => set({ outputHeight: h }),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleOutput: () => set((s) => ({ outputVisible: !s.outputVisible })),
  showContextMenu: (menu) => set({ contextMenu: menu }),
  hideContextMenu: () => set({ contextMenu: { visible: false, x: 0, y: 0, items: [] } }),
  setFindVisible: (v) => set({ findVisible: v }),
  setFindQuery: (q) => set({ findQuery: q }),
  setReplaceQuery: (q) => set({ replaceQuery: q }),
  setFindMatchCase: (v) => set({ findMatchCase: v }),
  setFindRegex: (v) => set({ findRegex: v }),
}));
