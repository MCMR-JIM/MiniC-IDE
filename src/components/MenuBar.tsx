import React, { useState, useRef, useEffect } from 'react';
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
];

const MenuBar: React.FC = () => {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const dispatch = (action: string) => {
    document.dispatchEvent(new CustomEvent('menu-action', { detail: { action } }));
    setOpenMenu(null);
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
    </div>
  );
};

export default MenuBar;
