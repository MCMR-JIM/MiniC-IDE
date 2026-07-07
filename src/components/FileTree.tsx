import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useIDEStore } from '../store/ideStore';
import { FileEntry, FileIdentity, FileReadResult } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { getFileIconComponent } from './FileIcons';
import { getEditorLanguageFromFileName } from '../utils/language';
import './FileTree.css';

type InlineMode = 'newFile' | 'newFolder' | 'rename';

type InlineEditState = {
  mode: InlineMode;
  parentPath: string;
  targetPath?: string;
  isDir?: boolean;
};

type InlineActionDetail = {
  mode: InlineMode;
  context?: Record<string, unknown>;
};

const getParentPath = (path: string): string => {
  const normalized = path.replace(/[\\/]+$/, '');
  const slash = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  if (slash < 0) return normalized;
  if (slash === 0) return normalized[0];
  const parent = normalized.slice(0, slash);
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  return parent;
};

const getBaseName = (path: string): string => {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
};

const joinPath = (parent: string, name: string): string => {
  const trimmed = name.trim();
  if (!parent) return trimmed;
  const sep = parent.includes('\\') || /^[A-Za-z]:$/.test(parent) ? '\\' : '/';
  if (parent.endsWith('\\') || parent.endsWith('/')) return `${parent}${trimmed}`;
  return `${parent}${sep}${trimmed}`;
};

const InlineEntryInput: React.FC<{
  depth: number;
  isDir: boolean;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}> = ({ depth, isDir, value, onChange, onSubmit, onCancel }) => {
  return (
    <div
      className="file-node file-node-inline"
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="file-node-arrow placeholder" />
      <span className="file-node-icon">{getFileIconComponent(isDir ? 'new-folder' : 'new-file', isDir, false)}</span>
      <input
        className="file-node-inline-input"
        value={value}
        autoFocus
        placeholder={isDir ? '新建文件夹' : '新建文件'}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
    </div>
  );
};

const FileNode: React.FC<{
  entry: FileEntry;
  depth: number;
  inlineState: InlineEditState | null;
  inlineName: string;
  setInlineName: (v: string) => void;
  submitInline: () => void;
  cancelInline: () => void;
}> = ({ entry, depth, inlineState, inlineName, setInlineName, submitInline, cancelInline }) => {
  const { expandedDirs, toggleDir, openTab, tabs, setActiveTab, showContextMenu, activeTabPath, runningFilePath } = useIDEStore();
  const isActiveFile = !entry.is_dir && entry.path === activeTabPath;
  const isExpanded = expandedDirs.has(entry.path);
  const tabState = tabs.find((t) => t.path === entry.path);
  const isModified = Boolean(tabState?.modified);
  const isRunningFile = !entry.is_dir && runningFilePath === entry.path;
  const isRenaming = inlineState?.mode === 'rename' && inlineState.targetPath === entry.path;
  const hasInlineChild =
    entry.is_dir &&
    (inlineState?.mode === 'newFile' || inlineState?.mode === 'newFolder') &&
    inlineState.parentPath === entry.path;

  const handleClick = async () => {
    if (isRenaming) return;
    if (entry.is_dir) {
      toggleDir(entry.path);
    } else {
      const existing = tabs.find(t => t.path === entry.path);
      if (existing) {
        setActiveTab(entry.path);
        return;
      }
      try {
        const [readResult, fileIdentity] = await Promise.all([
          invoke<FileReadResult>('read_file_content', { path: entry.path }),
          invoke<FileIdentity | null>('get_file_identity', { path: entry.path }),
        ]);
        openTab({ path: entry.path, name: entry.name, content: readResult.content, modified: false, language: getEditorLanguageFromFileName(entry.name), encoding: readResult.encoding, fileIdentity });
      } catch (e: unknown) {
        const msg = typeof e === 'string' ? e : String(e);
        openTab({ path: entry.path, name: entry.name, content: msg, modified: false, language: 'plaintext', encoding: 'UTF-8' });
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const items = entry.is_dir ? [
      { label: '新建文件', action: 'tree.newFile' },
      { label: '新建文件夹', action: 'tree.newFolder' },
      { separator: true },
      { label: '在文件夹中查看', action: 'tree.revealInExplorer' },
      { separator: true },
      { label: '重命名', action: 'tree.rename' },
      { label: '删除', action: 'tree.delete' },
    ] : [
      { label: '打开', action: 'tree.open' },
      { separator: true },
      { label: '重命名', action: 'tree.rename' },
      { label: '删除', action: 'tree.delete' },
      { separator: true },
      { label: '复制路径', action: 'tree.copyPath' },
      { label: '在文件夹中查看', action: 'tree.revealInExplorer' },
    ];
    showContextMenu({ visible: true, x: e.clientX, y: e.clientY, items, context: { path: entry.path, is_dir: entry.is_dir, name: entry.name } });
  };

  return (
    <div>
      <div
        className={`file-node${entry.is_dir ? ' dir' : ' file'}${isActiveFile ? ' file-node-active' : ''}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        title={entry.path}
      >
        <span className={`file-node-arrow${entry.is_dir ? '' : ' placeholder'}${entry.is_dir && isExpanded ? ' expanded' : ''}`} />
        <span className="file-node-icon">{getFileIconComponent(entry.name, entry.is_dir, isExpanded)}</span>
        {isRenaming ? (
          <input
            className="file-node-inline-input"
            value={inlineName}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setInlineName(e.target.value)}
            onBlur={submitInline}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitInline();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelInline();
              }
            }}
          />
        ) : (
          <span className="file-node-name">{entry.name}</span>
        )}
        {!entry.is_dir && !isRenaming && (
          <span className="file-node-flags">
            {isRunningFile && <span className="file-node-running-badge" title="运行中">▶</span>}
            {isModified && <span className="file-node-dirty-dot" title="未保存">●</span>}
          </span>
        )}
      </div>
      {hasInlineChild && inlineState && (
        <InlineEntryInput
          depth={depth + 1}
          isDir={inlineState.mode === 'newFolder'}
          value={inlineName}
          onChange={setInlineName}
          onSubmit={submitInline}
          onCancel={cancelInline}
        />
      )}
      {entry.is_dir && isExpanded && entry.children?.map(child => (
        <FileNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          inlineState={inlineState}
          inlineName={inlineName}
          setInlineName={setInlineName}
          submitInline={submitInline}
          cancelInline={cancelInline}
        />
      ))}
    </div>
  );
};

const FileTree: React.FC = () => {
  const {
    fileTree,
    projectRoot,
    showContextMenu,
    expandedDirs,
    toggleDir,
    openTab,
    appendOutput,
    remapPathReferences,
  } = useIDEStore();
  const [inlineState, setInlineState] = useState<InlineEditState | null>(null);
  const [inlineName, setInlineName] = useState('');

  const rootDisplayName = useMemo(() => {
    if (!projectRoot) return '';
    return projectRoot.split(/[\\/]/).pop()?.toUpperCase() ?? '';
  }, [projectRoot]);

  const cancelInline = useCallback(() => {
    setInlineState(null);
    setInlineName('');
  }, []);

  const submitInline = useCallback(async () => {
    if (!inlineState || !projectRoot) {
      cancelInline();
      return;
    }

    const name = inlineName.trim();
    if (!name) {
      cancelInline();
      return;
    }

    try {
      if (inlineState.mode === 'rename' && inlineState.targetPath) {
        const newPath = joinPath(inlineState.parentPath, name);
        if (newPath !== inlineState.targetPath) {
          await invoke('rename_path', { oldPath: inlineState.targetPath, newPath });
          remapPathReferences(inlineState.targetPath, newPath, Boolean(inlineState.isDir));
        }
      } else if (inlineState.mode === 'newFile') {
        const filePath = joinPath(inlineState.parentPath, name);
        await invoke('create_file', { path: filePath });
        const fileIdentity = await invoke<FileIdentity | null>('get_file_identity', { path: filePath }).catch(() => null);
        openTab({
          path: filePath,
          name,
          content: '',
          modified: false,
          language: getEditorLanguageFromFileName(name),
          encoding: useIDEStore.getState().defaultEncoding,
          fileIdentity,
        });
      } else if (inlineState.mode === 'newFolder') {
        const dirPath = joinPath(inlineState.parentPath, name);
        await invoke('create_directory', { path: dirPath });
      }

      document.dispatchEvent(new CustomEvent('menu-action', { detail: { action: 'tree.refresh' } }));
      cancelInline();
    } catch (e) {
      appendOutput(`Error: ${String(e)}`);
      cancelInline();
    }
  }, [appendOutput, cancelInline, inlineName, inlineState, openTab, projectRoot, remapPathReferences]);

  const startInline = useCallback((detail: InlineActionDetail) => {
    if (!projectRoot) return;
    const ctx = detail.context ?? {};
    const ctxPath = typeof ctx.path === 'string' ? ctx.path : '';
    const ctxIsDir = Boolean(ctx.is_dir);

    if (detail.mode === 'rename') {
      if (!ctxPath) return;
      setInlineState({
        mode: 'rename',
        parentPath: getParentPath(ctxPath),
        targetPath: ctxPath,
        isDir: ctxIsDir,
      });
      setInlineName(typeof ctx.name === 'string' ? ctx.name : getBaseName(ctxPath));
      return;
    }

    const parentPath = ctxPath
      ? (ctxIsDir ? ctxPath : getParentPath(ctxPath))
      : projectRoot;

    if (parentPath !== projectRoot && !expandedDirs.has(parentPath)) {
      toggleDir(parentPath);
    }

    setInlineState({
      mode: detail.mode,
      parentPath,
      isDir: detail.mode === 'newFolder',
    });
    setInlineName('');
  }, [expandedDirs, projectRoot, toggleDir]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as InlineActionDetail | undefined;
      if (!detail) return;
      startInline(detail);
    };
    document.addEventListener('file-tree-inline-action', handler);
    return () => document.removeEventListener('file-tree-inline-action', handler);
  }, [startInline]);

  const handleRootContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    showContextMenu({
      visible: true, x: e.clientX, y: e.clientY,
      items: [
        { label: '新建文件', action: 'tree.newFile' },
        { label: '新建文件夹', action: 'tree.newFolder' },
        { separator: true },
        { label: '在文件夹中查看', action: 'tree.revealInExplorer' },
        { separator: true },
        { label: '刷新', action: 'tree.refresh' },
      ],
      context: { path: projectRoot ?? '', is_dir: true, name: '' },
    });
  };

  const showRootInline =
    Boolean(projectRoot) &&
    Boolean(inlineState) &&
    (inlineState?.mode === 'newFile' || inlineState?.mode === 'newFolder') &&
    inlineState.parentPath === projectRoot;

  const showEmptyState = fileTree.length === 0 && !showRootInline;

  return (
    <div className="file-tree" onContextMenu={handleRootContextMenu}>
      {projectRoot && (
        <div className="file-tree-header">
          {rootDisplayName}
        </div>
      )}
      {showEmptyState && (
        <div className="file-tree-empty">
          <p>{projectRoot ? '空文件夹' : '未打开文件夹'}</p>
        </div>
      )}
      {showRootInline && inlineState && (
        <InlineEntryInput
          depth={0}
          isDir={inlineState.mode === 'newFolder'}
          value={inlineName}
          onChange={setInlineName}
          onSubmit={submitInline}
          onCancel={cancelInline}
        />
      )}
      {fileTree.map(entry => (
        <FileNode
          key={entry.path}
          entry={entry}
          depth={0}
          inlineState={inlineState}
          inlineName={inlineName}
          setInlineName={setInlineName}
          submitInline={submitInline}
          cancelInline={cancelInline}
        />
      ))}
    </div>
  );
};

export default FileTree;
