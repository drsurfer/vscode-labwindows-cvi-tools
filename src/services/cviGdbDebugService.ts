import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export class CviGdbDebugService {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly traceOutput: vscode.OutputChannel
  ) {}

  /**
   * Discovers gdb.exe from settings, PATH, or common install locations.
   */
  async findGdb(): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('labwindowsCvi');
    const customGdb = config.get<string>('gdbPath', '').trim();
    if (customGdb && fs.existsSync(customGdb)) {
      return customGdb;
    }

    // Check PATH via where.exe
    const whereGdb = this.findExecutableInPath('gdb.exe');
    if (whereGdb) {
      return whereGdb;
    }

    // Common installation paths
    const userProfile = process.env.USERPROFILE || '';
    const commonPaths = [
      path.join(userProfile, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages'),
      'C:\\mingw64\\bin',
      'C:\\msys64\\mingw64\\bin',
      'C:\\msys64\\ucrt64\\bin',
      'C:\\TDM-GCC-64\\bin'
    ];

    for (const dir of commonPaths) {
      if (dir.includes('WinGet')) {
        const found = this.searchWinGetDir(dir, 'gdb.exe');
        if (found) return found;
      } else {
        const fullPath = path.join(dir, 'gdb.exe');
        if (fs.existsSync(fullPath)) return fullPath;
      }
    }

    return undefined;
  }

  /**
   * Discovers objcopy.exe from settings, alongside GDB, PATH, or common locations.
   */
  async findObjcopy(gdbPath?: string): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('labwindowsCvi');
    const customObjcopy = config.get<string>('objcopyPath', '').trim();
    if (customObjcopy && fs.existsSync(customObjcopy)) {
      return customObjcopy;
    }

    // Check same directory as gdb.exe if provided
    if (gdbPath) {
      const neighbor = path.join(path.dirname(gdbPath), 'objcopy.exe');
      if (fs.existsSync(neighbor)) {
        return neighbor;
      }
    }

    // Check PATH via where.exe
    const whereObjcopy = this.findExecutableInPath('objcopy.exe');
    if (whereObjcopy) {
      return whereObjcopy;
    }

    // Common installation paths
    const userProfile = process.env.USERPROFILE || '';
    const commonPaths = [
      path.join(userProfile, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages'),
      'C:\\mingw64\\bin',
      'C:\\msys64\\mingw64\\bin',
      'C:\\msys64\\ucrt64\\bin',
      'C:\\TDM-GCC-64\\bin'
    ];

    for (const dir of commonPaths) {
      if (dir.includes('WinGet')) {
        const found = this.searchWinGetDir(dir, 'objcopy.exe');
        if (found) return found;
      } else {
        const fullPath = path.join(dir, 'objcopy.exe');
        if (fs.existsSync(fullPath)) return fullPath;
      }
    }

    return undefined;
  }

  /**
   * Renames CVI's abbreviated DWARF section names (.db_*) into standard DWARF names (.debug_*)
   * using objcopy.exe so that GDB can load all line numbers, variables and types.
   */
  async enableDwarfSymbols(executablePath: string, objcopyPath?: string): Promise<boolean> {
    const resolvedObjcopy = objcopyPath ?? await this.findObjcopy();
    if (!resolvedObjcopy) {
      this.output.appendLine('[GDB Debug] Warning: objcopy.exe not found. DWARF symbols may not be recognized by GDB.');
      this.output.appendLine('  Install MinGW/WinLibs (e.g. winget install BrechtSanders.WinLibs.POSIX.UCRT) or configure labwindowsCvi.objcopyPath.');
      return false;
    }

    const args = [
      '--long-section-names', 'enable',
      '--rename-section', '.db_info=.debug_info',
      '--rename-section', '.db_abbv=.debug_abbrev',
      '--rename-section', '.db_line=.debug_line',
      '--rename-section', '.db_pnam=.debug_pubnames',
      '--rename-section', '.db_str=.debug_str',
      '--rename-section', '.db_ref=.debug_ranges',
      '--rename-section', '.db_fram=.debug_frame',
      '--rename-section', '.db_loc=.debug_loc',
      executablePath
    ];

    this.output.appendLine(`[GDB Debug] Enabling DWARF debug symbols on ${path.basename(executablePath)}...`);
    this.traceOutput.appendLine(`[GDB Debug] Executing: "${resolvedObjcopy}" ${args.join(' ')}`);

    const startTime = Date.now();
    const result = cp.spawnSync(resolvedObjcopy, args, {
      windowsHide: true,
      encoding: 'utf8'
    });

    const durationMs = Date.now() - startTime;
    if (result.status === 0) {
      this.output.appendLine(`[GDB Debug] DWARF symbols enabled successfully (${durationMs} ms).`);
      return true;
    } else {
      this.output.appendLine(`[GDB Debug] objcopy failed (exit code ${result.status}): ${result.stderr || result.stdout}`);
      return false;
    }
  }

  private findExecutableInPath(exeName: string): string | undefined {
    try {
      const res = cp.spawnSync('where.exe', [exeName], { windowsHide: true, encoding: 'utf8' });
      if (res.status === 0 && res.stdout) {
        const firstLine = res.stdout.split(/\r?\n/)[0]?.trim();
        if (firstLine && fs.existsSync(firstLine)) {
          return firstLine;
        }
      }
    } catch {
      // Ignore
    }
    return undefined;
  }

  private searchWinGetDir(packagesDir: string, exeName: string): string | undefined {
    if (!fs.existsSync(packagesDir)) return undefined;
    try {
      const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.toLowerCase().includes('winlibs')) {
          const candidate = path.join(packagesDir, entry.name, 'mingw64', 'bin', exeName);
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    } catch {
      // Ignore
    }
    return undefined;
  }
}
