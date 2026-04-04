import React, { useEffect, useRef, useState } from 'react';
import { useIDEStore } from '../store/ideStore';
import Terminal from './Terminal';
import './OutputPanel.css';

const OutputPanel: React.FC = () => {
  const { outputLines, clearOutput, outputVisible, setOutputVisible } = useIDEStore();
  const [activeTab, setActiveTab] = useState<'output' | 'terminal'>('output');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [outputLines]);

  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab;
      if (tab === 'terminal' || tab === 'output') setActiveTab(tab);
    };
    document.addEventListener('switch-output-tab', handler);
    return () => document.removeEventListener('switch-output-tab', handler);
  }, []);

  const parseErrorLine = (line: string) => {
    const match = line.match(/^(.+\.c):(\d+):/);
    if (match) {
      return (
        <span>
          <span className="output-link" onClick={() => {
            document.dispatchEvent(new CustomEvent('goto-error', { detail: { file: match[1], line: parseInt(match[2]) } }));
          }}>{match[0]}</span>
          {line.slice(match[0].length)}
        </span>
      );
    }
    return line;
  };

  const getLineClass = (line: string): string => {
    if (line.includes('error:') || line.includes('Error')) return 'output-error';
    if (line.includes('warning:') || line.includes('Warning')) return 'output-warning';
    if (line.startsWith('[') || line.startsWith('Compiled') || line.startsWith('Running')) return 'output-info';
    if (line.startsWith('>>')) return 'output-success';
    return 'output-normal';
  };

  if (!outputVisible) return null;

  return (
    <div className="output-panel">
      <div className="output-header">
        <div className="output-tabs">
          <button
            className={`output-tab${activeTab === 'output' ? ' active' : ''}`}
            onClick={() => setActiveTab('output')}
          >输出</button>
          <button
            className={`output-tab${activeTab === 'terminal' ? ' active' : ''}`}
            onClick={() => setActiveTab('terminal')}
          >终端</button>
        </div>
        <div className="output-actions">
          {activeTab === 'output' && (
            <button className="output-btn" onClick={clearOutput} title="清除">⊘ 清除</button>
          )}
          <button className="output-btn" onClick={() => setOutputVisible(false)} title="关闭">×</button>
        </div>
      </div>
      <div className="output-body" hidden={activeTab !== 'output'}>
        {outputLines.length === 0 && (
          <div className="output-empty">暂无输出。按 F5 编译并运行，或按 F6 仅编译。</div>
        )}
        {outputLines.map((line, i) => (
          <div key={i} className={`output-line ${getLineClass(line)}`}>
            {parseErrorLine(line)}
          </div>
        ))}
        <div ref={bottomRef} className="output-bottom-anchor" />
      </div>
      <div className="output-terminal-wrap" hidden={activeTab !== 'terminal'}>
        <Terminal visible={activeTab === 'terminal'} />
      </div>
    </div>
  );
};

export default OutputPanel;
