import React from 'react';
import { useIDEStore } from '../store/ideStore';
import { invoke } from '@tauri-apps/api/core';
import { FileIdentity } from '../types';
import './TabBar.css';

const TabBar: React.FC = () => {
  const { tabs, activeTabPath, setActiveTab, closeTab, showContextMenu, remapPathReferences, setTabFileIdentity } = useIDEStore();

  const resolveTrackedPath = async (path: string, fileIdentity?: FileIdentity | null): Promise<string | null> => {
    if (!fileIdentity) return path;
    const resolved = await invoke<string | null>('resolve_file_path_by_identity', { identity: fileIdentity }).catch(() => path);
    if (!resolved) return null;
    if (resolved !== path) remapPathReferences(path, resolved, false);
    return resolved;
  };

  const handleTabClick = (path: string) => setActiveTab(path);

  const handleTabClose = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    const tab = useIDEStore.getState().tabs.find(t => t.path === path);
    if (tab?.modified) {
      if (!window.confirm(`Save changes to ${tab.name}?`)) {
        closeTab(path);
        return;
      }
      const savePath = await resolveTrackedPath(path, tab.fileIdentity);
      if (!savePath) {
        closeTab(path);
        return;
      }
      await invoke('write_file_content', { path: savePath, content: tab.content });
      const nextIdentity = await invoke<FileIdentity | null>('get_file_identity', { path: savePath }).catch(() => null);
      setTabFileIdentity(savePath, nextIdentity);
      closeTab(savePath);
    } else {
      const resolvedPath = tab ? await resolveTrackedPath(path, tab.fileIdentity) : path;
      closeTab(resolvedPath ?? path);
    }
  };

  const handleTabContextMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    showContextMenu({
      visible: true, x: e.clientX, y: e.clientY,
      items: [
        { label: '关闭', action: 'tab.close', shortcut: 'Ctrl+W' },
        { label: '关闭其他', action: 'tab.closeOthers' },
        { label: '关闭全部', action: 'tab.closeAll' },
        { separator: true },
        { label: '复制路径', action: 'tab.copyPath' },
        { label: '在资源管理器中显示', action: 'tab.revealInExplorer' },
      ],
      context: { path },
    });
  };

  if (tabs.length === 0) return <div className="tabbar tabbar-empty" />;

  return (
    <div className="tabbar">
      {tabs.map(tab => (
        <div
          key={tab.path}
          className={`tab${tab.path === activeTabPath ? ' active' : ''}${tab.modified ? ' modified' : ''}`}
          onClick={() => handleTabClick(tab.path)}
          onContextMenu={(e) => handleTabContextMenu(e, tab.path)}
          title={tab.path}
        >
          <span className="tab-name">{tab.name}</span>
          {tab.modified && <span className="tab-dot">●</span>}
          <span className="tab-close" onClick={(e) => handleTabClose(e, tab.path)}>×</span>
        </div>
      ))}
    </div>
  );
};

export default TabBar;
