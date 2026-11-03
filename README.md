# LabWindows/CVI Tools

A Visual Studio Code extension to manage, build, and debug **National Instruments LabWindows™/CVI™** workspaces and projects directly from VS Code.

---

> ### Introduction
>
> This project was born as an experiment: to explore whether it is genuinely possible to create a modern, productive, and lightweight alternative to the native National Instruments LabWindows/CVI IDE within Visual Studio Code.
>
> This journey would never have started without discovering the outstanding work of **Jerry Crozet** (author of *JC Tools* / *JC Lib*), to whom we owe immense gratitude for paving the way and proving that modernizing the CVI developer experience was achievable.
>
> As this is our very first open-source project on GitHub, we don't know yet how far we will be able to go. What is certain is that embarking on this endeavour and bringing it to life would never have been possible without the assistance of modern AI engineering tools supporting us along the way.

---

## Overview

**LabWindows/CVI Tools** brings modern developer ergonomics to ANSI C development in NI LabWindows/CVI environments. It enables seamless workspace browsing, automated builds, compiler diagnostics, and integrated debugging without having to manually craft complex `tasks.json` or `launch.json` configurations.

### Key Features

- **Workspace & Project Management**:
  - Open, create, and manage `.cws` workspaces and `.prj` projects.
  - Multi-project workspace support (EXE, DLL, static library).
  - Manage logical CVI folders, project files, and include/exclude flags.
  - Discover local CVI installations automatically or define custom toolchain paths.

- **Target Settings & Build Options**:
  - Native UI dialogs for project Target Settings and compiler Build Options with Safe Mode support.
  - Complete catalog of all 139 Clang 3.3 compiler warnings with interactive search, enable/disable, and error promotion.
  - Automatic C/C++ IntelliSense synchronization (c_cpp_properties.json) with project compiler defines and C99 mode.

- **Build Pipeline & Diagnostics**:
  - Direct execution of `compile.exe` for projects, individual source files, and entire workspaces.
  - Native build settings synchronization: pre-build, post-build, and custom build steps.
  - Inline error and warning diagnostics parsed into the VS Code Problems view.

- **Integrated Debugging**:
  - **VS Code Run & Debug Integration**: Native launch configuration provider (`cvi`) with F5 shortcut support.
  - **Native GDB Pipeline**: Automated DWARF symbol generation and GDB debug adapter bridge.

- **Editor Helpers & Tools**:
  - Integrated CVI API & Library Explorer (derived from JC Lib).
  - CVI-aware editor snippets and Doxygen-ready function headers.
  - Color value picker supporting `MakeColor(r, g, b)`, hex, RGB integers, and web color codes.
  - Base conversion utilities (decimal, hex, binary).

---

## Requirements

- **Visual Studio Code** `^1.90.0`
- **National Instruments LabWindows/CVI** (e.g. CVI 2013, 2017, 2020 or newer) installed on Windows.
- *(Recommended for native debugging)*: [C/C++ Extension for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools).

---

## Getting Started

1. Open a directory containing your LabWindows/CVI workspace (`.cws`) or project (`.prj`) in VS Code.
2. Click on the **LabWindows/CVI** icon in the Activity Bar.
3. The **CVI Workspace** view displays your project structure and build targets.
4. Use the **CVI Actions** view or status bar items to trigger Build, Rebuild, Run, or Debug commands.

---

## Disclaimer & Trademark Notice

> **Important Notice:**
>
> **LabWindows™**, **LabWindows/CVI™**, and **NI™** are trademarks or registered trademarks of **National Instruments Corporation** (an Emerson company).
>
> This extension is an independent open-source project and is **not** endorsed by, affiliated with, sponsored by, or associated in any way with National Instruments Corporation. All trademarks and registered trademarks belong to their respective owners.

---

## License

This project is licensed under the [MIT License](LICENSE).

- Copyright (c) 2026 DrSurfer
- Portions Copyright (c) 2026 JC Tools
