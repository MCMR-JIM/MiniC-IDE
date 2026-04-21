import React, { useEffect, useCallback, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { message } from '@tauri-apps/plugin-dialog';
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
import { getEditorLanguageFromFileName } from './utils/language';
import './App.css';

type ExitDialogState =
  | null
  | {
      mode: 'running' | 'unsaved';
      runningCount?: number;
      modifiedCount?: number;
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
  const exitDialogResolverRef = useRef<((choice: string) => void) | null>(null);
  const [exitDialog, setExitDialog] = useState<ExitDialogState>(null);

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
            const runChoice = await askExitDialog({ mode: 'running', runningCount: running });
            if (runChoice !== 'close_running') return;
            await invoke('kill_child_processes').catch(() => {});
          }

          if (modified.length > 0) {
            const saveChoice = await askExitDialog({ mode: 'unsaved', modifiedCount: modified.length });
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

  const handleCompile = useCallback(async () => {
    const path = activeTabPath;
    if (!path) { appendOutput('No file open to compile.'); return; }
    const tab = useIDEStore.getState().tabs.find(t => t.path === path);
    if (!tab) return;
    setOutputVisible(true);
    document.dispatchEvent(new CustomEvent('switch-output-tab', { detail: { tab: 'output' } }));
    if (tab.modified) {
      await invoke('write_file_content', { path, content: tab.content });
      markTabSaved(path);
    }
    clearOutput();
    setIsCompiling(true);
    appendOutput(`[Compiling] ${path}`);
    try {
      const result = await invoke<CompileResult>('compile_file', { filePath: path, outputPath: null });
      setCompileResult(result);
      if (result.stdout) result.stdout.split('\n').filter(Boolean).forEach(l => appendOutput(l));
      if (result.stderr) result.stderr.split('\n').filter(Boolean).forEach(l => appendOutput(l));
      appendOutput(result.success ? `>> Compiled successfully.` : `>> Compilation failed (exit ${result.exit_code}).`);
    } catch (e) {
      appendOutput(`Error: ${e}`);
    } finally {
      setIsCompiling(false);
      fixEditorLayoutAfter();
    }
  }, [activeTabPath, appendOutput, clearOutput, setCompileResult, setIsCompiling, markTabSaved, fixEditorLayoutAfter, setOutputVisible]);

  const handleRun = useCallback(async () => {
    await handleCompile();
    const state = useIDEStore.getState();
    if (!state.compileResult?.success) return;
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
        setProjectRoot(selected);
        await refreshFileTree(selected);
      }
    } catch (e) { console.error(e); }
  }, [setProjectRoot, refreshFileTree]);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await invoke<string | null>('open_file_dialog');
      if (selected) {
        const name = selected.split(/[\\/]/).pop() ?? selected;
        const content = await invoke<string>('read_file_content', { path: selected });
        const lang = getEditorLanguageFromFileName(name);
        openTab({ path: selected, name, content, modified: false, language: lang });
      }
    } catch (e) { console.error(e); }
  }, [openTab]);

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
          const name = selected.split(/[\\/]/).pop() ?? selected;
          const content = await invoke<string>('read_file_content', { path: selected });
          const lang = getEditorLanguageFromFileName(name);
          openTab({ path: selected, name, content, modified: false, language: lang });
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
  }, [activeTabPath, tabs, projectRoot, handleCompile, handleRun, handleStop, handleSave, handleOpenFile, handleOpenFolder, closeTab, toggleSidebar, toggleOutput, setFindVisible, refreshFileTree, triggerFileTreeInline, openTab]);

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
      <div className="ide-body">
        {sidebarVisible && (
          <div className="ide-sidebar" style={{ width: sidebarWidth }}>
            <FileTree />
            <div className="sidebar-resizer" onMouseDown={onSidebarMouseDown} />
          </div>
        )}
        <div className="ide-main">
          <div className="ide-main-tabstrip">
            <TabBar />
          </div>
          <div className="ide-editor-area">
            <EditorPane />
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
                  请选择是否关闭程序并退出。
                </div>
                <div className="exit-modal-actions">
                  <button className="exit-modal-btn danger" onClick={() => resolveExitDialog('close_running')}>关闭程序并退出</button>
                  <button className="exit-modal-btn" onClick={() => resolveExitDialog('cancel_close')}>取消关闭</button>
                </div>
              </>
            ) : (
              <>
                <div className="exit-modal-title">存在未保存文件</div>
                <div className="exit-modal-body">
                  当前有 {exitDialog.modifiedCount ?? 0} 个文件未保存。
                  <br />
                  请选择退出方式。
                </div>
                <div className="exit-modal-actions">
                  <button className="exit-modal-btn primary" onClick={() => resolveExitDialog('save_all_exit')}>全部保存并退出</button>
                  <button className="exit-modal-btn warning" onClick={() => resolveExitDialog('no_save_exit')}>不保存并退出</button>
                  <button className="exit-modal-btn" onClick={() => resolveExitDialog('cancel_exit')}>取消退出</button>
                </div>
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
