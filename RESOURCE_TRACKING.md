# LabWindows/CVI Resource Tracking and Runtime Diagnostics in Visual Studio Code

This document provides a comprehensive technical reference detailing the reverse engineering, architecture, and implementation of **Live Resource Tracking**, **Memory Leak Detection**, and **Runtime Error Interception** for National Instruments LabWindows™/CVI™ applications inside Visual Studio Code.

---

## 1. Executive Summary & Architecture Overview

LabWindows/CVI provides powerful built-in runtime diagnostics—most notably **Resource Tracking** (detecting dynamic memory, UI panel, and file handle leaks) and **Runtime Checking** (detecting uninitialized local variables, array bounds violations, and pointer corruption). Historically, these features were accessible only through the proprietary National Instruments CVI IDE.

The `labwindows-cvi-tools` extension brings these diagnostics natively into Visual Studio Code by interfacing directly with the LabWindows/CVI Run-Time Engine (`cvirte.dll`), the GNU Debugger (**GDB**), and Microsoft's C/C++ Debug Adapter (**MIEngine** / `cppdbg`).

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Visual Studio Code (IDE & Extension Host)                                   │
│                                                                             │
│  ┌────────────────────────┐  ┌───────────────────────┐  ┌────────────────┐  │
│  │ CVI Resource Tracker   │  │ Offending Line Decor. │  │ Debug Console  │  │
│  │ TreeView & Leak Report │  │ (Red Highlight/Badge) │  │ Diagnostic Log │  │
│  └───────────▲────────────┘  └───────────▲───────────┘  └───────▲────────┘  │
│              │                           │                      │           │
│  ┌───────────┴───────────────────────────┴──────────────────────┴────────┐  │
│  │ CviResourceTrackerService / DebugAdapterTracker (DAP Interceptor)     │  │
│  └───────────────────────────────────────▲───────────────────────────────┘  │
└──────────────────────────────────────────┼──────────────────────────────────┘
                                           │ DAP (Debug Adapter Protocol)
┌──────────────────────────────────────────▼──────────────────────────────────┐
│ Microsoft MIEngine (cppdbg)                                                 │
│   - Configured with `unknownBreakpointHandling: "stop"`                     │
└──────────────────────────────────────────▲──────────────────────────────────┘
                                           │ GDB/MI Protocol
┌──────────────────────────────────────────▼──────────────────────────────────┐
│ GNU Debugger (gdb.exe)                                                      │
│   - Sourced Trap Script (`cvi_gdb_exit_trap.gdb`)                           │
│   - Silent Exit Leaks Traps (at `CloseCVIRTE` & `main` return)               │
│   - Runtime Error Traps (`ReportUPError`, `_UPLibReportError`, `CVIAssert`) │
│   - Frame Pop via `return` command (bypassing modal popups)                 │
└──────────────────────────────────────────▲──────────────────────────────────┘
                                           │ Windows Debugging API
┌──────────────────────────────────────────▼──────────────────────────────────┐
│ Target Application Process (e.g. Demo Antigravity.exe)                      │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ National Instruments CVI Run-Time Engine (`cvirte.dll`)               │  │
│  │                                                                       │  │
│  │  • Resource Tracking Hooks:                                           │  │
│  │      - Dynamic Memory (`malloc`, `calloc`, `realloc`, `free`)         │  │
│  │      - User Interface Panels (`LoadPanel`, `DiscardPanel`, etc.)      │  │
│  │      - File & Stream Handles (`fopen`, `fclose`, etc.)                │  │
│  │                                                                       │  │
│  │  • Diagnostic Engine:                                                 │  │
│  │      - `_LocalsRuntimeCheck`: Instruments uninitialized variables     │  │
│  │      - `ReportUPError`: Error reporter & modal dialog handler         │  │
│  │      - `__CVI_Resource_DumpToFile`: Serializes tracking table to disk │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. LabWindows/CVI Runtime Internals (`cvirte.dll`)

The National Instruments runtime library `cvirte.dll` (located in `C:\Windows\System32\cvirte.dll` for 64-bit and `C:\Windows\SysWOW64\cvirte.dll` for 32-bit) contains an extensive, undocumented set of diagnostic hooks.

### Key Exported Functions Discovered

| Function Symbol | Calling Convention | Purpose & Behavior |
| :--- | :--- | :--- |
| `SetEnableResourceTracking(int enable)` | `cdecl` / `fastcall` | Enables (`1`) or disables (`0`) runtime tracking of allocated resources across all CVI subsystems. |
| `__SetCurrentDebuggingLevel(int level)` | `cdecl` / `fastcall` | Sets the diagnostic verbosity. Level `3` activates comprehensive allocation tracking and stack capturing. |
| `__CVI_Resource_DumpToFile(const char* path)` | `cdecl` / `fastcall` | Formats and serializes the complete live tracking database into an ASCII report at the specified file path. Returns `0` on success. |
| `CloseCVIRTE(void)` | `cdecl` / `fastcall` | Official NI termination routine. Releases internal CRT hooks, frees system handles, and performs final leak verification. |
| `_LocalsRuntimeCheck(...)` | Internal compiler helper | Injected by `compile.exe` at function branches to verify that local variables have been written before being read. |
| `ReportUPError(int category, int code, int line, int col, ...)` | Windows x64 fastcall | Central runtime error dispatcher. Displays the modal *"Non-Fatal Run-time Error"* dialog if not running inside the NI IDE. |
| `_UPLibReportError(...)` | Internal helper | Dispatches CVI library parameter and handle validation errors. |
| `CVIAssert(...)` | Internal helper | Injected by CVI assert macros when an assertion evaluates to false. |

### Resource Categories Tracked by CVI

When tracking is enabled, `cvirte.dll` wraps every allocation primitive with tracking metadata:
1. **Dynamic Memory**: Tracks heap pointers allocated via `malloc`, `calloc`, and `realloc`. Stores pointer address, allocation size in bytes, and the calling source file and line.
2. **User Interface & Panels**: Tracks panel handles returned by `LoadPanel`, `DuplicatePanel`, and child controls. Records UIR resource IDs and file paths.
3. **File & System Handles**: Tracks file streams (`FILE*`) opened via `fopen` and low-level system handles.
4. **Threads & Synchronization**: Tracks thread pools, thread locks, semaphores, and condition variables created via the CVI Multithreading Library.
5. **Communication**: Tracks TCP sockets, UDP channels, DDE servers, and RS-232 serial connections.

### Format of `__CVI_Resource_DumpToFile`

When invoked, `__CVI_Resource_DumpToFile` creates an ASCII text report structured with distinct category headers:

```
[Dynamic Memory]
0x000000000047F58B0, 100, "Demo Antigravity.c", 35, 16, 35, 41
0x000000000047D58F0, 256, "Demo Antigravity.c", 42, 23, 42, 34

[User Interface & Panels]
1, "Untitled Panel", "Demo Antigravity.uir", PANEL, "Demo Antigravity.c", 63

[File & System Handles]
0x000000000056AAD0, "cvi_test_stream.tmp", "Demo Antigravity.c", 56
```

---

## 3. Engineering Challenges & Solutions

### 3.1 The 65-Byte Phantom Leak Bug (GDB Infcall Artifact)

#### The Problem
During interactive debugging, every time the user paused at a breakpoint or stepped (`F10`/`F11`), the CVI Resource Tracking tree reported a new, unexplained 65-byte dynamic memory allocation originating inside `cvirte.dll`. Stepping 5 times produced 5 spurious 65-byte leaks. When the program finished, these allocations were incorrectly flagged as memory leaks.

#### Root Cause Analysis
To query the resource tracking state while paused at a breakpoint, the extension dispatched a GDB inferior function call:
```gdb
call (int)__CVI_Resource_DumpToFile("C:/Users/.../AppData/Local/Temp/cvi_res_dump.txt")
```
When GDB executes an inferior function call (`infcall`) with a string argument:
1. GDB dynamically allocates memory inside the debuggee process by calling the runtime's `malloc()`.
2. It writes the string argument (`"C:/Users/.../cvi_res_dump.txt"`) into that allocated buffer (which, with padding and header metadata, measured exactly 65 bytes).
3. It passes the pointer to `__CVI_Resource_DumpToFile`.
4. Because `cvirte.dll` hooks `malloc()`, **CVI dutifully recorded GDB's own internal buffer as an active application heap allocation!**

#### The Breakthrough: VirtualAlloc Bypass
To prevent CVI's CRT allocator from seeing GDB's buffers, the extension completely bypasses the C Runtime heap:
1. At the first breakpoint or initialization step, GDB allocates a tiny 512-byte block using the Windows OS kernel primitive:
   ```gdb
   set $cvi_buf = (char*)VirtualAlloc(0, 512, 0x1000, 4)
   ```
   *(where `0x1000 = MEM_COMMIT`, `4 = PAGE_READWRITE`)*.
2. The normalized dump file path is copied directly into this OS virtual page:
   ```gdb
   set {char[52]}$cvi_buf = "C:/Users/carlo/AppData/Local/Temp/cvi_res_dump.txt"
   ```
3. Subsequent dump requests reuse this buffer without allocating any memory:
   ```gdb
   call (int)__CVI_Resource_DumpToFile($cvi_buf)
   ```
Because `VirtualAlloc` operates directly at the Windows NT kernel boundary, `cvirte.dll`'s CRT heap tracking is completely unaware of it. **The 65-byte phantom leak was permanently eliminated.**

---

### 3.2 Variable Name Resolution via DWARF Stack Inspection

#### The Problem
`__CVI_Resource_DumpToFile` outputs raw heap addresses (e.g., `0x000000000047F58B0 (100 B)`). Showing developers raw hexadecimal addresses instead of their actual variable names (`validBuffer`, `leakedString`, `leakedDataArray`) severely hampers productivity.

#### Root Cause
Heap allocators (`malloc`/`calloc`) only receive size parameters; they possess no semantic awareness of the variable names storing their returned pointers.

#### The Solution
When the resource tree is updated, `CviResourceTrackerService` cross-references the heap dump against the active stack frame:
1. It queries GDB for active local and parameter variables using `-exec info locals` and `-exec info args`.
2. It parses the variable values and addresses (e.g. `validBuffer = 0x47f58b0`, `leakedString = 0x47d58f0`).
3. It correlates each pointer in the CVI resource dump with the active local variables in the matching source file and line.
4. The tree view displays the human-readable identifier:
   ```
   ▼ Dynamic Memory (2 · 656 B)
     ▶ leakedString (0x000000000047D58F0) 256 B · Demo Antigravity.c:42
     ▶ leakedDataArray (0x000000000047D5A00) 400 B · Demo Antigravity.c:49
   ```

---

### 3.3 Non-Intrusive Program Exit Leak Trapping

#### The Problem
Detecting exit memory leaks requires querying the resource table at the exact instant the user application finishes execution, but **before** the operating system tears down the process address space.
- Querying during `main` is premature (valid buffers intended to be freed before `return 0` are still allocated).
- Querying after process exit is impossible (the process memory space has been destroyed).

#### The Breakthrough: Dual-Trap GDB Strategy
The extension configures an automated, silent dual trap inside GDB via a generated script (`cvi_gdb_exit_trap.gdb`):

```gdb
set breakpoint pending on

# Trap 1: Break on main() return address
break *0x0000000000402f8f
commands
silent
call (int)__CVI_Resource_DumpToFile($cvi_buf)
continue
end

# Trap 2: Break on official CVI runtime teardown
break CloseCVIRTE
commands
silent
call (int)__CVI_Resource_DumpToFile($cvi_buf)
continue
end
```

1. **Main Return Address Trapping**: At debug launch, the extension disassembles the entry point of `main()` using `gdbService.findMainReturnAddress()` to identify the exact machine instruction of `ret`. A silent breakpoint is placed at this address.
2. **`CloseCVIRTE` Trapping**: A secondary breakpoint is placed on `CloseCVIRTE()`.
3. **Execution Flow**:
   - Both breakpoints attach GDB `commands` that silently invoke `__CVI_Resource_DumpToFile($cvi_buf)` and immediately `continue`.
   - The user never experiences an unwanted pause at exit.
   - If no resources remain allocated, the extension logs `Clean Exit: No memory leaks or unreleased handles detected`.
   - If leaks exist, the extension highlights them in the tree view and issues a notification detailing the exact leaked bytes and source lines.

---

## 4. Runtime Error Interception ("Detect Uninitialized Local Variables")

### 4.1 How CVI Detects Uninitialized Variables

When a project is built with **"Detect uninitialized local variables at run time"** enabled in the CVI Build Options dialog:
1. `compile.exe` injects calls to `_LocalsRuntimeCheck(...)` before local variables are evaluated.
2. If a local variable is evaluated on an execution path where it was not initialized (for example, jumping past initialization to an `Error:` label), `_LocalsRuntimeCheck` executes.
3. In `cvirte.dll` (x64), `_LocalsRuntimeCheck` populates the registers:
   - `%ecx` = Category (`2` = Run-Time Check)
   - `%edx` = Error Code (`0x3151` = 12625: *"Local variable referenced before being initialized"*)
   - `%r8d` = Offending Source Line (e.g. `99`)
   - `%r9d` = Offending Column (e.g. `21`)
   - `0x20(%rsp)` = Pointer to variable name string (`"leakedString"`)
4. It then calls `ReportUPError`.

### 4.2 The Default CVI Behavior (and why it failed in VS Code)
By default, `ReportUPError` displays a modal Windows dialog:

```
┌────────────────────────────────────────────────────────┐
│ Non-Fatal Run-time Error                               │
├────────────────────────────────────────────────────────┤
│ File "Demo Antigravity.c", line 99, column 21:         │
│                                                        │
│ Local 'leakedString' was referenced before being       │
│ initialized.                                           │
│                                                        │
│       [ Break ]       [ Ignore ]       [ Terminate ]   │
└────────────────────────────────────────────────────────┘
```

- Clicking **Break** attempts to invoke the National Instruments CVI IDE. The IDE launches and displays an error: *"Unable to attach to the specified process"* (because GDB is already attached as the active debugger).
- Clicking **Terminate** aborts the process immediately.
- The modal dialog blocks execution and cannot be automated.

### 4.3 Breakpoint Interception
To catch the error in Visual Studio Code before the dialog appears, the extension sets breakpoints on CVI diagnostic functions:
- `ReportUPError`: Local variable uninitialized, array out-of-bounds, pointer corruption.
- `_UPLibReportError`: Library function parameter and handle validation failures.
- `_UPLibBreakpoint`: Programmatic calls to `Breakpoint()`.
- `CVIAssert`: Assertion failures.

---

### 4.4 Eliminating the "Hit Breakpoint 3" Red Exception Dialog

#### The Problem
In initial implementations, when GDB hit `ReportUPError`, Visual Studio Code displayed a disruptive, ugly red callout box directly over the editor line:
```
Exception has occurred.
Hit breakpoint 3 at 0x7fff9e9a58d6.
```
Looking at the VS Code Breakpoints window, Breakpoint 3 was nowhere to be found, leading developers to believe an unhandled crash or mysterious phantom breakpoint had occurred.

#### Root Cause
Microsoft's `cppdbg` debug adapter (MIEngine) maintains a table of breakpoints created through the VS Code UI. When GDB stops at an internal breakpoint set via scripts or raw commands:
- MIEngine does not recognize the breakpoint ID.
- By default, MIEngine treats unknown breakpoints as unhandled exceptions (`"throw"`).
- It emits a DAP `stopped` event with `reason: "exception"` and `description: "Hit breakpoint 3..."`.
- VS Code's editor catches `reason === "exception"` and opens the red Exception Widget.

#### The Solution: `unknownBreakpointHandling: "stop"`
Microsoft MIEngine provides an official configuration option specifically designed for this scenario:
```json
{
  "unknownBreakpointHandling": "stop"
}
```
In `cviBuildService.ts`, `unknownBreakpointHandling: 'stop'` is injected into the debug launch configuration:
- MIEngine stops treating internal GDB breakpoints as engine exceptions.
- It pauses execution gracefully with `reason: "breakpoint"` or `reason: "pause"`.
- **The disruptive red "Exception has occurred" callout box was completely eliminated.**

---

### 4.5 Preventing the Modal Dialog on Resume: The GDB `return` Command

#### The Problem
Even after intercepting the error and pausing at line 99, when the developer pressed **Continue (`F5`)** or **Step Over (`F10`)**, execution resumed right inside `ReportUPError`. As a result, the CVI modal popup (*"Non-Fatal Run-time Error"*) appeared anyway, blocking the application!

#### Root Cause
Placing a standard breakpoint on a function pauses execution at its entry point, but when the user resumes, the function's instructions still execute.

#### The Breakthrough: GDB `return` Frame Pop
In GDB, the `return` command cancels execution of the current function call and immediately pops its stack frame, returning control to the caller:

```gdb
break ReportUPError
commands
printf "\n================================================================================\n"
printf " [LABWINDOWS/CVI RUN-TIME CHECK ERROR]\n"
printf " Execution paused because a LabWindows/CVI Run-Time Check failed!\n"
printf " Offending line is highlighted in the VS Code editor.\n"
printf " Common causes:\n"
printf "   * Local variable referenced before being initialized\n"
printf "   * Array index or pointer out of bounds\n"
printf "   * Invalid pointer access detected by CVI runtime\n"
printf " Check Call Stack and Variables in VS Code to inspect the state.\n"
printf "================================================================================\n\n"
return
end
```

#### How it works:
1. `_LocalsRuntimeCheck` calls `ReportUPError`.
2. GDB catches `ReportUPError`.
3. GDB executes `printf`, outputting the formatted explanation to the **Debug Console**.
4. GDB executes `return`:
   - `ReportUPError`'s stack frame is popped **before it can execute any instructions**.
   - The code that creates the Windows modal dialog **never runs**.
   - Control returns to the caller, exactly as if the user had clicked `[Ignore]` in the dialog!
5. GDB stops execution, and the editor focuses on line 99 (`free(leakedString)`).
6. When the developer presses **Continue (`F5`)** or **Step (`F10`)**, execution resumes smoothly in user code without any modal popup!

---

### 4.6 Persistent Visual Editor Highlighting

To ensure that the developer has a clear, persistent visual indication of the offending code line even after transient toast notifications fade:

1. **Stack Frame Resolution**: When a stop occurs, `CviResourceTrackerService` queries the DAP stack trace (`session.customRequest('stackTrace')`) to locate the first frame with valid user source code (e.g. `Demo Antigravity.c`, line `99`).
2. **Editor Decoration**: It applies a custom `vscode.TextEditorDecorationType`:
   - Full line soft-red background highlight (`rgba(255, 68, 68, 0.25)`).
   - Solid red line border (`1px solid rgba(255, 68, 68, 0.7)`).
   - Right-hand overview ruler marker (`#ff4444`).
   - Inline badge: `⚠️ [LabWindows/CVI Run-Time Error Check Failed]`.
   - Hover tooltip explaining the error condition.
3. **Instant Auto-Clearing on Resume**:
   - In DAP, user actions (clicking Continue, Step Over, Step In, Step Out, Restart, or Stop) send client requests (`request: "continue"`, `request: "next"`, etc.).
   - The extension intercepts these outgoing requests via `onWillReceiveMessage`:
     ```typescript
     onWillReceiveMessage: (message: any) => {
       if (message.type === 'request' && (
         message.command === 'continue' ||
         message.command === 'next' ||
         message.command === 'stepIn' ||
         message.command === 'stepOut' ||
         message.command === 'restart' ||
         message.command === 'disconnect'
       )) {
         this.hasPendingRuntimeError = false;
         this.clearRuntimeErrorDecoration();
       }
     }
     ```
   - The moment the user clicks **Continue (`F5`)** or **Step**, the red highlight and badge vanish instantly from the editor.

---

## 5. Visual Studio Code Configuration Reference

The following settings in `settings.json` control resource tracking and runtime check behaviors:

| Setting Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `labwindowsCvi.debug.breakOnRuntimeErrors` | `boolean` | `true` | Automatically breaks execution in VS Code when CVI detects a runtime check error (uninitialized variables, out-of-bounds array access, assertions) or library error, preventing external IDE invocation. |
| `labwindowsCvi.resourceTracking.autoRefreshOnBreakpoint` | `boolean` | `true` | Automatically queries and updates the live CVI Resource Tracking tree view whenever the debugger pauses at a breakpoint or step. |
| `labwindowsCvi.resourceTracking.notifyOnLeaks` | `boolean` | `true` | Displays a detailed notification report when a debugged CVI program terminates with unreleased memory blocks, open UI panels, or unclosed file handles. |
| `labwindowsCvi.autoDebugLibraries` | `boolean` | `false` | Automatically swaps debug (`*_debug.lib`) and release (`*.lib`) instrumentation libraries based on the active build configuration. |

---

## 6. Best Practices for Developers Writing LabWindows/CVI Code

### 1. Always Pair `InitCVIRTE` with `CloseCVIRTE`
According to National Instruments engineering specifications, every CVI executable must initialize and shut down the runtime engine properly:

```c
#include <cvirte.h>
#include <userint.h>

int main (int argc, char *argv[])
{
    // Initialize CVI Runtime
    if (InitCVIRTE (0, argv, 0) == 0)
        return -1; // Out of memory

    // Enable Resource Tracking for debug builds
    SetEnableResourceTracking (1);

    // ... Application Code ...

    // Clean up all user interface panels
    DiscardPanel (panelHandle);

    // Finalize CVI Runtime Engine (essential for accurate leak detection)
    CloseCVIRTE ();

    return 0;
}
```

### 2. Variable Declarations with Runtime Checking
When compiling with **"Detect uninitialized local variables at run time"**:
- In C99, avoid placing variable declarations after conditional jump macros (like `nullChk` or `errChk`).
- If execution jumps to an `Error:` label, ensure cleanup code checks whether the variable was allocated before attempting to free it:
  ```c
  char *buffer = NULL; // Initialize to NULL at declaration!
  
  nullChk (InitCVIRTE (0, argv, 0));
  buffer = malloc (256);
  
  Error:
      if (buffer)
          free (buffer);
  ```
  Initializing local pointers to `NULL` satisfies both static compiler analysis and CVI's runtime check instrumentation.
