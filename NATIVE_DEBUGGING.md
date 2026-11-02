# Native Debugging of LabWindows/CVI Projects in Visual Studio Code

This document outlines the technical journey, diagnostic analysis, and tooling architecture that enabled **full native debugging** (breakpoints, step-by-step execution, call stack inspection, and local/global variable evaluation) for National Instruments LabWindows/CVI projects inside Visual Studio Code. It details the underlying reasons why Microsoft's PDB format could not be used and why DWARF was adopted as the native solution.

---

## 1. Objective and Context

Historically, **LabWindows/CVI** projects have been tightly coupled with the proprietary National Instruments IDE for both compilation and interactive debugging. The goal of this engineering effort was to enable developers to develop and debug entirely within **Visual Studio Code**, preserving:
- The official LabWindows/CVI build toolchain (`compile.exe`, `cvilink.exe`).
- Complete binary compatibility with the CVI runtime engine (User Interface, multithreading, hardware drivers).
- A seamless, modern debugging experience: **F5** one-click launch, interactive breakpoints, variable evaluation (locals, globals, structs, pointers), and call-stack navigation across both main application executables and embedded workspace libraries (`.lib`).

---

## 2. Initial Investigation: The Microsoft PDB Approach

The conventional path for debugging C/C++ applications on Windows within Visual Studio Code (via the Microsoft C/C++ extension and the `cppvsdbg` engine) relies on Microsoft **PDB** (*Program Database*) symbol files.

### The Initial Strategy
1. Compile C source files using the CVI compiler.
2. Replace CVI's proprietary linker (`cvilink.exe`) with Microsoft's official linker (`link.exe` from Visual Studio Build Tools, invoked with `/DEBUG`).
3. Generate the application executable alongside a corresponding `.pdb` symbol database.

### Roadblocks Encountered
- **Runtime Library Collisions**: Linking CVI runtime objects (`cvistart.lib`, `cvi.lib`) with Microsoft's Universal C Runtime (`ucrt.lib`) produced symbol collisions on standard C library entry points (such as `exit`, `malloc`, etc.).
- **Unresolved Compiler Primitives**: The CVI runtime depends on internal compiler symbols (e.g., `__CompiledDebuggingLevel`, `__ExeSymbols`, `__CVILibSymbols`, and `_UP_@...` thread-local variables).
- By providing compatibility stubs and linker resolution directives (such as `/FORCE:MULTIPLE`), `link.exe` successfully produced an executable accompanied by a generated `.pdb` file.

---

## 3. Why PDB Failed: CodeView vs. DWARF

Although `link.exe` successfully generated the `.pdb` file, launching a debug session in Visual Studio Code revealed a critical failure: **breakpoints failed to bind**, and the debugger reported zero knowledge of source code lines, types, or local variables.

Binary analysis of the object files and executable headers revealed the root architectural incompatibility:

```
[LabWindows/CVI Compiler (Custom Clang 3.3)]
                 │
                 ▼ Emits exclusively DWARF 4 debug records
          Object File (.obj)
          ┌─────────────────────────┐
          │ .text / .data           │
          │ .db_info / .db_line ... │  <-- DWARF debug sections
          └─────────────────────────┘
                 │
                 ├────────────────────────────────────────┐
                 ▼                                        ▼
          [MSVC link.exe]                         [cvilink.exe (CVI)]
      Expects CodeView records                  Preserves all sections
       (.debug$S / .debug$T)                     including DWARF blocks
                 │                                        │
                 ▼                                        ▼
          "Empty" PDB                             CVI Executable
      (Only export symbols;                     (Contains full DWARF,
       no line/source mapping)                   but with truncated names)
```

1. **Incompatible Debug Record Formats**:
   - Microsoft `link.exe` expects object files to contain debug records formatted in Microsoft's proprietary **CodeView** standard (embedded in `.debug$S` for symbols and `.debug$T` for types).
   - The LabWindows/CVI compiler (which is internally built upon a customized Clang/LLVM 3.3 backend) **does not emit CodeView records**. Instead, it emits debug metadata adhering to the open-standard **DWARF** specification (specifically DWARF version 4).
2. **The Linker Outcome**:
   - Encountering DWARF sections that it did not recognize, `link.exe` silently ignored them during PDB construction.
   - Consequently, the generated `.pdb` file contained only public exported function names, but was entirely devoid of line-to-address mappings, source file associations, and local variable descriptors.
   - Without CodeView records, Microsoft-based debuggers (`cppvsdbg`) cannot locate or bind breakpoints in the source code.

---

## 4. The Breakthrough: Uncovering CVI's Internal DWARF Symbols

With PDB ruled out as architecturally non-viable without a completely different compiler, the investigation shifted to examining the native binaries produced by National Instruments' own linker (`cvilink.exe`).

Inspecting standard Debug executables with PE/COFF diagnostic tools revealed a vital discovery:
- `cvilink.exe` **fully preserves** the DWARF 4 debug tables generated by the CVI compiler.
- However, standard DWARF-compatible debuggers (such as GDB or LLDB) were unable to detect any debug symbols in the resulting binary.

### The 8-Character Section Name Restriction
In the original Microsoft PE/COFF executable specification, section headers allocated a fixed 8-byte field for section names. For historical compatibility, LabWindows/CVI stores standard DWARF debug sections using abbreviated 8-character names:

| Standard DWARF Section Name | Abbreviated CVI Section Name | Description |
|-----------------------------|------------------------------|-------------|
| `.debug_info`               | `.db_info`                   | Type, function, and variable definitions |
| `.debug_line`               | `.db_line`                   | Line number to memory address mappings |
| `.debug_abbrev`             | `.db_abbv`                   | DWARF abbreviation table |
| `.debug_str`                | `.db_str`                    | Debug string table and identifiers |
| `.debug_ranges`             | `.db_rang`                   | Memory address range lists |
| `.debug_loc`                | `.db_loc`                    | Variable location descriptors |
| `.debug_frame`              | `.db_fram`                   | Call-frame information for stack traces |

Because standard debuggers strictly search for canonical section names prefixed with `.debug_*`, they considered the CVI executable stripped of debug information.

---

## 5. The Implemented Pipeline: `objcopy` and GDB

Once the problem was identified as purely a section naming mismatch within the PE header, a non-invasive, ultra-fast post-link pipeline was established:

```
  [1] CVI Build & Link
           │ (compile.exe + cvilink.exe)
           ▼
      Target .exe with abbreviated .db_* sections
           │
  [2] Post-Build Conversion Hook (< 100 ms)
           │ (objcopy.exe --rename-section .db_*=.debug_*)
           ▼
      Target .exe with canonical DWARF sections (.debug_*)
           │
  [3] Visual Studio Code Debug Session
           │ (F5 / Run & Debug via MinGW-w64 GDB)
           ▼
      Native Debugging: Breakpoints, Variables, Call Stacks
```

### 1. Standard CVI Build
The project and its referenced workspace libraries are compiled and linked using the official CVI tools in **64-bit Debug** configuration.

### 2. Surgical Symbol Header Conversion (`objcopy`)
Immediately following link completion, an automated post-build hook runs `objcopy` (from GNU Binutils).  
In under 100 milliseconds and without recompiling or altering machine instructions, `objcopy` enables the PE long section name table and renames `.db_*` sections to standard `.debug_*`.  
Because the underlying code segment (`.text`) and data segments remain untouched, binary execution behavior is 100% faithful to the official CVI environment.

### 3. Native Debugging with GDB
Visual Studio Code initializes a debug session using the Microsoft C/C++ debug adapter (`cppdbg`) configured to invoke **64-bit GDB** (from MinGW-w64 / WinLibs).  
GDB natively parses the restored DWARF 4 symbol hierarchy:
- Instantly maps executable instructions back to `.c` and `.h` source lines.
- Binds breakpoints accurately.
- Reconstructs accurate call stacks.
- Evaluates local variables, parameters, structs, arrays, and pointers.
- Enables seamless step-into debugging across multiple CVI **Library (.lib)** projects open within the workspace.

---

## 6. Tooling Reference

The following tools were utilized during diagnostic research and in the final production pipeline:

1. **LabWindows/CVI Toolchain (`compile.exe`, `cvilink.exe`)**:
   - Performs standard compilation and linking, resolving proprietary CVI runtime dependencies and emitting DWARF 4 data.
2. **Binary Inspection Tools (`dumpbin.exe`, `objdump.exe`)**:
   - Used during reverse engineering to disassemble PE headers, inspect section flags, and analyze the discrepancy between CodeView and DWARF records.
3. **GNU Binutils (`objcopy.exe`)**:
   - Serves as the lightweight, in-place bridge that converts section headers to canonical DWARF names.
4. **GNU Debugger (`gdb.exe` via MinGW-w64 / WinLibs)**:
   - The native DWARF 4 execution engine on Windows x64.
5. **Microsoft C/C++ Extension for VS Code (`cppdbg`)**:
   - Implements the Debug Adapter Protocol (DAP) communicating between VS Code's UI and the GDB engine.
6. **CVI Tools VS Code Extension**:
   - Orchestrates the full lifecycle: manages builds, runs the symbol conversion hook, injects runtime-tuned GDB commands (e.g., suppressing transient thread events during `RunUserInterface()`), and binds launch actions directly to **F5** and the **Run & Debug** interface.

---

## 7. Conclusions & Architectural Benefits

- **Zero Compiler Modifications**: Uses the official CVI compiler and runtime libraries, guaranteeing full binary and timing fidelity for mission-critical industrial test systems.
- **Cross-Library Workspace Debugging**: Fully supports stepping into and inspecting code across external libraries within the same workspace.
- **Modern Developer Ergonomics**: Developers gain modern VS Code amenities (Git workflows, responsive UI, rich extensions) while retaining 100% compatibility with National Instruments hardware and software libraries.
