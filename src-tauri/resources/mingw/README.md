This folder is used to bundle a portable MinGW toolchain into the installer.

Expected runtime layout:

- mingw/bin/g++.exe
- mingw/bin/gcc.exe
- mingw/libexec/...
- mingw/lib/...
- mingw/x86_64-w64-mingw32/...

For local release builds, copy your MinGW distribution into this folder before running:

`npm run tauri build`

The actual toolchain files are intentionally ignored by git.
