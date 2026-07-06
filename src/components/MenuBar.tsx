import React, { useState, useRef, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriRuntime } from '../tauriEnv';
import './MenuBar.css';

interface MenuDefinition {
  label: string;
  items: Array<{ label?: string; action?: string; shortcut?: string; separator?: boolean; disabled?: boolean }>;
}

const MENUS: MenuDefinition[] = [
  {
    label: '文件',
    items: [
      { label: '新建文件', action: 'file.new', shortcut: 'Ctrl+N' },
      { label: '新建文件夹', action: 'file.newFolder' },
      { separator: true },
      { label: '打开文件...', action: 'file.open', shortcut: 'Ctrl+O' },
      { label: '打开文件夹...', action: 'file.openFolder', shortcut: 'Ctrl+K Ctrl+O' },
      { separator: true },
      { label: '保存', action: 'file.save', shortcut: 'Ctrl+S' },
      { label: '另存为...', action: 'file.saveAs', shortcut: 'Ctrl+Shift+S' },
      { separator: true },
      { label: '关闭标签页', action: 'file.closeTab', shortcut: 'Ctrl+W' },
    ],
  },
  {
    label: '编辑',
    items: [
      { label: '撤销', action: 'edit.undo', shortcut: 'Ctrl+Z' },
      { label: '重做', action: 'edit.redo', shortcut: 'Ctrl+Y' },
      { separator: true },
      { label: '剪切', action: 'edit.cut', shortcut: 'Ctrl+X' },
      { label: '复制', action: 'edit.copy', shortcut: 'Ctrl+C' },
      { label: '粘贴', action: 'edit.paste', shortcut: 'Ctrl+V' },
      { separator: true },
      { label: '查找', action: 'edit.find', shortcut: 'Ctrl+F' },
      { label: '替换', action: 'edit.replace', shortcut: 'Ctrl+H' },
      { separator: true },
      { label: '全选', action: 'edit.selectAll', shortcut: 'Ctrl+A' },
    ],
  },
  {
    label: '视图',
    items: [
      { label: '切换侧边栏', action: 'view.toggleSidebar', shortcut: 'Ctrl+B' },
      { label: '切换输出面板', action: 'view.toggleOutput', shortcut: 'Ctrl+`' },
      { separator: true },
      { label: '放大', action: 'view.zoomIn', shortcut: 'Ctrl+=' },
      { label: '缩小', action: 'view.zoomOut', shortcut: 'Ctrl+-' },
      { label: '重置缩放', action: 'view.zoomReset', shortcut: 'Ctrl+0' },
    ],
  },
  {
    label: '运行',
    items: [
      { label: '编译并运行', action: 'run.run', shortcut: 'F5' },
      { label: '仅编译', action: 'run.compile', shortcut: 'F6' },
      { separator: true },
      { label: '停止', action: 'run.stop', shortcut: 'F7' },
    ],
  },
  {
    label: '帮助',
    items: [
      { label: '检查更新...', action: 'help.checkUpdate' },
    ],
  },
];

const MenuBar: React.FC = () => {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    let alive = true;
    (async () => {
      const win = getCurrentWindow();
      setIsMaximized(await win.isMaximized());
      const u = await win.onResized(async () => {
        if (alive) setIsMaximized(await win.isMaximized());
      });
      if (alive) unlisten = u; else u();
    })();
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const dispatch = (action: string) => {
    document.dispatchEvent(new CustomEvent('menu-action', { detail: { action } }));
    setOpenMenu(null);
  };

  const handleMinimize = () => {
    if (isTauriRuntime()) void getCurrentWindow().minimize();
  };

  const handleToggleMaximize = () => {
    if (isTauriRuntime()) void getCurrentWindow().toggleMaximize();
  };

  const handleClose = () => {
    if (isTauriRuntime()) void getCurrentWindow().close();
  };

  return (
    <div className="menubar" ref={barRef}>
      <span className="menubar-logo">MiniC</span>
      {MENUS.map((menu, i) => (
        <div key={i} className="menubar-item-wrap">
          <div
            className={`menubar-item${openMenu === i ? ' active' : ''}`}
            onClick={() => setOpenMenu(openMenu === i ? null : i)}
            onMouseEnter={() => openMenu !== null && setOpenMenu(i)}
          >
            {menu.label}
          </div>
          {openMenu === i && (
            <div className="menubar-dropdown">
              {menu.items.map((item, j) =>
                item.separator ? (
                  <div key={j} className="menubar-separator" />
                ) : (
                  <div
                    key={j}
                    className={`menubar-dropdown-item${item.disabled ? ' disabled' : ''}`}
                    onClick={() => item.action && dispatch(item.action)}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <span className="menubar-shortcut">{item.shortcut}</span>}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      ))}
      <div className="menubar-drag-region" data-tauri-drag-region />
      <div className="menubar-window-controls">
        <button
          className="menubar-window-btn"
          onClick={handleMinimize}
          aria-label="最小化"
          title="最小化"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4.5" width="10" height="1" fill="currentColor" /></svg>
        </button>
        <button
          className="menubar-window-btn"
          onClick={handleToggleMaximize}
          aria-label={isMaximized ? '还原' : '最大化'}
          title={isMaximized ? '还原' : '最大化'}
        >
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="2.5" y="0.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x="0.5" y="2.5" width="7" height="7" fill="#3c3c3c" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
          )}
        </button>
        <button
          className="menubar-window-btn menubar-window-btn-close"
          onClick={handleClose}
          aria-label="关闭"
          title="关闭"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5" stroke="currentColor" strokeWidth="1" /></svg>
        </button>
      </div>
    </div>
  );
};

export default MenuBar;
