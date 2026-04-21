const CPP_EXTENSIONS = new Set(['cpp', 'cc', 'cxx', 'h', 'hpp', 'hh', 'hxx']);
const C_EXTENSIONS = new Set(['c']);

export const getEditorLanguageFromFileName = (name: string): string => {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0 || dot === lower.length - 1) return 'plaintext';
  const ext = lower.slice(dot + 1);
  if (CPP_EXTENSIONS.has(ext)) return 'cpp';
  if (C_EXTENSIONS.has(ext)) return 'c';
  if (ext === 'json') return 'json';
  if (ext === 'md') return 'markdown';
  return 'plaintext';
};

export const COMPILE_ERROR_LOCATION_RE = /^(.+\.(?:c|h|cc|hh|cpp|hpp|cxx|hxx)):(\d+)(?::\d+)?:/i;
