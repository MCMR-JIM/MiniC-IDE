import React, { useEffect, useCallback, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { message } from '@tauri-apps/plugin-dialog';
import { check } from '@tauri-apps/plugin-updater';
import { useIDEStore } from './store/ideStore';
import MenuBar from './components/MenuBar';
import FileTree from './components/FileTree';
import TabBar from './components/TabBar';
import EditorPane from './components/EditorPane';
import OutputPanel from './components/OutputPanel';
import StatusBar from './components/StatusBar';
import ContextMenu from './components/ContextMenu';
import { CompileResult } from './types';
import { isTauriRuntime } from './tauriEnv';
import { getEditorLanguageFromFileName, isCompilableSourceFileName, isHeaderFileName } from './utils/language';
import './App.css';

type DroppedPathInfo = {
  path: string;
  is_dir: boolean;
};

type ExitDialogState =
  | null
  | {
      mode: 'running' | 'unsaved';
      runningCount?: number;
      modifiedCount?: number;
      actionLabel?: string;
    };

type SwitchProjectDialogState =
  | null
  | {
      newProjectPath: string;
      modifiedCount?: number;
    };

type UpdatePromptState =
  | null
  | {
      version: string;
      currentVersion: string;
      date?: string;
      body?: string;
      downloading: boolean;
      progress: number | null;
      progressText: string;
    };

type DragTarget = 'sidebar' | 'editor' | 'body';
type DragPosition = { x: number; y: number };

const formatActionLabel = (label: string, withPrefix = false): string => {
  if (!withPrefix) return label;
  return /^[\x00-\x7F]+$/.test(label) ? `to ${label}` : `并${label}`;
};

const normalizePathForCompare = (path: string): string =>
  path.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();

const isPathInsideRoot = (path: string, root: string): boolean => {
  const normalizedPath = normalizePathForCompare(path);
  const normalizedRoot = normalizePathForCompare(root);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
};

const App: React.FC = () => {
  const {
    tabs, activeTabPath, closeTab, openTab,
    projectRoot, setProjectRoot, setFileTree,
    appendOutput, clearOutput, setCompileResult, setIsCompiling,
    sidebarWidth, setSidebarWidth, outputHeight, setOutputHeight,
    sidebarVisible, toggleSidebar, outputVisible, toggleOutput, setOutputVisible,
    markTabSaved, setFindVisible, setIsRunning, setRunningFilePath,
  } = useIDEStore();

  const sidebarDragging = useRef(false);
  const outputDragging = useRef(false);
  const closeFlowActiveRef = useRef(false);
  const allowWindowCloseRef = useRef(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const editorPaneRef = useRef<HTMLDivElement | null>(null);
  const exitDialogResolverRef = useRef<((choice: string) => void) | null>(null);
  const switchProjectResolverRef = useRef<((choice: string) => void) | null>(null);
  const dragSessionRef = useRef(0);
  const updateCheckInFlightRef = useRef(false);
  const pendingUpdateRef = useRef<Awaited<ReturnType<typeof check>> | null>(null);
  const [exitDialog, setExitDialog] = useState<ExitDialogState>(null);
  const [switchProjectDialog, setSwitchProjectDialog] = useState<SwitchProjectDialogState>(null);
  const [updatePrompt, setUpdatePrompt] = useState<UpdatePromptState>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const [dragContent, setDragContent] = useState<'file' | 'folder' | 'mixed' | null>(null);
  const dragContentRef = useRef<'file' | 'folder' | 'mixed' | null>(null);

  useEffect(() => {
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }, []);

  const askExitDialog = useCallback((state: Exclude<ExitDialogState, null>) => {
    return new Promise<string>((resolve) => {
      exitDialogResolverRef.current = resolve;
      setExitDialog(state);
    });
  }, []);

  const resolveExitDialog = useCallback((choice: string) => {
    const resolver = exitDialogResolverRef.current;
    exitDialogResolverRef.current = null;
    setExitDialog(null);
    resolver?.(choice);
  }, []);

  const askSwitchProjectDialog = useCallback((newProjectPath: string, modifiedCount: number) => {
    return new Promise<string>((resolve) => {
      switchProjectResolverRef.current = resolve;
      setSwitchProjectDialog({ newProjectPath, modifiedCount });
    });
  }, []);

  const resolveSwitchProjectDialog = useCallback((choice: string) => {
    const resolver = switchProjectResolverRef.current;
    switchProjectResolverRef.current = null;
    setSwitchProjectDialog(null);
    resolver?.(choice);
  }, []);

  const prepareForAppAction = useCallback(async (actionLabel: string) => {
    const state = useIDEStore.getState();
    const modified = state.tabs.filter((t) => t.modified);
    const running = state.isRunning
      ? await invoke<number>('running_child_count').catch(() => 0)
      : 0;

    if (running > 0) {
      const runChoice = await askExitDialog({ mode: 'running', runningCount: running, actionLabel });
      if (runChoice !== 'close_running') return false;
      await invoke('kill_child_processes').catch(() => {});
    }

    if (modified.length > 0) {
      const saveChoice = await askExitDialog({ mode: 'unsaved', modifiedCount: modified.length, actionLabel });
      if (saveChoice === 'cancel_exit') return false;
      if (saveChoice === 'save_all_exit') {
        const { markTabSaved } = useIDEStore.getState();
        for (const t of modified) {
          try {
            await invoke('write_file_content', { path: t.path, content: t.content });
            markTabSaved(t.path);
          } catch (e) {
            await message(`保存失败：${String(e)}`, { title: 'MiniC IDE', kind: 'error', buttons: 'Ok' });
            return false;
          }
        }
      }
    }

    appendOutput(`[Updater] 已完成${actionLabel}前检查。`);
    return true;
  }, [appendOutput, askExitDialog]);

  useEffect(() => {
    const onRunningChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const running = Boolean(detail.running);
      const sourcePath = typeof detail.sourcePath === 'string' ? detail.sourcePath : null;
      const exePath = typeof detail.exePath === 'string' ? detail.exePath : null;
      setIsRunning(running);
      setRunningFilePath(running ? (sourcePath || exePath) : null);
    };
    document.addEventListener('terminal-running-changed', onRunningChanged);
    return () => document.removeEventListener('terminal-running-changed', onRunningChanged);
  }, [setIsRunning, setRunningFilePath]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    let alive = true;
    (async () => {
      const win = getCurrentWindow();
      const u = await win.onCloseRequested(async (event) => {
        if (allowWindowCloseRef.current) return;
        const initial = useIDEStore.getState();
        const modified = initial.tabs.filter((t) => t.modified);
        const maybeRunning = initial.isRunning;
        const needsPotentialIntercept = maybeRunning || modified.length > 0;
        event.preventDefault();
        if (closeFlowActiveRef.current) return;
        closeFlowActiveRef.current = true;
        try {
          const { markTabSaved } = useIDEStore.getState();
          const running = maybeRunning
            ? await invoke<number>('running_child_count').catch(() => 0)
            : 0;

          const requestExit = async () => {
            allowWindowCloseRef.current = true;
            try {
              await invoke('request_app_exit');
            } catch {
              // Ignore and fallback to force-destroy below.
            }
            setTimeout(() => {
              void win.destroy().catch(async () => {
                allowWindowCloseRef.current = false;
                await message('关闭 IDE 失败，请重试。', { title: 'MiniC IDE', kind: 'error', buttons: 'Ok' });
              });
            }, 120);
          };

          if (!needsPotentialIntercept) {
            await requestExit();
            return;
          }

          // isRunning store may be stale; if both are effectively clean, close directly.
          if (running <= 0 && modified.length === 0) {
            await requestExit();
            return;
          }

          if (running > 0) {
            const runChoice = await askExitDialog({ mode: 'running', runningCount: running, actionLabel: '退出' });
            if (runChoice !== 'close_running') return;
            await invoke('kill_child_processes').catch(() => {});
          }

          if (modified.length > 0) {
            const saveChoice = await askExitDialog({ mode: 'unsaved', modifiedCount: modified.length, actionLabel: '退出' });
            if (saveChoice === 'cancel_exit') return;
            if (saveChoice === 'save_all_exit') {
              for (const t of modified) {
                try {
                  await invoke('write_file_content', { path: t.path, content: t.content });
                  markTabSaved(t.path);
                } catch (e) {
                  await message(`保存失败：${String(e)}`, { title: 'MiniC IDE', kind: 'error', buttons: 'Ok' });
                  return;
                }
              }
            }
          }

          await requestExit();
          return;
        } finally {
          closeFlowActiveRef.current = false;
        }
      });
      if (alive) unlisten = u;
      else u();
    })();
    return () => {
      alive = false;
      unlisten?.();
      exitDialogResolverRef.current = null;
    };
  }, [askExitDialog]);

  const refreshFileTree = useCallback(async (root: string) => {
    try {
      const tree = await invoke<ReturnType<typeof Array>>('read_dir_recursive', { dirPath: root });
      setFileTree(tree as never);
    } catch (e) {
      console.error('Tree refresh failed:', e);
    }
  }, [setFileTree]);

  const fixEditorLayoutAfter = useCallback(() => {
    requestAnimationFrame(() => {
      document.dispatchEvent(new CustomEvent('minic-fix-editor-layout'));
      setTimeout(() => document.dispatchEvent(new CustomEvent('minic-fix-editor-layout')), 0);
    });
  }, []);

  const openFolderPath = useCallback(async (root: string) => {
    setProjectRoot(root);
    await refreshFileTree(root);
  }, [refreshFileTree, setProjectRoot]);

  const openFilePath = useCallback(async (selected: string) => {
    try {
      const name = selected.split(/[\\/]/).pop() ?? selected;
      const content = await invoke<string>('read_file_content', { path: selected });
      const lang = getEditorLanguageFromFileName(name);
      if (projectRoot && !isPathInsideRoot(selected, projectRoot)) {
        setProjectRoot(null);
        setFileTree([]);
      }
      openTab({ path: selected, name, content, modified: false, language: lang });
      return true;
    } catch (e) {
      await message(`打开文件失败：${String(e)}`, { title: 'MiniC IDE', kind: 'error', buttons: 'Ok' });
      return false;
    }
  }, [openTab, projectRoot, setFileTree, setProjectRoot]);

  const handleCompile = useCallback(async (): Promise<CompileResult | null> => {
    const path = activeTabPath;
    setCompileResult(null);
    if (!path) {
      appendOutput('No file open to compile.');
      return null;
    }
    const tab = useIDEStore.getState().tabs.find(t => t.path === path);
    if (!tab) return null;
    setOutputVisible(true);
    document.dispatchEvent(new CustomEvent('switch-output-tab', { detail: { tab: 'output' } }));
    clearOutput();
    setIsCompiling(true);
    appendOutput(`[Compiling] ${path}`);
    try {
      if (!isCompilableSourceFileName(tab.name)) {
        const errorText = isHeaderFileName(tab.name)
          ? '当前文件是头文件，不能单独编译。请打开对应的 .c / .cc / .cpp / .cxx 源文件再编译。'
          : '当前文件类型不支持编译，仅支持 .c / .cc / .cpp / .cxx 源文件。';
        const result: CompileResult = {
          success: false,
          stdout: '',
          stderr: errorText,
          exit_code: -1,
        };
        setCompileResult(result);
        appendOutput(`Error: ${errorText}`);
        return result;
      }
      if (tab.modified) {
        await invoke('write_file_content', { path, content: tab.content });
        markTabSaved(path);
      }
      const result = await invoke<CompileResult>('compile_file', { filePath: path, outputPath: null });
      setCompileResult(result);
      if (result.stdout) result.stdout.split('\n').filter(Boolean).forEach(l => appendOutput(l));
      if (result.stderr) result.stderr.split('\n').filter(Boolean).forEach(l => appendOutput(l));
      appendOutput(result.success ? `>> Compiled successfully.` : `>> Compilation failed (exit ${result.exit_code}).`);
      return result;
    } catch (e) {
      const errorText = String(e);
      const result: CompileResult = {
        success: false,
        stdout: '',
        stderr: errorText,
        exit_code: -1,
      };
      setCompileResult(result);
      appendOutput(`Error: ${errorText}`);
      return result;
    } finally {
      setIsCompiling(false);
      fixEditorLayoutAfter();
    }
  }, [activeTabPath, appendOutput, clearOutput, setCompileResult, setIsCompiling, markTabSaved, fixEditorLayoutAfter, setOutputVisible]);

  const handleRun = useCallback(async () => {
    const compileResult = await handleCompile();
    if (!compileResult?.success) return;
    const path = activeTabPath;
    if (!path) return;
    const exePath = path.replace(/\.[^\\/]+$/, '.exe');
    const cwd = path.includes('\\') ? path.replace(/\\[^\\]+$/, '') : path.replace(/\/[^\/]+$/, '');
    setOutputVisible(true);
    document.dispatchEvent(new CustomEvent('switch-output-tab', { detail: { tab: 'terminal' } }));
    fixEditorLayoutAfter();
    setTimeout(() => {
      document.dispatchEvent(new CustomEvent('terminal-run', { detail: { type: 'exe', exePath, cwd, sourcePath: path } }));
      fixEditorLayoutAfter();
    }, 100);
    setTimeout(fixEditorLayoutAfter, 300);
  }, [handleCompile, activeTabPath, fixEditorLayoutAfter, setOutputVisible]);

  const handleStop = useCallback(() => {
    setOutputVisible(true);
    document.dispatchEvent(new CustomEvent('switch-output-tab', { detail: { tab: 'terminal' } }));
    document.dispatchEvent(new CustomEvent('terminal-stop'));
    fixEditorLayoutAfter();
  }, [fixEditorLayoutAfter, setOutputVisible]);

  const handleSave = useCallback(async () => {
    const path = activeTabPath;
    const tab = useIDEStore.getState().tabs.find(t => t.path === path);
    if (!path || !tab) return;
    try {
      await invoke('write_file_content', { path, content: tab.content });
      markTabSaved(path);
      appendOutput(`Saved: ${path}`);
    } catch (e) {
      appendOutput(`Save error: ${e}`);
    }
  }, [activeTabPath, markTabSaved, appendOutput]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await invoke<string | null>('open_folder_dialog');
      if (selected) {
        await openFolderPath(selected);
      }
    } catch (e) { console.error(e); }
  }, [openFolderPath]);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await invoke<string | null>('open_file_dialog');
      if (selected) {
        await openFilePath(selected);
      }
    } catch (e) { console.error(e); }
  }, [openFilePath]);

  const clearPendingUpdate = useCallback(async () => {
    const pending = pendingUpdateRef.current;
    pendingUpdateRef.current = null;
    setUpdatePrompt(null);
    if (pending) {
      await pending.close().catch(() => {});
    }
  }, []);

  const installPendingUpdate = useCallback(async () => {
    const pending = pendingUpdateRef.current;
    if (!pending) return;

    const ready = await prepareForAppAction('更新');
    if (!ready) return;

    setUpdatePrompt((current) => current ? {
      ...current,
      downloading: true,
      progress: null,
      progressText: '准备下载安装更新...',
    } : current);

    appendOutput(`[Updater] 正在下载并安装 ${pending.version}...`);
    let downloaded = 0;
    let total = 0;
    let nextReport = 0.25;

    try {
      await pending.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
          const progressText = total > 0
            ? `正在下载更新（约 ${(total / 1024 / 1024).toFixed(2)} MB）...`
            : '正在下载更新...';
          setUpdatePrompt((current) => current ? { ...current, downloading: true, progress: 0, progressText } : current);
          appendOutput(total > 0
            ? `[Updater] 开始下载更新，大小约 ${(total / 1024 / 1024).toFixed(2)} MB。`
            : '[Updater] 开始下载更新。');
          return;
        }

        if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          const progress = total > 0 ? Math.min(1, downloaded / total) : null;
          const percent = progress === null ? null : Math.min(100, Math.round(progress * 100));
          setUpdatePrompt((current) => current ? {
            ...current,
            downloading: true,
            progress,
            progressText: percent === null ? '正在下载安装更新...' : `正在下载安装更新... ${percent}%`,
          } : current);
          if (progress !== null && progress >= nextReport) {
            appendOutput(`[Updater] 下载进度 ${percent}%`);
            nextReport += 0.25;
          }
          return;
        }

        setUpdatePrompt((current) => current ? {
          ...current,
          downloading: true,
          progress: 1,
          progressText: '下载完成，正在安装更新...',
        } : current);
        appendOutput('[Updater] 下载完成，正在安装更新...');
      });

      appendOutput('[Updater] 更新已安装。若应用未自动退出，请手动重启。');
      setUpdatePrompt((current) => current ? {
        ...current,
        downloading: false,
        progress: 1,
        progressText: '更新已安装。若应用未自动退出，请手动重启。',
      } : current);
      pendingUpdateRef.current = null;
      await pending.close().catch(() => {});
    } catch (e) {
      const errorText = `更新失败：${String(e)}`;
      appendOutput(`[Updater] ${errorText}`);
      setUpdatePrompt((current) => current ? {
        ...current,
        downloading: false,
        progress: null,
        progressText: errorText,
      } : current);
      await message(errorText, { title: 'MiniC IDE', kind: 'error', buttons: 'Ok' });
    }
  }, [appendOutput, prepareForAppAction]);

  const checkForUpdates = useCallback(async (manual: boolean) => {
    if (!isTauriRuntime()) return;
    if (import.meta.env.DEV) {
      if (manual) {
        await message('开发模式下不检查更新。', { title: 'MiniC IDE', kind: 'info', buttons: 'Ok' });
      }
      return;
    }
    if (updateCheckInFlightRef.current) {
      if (manual) {
        await message('正在检查更新，请稍候。', { title: 'MiniC IDE', kind: 'info', buttons: 'Ok' });
      }
      return;
    }

    updateCheckInFlightRef.current = true;
    try {
      if (manual) appendOutput('[Updater] 正在检查更新...');
      const update = await check();
      if (!update) {
        if (manual) {
          appendOutput('[Updater] 当前已是最新版本。');
          await message('当前已是最新版本。', { title: 'MiniC IDE', kind: 'info', buttons: 'Ok' });
        }
        return;
      }

      if (pendingUpdateRef.current) {
        await pendingUpdateRef.current.close().catch(() => {});
      }
      pendingUpdateRef.current = update;
      appendOutput(`[Updater] 发现新版本 ${update.version}。`);
      setUpdatePrompt({
        version: update.version,
        currentVersion: update.currentVersion,
        date: update.date,
        body: update.body,
        downloading: false,
        progress: null,
        progressText: manual ? '已发现更新，可立即安装。' : '后台已检测到新版本。',
      });
    } catch (e) {
      const errorText = `检查更新失败：${String(e)}`;
      appendOutput(`[Updater] ${errorText}`);
      if (manual) {
        await message(errorText, { title: 'MiniC IDE', kind: 'error', buttons: 'Ok' });
      }
    } finally {
      updateCheckInFlightRef.current = false;
    }
  }, [appendOutput]);

  const triggerFileTreeInline = useCallback((
    mode: 'newFile' | 'newFolder' | 'rename',
    context?: Record<string, unknown>,
  ) => {
    document.dispatchEvent(new CustomEvent('file-tree-inline-action', { detail: { mode, context } }));
  }, []);

  useEffect(() => {
    const handler = async (e: Event) => {
      const action = (e as CustomEvent).detail?.action as string;
      if (!action) return;
      if (action === 'file.new') {
        triggerFileTreeInline('newFile', { path: projectRoot ?? '', is_dir: true, name: '' });
      }
      else if (action === 'file.newFolder') {
        triggerFileTreeInline('newFolder', { path: projectRoot ?? '', is_dir: true, name: '' });
      }
      else if (action === 'file.open') handleOpenFile();
      else if (action === 'file.openFolder') handleOpenFolder();
      else if (action === 'file.save') handleSave();
      else if (action === 'file.saveAs') handleSave();
      else if (action === 'file.closeTab') { if (activeTabPath) closeTab(activeTabPath); }
      else if (action === 'view.toggleSidebar') toggleSidebar();
      else if (action === 'view.toggleOutput') toggleOutput();
      else if (action === 'run.compile') handleCompile();
      else if (action === 'run.run') handleRun();
      else if (action === 'run.stop') handleStop();
      else if (action === 'help.checkUpdate') await checkForUpdates(true);
      else if (action === 'edit.find') setFindVisible(true);
      else if (action === 'edit.replace') setFindVisible(true);
      else if (action === 'find.close') setFindVisible(false);
      else if (action === 'tree.refresh') { if (projectRoot) await refreshFileTree(projectRoot); }
      else if (action === 'tree.newFile') {
        const ctx = (e as CustomEvent).detail?.context;
        triggerFileTreeInline('newFile', ctx as Record<string, unknown> | undefined);
      }
      else if (action === 'tree.newFolder') {
        const ctx = (e as CustomEvent).detail?.context;
        triggerFileTreeInline('newFolder', ctx as Record<string, unknown> | undefined);
      }
      else if (action === 'tree.open') {
        const ctx = (e as CustomEvent).detail?.context;
        const selected = typeof ctx?.path === 'string' ? ctx.path : '';
        const isDir = Boolean(ctx?.is_dir);
        if (selected && !isDir) {
          await openFilePath(selected);
        }
      }
      else if (action === 'tree.delete') {
        const ctx = (e as CustomEvent).detail?.context;
        if (ctx?.path && window.confirm(`Delete ${ctx.path}?`)) {
          await invoke('delete_path', { path: ctx.path });
          if (projectRoot) await refreshFileTree(projectRoot);
        }
      }
      else if (action === 'tree.rename') {
        const ctx = (e as CustomEvent).detail?.context;
        triggerFileTreeInline('rename', ctx as Record<string, unknown> | undefined);
      }
      else if (action === 'tree.copyPath') {
        const ctx = (e as CustomEvent).detail?.context;
        if (ctx?.path) navigator.clipboard.writeText(ctx.path as string);
      }
      else if (action === 'tree.revealInExplorer' || action === 'tab.revealInExplorer') {
        const ctx = (e as CustomEvent).detail?.context;
        const revealPath = typeof ctx?.path === 'string' ? ctx.path : projectRoot;
        if (revealPath) {
          await invoke('reveal_in_file_manager', { path: revealPath });
        }
      }
      else if (action === 'tab.close') { if (activeTabPath) closeTab(activeTabPath); }
      else if (action === 'tab.closeAll') { tabs.forEach(t => closeTab(t.path)); }
      else if (action === 'tab.closeOthers') {
        const ctx = (e as CustomEvent).detail?.context;
        tabs.filter(t => t.path !== ctx?.path).forEach(t => closeTab(t.path));
      }
      else if (action === 'tab.copyPath') {
        const ctx = (e as CustomEvent).detail?.context;
        if (ctx?.path) navigator.clipboard.writeText(ctx.path as string);
      }
    };
    document.addEventListener('menu-action', handler);
    document.addEventListener('context-menu-action', handler);
    return () => {
      document.removeEventListener('menu-action', handler);
      document.removeEventListener('context-menu-action', handler);
    };
  }, [activeTabPath, tabs, projectRoot, handleCompile, handleRun, handleStop, handleSave, handleOpenFile, handleOpenFolder, closeTab, toggleSidebar, toggleOutput, setFindVisible, refreshFileTree, triggerFileTreeInline, openFilePath, checkForUpdates]);

  useEffect(() => {
    if (!isTauriRuntime() || import.meta.env.DEV) return;
    const timer = window.setTimeout(() => {
      void checkForUpdates(false);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [checkForUpdates]);

  useEffect(() => {
    return () => {
      const pending = pendingUpdateRef.current;
      pendingUpdateRef.current = null;
      if (pending) {
        void pending.close().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    let alive = true;

    (async () => {
      const win = getCurrentWindow();
      const scaleFactor = await win.scaleFactor();
      const resolveDropTarget = (position: DragPosition, hasFolder: boolean): DragTarget | null => {
        if (hasFolder) return 'body';

        const logicalPoint = {
          x: position.x / scaleFactor,
          y: position.y / scaleFactor,
        };

        const isInside = (element: HTMLElement | null) => {
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          return logicalPoint.x >= rect.left
            && logicalPoint.x <= rect.right
            && logicalPoint.y >= rect.top
            && logicalPoint.y <= rect.bottom;
        };

        if (isInside(sidebarRef.current)) return 'sidebar';
        if (isInside(editorPaneRef.current)) return 'editor';
        return null;
      };

      const u = await win.onDragDropEvent(async (event) => {
        const payload = event.payload;

        if (payload.type === 'leave') {
          dragSessionRef.current += 1;
          setDragTarget(null);
          setDragContent(null);
          dragContentRef.current = null;
          return;
        }

        if (payload.type === 'enter') {
          const sessionId = ++dragSessionRef.current;
          try {
            const dropped = await invoke<DroppedPathInfo[]>('inspect_paths', { paths: payload.paths });
            if (!alive || dragSessionRef.current !== sessionId) return;
            const hasFolder = dropped.some((item) => item.is_dir);
            const content: 'file' | 'folder' | 'mixed' = hasFolder ? 'folder' : (dropped.length > 1 ? 'mixed' : 'file');
            dragContentRef.current = content;
            setDragContent(content);
            setDragTarget(resolveDropTarget(payload.position, hasFolder));
          } catch (e) {
            if (!alive || dragSessionRef.current !== sessionId) return;
            dragContentRef.current = null;
            setDragContent(null);
            setDragTarget(null);
            await message(`拖拽识别失败：${String(e)}`, { title: 'MiniC IDE', kind: 'error', buttons: 'Ok' });
          }
          return;
        }

        if (payload.type === 'over') {
          setDragTarget(resolveDropTarget(payload.position, dragContentRef.current === 'folder'));
          return;
        }

        if (payload.type !== 'drop') {
          return;
        }

        dragSessionRef.current += 1;
        setDragTarget(null);
        setDragContent(null);
        dragContentRef.current = null;

        try {
          const dropped = await invoke<DroppedPathInfo[]>('inspect_paths', { paths: payload.paths });
          const dirs = dropped.filter((item) => item.is_dir);
          const files = dropped.filter((item) => !item.is_dir);
          const { projectRoot, tabs, markTabSaved } = useIDEStore.getState();
          const dropTarget = resolveDropTarget(payload.position, dirs.length > 0);

          if (dirs.length > 0) {
            const folderPath = dirs[0].path;

            if (projectRoot && normalizePathForCompare(folderPath) === normalizePathForCompare(projectRoot)) {
              return;
            }

            const modified = tabs.filter((t) => t.modified);
            if (modified.length > 0) {
              const choice = await askSwitchProjectDialog(folderPath, modified.length);
              if (choice !== 'switch_and_save' && choice !== 'switch_without_save') {
                return;
              }

              if (choice === 'switch_and_save') {
                for (const t of modified) {
                  try {
                    await invoke('write_file_content', { path: t.path, content: t.content });
                    markTabSaved(t.path);
                  } catch (e) {
                    await message(`保存失败：${String(e)}`, { title: 'MiniC IDE', kind: 'error', buttons: 'Ok' });
                    return;
                  }
                }
              }
            }

            await openFolderPath(folderPath);
            for (const file of files) {
              await openFilePath(file.path);
            }
            return;
          }

          if (dropTarget === 'sidebar') {
            if (!projectRoot) {
              appendOutput('[DragDrop] 文件树区域拖拽需要先打开项目文件夹');
              return;
            }

            let copiedCount = 0;
            for (const file of files) {
              try {
                const fileName = file.path.split(/[\\/]/).pop() ?? 'file';
                const destPath = `${projectRoot}/${fileName}`;
                await invoke('copy_file', { srcPath: file.path, dstPath: destPath });
                copiedCount++;
                await openFilePath(destPath);
              } catch (e) {
                appendOutput(`[DragDrop] 复制文件失败 ${file.path}: ${String(e)}`);
              }
            }

            if (copiedCount > 0) {
              appendOutput(`[DragDrop] 已复制 ${copiedCount} 个文件到项目目录`);
              await refreshFileTree(projectRoot);
            }
            return;
          }

          if (dropTarget !== 'editor') {
            return;
          }

          for (const file of files) {
            await openFilePath(file.path);
          }
        } catch (e) {
          await message(`拖拽打开失败：${String(e)}`, { title: 'MiniC IDE', kind: 'error', buttons: 'Ok' });
        }
      });
      if (alive) unlisten = u;
      else u();
    })();

    return () => {
      alive = false;
      unlisten?.();
    };
  }, [appendOutput, askSwitchProjectDialog, openFilePath, openFolderPath, refreshFileTree]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'o') { e.preventDefault(); handleOpenFile(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        triggerFileTreeInline('newFile', { path: projectRoot ?? '', is_dir: true, name: '' });
      }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'w') { e.preventDefault(); if (activeTabPath) closeTab(activeTabPath); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); toggleSidebar(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === '`') { e.preventDefault(); toggleOutput(); }
      else if (e.key === 'F5') { e.preventDefault(); handleRun(); }
      else if (e.key === 'F6') { e.preventDefault(); handleCompile(); }
      else if (e.key === 'F7') { e.preventDefault(); handleStop(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); setFindVisible(true); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'h') { e.preventDefault(); setFindVisible(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTabPath, handleSave, handleOpenFile, closeTab, toggleSidebar, toggleOutput, handleCompile, handleRun, handleStop, setFindVisible, triggerFileTreeInline, projectRoot]);

  const onSidebarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    sidebarDragging.current = true;
    const onMove = (me: MouseEvent) => { if (sidebarDragging.current) setSidebarWidth(Math.max(150, Math.min(500, me.clientX - 0))); };
    const onUp = () => { sidebarDragging.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onOutputMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    outputDragging.current = true;
    const startY = e.clientY;
    const startH = outputHeight;
    const onMove = (me: MouseEvent) => { if (outputDragging.current) setOutputHeight(Math.max(80, Math.min(600, startH + (startY - me.clientY)))); };
    const onUp = () => { outputDragging.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="ide-root">
      <MenuBar />
      <div ref={bodyRef} className={`ide-body${dragTarget ? ` drag-target-${dragTarget}` : ''}`}>
        {sidebarVisible && (
          <div
            ref={sidebarRef}
            className={`ide-sidebar${dragTarget === 'sidebar' ? ' drag-target-sidebar' : ''}`}
            style={{ width: sidebarWidth }}
          >
            <FileTree />
            {dragTarget === 'sidebar' && (
              <div className="ide-drop-overlay">
                <div className="ide-drop-hint">
                  <div className="ide-drop-hint-title">复制到项目</div>
                  <div className="ide-drop-hint-detail">拖到文件树中会复制文件到当前项目</div>
                </div>
              </div>
            )}
            <div className="sidebar-resizer" onMouseDown={onSidebarMouseDown} />
          </div>
        )}
        <div className="ide-main">
          <div className="ide-main-tabstrip">
            <TabBar />
          </div>
          <div className="ide-editor-area">
            <div ref={editorPaneRef} className={`ide-editor-pane-slot${dragTarget === 'editor' ? ' drag-target-editor' : ''}`}>
              <EditorPane />
              {dragTarget === 'editor' && (
                <div className="ide-drop-overlay">
                  <div className="ide-drop-hint">
                    <div className="ide-drop-hint-title">打开文件</div>
                    <div className="ide-drop-hint-detail">
                      {dragContent === 'mixed' ? '拖到编辑区会分别打开多个文件' : '拖到编辑区将直接打开文件'}
                    </div>
                  </div>
                </div>
              )}
            </div>
            {outputVisible && (
              <>
                <div className="output-resizer" onMouseDown={onOutputMouseDown} />
                <div className="ide-output-slot" style={{ height: outputHeight }}>
                  <OutputPanel />
                </div>
              </>
            )}
          </div>
        </div>
        {dragTarget === 'body' && (
          <div className="ide-drop-overlay">
            <div className="ide-drop-hint">
              <div className="ide-drop-hint-title">打开项目</div>
              <div className="ide-drop-hint-detail">
                拖入文件夹将作为新项目打开
              </div>
            </div>
          </div>
        )}
      </div>
      {exitDialog && (
        <div className="exit-modal-backdrop">
          <div className="exit-modal">
            {exitDialog.mode === 'running' ? (
              <>
                <div className="exit-modal-title">程序仍在运行</div>
                <div className="exit-modal-body">
                  当前有 {exitDialog.runningCount ?? 0} 个运行中的程序。
                  <br />
                  请选择是否关闭程序{formatActionLabel(exitDialog.actionLabel ?? '退出', true)}。
                </div>
                <div className="exit-modal-actions">
                  <button className="exit-modal-btn danger" onClick={() => resolveExitDialog('close_running')}>关闭程序{formatActionLabel(exitDialog.actionLabel ?? '退出', true)}</button>
                  <button className="exit-modal-btn" onClick={() => resolveExitDialog('cancel_close')}>取消</button>
                </div>
              </>
            ) : (
              <>
                <div className="exit-modal-title">存在未保存文件</div>
                <div className="exit-modal-body">
                  当前有 {exitDialog.modifiedCount ?? 0} 个文件未保存。
                  <br />
                  请选择{exitDialog.actionLabel ?? '退出'}方式。
                </div>
                <div className="exit-modal-actions">
                  <button className="exit-modal-btn primary" onClick={() => resolveExitDialog('save_all_exit')}>全部保存并{exitDialog.actionLabel ?? '退出'}</button>
                  <button className="exit-modal-btn warning" onClick={() => resolveExitDialog('no_save_exit')}>不保存并{exitDialog.actionLabel ?? '退出'}</button>
                  <button className="exit-modal-btn" onClick={() => resolveExitDialog('cancel_exit')}>取消</button>
                </div>
               </>
              )}
            </div>
          </div>
        )}
       {switchProjectDialog && (
         <div className="exit-modal-backdrop">
           <div className="exit-modal">
             <div className="exit-modal-title">切换项目</div>
             <div className="exit-modal-body">
               当前有 {switchProjectDialog.modifiedCount ?? 0} 个文件未保存。
               <br />
               拖入新文件夹将切换项目，请选择处理方式。
               <br />
               <br />
               <small>新项目路径: {switchProjectDialog.newProjectPath}</small>
             </div>
             <div className="exit-modal-actions">
               <button className="exit-modal-btn primary" onClick={() => resolveSwitchProjectDialog('switch_and_save')}>保存并切换</button>
               <button className="exit-modal-btn warning" onClick={() => resolveSwitchProjectDialog('switch_without_save')}>不保存直接切换</button>
               <button className="exit-modal-btn" onClick={() => resolveSwitchProjectDialog('cancel_switch')}>取消切换</button>
             </div>
           </div>
          </div>
        )}
        {updatePrompt && (
          <div className="update-toast" role="status" aria-live="polite">
            <div className="update-toast-header">
              <div className="update-toast-title">发现新版本 {updatePrompt.version}</div>
              {!updatePrompt.downloading && (
                <button className="update-toast-close" onClick={() => void clearPendingUpdate()} title="稍后再说">×</button>
              )}
            </div>
            <div className="update-toast-meta">当前版本 {updatePrompt.currentVersion}{updatePrompt.date ? ` · ${new Date(updatePrompt.date).toLocaleDateString()}` : ''}</div>
            <div className="update-toast-body">{updatePrompt.body?.trim() || updatePrompt.progressText}</div>
            {updatePrompt.downloading && updatePrompt.progress !== null && (
              <div className="update-toast-progress">
                <div className="update-toast-progress-bar" style={{ width: `${Math.max(8, Math.round(updatePrompt.progress * 100))}%` }} />
              </div>
            )}
            <div className="update-toast-footer">
              <div className="update-toast-status">{updatePrompt.progressText}</div>
              {updatePrompt.downloading ? (
                <button className="update-toast-btn muted" disabled>下载中</button>
              ) : (
                <>
                  <button className="update-toast-btn muted" onClick={() => void clearPendingUpdate()}>稍后</button>
                  <button className="update-toast-btn primary" onClick={() => void installPendingUpdate()}>更新</button>
                </>
              )}
            </div>
          </div>
        )}
       <StatusBar />
       <ContextMenu />
     </div>
   );
 };

export default App;
