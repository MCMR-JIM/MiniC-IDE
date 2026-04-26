# Local Release

This project ships a bundled MinGW toolchain from `src-tauri/resources/mingw/`.

That payload is intentionally not committed to git, so cloud CI cannot produce a correct installer by itself.
Release from a local machine that already has the full `mingw` payload in place.

## Steps

1. Ensure `src-tauri/resources/mingw/bin/gcc.exe` and `src-tauri/resources/mingw/bin/g++.exe` exist.
2. Update the app version in:
   - `package.json`
   - `package-lock.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/Cargo.lock`
   - `src-tauri/tauri.conf.json`
   - `README.md` when the badge version changes
3. Build locally:

```powershell
npm run tauri build
```

4. Publish with `gh`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\release-local.ps1
```

Optional:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\release-local.ps1 -Version 1.2.0 -NotesFile .\docs\release-notes\v1.2.0.md
```

The script publishes:

- the NSIS installer from `src-tauri/target/release/bundle/nsis/`
- a generated `latest.json` for the GitHub Releases static updater endpoint
- matching `.sig` files when present

Notes:

- Tauri v2 on Windows generates the installer and `.sig`, but does not automatically emit the GitHub-style `latest.json`.
- `scripts/release-local.ps1` generates `latest.json` from the built installer, its `.sig`, the current tag, and the provided release notes before publishing.
