import init, { format } from '@wasm-fmt/clang-format/vite';

const LLVM_STYLE =
  '{BasedOnStyle: LLVM, IndentWidth: 4, TabWidth: 4, UseTab: Never, ColumnLimit: 0}';

let initPromise: Promise<void> | null = null;

const ensureReady = (): Promise<void> => {
  if (!initPromise) {
    initPromise = init().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
};

const clangFilenameForPath = (path: string): string => {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot + 1) : '';
  switch (ext) {
    case 'c':
      return 'main.c';
    case 'cc':
      return 'main.cc';
    case 'cxx':
      return 'main.cxx';
    case 'cpp':
      return 'main.cpp';
    case 'h':
    case 'hpp':
    case 'hh':
    case 'hxx':
      return 'main.hpp';
    default:
      return 'main.cpp';
  }
};

/**
 * Clean up paste artifacts that break clang-format. Code copied from a rendered
 * web page / chat helper (e.g. 网页版微信) can carry literal HTML line-break
 * tags, HTML entities, non-breaking spaces or zero-width characters. These make
 * the source look normal on screen but leave it without real line breaks or with
 * invisible junk, so clang-format ends up doing nothing (or fails to parse).
 */
export const sanitizeSource = (src: string): string => {
  let s = src;
  // Zero-width / BOM characters.
  s = s.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '');
  // Non-breaking spaces -> normal space.
  s = s.replace(/\u00A0/g, ' ');
  // Literal HTML line-break tags -> real newline.
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // HTML non-breaking-space entity.
  s = s.replace(/&nbsp;/gi, ' ');
  return s;
};

export const formatSource = async (content: string, path: string): Promise<string> => {
  await ensureReady();
  const cleaned = sanitizeSource(content);
  return format(cleaned, clangFilenameForPath(path), LLVM_STYLE);
};
