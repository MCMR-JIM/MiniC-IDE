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

export const formatSource = async (content: string, path: string): Promise<string> => {
  await ensureReady();
  return format(content, clangFilenameForPath(path), LLVM_STYLE);
};
