<div align="center">
  <h1>MiniC IDE</h1>
  <p>面向 C / C++ 教学与练习场景的轻量桌面 IDE</p>
  <p>
    <img alt="version" src="https://img.shields.io/badge/version-1.1.1-0e639c">
    <img alt="platform" src="https://img.shields.io/badge/platform-Windows-0078d4">
    <img alt="tauri" src="https://img.shields.io/badge/Tauri-2.x-24c8db">
    <img alt="react" src="https://img.shields.io/badge/React-19-61dafb">
    <img alt="typescript" src="https://img.shields.io/badge/TypeScript-5.x-3178c6">
  </p>
</div>

## 项目简介

MiniC IDE 是一个基于 `Tauri + React + TypeScript + Rust` 的桌面 IDE，主要面向 C / C++ 教学、课程实验与日常练习。

它强调开箱即用的本地开发体验：编辑、编译、运行、终端、文件树、查找替换，以及基于 GitHub Releases 的应用内更新都集成在同一个桌面应用里。

## 功能特性

- 使用 Monaco Editor 编辑 C / C++ 源文件与头文件
- 基于 GCC / g++（MinGW）完成编译与运行
- 集成输出面板与交互终端
- 支持文件树浏览、创建、重命名、删除与资源管理器定位
- 支持拖拽打开文件、拖拽打开项目、拖拽复制文件到项目
- 支持查找 / 替换
- 支持中文路径下的编译与运行
- 支持基于 GitHub Releases 的应用内更新

## 适用平台

- 当前主要面向 Windows 使用
- 当前打包目标为 NSIS 安装包

## 快速开始

### 下载使用

如果你只是想使用 MiniC IDE，直接从 GitHub Releases 下载最新安装包即可。

### 本地开发

安装依赖：

```bash
npm install
```

启动桌面开发模式：

```bash
npm run tauri dev
```

仅构建前端：

```bash
npm run build
```

### 打包构建

生成桌面安装包：

```bash
npm run tauri build
```

Windows NSIS 安装包默认输出目录：

```text
src-tauri/target/release/bundle/nsis/
```

## 自动更新

项目已接入 Tauri Updater，更新源为 GitHub Releases。

当前行为：

- 应用启动后会自动检查更新
- 也可以通过 `帮助 -> 检查更新...` 手动检查
- 发现更新后会在右下角显示非打断式提示
- 安装更新前会检查运行中的程序和未保存文件

## 快捷键

| 快捷键 | 说明 |
| --- | --- |
| `F5` | 编译并运行 |
| `F6` | 仅编译 |
| `F7` | 停止运行 |
| `Ctrl + S` | 保存 |
| `Ctrl + O` | 打开文件 |
| `Ctrl + N` | 新建文件 |
| `Ctrl + F` | 查找 |
| `Ctrl + H` | 替换 |
| `Ctrl + B` | 切换侧边栏 |
| ```Ctrl + ` ``` | 切换输出面板 |
| `Ctrl + 鼠标滚轮` | 编辑器缩放 |

## 技术栈

- 前端：React 19、TypeScript、Vite、Zustand、Monaco Editor、xterm.js
- 后端：Rust、Tauri 2
- 编译工具链：MinGW-w64 / GCC / g++
- 更新分发：GitHub Releases + Tauri Updater

## 运行环境

- Node.js 18+，建议 20+
- Rust stable
- Windows
- 可用的 MinGW-w64 工具链

> 如果系统环境中没有可用的 `gcc` / `g++`，也可以将 `mingw/bin` 放到应用目录资源中随应用分发。

## 项目结构

```text
src/                         前端界面与交互逻辑
src/components/              界面组件
src/store/                   Zustand 状态管理
src/utils/                   前端工具函数
src-tauri/                   Rust 后端、Tauri 配置、资源与打包逻辑
src-tauri/resources/mingw/   随应用分发的 MinGW 资源目录
scripts/                     资源处理脚本
```
