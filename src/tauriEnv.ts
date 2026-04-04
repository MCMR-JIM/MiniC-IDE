export const isTauriRuntime = (): boolean => {
  const w = window as unknown as {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return typeof w.__TAURI_INTERNALS__ !== 'undefined' || typeof w.__TAURI__ !== 'undefined';
};
