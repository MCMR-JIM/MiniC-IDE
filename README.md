# MiniC IDE

MiniC IDE 是一个面向 C 语言教学/练习的桌面 IDE（Tauri + React + TypeScript + Rust）。

当前版本：`1.0.0`

## 功能概览

- C/C++ 文件编辑（Monaco）
- 编译与运行（GCC / g++）
- 终端输出与输入
- 文件树操作（新建、重命名、删除、在资源管理器中打开）
- 查找替换

## 快捷键

- `F5`：编译并运行
- `F6`：仅编译
- `F7`：停止运行
- `Ctrl + S`：保存
- `Ctrl + O`：打开文件
- `Ctrl + N`：新建文件
- `Ctrl + F`：查找
- `Ctrl + H`：替换
- `Ctrl + 鼠标滚轮`：编辑器缩放

## 开发环境

- Node.js 18+（建议 20+）
- Rust stable
- Windows（当前打包目标为 NSIS 安装包）
- MinGW-w64（需可用 `g++`，或将 `mingw/bin` 放在应用目录下）

## 本地开发

```bash
npm install
npm run tauri dev
```

## 构建发布

```bash
npm run tauri build
```

安装包默认输出到：

`src-tauri/target/release/bundle/nsis/`

## 目录说明

- `src/`：前端界面（React）
- `src-tauri/`：后端命令、打包配置、资源
- `src-tauri/resources/mingw/`：随应用分发的 MinGW 编译器资源（工具链本体默认不入库）
- `src/utils/`：前端通用工具函数
- `scripts/`：图标/资源处理脚本
