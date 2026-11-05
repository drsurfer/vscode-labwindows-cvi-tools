# Changelog

All notable changes to the "LabWindows/CVI Tools" extension will be documented in this file.

## [0.0.12] - 2026-11-05

### Added
- **Outline View (PlatformIO Style)**:
  - Renamed "CVI File Symbols" view to **Outline**.
  - Extracted `#define` preprocessor macros with dedicated constant/macro icon.
  - Extracted global and file-static variables outside function bodies with variable icon.
  - Compact parameter type formatting (e.g. `panelCB(int, int, void *, int, int)` and `main(int, char * [])`).
  - Distinct `declaration` description tag for function prototypes.
  - Added **Follow Cursor** mode synchronizing outline selection with active editor cursor position.
  - Added **Sort By** options: Position (file order), Name (A-Z), and Category (Macros -> Variables -> Functions).
  - Registered `DocumentSymbolProvider` for C/C++ files, activating native VS Code Outline with integrated **Filter on Type**.

## [0.0.2] - 2026-11-02

### Added
- **Native LabWindows/CVI Build Options Dialog**:
  - Added interactive Webview dialog for CVI Build Options (labwindowsCvi.editBuildOptions) and Safe Mode fallback (labwindowsCvi.editBuildOptionsSafeMode).
  - Multi-configuration support (Debug, Release, Debug64, Release64, or All Configurations).
  - Code generation controls: default calling convention (cdecl, stdcall), stack reserve and commit sizes, 32-bit & 64-bit image base addresses (with hexadecimal display), optimization levels, and execution profiling.
  - Debugging options: debugging levels (None, Standard, Extended) and run-time uninitialized locals detection (persisted to .cws).
  - C language features: C99 extensions and OpenMP multi-threading toggle.
  - Include files: precompiled header include configuration with interactive file picker.
  - Compiler defines: macro definitions field with interactive modal for predefined compiler macros (_CVI_, _NI_mswin32_, _WIN64, etc.).
- **Clang 3.3 Compiler Warnings Catalog**:
  - Integrated complete catalog of 139 Clang 3.3 compiler warnings matching National Instruments compile.exe internal definitions.
  - Searchable warning management dialog with real-time text filter, individual enable/disable switches, error promotion (-Werror), level default restoration, and detailed descriptions.
  - Strict roundtrip serialization into .prj (Warning List <Level>, Error List <Level>).
- **C/C++ IntelliSense Synchronization**:
  - Automatically propagates project compiler defines (/D..., -D...) and C99 settings into .vscode/c_cpp_properties.json.

### Changed
- **Target Settings vs. Build Options Realignment**:
  - Renamed previous build settings to **Target Settings** (labwindowsCvi.editTargetSettings, labwindowsCvi.editTargetSettingsSafeMode) to match official LabWindows/CVI nomenclature.
  - Preserved backward-compatible command aliases for labwindowsCvi.editBuildSettings.

## [0.0.1] - 2026-11-02

### Added
- **Native Debugging Architecture Guide**: Added comprehensive documentation in `NATIVE_DEBUGGING.md` detailing the DWARF 4 pipeline, PE/COFF section name resolution, and native GDB vs. MSVC CodeView PDB integration.
- **Custom Branding Assets**:
  - Dedicated monochromatic Activity Bar / sidebar icon (`media/cvi-tools.svg`).
  - Full-color Home Page hero and header branding icon (`media/cvi-tools-hero.svg`) with optional light/dark variant support.

### Removed
- **DDE / ActiveX Automation Bridge**: Fully decommissioned legacy DDE and ActiveX command bridges (`cvi-dde-command.ps1`, `cvi-activex-command.ps1`, `cviNativeCommandService.ts`, `cviBreakpointSyncService.ts`).
- **Sidebar "CVI Debug" View**: Removed redundant CVI Debug sidebar panel (`labwindowsCvi.debugControls`) and associated menu/status bar actions.
- **Legacy "Debug in CVI"**: Replaced external IDE debug actions with native VS Code GDB debugging.
- **Experimental MSVC PDB Pipeline**: Removed non-functional MSVC link service and PDB generation stubs.

### Added
- **CVI Project Settings Debug Button**: Added dedicated **Debug** button in the *Build and run* section of the CVI Project Settings control center.

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
