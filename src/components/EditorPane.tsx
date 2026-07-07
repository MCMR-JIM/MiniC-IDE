import React, { useCallback, useEffect, useRef } from 'react';
import Editor, { OnMount, OnChange, BeforeMount } from '@monaco-editor/react';
import { useIDEStore } from '../store/ideStore';
import { formatSource } from '../utils/formatCode';
import FindReplace from './FindReplace';
import './EditorPane.css';

type MonacoModelLike = {
  getValue: () => string;
  getFullModelRange: () => unknown;
};

type MonacoEditorLike = {
  trigger: (source: string, cmd: string, args: unknown) => void;
  getModel: () => MonacoModelLike | null;
  executeEdits: (
    source: string,
    edits: Array<{ range: unknown; text: string; forceMoveMarkers?: boolean }>,
  ) => void;
  pushUndoStop: () => void;
  focus: () => void;
};

function resetIdeOuterScroll() {
  const sels = ['.ide-editor-area', '.ide-main', '.ide-body', '.ide-root', '#root'];
  for (const sel of sels) {
    const el = document.querySelector(sel);
    if (el instanceof HTMLElement) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
  }
  document.documentElement.scrollTop = 0;
  document.documentElement.scrollLeft = 0;
  document.body.scrollTop = 0;
  document.body.scrollLeft = 0;
  window.scrollTo(0, 0);
}

const EditorPane: React.FC = () => {
  const { tabs, activeTabPath, updateTabContent, findVisible, setFindVisible, showContextMenu, setCursorPosition, outputHeight, outputVisible } = useIDEStore();
  const editorRef = useRef<unknown>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const activeTab = tabs.find(t => t.path === activeTabPath);

  const runFormat = useCallback(async () => {
    const editor = editorRef.current as MonacoEditorLike | null;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    const original = model.getValue();
    if (!original.trim()) return;
    const store = useIDEStore.getState();
    const path = store.activeTabPath ?? 'main.cpp';
    const surface = (msg: string) => {
      store.appendOutput(msg);
      store.setOutputVisible(true);
      document.dispatchEvent(new CustomEvent('switch-output-tab', { detail: { tab: 'output' } }));
    };
    try {
      const formatted = await formatSource(original, path);
      if (formatted && formatted !== original) {
        editor.executeEdits('format', [
          { range: model.getFullModelRange(), text: formatted, forceMoveMarkers: true },
        ]);
        editor.pushUndoStop();
      } else {
        surface('[格式化] 代码已符合当前格式规范，无需改动。');
      }
      editor.focus();
    } catch (err) {
      surface(`[格式化] 失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { action } = e.detail;
      const editor = editorRef.current as { trigger: (s: string, cmd: string, args: unknown) => void } | null;
      if (!editor) return;
      if (action === 'edit.undo') editor.trigger('', 'undo', null);
      if (action === 'edit.redo') editor.trigger('', 'redo', null);
      if (action === 'edit.cut') editor.trigger('', 'editor.action.clipboardCutAction', null);
      if (action === 'edit.copy') editor.trigger('', 'editor.action.clipboardCopyAction', null);
      if (action === 'edit.paste') editor.trigger('', 'editor.action.clipboardPasteAction', null);
      if (action === 'edit.selectAll') editor.trigger('', 'editor.action.selectAll', null);
      if (action === 'edit.find' || action === 'edit.replace') setFindVisible(true);
      if (action === 'edit.format') void runFormat();
      if (action === 'view.zoomIn') editor.trigger('', 'editor.action.fontZoomIn', null);
      if (action === 'view.zoomOut') editor.trigger('', 'editor.action.fontZoomOut', null);
      if (action === 'view.zoomReset') editor.trigger('', 'editor.action.fontZoomReset', null);
    };
    document.addEventListener('menu-action', handler as EventListener);
    document.addEventListener('context-menu-action', handler as EventListener);
    return () => {
      document.removeEventListener('menu-action', handler as EventListener);
      document.removeEventListener('context-menu-action', handler as EventListener);
    };
  }, [setFindVisible, runFormat]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'f') { e.preventDefault(); setFindVisible(true); }
      if (e.ctrlKey && e.key === 'h') { e.preventDefault(); setFindVisible(true); }
      if (e.key === 'Escape' && findVisible) setFindVisible(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [findVisible, setFindVisible]);

  useEffect(() => {
    if (!hostRef.current) return;
    const fixInner = () => {
      const ed = editorRef.current as { layout: () => void } | null;
      if (!ed) return;
      resetIdeOuterScroll();
      ed.layout();
    };
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(fixInner);
    });
    ro.observe(hostRef.current);
    const onAppFix = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(fixInner);
        setTimeout(fixInner, 0);
      });
    };
    document.addEventListener('minic-fix-editor-layout', onAppFix);
    return () => {
      ro.disconnect();
      document.removeEventListener('minic-fix-editor-layout', onAppFix);
    };
  }, [activeTabPath, outputHeight, outputVisible]);

  const handleEditorBeforeMount: BeforeMount = (monaco) => {
    monaco.editor.defineTheme('minic-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '', foreground: 'd4d4d4' },
        { token: 'identifier.cpp', foreground: '9cdcfe' },

        { token: 'keyword.cpp', foreground: '569cd6', fontStyle: 'bold' },

        { token: 'keyword.break.cpp', foreground: 'c586c0', fontStyle: 'bold' },
        { token: 'keyword.case.cpp', foreground: 'c586c0', fontStyle: 'bold' },
        { token: 'keyword.continue.cpp', foreground: 'c586c0', fontStyle: 'bold' },
        { token: 'keyword.default.cpp', foreground: 'c586c0', fontStyle: 'bold' },
        { token: 'keyword.do.cpp', foreground: 'c586c0', fontStyle: 'bold' },
        { token: 'keyword.else.cpp', foreground: 'c586c0', fontStyle: 'bold' },
        { token: 'keyword.for.cpp', foreground: 'c586c0', fontStyle: 'bold' },
        { token: 'keyword.goto.cpp', foreground: 'c586c0', fontStyle: 'bold' },
        { token: 'keyword.if.cpp', foreground: 'c586c0', fontStyle: 'bold' },
        { token: 'keyword.return.cpp', foreground: 'c586c0', fontStyle: 'bold' },
        { token: 'keyword.switch.cpp', foreground: 'c586c0', fontStyle: 'bold' },
        { token: 'keyword.while.cpp', foreground: 'c586c0', fontStyle: 'bold' },
        { token: 'keyword.try.cpp', foreground: 'c586c0', fontStyle: 'bold' },
        { token: 'keyword.catch.cpp', foreground: 'c586c0', fontStyle: 'bold' },
        { token: 'keyword.throw.cpp', foreground: 'c586c0', fontStyle: 'bold' },

        { token: 'keyword.char.cpp', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'keyword.double.cpp', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'keyword.enum.cpp', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'keyword.float.cpp', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'keyword.int.cpp', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'keyword.long.cpp', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'keyword.short.cpp', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'keyword.signed.cpp', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'keyword.struct.cpp', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'keyword.typedef.cpp', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'keyword.union.cpp', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'keyword.unsigned.cpp', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'keyword.void.cpp', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'keyword.bool.cpp', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'keyword.wchar_t.cpp', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'keyword.class.cpp', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'keyword.typename.cpp', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'keyword.template.cpp', foreground: '4ec9b0', fontStyle: 'bold' },

        { token: 'keyword.auto.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.const.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.extern.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.inline.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.mutable.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.register.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.restrict.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.sizeof.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.static.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.volatile.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.nullptr.cpp', foreground: '4fc1ff', fontStyle: 'bold' },
        { token: 'keyword.true.cpp', foreground: '4fc1ff', fontStyle: 'bold' },
        { token: 'keyword.false.cpp', foreground: '4fc1ff', fontStyle: 'bold' },
        { token: 'keyword.new.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.delete.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.this.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.operator.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.namespace.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.using.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.explicit.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.friend.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.virtual.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.override.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.constexpr.cpp', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.static_assert.cpp', foreground: '569cd6', fontStyle: 'bold' },

        { token: 'keyword.directive.cpp', foreground: 'c586c0' },
        { token: 'keyword.directive.include.cpp', foreground: 'c586c0' },
        { token: 'keyword.directive.include.begin.cpp', foreground: 'ce9178' },
        { token: 'keyword.directive.include.end.cpp', foreground: 'ce9178' },
        { token: 'string.include.identifier.cpp', foreground: 'ce9178' },

        { token: 'number.cpp', foreground: 'b5cea8' },
        { token: 'number.float.cpp', foreground: 'b5cea8' },
        { token: 'number.hex.cpp', foreground: 'b5cea8' },
        { token: 'number.octal.cpp', foreground: 'b5cea8' },
        { token: 'number.binary.cpp', foreground: 'b5cea8' },

        { token: 'string.cpp', foreground: 'ce9178' },
        { token: 'string.escape.cpp', foreground: 'd7ba7d' },
        { token: 'string.invalid.cpp', foreground: 'f44747' },
        { token: 'string.raw.cpp', foreground: 'ce9178' },
        { token: 'string.raw.begin.cpp', foreground: 'ce9178' },
        { token: 'string.raw.end.cpp', foreground: 'ce9178' },

        { token: 'comment.cpp', foreground: '6a9955', fontStyle: 'italic' },
        { token: 'comment.doc.cpp', foreground: '6a9955', fontStyle: 'italic' },

        { token: 'delimiter.cpp', foreground: 'd4d4d4' },
        { token: 'delimiter.curly.cpp', foreground: 'ffd700' },
        { token: 'delimiter.parenthesis.cpp', foreground: 'da70d6' },
        { token: 'delimiter.square.cpp', foreground: '9cdcfe' },
        { token: 'delimiter.angle.cpp', foreground: 'cccccc' },

        { token: 'annotation.cpp', foreground: 'c586c0' },
      ],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#d4d4d4',
        'editorLineNumber.foreground': '#858585',
        'editorLineNumber.activeForeground': '#c6c6c6',
        'editor.selectionBackground': '#264f78',
        'editor.inactiveSelectionBackground': '#3a3d41',
        'editor.lineHighlightBackground': '#2a2d2e',
        'editorCursor.foreground': '#aeafad',
        'editorWhitespace.foreground': '#3b3a32',
        'editorIndentGuide.background1': '#404040',
        'editorIndentGuide.activeBackground1': '#707070',
        'editor.findMatchBackground': '#515c6a',
        'editor.findMatchHighlightBackground': '#ea5c0055',
        'editorBracketMatch.background': '#0064001a',
        'editorBracketMatch.border': '#888888',
        'scrollbarSlider.background': '#42424266',
        'scrollbarSlider.hoverBackground': '#646464b3',
        'scrollbarSlider.activeBackground': '#bfbfbf66',
      },
    });
  };

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    const scheduleLayoutFix = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resetIdeOuterScroll();
          editor.layout();
          setTimeout(() => {
            resetIdeOuterScroll();
            editor.layout();
          }, 0);
        });
      });
    };

    scheduleLayoutFix();

    editor.addCommand(2048 | 83, () => {
      document.dispatchEvent(new CustomEvent('menu-action', { detail: { action: 'file.save' } }));
    });
    editor.addCommand(2048 | 87, () => {
      document.dispatchEvent(new CustomEvent('menu-action', { detail: { action: 'file.closeTab' } }));
    });
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
      document.dispatchEvent(new CustomEvent('menu-action', { detail: { action: 'edit.format' } }));
    });
    editor.onDidChangeCursorPosition((e) => {
      setCursorPosition({ line: e.position.lineNumber, col: e.position.column });
    });
  };

  const handleChange: OnChange = (value) => {
    if (activeTabPath && value !== undefined) updateTabContent(activeTabPath, value);
  };

  const handleEditorContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    showContextMenu({
      visible: true, x: e.clientX, y: e.clientY,
      items: [
        { label: '剪切', action: 'edit.cut', shortcut: 'Ctrl+X' },
        { label: '复制', action: 'edit.copy', shortcut: 'Ctrl+C' },
        { label: '粘贴', action: 'edit.paste', shortcut: 'Ctrl+V' },
        { separator: true },
        { label: '格式化代码', action: 'edit.format', shortcut: 'Shift+Alt+F' },
        { separator: true },
        { label: '全选', action: 'edit.selectAll', shortcut: 'Ctrl+A' },
        { separator: true },
        { label: '查找', action: 'edit.find', shortcut: 'Ctrl+F' },
        { label: '替换', action: 'edit.replace', shortcut: 'Ctrl+H' },
      ],
    });
  };

  if (!activeTab) {
    return (
      <div className="editor-welcome">
        <div className="editor-welcome-inner">
          <h1>MiniC IDE</h1>
          <p>打开文件或文件夹以开始编辑</p>
          <div className="editor-welcome-actions">
            <button onClick={() => document.dispatchEvent(new CustomEvent('menu-action', { detail: { action: 'file.open' } }))}>打开文件</button>
            <button onClick={() => document.dispatchEvent(new CustomEvent('menu-action', { detail: { action: 'file.openFolder' } }))}>打开文件夹</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-pane" onContextMenu={handleEditorContextMenu}>
      {findVisible && <FindReplace editorRef={editorRef} />}
      <div className="editor-host" ref={hostRef}>
        <Editor
          key={activeTab.path}
          height="100%"
          language={activeTab.language}
          value={activeTab.content}
          theme="minic-dark"
          beforeMount={handleEditorBeforeMount}
          onChange={handleChange}
          onMount={handleEditorMount}
          options={{
            fontSize: 14,
            fontFamily: "'Consolas', 'Microsoft YaHei Mono', 'Courier New', monospace",
            fontLigatures: false,
            lineNumbers: 'on',
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            smoothScrolling: false,
            mouseWheelZoom: true,
            stickyScroll: { enabled: false },
            tabSize: 4,
            insertSpaces: true,
            wordWrap: 'off',
            renderWhitespace: 'selection',
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: true, indentation: true },
            suggest: { showKeywords: true },
            quickSuggestions: true,
            contextmenu: false,
            'semanticHighlighting.enabled': true,
          }}
        />
      </div>
    </div>
  );
};

export default EditorPane;
