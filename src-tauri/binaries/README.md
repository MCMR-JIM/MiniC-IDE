# `src-tauri/binaries` Notice

This directory is intentionally ignored by Git.

Reason:
- It contains third-party runtime/compiler binaries.
- Redistribution/licensing obligations may vary by component and version.

Project policy:
- Keep binaries local in development.
- Do not commit vendor binaries to this repository by default.
- Before distribution, verify the license terms of each binary you bundle.

Required local files for current build configuration:
- `tcc-x86_64-pc-windows-msvc.exe`
- `libtcc.dll`
- `tcc-include/`
- `tcc-lib/`
