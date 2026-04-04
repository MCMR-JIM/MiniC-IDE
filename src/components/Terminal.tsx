import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useIDEStore } from '../store/ideStore';
import '@xterm/xterm/css/xterm.css';
import './Terminal.css';

type TerminalChunkPayload = {
  data: string;
  stream: 'stdout' | 'stderr' | 'meta' | string;
  b64?: string;
};

type TerminalProps = {
  /** When false, dimensions may be 0; refit when true. */
  visible?: boolean;
};

type PtyStripMode = 'normal' | 'esc' | 'csi' | 'osc' | 'dcs';
type PtyStripState = {
  mode: PtyStripMode;
  oscEscPending: boolean;
  dcsEscPending: boolean;
};

const newPtyStripState = (): PtyStripState => ({
  mode: 'normal',
  oscEscPending: false,
  dcsEscPending: false,
});

const stripPtyChunkIncremental = (
  input: string,
  stateRef: React.MutableRefObject<PtyStripState>,
  crPendingRef: React.MutableRefObject<boolean>
): string => {
  const st = stateRef.current;
  let out = '';

  const emitPrintable = (ch: string) => {
    if (ch === '\r') {
      crPendingRef.current = true;
      return;
    }
    if (ch === '\n') {
      out += '\n';
      crPendingRef.current = false;
      return;
    }
    if (crPendingRef.current) {
      out += '\n';
      crPendingRef.current = false;
    }
    const code = ch.charCodeAt(0);
    if (code === 0x09 || code >= 0x20) {
      out += ch;
    }
  };

  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (st.mode === 'normal') {
      if (code === 0x1b) {
        st.mode = 'esc';
      } else {
        emitPrintable(ch);
      }
      continue;
    }

    if (st.mode === 'esc') {
      if (ch === '[') {
        st.mode = 'csi';
      } else if (ch === ']') {
        st.mode = 'osc';
        st.oscEscPending = false;
      } else if (ch === 'P') {
        st.mode = 'dcs';
        st.dcsEscPending = false;
      } else {
        // Single-character ESC sequence.
        st.mode = 'normal';
      }
      continue;
    }

    if (st.mode === 'csi') {
      if (code >= 0x40 && code <= 0x7e) {
        st.mode = 'normal';
      }
      continue;
    }

    if (st.mode === 'osc') {
      if (st.oscEscPending) {
        st.oscEscPending = false;
        if (ch === '\\') {
          st.mode = 'normal';
        }
        continue;
      }
      if (code === 0x07) {
        st.mode = 'normal';
      } else if (code === 0x1b) {
        st.oscEscPending = true;
      }
      continue;
    }

    if (st.mode === 'dcs') {
      if (st.dcsEscPending) {
        st.dcsEscPending = false;
        if (ch === '\\') {
          st.mode = 'normal';
        }
        continue;
      }
      if (code === 0x1b) {
        st.dcsEscPending = true;
      }
      continue;
    }
  }

  return out;
};

const writePrompt = (term: XTerm, cwdRef: React.MutableRefObject<string>) => {
  const p = cwdRef.current || '~';
  term.write(`\x1b[32m${p}>\x1b[0m `);
};

const redrawInputLine = (term: XTerm, cwdRef: React.MutableRefObject<string>, lineBuf: React.MutableRefObject<string>) => {
  term.write('\r\x1b[2K');
  writePrompt(term, cwdRef);
  term.write(lineBuf.current);
};

const b64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    arr[i] = bin.charCodeAt(i);
  }
  return arr;
};

const Terminal: React.FC<TerminalProps> = ({ visible = true }) => {
  const { projectRoot } = useIDEStore();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const cwdRef = useRef('');
  const lineBuf = useRef('');
  const histArr = useRef<string[]>([]);
  const histPos = useRef(-1);
  const runExeRef = useRef<(exePath: string, runCwd: string) => void>(() => {});
  /** While true, keystrokes go to ConPTY stdin (run_executable), not local line editor. */
  const ptyForwardRef = useRef(false);
  const lastInterruptAtRef = useRef(0);
  const currentExePathRef = useRef<string | null>(null);
  const currentSourcePathRef = useRef<string | null>(null);
  const ptyStripStateRef = useRef<PtyStripState>(newPtyStripState());
  const ptyCrPendingRef = useRef(false);
  const renderDbgCountRef = useRef(0);
  const resetPtyStripState = () => {
    ptyStripStateRef.current = newPtyStripState();
    ptyCrPendingRef.current = false;
    renderDbgCountRef.current = 0;
  };
  const emitRunningState = (running: boolean) => {
    document.dispatchEvent(new CustomEvent('terminal-running-changed', {
      detail: {
        running,
        exePath: currentExePathRef.current,
        sourcePath: currentSourcePathRef.current,
      },
    }));
    if (!running) {
      currentExePathRef.current = null;
      currentSourcePathRef.current = null;
    }
  };

  useEffect(() => {
    if (projectRoot) cwdRef.current = projectRoot;
  }, [projectRoot]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: 'Consolas, "Cascadia Code", "Courier New", monospace',
      fontSize: 13,
      windowsPty: {
        backend: 'conpty',
      },
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#aeafad',
      },
      scrollback: 8000,
      scrollOnEraseInDisplay: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    fitRef.current = fit;

    const stopPty = async (forceKill: boolean) => {
      if (!ptyForwardRef.current) return;
      if (!forceKill) {
        try {
          await invoke('pty_write', { data: '\x03' });
          return;
        } catch {
          // Fallback to hard stop below.
        }
      }

      let killed = false;
      try {
        await invoke('pty_kill');
        killed = true;
      } catch {
        try {
          await invoke('kill_child_processes');
          killed = true;
        } catch {
          killed = false;
        }
      }

      if (killed) {
        ptyForwardRef.current = false;
        emitRunningState(false);
        term.writeln('\r\n\x1b[33m[stopped]\x1b[0m');
        redrawInputLine(term, cwdRef, lineBuf);
      }
    };

    const requestInterrupt = async (forceKill = false) => {
      if (!ptyForwardRef.current) return;
      if (forceKill) {
        await stopPty(true);
        return;
      }

      const now = Date.now();
      const shouldForceKill = now - lastInterruptAtRef.current <= 700;
      lastInterruptAtRef.current = now;
      if (shouldForceKill) {
        await stopPty(true);
        return;
      }
      await stopPty(false);
    };

    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true;
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && (ev.key === 'c' || ev.key === 'C')) {
        const selected = term.getSelection();
        if (selected) {
          void navigator.clipboard.writeText(selected).catch(() => {});
        }
        return false;
      }
      if (!ptyForwardRef.current) return true;
      // Ctrl+C: forward ETX to PTY (allow copy when selection exists).
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'c' || ev.key === 'C')) {
        if (term.hasSelection()) return true;
        void requestInterrupt(false);
        return false;
      }
      // Ctrl+Break / Ctrl+Pause: hard stop fallback.
      if (ev.ctrlKey && ev.key === 'Pause') {
        void requestInterrupt(true);
        return false;
      }
      return true;
    });

    const onTerminalStop = () => {
      void requestInterrupt(true);
    };
    document.addEventListener('terminal-stop', onTerminalStop);

    const submitCommand = async (rawCmd: string) => {
      const trimmed = rawCmd.trim();
      if (!trimmed) {
        writePrompt(term, cwdRef);
        return;
      }

      histArr.current = [trimmed, ...histArr.current.slice(0, 49)];
      histPos.current = -1;

      const low = trimmed.toLowerCase();
      if (low === 'clear' || low === 'cls') {
        term.clear();
        writePrompt(term, cwdRef);
        return;
      }

      const cdMatch = trimmed.match(/^cd\s+(.+)$/i);
      if (cdMatch) {
        const target = cdMatch[1].trim();
        const cwd = cwdRef.current;
        const newCwd =
          target === '..'
            ? cwd.replace(/[\\/][^\\/]+$/, '') || cwd
            : /^[A-Za-z]:/.test(target)
              ? target
              : `${cwd}\\${target}`;
        cwdRef.current = newCwd;
        term.writeln(`\x1b[36m切换到: ${newCwd}\x1b[0m`);
        writePrompt(term, cwdRef);
        return;
      }

      const lowExe = low;
      const isExe = lowExe.endsWith('.exe');
      if (isExe) {
        const cwd = cwdRef.current;
        const hasPath = /^[A-Za-z]:[\\/]/.test(trimmed) || /[\\/]/.test(trimmed) || trimmed.startsWith('./') || trimmed.startsWith('../');
        const exePath = hasPath ? trimmed : (cwd ? `${cwd}\\${trimmed}` : trimmed);
        await runExecutable(exePath, cwdRef.current);
        return;
      }

      term.writeln(`\x1b[90m> ${trimmed}\x1b[0m`);
      try {
        await invoke('run_terminal_command', { cmd: trimmed, cwd: cwdRef.current });
      } catch (e) {
        term.writeln(`\x1b[31m错误: ${e}\x1b[0m`);
        writePrompt(term, cwdRef);
      }
    };

    const runExecutable = async (exePath: string, runCwd: string) => {
      if (runCwd) cwdRef.current = runCwd;
      if (ptyForwardRef.current) {
        await requestInterrupt(true);
      }
      currentExePathRef.current = exePath;
      term.writeln(`\x1b[36m> ${exePath}\x1b[0m`);
      resetPtyStripState();
      fit.fit();
      const rows = Math.max(1, term.rows || 24);
      const cols = Math.max(1, term.cols || 80);
      ptyForwardRef.current = true;
      emitRunningState(true);
      try {
        await invoke('run_executable', {
          exePath,
          cwd: runCwd || cwdRef.current,
          sourcePath: currentSourcePathRef.current,
          rows,
          cols,
        });
      } catch (e) {
        ptyForwardRef.current = false;
        emitRunningState(false);
        term.writeln(`\x1b[31m错误: ${e}\x1b[0m`);
        writePrompt(term, cwdRef);
        redrawInputLine(term, cwdRef, lineBuf);
      }
    };

    runExeRef.current = (exePath, runCwd) => {
      void runExecutable(exePath, runCwd);
    };

    term.writeln('\x1b[36m终端已就绪。输入命令后按 Enter 执行。\x1b[0m');
    writePrompt(term, cwdRef);

    term.onData((data) => {
      const t = termRef.current;
      if (!t) return;

      if (ptyForwardRef.current) {
        void invoke('pty_write', { data }).catch(() => {});
        return;
      }

      if (data === '\x1b[A') {
        if (histArr.current.length === 0) return;
        histPos.current = Math.min(histPos.current + 1, histArr.current.length - 1);
        lineBuf.current = histArr.current[histPos.current];
        redrawInputLine(t, cwdRef, lineBuf);
        return;
      }
      if (data === '\x1b[B') {
        histPos.current = Math.max(histPos.current - 1, -1);
        lineBuf.current = histPos.current < 0 ? '' : histArr.current[histPos.current];
        redrawInputLine(t, cwdRef, lineBuf);
        return;
      }
      if (data === '\x1b[C' || data === '\x1b[D') return;

      if (data === '\r' || data === '\n') {
        const cmd = lineBuf.current;
        lineBuf.current = '';
        histPos.current = -1;
        t.write('\r\n');
        void submitCommand(cmd);
        return;
      }

      if (data === '\x7f' || data === '\b') {
        if (lineBuf.current.length > 0) {
          lineBuf.current = lineBuf.current.slice(0, -1);
          t.write('\b \b');
        }
        return;
      }

      if (data.charCodeAt(0) === 0x1b) return;

      for (const ch of data) {
        const code = ch.charCodeAt(0);
        if (code === 13 || code === 10) break;
        if (code >= 32 || code === 9) {
          lineBuf.current += ch;
          t.write(ch);
        }
      }
    });

    const ro = new ResizeObserver(() => {
      fitRef.current?.fit();
      const tt = termRef.current;
      if (tt && ptyForwardRef.current) {
        const r = Math.max(1, tt.rows || 24);
        const c = Math.max(1, tt.cols || 80);
        void invoke('pty_resize', { rows: r, cols: c }).catch(() => {});
      }
    });
    ro.observe(el);
    requestAnimationFrame(() => fit.fit());

    return () => {
      document.removeEventListener('terminal-stop', onTerminalStop);
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => {
      fitRef.current?.fit();
      termRef.current?.focus();
    });
  }, [visible]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const dbg = (_msg: string) => {};

    const handleChunk = (event: { payload: TerminalChunkPayload }) => {
      const t = termRef.current;
      if (!t) return;
      const payload = event.payload as TerminalChunkPayload | null;
      if (!payload) return;
      const data = String(payload.data ?? '');

      if (payload.stream === 'meta' && data.startsWith('__MINIC_DEBUG__')) {
        const msg = data.replace('__MINIC_DEBUG__', '');
        dbg(msg);
        return;
      }

      if (payload.stream === 'meta' && data.startsWith('__MINIC_EXIT_CODE__')) {
        ptyForwardRef.current = false;
        emitRunningState(false);
        resetPtyStripState();
        const code = parseInt(data.replace('__MINIC_EXIT_CODE__', ''), 10);
        const exit = Number.isNaN(code) ? -1 : code;
        const color = exit === 0 ? '36' : '31';
        t.writeln(`\x1b[${color}m[exit ${exit}]\x1b[0m`);
        redrawInputLine(t, cwdRef, lineBuf);
        return;
      }

      if (typeof payload.b64 === 'string' && payload.b64.length > 0) {
        try {
          t.write(b64ToBytes(payload.b64));
        } catch {
          // Ignore malformed payloads.
        }
        return;
      }

      const rendered = stripPtyChunkIncremental(data, ptyStripStateRef, ptyCrPendingRef);
      if (ptyForwardRef.current && renderDbgCountRef.current < 12) {
        const sample = rendered
          .replace(/\r/g, '\\r')
          .replace(/\n/g, '\\n')
          .slice(0, 120);
        dbg(
          `rendered chunk#${renderDbgCountRef.current + 1} len=${rendered.length} mode=${ptyStripStateRef.current.mode} sample='${sample}'`
        );
        renderDbgCountRef.current += 1;
      }
      if (!rendered) return;
      t.write(rendered);
    };

    const attachListener = async (attempt = 0) => {
      if (cancelled) return;
      try {
        const disposer = await listen<TerminalChunkPayload>('terminal-output-chunk', handleChunk);
        if (cancelled) {
          disposer();
          return;
        }
        unlisten = disposer;
        dbg(`terminal-output-chunk listener attached (attempt ${attempt + 1})`);
      } catch {
        if (cancelled) return;
        dbg(`listener attach failed (attempt ${attempt + 1})`);
        if (attempt >= 20) return;
        retryTimer = setTimeout(() => {
          void attachListener(attempt + 1);
        }, 100);
      }
    };

    dbg('attaching terminal-output-chunk listener');
    void attachListener();

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const { cwd: newCwd, type, exePath, sourcePath } = (e as CustomEvent).detail ?? {};
      if (newCwd) cwdRef.current = newCwd;
      currentSourcePathRef.current = typeof sourcePath === 'string' ? sourcePath : null;
      if (type === 'exe' && exePath) {
        setTimeout(() => runExeRef.current(exePath, newCwd || cwdRef.current), 50);
      }
    };
    document.addEventListener('terminal-run', handler);
    return () => document.removeEventListener('terminal-run', handler);
  }, []);

  return (
    <div className="terminal" onMouseDown={() => termRef.current?.focus()}>
      <div ref={hostRef} className="terminal-xterm-host" />
    </div>
  );
};

export default Terminal;
