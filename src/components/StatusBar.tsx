import React, { useState } from 'react';
import { useIDEStore } from '../store/ideStore';
import './StatusBar.css';

const ENCODING_OPTIONS = ['UTF-8', 'GBK', 'GB18030', 'Big5', 'Shift_JIS', 'EUC-KR'];

const StatusBar: React.FC = () => {
  const { tabs, activeTabPath, outputVisible, setOutputVisible, cursorPosition, isCompiling, isRunning, setTabEncoding } = useIDEStore();
  const activeTab = tabs.find(t => t.path === activeTabPath);
  const [encodingMenuOpen, setEncodingMenuOpen] = useState(false);

  const handleCompile = () => {
    document.dispatchEvent(new CustomEvent('menu-action', { detail: { action: 'run.compile' } }));
  };

  const handleRun = () => {
    document.dispatchEvent(new CustomEvent('menu-action', { detail: { action: 'run.run' } }));
  };

  const handleStop = () => {
    document.dispatchEvent(new CustomEvent('menu-action', { detail: { action: 'run.stop' } }));
  };

  const chooseEncoding = (enc: string) => {
    if (activeTab) setTabEncoding(activeTab.path, enc);
    setEncodingMenuOpen(false);
  };

  return (
    <div className="status-bar">
      <div className="status-left">
        <span className="status-item status-branch">⎇ main</span>
        {activeTab && (
          <span className="status-item">{activeTab.path}</span>
        )}
      </div>
      <div className="status-right">
        {activeTab && (
          <>
            <span className="status-item">行 {cursorPosition.line}, 列 {cursorPosition.col}</span>
            <span className="status-item">C</span>
            <span className="status-encoding-wrap">
              {encodingMenuOpen && (
                <div className="status-encoding-menu">
                  {ENCODING_OPTIONS.map((enc) => (
                    <div
                      key={enc}
                      className={`status-encoding-option${activeTab.encoding === enc ? ' active' : ''}`}
                      onClick={() => chooseEncoding(enc)}
                    >
                      {enc}
                    </div>
                  ))}
                </div>
              )}
              <span
                className="status-item status-toggle"
                onClick={() => setEncodingMenuOpen((v) => !v)}
                title="点击切换文件编码（影响保存与编译输出编码）"
              >
                {activeTab.encoding}
              </span>
            </span>
            <span className="status-item">CRLF</span>
          </>
        )}
        {isCompiling && <span className="status-item status-pulse">编译中…</span>}
        {isRunning && <span className="status-item status-running">运行中</span>}
        <span
          className={`status-item status-toggle${outputVisible ? ' active' : ''}`}
          onClick={() => setOutputVisible(!outputVisible)}
          title="切换输出面板"
        >
          ⊞ 输出
        </span>
        <span
          className={`status-item status-compile${isRunning || isCompiling ? ' disabled' : ''}`}
          onClick={isRunning || isCompiling ? undefined : handleCompile}
          title="仅编译 (F6)"
          style={{ cursor: isRunning || isCompiling ? 'not-allowed' : 'pointer' }}
        >
          ▶ 编译
        </span>
        {isRunning ? (
          <span
            className="status-item status-stop"
            onClick={handleStop}
            title="停止 (F7)"
            style={{ cursor: 'pointer' }}
          >
            <span className="status-stop-icon">■</span>
            <span>停止</span>
          </span>
        ) : (
          <span
            className="status-item status-run"
            onClick={handleRun}
            title="编译并运行 (F5)"
            style={{ cursor: 'pointer' }}
          >
            ▷ 运行
          </span>
        )}
      </div>
    </div>
  );
};

export default StatusBar;
