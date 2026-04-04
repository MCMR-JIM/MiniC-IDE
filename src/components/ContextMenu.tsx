import React, { useEffect, useRef } from 'react';
import { useIDEStore } from '../store/ideStore';
import './ContextMenu.css';

const ContextMenu: React.FC = () => {
  const { contextMenu, hideContextMenu } = useIDEStore();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => hideContextMenu();
    if (contextMenu.visible) {
      document.addEventListener('mousedown', handler);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideContextMenu(); });
    }
    return () => document.removeEventListener('mousedown', handler);
  }, [contextMenu.visible, hideContextMenu]);

  if (!contextMenu.visible) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    left: contextMenu.x,
    top: contextMenu.y,
    zIndex: 9999,
  };

  return (
    <div ref={menuRef} className="context-menu" style={style} onMouseDown={e => e.stopPropagation()}>
      {contextMenu.items.map((item, i) =>
        item.separator ? (
          <div key={i} className="context-menu-separator" />
        ) : (
          <div
            key={i}
            className={`context-menu-item${item.disabled ? ' disabled' : ''}`}
            onClick={() => {
              if (!item.disabled && item.action) {
                const event = new CustomEvent('context-menu-action', { detail: { action: item.action, context: contextMenu.context } });
                document.dispatchEvent(event);
              }
              hideContextMenu();
            }}
          >
            <span className="context-menu-label">{item.label}</span>
            {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
          </div>
        )
      )}
    </div>
  );
};

export default ContextMenu;
