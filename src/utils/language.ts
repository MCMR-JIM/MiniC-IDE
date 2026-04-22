const CPP_SOURCE_EXTENSIONS = new Set(['cpp', 'cc', 'cxx']);
const HEADER_EXTENSIONS = new Set(['h', 'hpp', 'hh', 'hxx']);
const C_SOURCE_EXTENSIONS = new Set(['c']);

const getFileExtension = (name: string): string => {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0 || dot === lower.length - 1) return '';
  return lower.slice(dot + 1);
};

export const getEditorLanguageFromFileName = (name: string): string => {
  const ext = getFileExtension(name);
  if (!ext) return 'plaintext';
  if (CPP_SOURCE_EXTENSIONS.has(ext) || HEADER_EXTENSIONS.has(ext)) return 'cpp';
  if (C_SOURCE_EXTENSIONS.has(ext)) return 'c';
  if (ext === 'json') return 'json';
  if (ext === 'md') return 'markdown';
  return 'plaintext';
};

export const isCompilableSourceFileName = (name: string): boolean => {
  const ext = getFileExtension(name);
  return C_SOURCE_EXTENSIONS.has(ext) || CPP_SOURCE_EXTENSIONS.has(ext);
};

export const isHeaderFileName = (name: string): boolean => HEADER_EXTENSIONS.has(getFileExtension(name));

export const COMPILE_ERROR_LOCATION_RE = /^(.+\.(?:c|h|cc|hh|cpp|hpp|cxx|hxx)):(\d+)(?::\d+)?:/i;
