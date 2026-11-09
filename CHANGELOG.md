# Changelog

All notable changes to the "LabWindows/CVI Tools" extension will be documented in this file.

## [0.0.16] - 2026-11-09

### Added
- **Parameterized Settings Navigation**:
  - Enhanced `labwindowsCvi.editTargetSettings` and `labwindowsCvi.editBuildSettings` to accept an optional target tab ID (e.g. `'build'`, `'dependencies'`), enabling direct programmatic and contextual jumps into specific settings sections.
- **Roadmap & Milestone Tracking**:
  - Added comprehensive `TODO.md` tracking all completed UX/UI items and outlining upcoming architectural features (Build options completion, alternative compilers, auto-saving settings, removing "Open in CVI" buttons, custom build configurations, and installer generation).

### Changed
- **Direct Tab Navigation from CVI Actions**:
  - Clicking **Build steps** in the "CVI Actions" view now opens CVI Project Settings directly focused on the **Build steps** tab (Pre-build, Custom-build, and Post-build actions).
  - Clicking **Dependencies** in the "CVI Actions" view now opens CVI Project Settings directly focused on the **Dependencies** tab (Project dependencies and build order).
  - Implemented bidirectional Webview messaging (`activatePage`) ensuring that clicking an action immediately reveals, switches to, and scrolls to the target tab even if the settings panel is already open in the background.
  - Eliminated UI flicker on initial panel load by generating HTML pre-scoped to the requested tab instead of defaulting to Overview.

## [0.0.15] - 2026-11-09

### Changed
- **Show Full Pathnames Menu Action**:
  - Updated context menu and title bar action label to "Show Full Pathnames" with dynamic checkmark (`✓ Show Full Pathnames`) when pathnames are toggled on.
- **Home Page Activation & Startup Guard**:
  - Fixed duplicate Home page tab creation when opening a CVI workspace from an empty VS Code window.
  - Prevented automatic Home page opening on startup when a VS Code workspace is loaded, preserving the existing editor layout and tab state.
- **Interactive CVI Actions View**:
  - Streamlined the "CVI Actions" view by converting read-only status rows into interactive, clickable actions:
    - *Build Mode*: triggers build mode selection.
    - *Target Type*: triggers target type selection.
    - *Command Line Arguments*: interactive prompt to view and edit command line parameters.
    - *Working Directory*: interactive prompt with file-system folder picker to set the execution working directory.
    - *Environment Variables*: interactive prompt to set custom execution environment variables.
  - Added contextual edit buttons on hover for immediate configuration.

### Removed
- **Safe Mode Fallback Options**:
  - Completely removed obsolete "Safe Mode" commands (`labwindowsCvi.editTargetSettingsSafeMode`, `labwindowsCvi.editBuildSettingsSafeMode`, `labwindowsCvi.editBuildOptionsSafeMode`) and their toolbar buttons across Target Settings, Build Settings, and Build Options panels.

## [0.0.14] - 2026-11-09

### Removed
- **Redundant "Open the CVI home page" Action**:
  - Removed duplicate action link from empty workspace explorer view welcome content. The Home page remains accessible via the title bar and status bar home actions.

### Added
- **Home Page Single-Instance Activation Guard**:
  - Implemented `WebviewPanelSerializer` to restore existing Home page instances across window reloads without duplicating tabs.
  - Added startup guard preventing duplicate tabs and redundant focus stealing on extension activation.
- **Recent Workspaces & Projects Management**:
  - Added global history tracking for recently opened CVI workspaces (`.cws`) and projects (`.prj`).
  - Added interactive "Recent workspaces and projects" section to the CVI Home page with quick opening and item removal.
  - Added `labwindowsCvi.openRecent` quick-pick command (`$(history)`) with inline removal and clear-all actions.
  - Implemented intelligent associated workspace detection for standalone `.prj` files with configurable behavior (`labwindowsCvi.openProjectWorkspaceBehavior`: `prompt`, `openWorkspace`, or `openStandalone`).
- **Project Tree View: Native CVI Layout, Ordering & Drag-and-Drop**:
  - Eliminated synthetic/automatic folder hierarchies in favor of faithful LabWindows/CVI virtual folders matching `.prj` declarations.
  - Files not assigned to a folder or marked `Not In A Folder` are placed directly at the project root.
  - Exact preservation of folder and file order matching `.prj` sequence (`[Folders]` and `[File XXXX]` declarations) without alphabetical sorting.
  - Added manual reordering commands (`labwindowsCvi.moveItemUp`, `labwindowsCvi.moveItemDown`) with `Alt+Up` / `Alt+Down` shortcut support.
  - Added full drag-and-drop reordering: drag files before other files or into virtual folders/root; reorder virtual folders in `[Folders]`.
  - Added context menu and title bar toggle for **Full File Paths** (`labwindowsCvi.toggleShowFullFilePaths` / `labwindowsCvi.showFullFilePaths`) switching between file name only and complete path display.
  - Added multi-select batch support for contextual file actions (exclude, include, remove, toggle `.obj` compile, move to folder).

## [0.0.13] - 2026-11-05

### Added
- **Explicit Checkmarks for Outline Settings**:
  - Added visible checkmark symbols (`✓`) for active states in the Outline menu (`✓ Follow Cursor`, `✓ Filter on Type`, `✓ Sort By: ...`).
- **Outline Filter on Type & Focus Preservation**:
  - Added dedicated **Filter on Type** interactive filtering action allowing real-time symbol search.
  - Configured symbol selection with `preserveFocus: true` so clicking an outline item reveals the code without moving keyboard focus away from the Outline view into the editor.

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

## [0.0.11] - 2026-11-04

### Added
- **Live CVI Resource Tracking & Tree View**:
  - Added dedicated **CVI Resource Tracking** view in the Run & Debug sidebar container (`labwindowsCvi.resourceTracking`).
  - Hierarchical tracking for all CVI subsystems: Dynamic Memory, User Interface & Panels, File & System Handles, Threads & Synchronization, and Communication.
  - Live resource inspection on breakpoints, stepping, and paused execution with automatic refresh (`labwindowsCvi.resourceTracking.autoRefreshOnBreakpoint`).
  - Allocation details breakdown: physical memory addresses, exact byte sizes, resource identifiers, calling source file and line number ranges.
  - Markdown resource report generator and manual refresh/clear actions.
- **Variable Name Resolution**:
  - Correlated raw CVI heap dump pointers with active stack frame symbols (`info locals`, `info args`) and DWARF debug records.
  - Replaced anonymous hexadecimal memory addresses with actual variable names (e.g. `leakedString (0x000000000047D58F0) 256 B`).
- **Artifact-Free Diagnostic Dumping (OS VirtualAlloc Bypass)**:
  - Bypassed CVI's CRT allocation hooks by allocating diagnostic dump buffers using Windows kernel `VirtualAlloc`.
  - Permanently eliminated the 65-byte phantom memory leak previously caused by GDB inferior function calls (`infcall`) allocating string paths via the debuggee CRT heap.
- **Non-Intrusive Program Exit Leak Trapping**:
  - Implemented dual-trap architecture at program teardown: silent trap on `CloseCVIRTE()` and dynamic address trapping on `main()` return (`ret`).
  - Automated exit leak notifications (`labwindowsCvi.resourceTracking.notifyOnLeaks`) differentiating between clean exits (0 leaks) and unreleased resources.
- **Runtime Error Interception & Visual Editor Diagnostics**:
  - Intercepted LabWindows/CVI compiler runtime checks (uninitialized local variables, array bounds violations, assertions: `ReportUPError`, `_UPLibReportError`, `_UPLibBreakpoint`, `CVIAssert`).
  - Prevented modal Windows dialogs (*"Non-Fatal Run-time Error"*) and external CVI IDE invocation by automatically popping the error frame using GDB `return`.
  - Configured Microsoft MIEngine with `unknownBreakpointHandling: "stop"`, eliminating disruptive VS Code red exception callout boxes.
  - Added persistent in-editor line decoration (`TextEditorDecorationType`) highlighting the offending source line with soft-red background, overview ruler marker, and inline badge (`⚠️ [LabWindows/CVI Run-Time Error Check Failed]`).
  - Auto-clearing of error decorations on resume (Continue, Step, Restart, Stop).
  - Formatted diagnostic banners emitted to the VS Code Debug Console.
- **Architecture Documentation**:
  - Added comprehensive technical reference in `RESOURCE_TRACKING.md` detailing CVI runtime internals (`cvirte.dll`), GDB integration, and diagnostic workflows.

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
