# Changelog

All notable changes to the "LabWindows/CVI Tools" extension will be documented in this file.

## [0.0.23] - 2026-11-12

### Fixed
- **Process Threads Sidebar Tooltip Persistence**:
  - Eliminated the issue where hover tooltips in the sidebar "Process Threads" view would immediately vanish during 1 Hz telemetry updates.
  - Frozen tree updates during continuous 1 Hz running ticks, firing tree change notifications only on actual structural alterations (thread creation/termination or suspend/resume state changes).
- **Automatic Source Code Navigation on Debugger Pause**:
  - Resolved the problem where pressing the debugger Pause button failed to open or highlight the user's source code (due to Windows stopping on non-source OS frames such as `ntdll!DbgBreakPoint` or `user32!GetMessage`).
  - Added intelligent stack frame analysis (`navigateAndCaptureOnStop`) that inspects the stopped thread and Thread 1 (Main GUI thread) to locate the top-most frame with user CVI source code (`.c`/`.h`) and automatically opens the file and highlights the line in the editor.

### Changed
- **Process Threads Diagnostics Disabled/Inactive Styling**:
  - Added dynamic `.session-inactive` styling to the "Process Threads" webview when no active CVI debugging session is running.
  - Displays an inactive banner notice, disabled action buttons, offline status badges, and an explicit watermark on the CPU stripchart canvas until a debug session starts.
- **Nomenclature Update**:
  - Renamed the sidebar view and diagnostics panel to **"Process Threads [Experimental]"** to clearly indicate preview functionality.

## [0.0.22] - 2026-11-12

### Added
- **Ultra-Lightweight Native Process Telemetry Helper (`cvi_telemetry.exe`)**:
  - Replaced high-overhead PowerShell/WMI polling with a dedicated native C binary (`bin/cvi_telemetry.exe`) using Windows NT Native APIs (`NtQuerySystemInformation(SystemProcessInformation)` and `GetSystemTimes`).
  - Reduced CPU consumption to virtually zero (<0.1% CPU usage at 1 Hz), eliminating all system slowdowns during telemetry sampling.
  - Added command-line configurable sampling intervals and interactive `stdin` commands for thread suspension and resumption (`suspend <tid>`, `resume <tid>`).
- **Real-Time CPU Stripchart & Thread Diagnostics Webview**:
  - Integrated high-performance HTML5 canvas stripchart with dynamic Y-axis autoscaling (with fixed zero) and scrolling 60-second time window.
  - Added comprehensive thread tabular diagnostic metrics: Thread ID (TID), Name/Role, Kernel State (`Running`, `Wait`, `Suspended`), Wait Reason (`UserRequest`, `WrQueue`, `DelayExecution`, etc.), Base Priority, and exact CPU execution times.
  - Added multi-column sorting (TID, Name, Status, Priority, CPU Time) and customizable column visibility.

### Removed
- **Textual Sparkline Glyphs**:
  - Removed decorative textual sparkline glyphs from thread headers to streamline the UI and avoid unnecessary rendering overhead.

## [0.0.21] - 2026-11-11

### Removed
- **Empty Debug Memory Container**:
  - Removed the unused and empty "Memory" tree container from the Run & Debug viewlet.

### Fixed
- **Resource Tracking Service Stability**:
  - Enhanced error handling and recovery in `CviResourceTrackingService` to prevent unhandled rejection during debugger attach/detach cycles.

## [0.0.20] - 2026-11-10

### Fixed
- **Debugger Crash / Silent Exit on Multiple Breakpoint Hits**:
  - Fixed a critical heap corruption bug where the debugged target would silently crash or terminate after hitting the same breakpoint 3 or 4 times.
  - Identified root cause: synchronous GDB expression calls (`-exec call (int)__CVI_Resource_DumpToFile($cvi_buf)`) while another thread hit a breakpoint caused GDB to abandon function evaluation, corrupting the inferior process's heap and runtime state.
  - Decoupled resource inspection from synchronous breakpoint stop hooks, ensuring uninterrupted multithreaded debugging stability.

## [0.0.19] - 2026-11-10

### Consolidated
- **Unified Release Consolidation**:
  - Consolidated and harmonized all development branches into `main` in preparation for public release.
  - Combined byte-for-byte `.prj` project serialization fidelity with the complete UI & UX overhaul, multithreaded debugging diagnostics, and custom build configuration engine.
  - Fully integrated settings auto-save, process threads visualization, and extended compiler option coverage across all project types (Executable, DLL, and Static Library).

## [0.0.18] - 2026-11-10

### Fixed
- **Project (.prj) Serialization Fidelity (Static Library, Executable, DLL)**:
  - Ensured 100% byte-for-byte serialization fidelity matching native LabWindows/CVI IDE output across all project types (`Static Library`, `Executable`, and `Dynamic Link Library`).
  - **In-Place Key Replacement**: Replaced existing single-line and multi-line (`Line0001..LineXXXX`) INI key entries in-place (`replaceKeyLines`) preserving exact key ordering within sections.
  - **Multi-Line Build Actions Preservation**: Added full support for multi-line build actions (`Build Action<N> Line<NNNN>`), preventing post-build actions from being cleared on save.
  - **CVI Chunk Splitting Size**: Standardized long value string splitting (`splitCviLongValue`) to 80 characters matching native CVI line splitting rules.
  - **Macro Evaluation vs Template Preservation**: Implemented `expandCviVersionMacros` for version templates (`%company`, `%application`, `%rel_dbg`, `%arch`, `%basename`, `%filename`, `%f1..%f4`, `%p1..%p4`, `%Y`) and preserved existing unedited version fields and evaluated strings without unwanted modification.
  - **Conditional Key Writing**: Omitted unused/default keys (`Compiler Defines`, `Compile with Precompiled Include File`, `Add NI Type Info To DLL`, `Use Single Header for NI Type Info`, warning/error lists) when not present in original `.prj` or not enabled.
  - **Export Files Formatting**: Formatted DLL export entries as `Export File1`, `Export File2` replacing in-place to match native CVI conventions.
  - **Mode-Specific Output and Action Preservation**: Preserved configuration-specific target output paths and build actions when saving with scope `'all'`.

## [0.0.17] - 2026-11-10

### Added
- **Build In-Progress Activity Indicator**:
  - Added real-time visual progress feedback during build, rebuild, clean, and batch compilation operations.
  - Status bar item dynamically transforms into an animated spinner (`$(sync~spin) Building...`) while compiling.
  - Integrated `vscode.window.withProgress` notification banners showing project compilation progress.
  - Project items in the Workspace Explorer and CVI Actions views display animated busy status indicators during builds.
  - Added build concurrency guards to safely prevent conflicting overlapping compilation jobs.
- **Complete Build Options Coverage**:
  - Implemented full parser and UI coverage for native CVI build and compiler options:
    - Number of concurrent compiles (`labwindowsCvi.numberOfConcurrentCompiles` setting and project build option).
    - Function prototypes requirement (`Require Prototypes`).
    - Non-void function return values requirement (`Require Return Values`).
    - Compiler-level uninitialized local variables check (`None`, `Conservative`, `Aggressive`).
    - Quick compiler warning toggles: Unreferenced identifiers, Pointer type mismatch, Unreachable code, and Assignment in conditional.
- **Process Threads Visualization During Debugging**:
  - Added dedicated **CVI Process Threads** tree view (`labwindowsCvi.processThreads`) in the Run & Debug sidebar container.
  - Real-time thread inspection via Debug Adapter Protocol (DAP) during debugging sessions (`cppdbg` / `cvi`).
  - Automatic thread classification: Main GUI Thread, CVI Thread Pool Worker (`CmtScheduleThreadPoolFunction`), Worker Thread, and CVI Runtime Internal.
  - Expandable thread nodes displaying call stack frames with click-to-open source code navigation.
  - Process diagnostics summary with active thread counts and live CPU utilization percentage sampling.
  - View toolbar actions for manual refresh (`$(refresh)`) and pausing all threads (`$(debug-pause)`).
- **Custom Build Configurations Management ("Manage Configurations")**:
  - Full support for user-defined build configurations beyond the four standard targets (`Debug`, `Release`, `Debug64`, `Release64`).
  - Added `labwindowsCvi.manageConfigurations` command mirroring the native LabWindows/CVI dialog:
    - Create new custom configurations inheriting compiler & linker settings from any existing configuration.
    - Duplicate existing build configurations.
    - Rename custom build configurations.
    - Delete custom configurations from `.prj` files.
    - Switch active build configuration.
  - Enhanced `labwindowsCvi.selectBuildMode` and the status bar mode item to display and activate custom configurations.
  - Seamless compiler integration: passing `-config=<Name>` to `compile.exe` when building a custom configuration.

### Changed
- **Auto-Save on Change in Settings Webviews**:
  - Replaced manual "Save" buttons in Project Target Settings and Build Options panels with automatic saving on input/change/blur.
  - Text inputs are debounced (350ms) to ensure smooth typing while checkboxes and selectors save immediately.
  - Added real-time save status badge indicator (`Saved` / `Saving...`) in the header.

### Removed
- **Redundant "Open in CVI" Action Buttons**:
  - Removed "Open in CVI" buttons from the CVI Home panel and the Build Settings panel header and Overview card. (The command remains available via the Command Palette).

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
