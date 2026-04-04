import React, { useState, useEffect, useRef } from 'react';
import './FindReplace.css';

interface Props {
  editorRef: React.RefObject<unknown>;
}

const FindReplace: React.FC<Props> = ({ editorRef }) => {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const getEditor = () => editorRef.current as {
    getModel: () => { findMatches: (s: string, b: boolean, b2: boolean, b3: boolean, s2: string|null, b4: boolean) => { range: unknown }[] };
    setSelection: (r: unknown) => void;
    revealLineInCenter: (n: number) => void;
    executeEdits: (s: string, edits: unknown[]) => void;
    trigger: (s: string, cmd: string, args: unknown) => void;
  } | null;

  const doFind = () => {
    const editor = getEditor();
    if (!editor || !findText) return;
    editor.trigger('keyboard', 'actions.find', null);
  };

  const doReplace = () => {
    const editor = getEditor();
    if (!editor || !findText) return;
    editor.trigger('', 'editor.action.startFindReplaceAction', null);
  };

  return (
    <div className="find-replace-bar">
      <div className="find-replace-row">
        <button className="fr-toggle" onClick={() => setShowReplace(!showReplace)}>
          {showReplace ? '▾' : '▸'}
        </button>
        <input
          ref={inputRef}
          className="fr-input"
          placeholder="Find"
          value={findText}
          onChange={e => setFindText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doFind()}
        />
        <button className={`fr-btn${matchCase ? ' active' : ''}`} title="Match Case" onClick={() => setMatchCase(!matchCase)}>Aa</button>
        <button className={`fr-btn${wholeWord ? ' active' : ''}`} title="Whole Word" onClick={() => setWholeWord(!wholeWord)}>ab</button>
        <button className={`fr-btn${useRegex ? ' active' : ''}`} title="Use Regex" onClick={() => setUseRegex(!useRegex)}>.*</button>
        <button className="fr-btn" onClick={doFind}>Find</button>
        <button className="fr-close" onClick={() => document.dispatchEvent(new CustomEvent('menu-action', { detail: { action: 'find.close' } }))}>×</button>
      </div>
      {showReplace && (
        <div className="find-replace-row">
          <div style={{ width: 20 }} />
          <input
            className="fr-input"
            placeholder="Replace"
            value={replaceText}
            onChange={e => setReplaceText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doReplace()}
          />
          <button className="fr-btn" onClick={doReplace}>Replace</button>
          <button className="fr-btn" onClick={doReplace}>Replace All</button>
        </div>
      )}
    </div>
  );
};

export default FindReplace;
