# Changelog

All notable changes to the "LabWindows/CVI Tools" extension will be documented in this file.

## [0.0.1] - 2026-11-02

### Added
- **Native Debugging Architecture Guide**: Added comprehensive documentation in `NATIVE_DEBUGGING.md` detailing the DWARF 4 pipeline, PE/COFF section name resolution, and native GDB vs. MSVC CodeView PDB integration.
- **Custom Branding Assets**:
  - Dedicated monochromatic Activity Bar / sidebar icon (`media/cvi-tools.svg`).
  - Full-color Home Page hero and header branding icon (`media/cvi-tools-hero.svg`) with optional light/dark variant support.

### Changed
- **Home Page UX/UI Redesign**:
  - Replaced hardcoded inline SVG with dynamic file-based icon loading from `media/`.
  - Removed button background from top header title logo.
  - Relocated GitHub repository link to header-left alongside title logo.
  - Removed circular frame and shadow around the main hero logo, scaling icon proportionally to 74x74 px.
  - Added optional automatic home page display on VS Code startup (`labwindowsCvi.showHomeOnStartup`).
- **Build & Packaging Automation**:
  - Localized `build.cmd` to English.
  - Removed interactive pauses and added immediate error aborts preventing failed installs.
  - Automated package name and version resolution directly from `package.json`.

## [0.0.0] - 2026-10-30

### Initial Baseline Release
- Initial baseline snapshot establishing the standalone **LabWindows/CVI Tools** repository (`labwindows-cvi-tools`).
- **Workspace & Project Management**:
  - Full support for `.cws` workspaces and `.prj` projects (EXE, DLL, static library).
  - CVI folder hierarchy, file inclusion/exclusion, and build target selection.
  - Automatic detection of local National Instruments LabWindows/CVI installations.
- **Build System**:
  - Direct compilation and rebuild integration via `compile.exe`.
  - Synchronization of CVI-native pre-build, post-build, and custom build steps.
  - Compiler error/warning diagnostics reported directly in VS Code.
- **Debugging**:
  - Dedicated `cvi` debug configuration provider with Run & Debug UI and F5 shortcut integration.
  - Native GDB debugging pipeline with automated DWARF symbol conversion.
  - MSVC toolchain and PDB symbol generation support.
  - ActiveX / DDE automation bridge for the native CVI IDE debugger with VS Code Debug Adapter Protocol (DAP).
- **CVI Libraries & API Explorer**:
  - Embedded library pack management and interactive visual editor for CVI API symbols.
  - C header parsing (`.h`) to import prototypes and symbols into JSON library packs.
  - Reverse generation of C headers (`.h`) from library packs.
- **Clean-up & Pure C / CVI Focus**:
  - Removed obsolete multi-language packs, legacy test scripts, and mock runners.
  - Removed extraneous `my_util` templates and non-C execution starters to keep the extension strictly focused on ANSI C and LabWindows/CVI.
