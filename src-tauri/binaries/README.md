# `src-tauri/binaries` Notice

This directory only keeps legacy local TCC files from the old toolchain layout.

Current project policy:
- GCC/MinGW is the active build/runtime compiler path.
- Installer resources now come from `src-tauri/resources/mingw/`.
- Files in this directory stay ignored by Git by default.
- You can keep or remove local TCC files as needed; current builds do not depend on them.
