import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CviBuildMode, CviWorkspaceProjectRef } from '../model/types';
import { CviWorkspaceService } from './cviWorkspaceService';
import { CviParser } from '../model/cviParser';

export interface MsvcEnvironment {
  linkExe: string;
  msvcLibDir: string;
  sdkUmLibDir: string;
  sdkUcrtLibDir: string;
  arch: 'x86' | 'x64';
}

export interface MsvcLinkResult {
  success: boolean;
  exePath: string;
  pdbPath: string;
  error?: string;
  durationMs: number;
}

export class CviMsvcLinkService {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspaces: CviWorkspaceService,
    private readonly parser: CviParser,
    private readonly output: vscode.OutputChannel,
    private readonly traceOutput: vscode.OutputChannel
  ) {}

  /**
   * Discovers MSVC link.exe and Windows SDK library directories for the requested architecture.
   */
  async findMsvcEnvironment(arch: 'x86' | 'x64'): Promise<MsvcEnvironment | undefined> {
    const config = vscode.workspace.getConfiguration('labwindowsCvi');
    const customLinker = config.get<string>('msvcLinkerPath', '').trim();
    if (customLinker && fs.existsSync(customLinker)) {
      // Derive VC lib directory from custom linker path if possible
      const vcToolsDir = path.resolve(path.dirname(customLinker), '..', '..');
      const msvcLibDir = path.join(vcToolsDir, 'lib', arch);
      const sdkLibs = this.findWindowsSdkLibs(arch);
      return {
        linkExe: customLinker,
        msvcLibDir: fs.existsSync(msvcLibDir) ? msvcLibDir : '',
        sdkUmLibDir: sdkLibs?.um ?? '',
        sdkUcrtLibDir: sdkLibs?.ucrt ?? '',
        arch
      };
    }

    // Look for Visual Studio via vswhere.exe
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const vswhereExe = path.join(progFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');

    let vsInstallPath = '';
    if (fs.existsSync(vswhereExe)) {
      try {
        const stdout = cp.execFileSync(vswhereExe, [
          '-latest',
          '-prerelease',
          '-products', '*',
          '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
          '-property', 'installationPath'
        ], { encoding: 'utf8', windowsHide: true }).trim();
        if (stdout && fs.existsSync(stdout)) {
          vsInstallPath = stdout;
        }
      } catch (err) {
        this.traceOutput.appendLine(`[MSVC Discovery] vswhere execution error: ${err}`);
      }
    }

    // Fallback known paths if vswhere didn't find it
    if (!vsInstallPath) {
      const candidates = [
        'C:\\Program Files\\Microsoft Visual Studio\\18\\Community',
        'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
        'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional',
        'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise',
        'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community',
        'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Professional',
        'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Enterprise'
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          vsInstallPath = cand;
          break;
        }
      }
    }

    if (!vsInstallPath) {
      vscode.window.showErrorMessage('Microsoft Visual C++ linker (link.exe) was not found. Please ensure Visual Studio or VC Build Tools are installed, or set "labwindowsCvi.msvcLinkerPath".');
      return undefined;
    }

    // Read VC Tools version
    const verFile = path.join(vsInstallPath, 'VC', 'Auxiliary', 'Build', 'Microsoft.VCToolsVersion.default.txt');
    let vcToolsVer = '';
    if (fs.existsSync(verFile)) {
      vcToolsVer = fs.readFileSync(verFile, 'utf8').trim();
    } else {
      // Find latest subdirectory in VC\Tools\MSVC
      const msvcRoot = path.join(vsInstallPath, 'VC', 'Tools', 'MSVC');
      if (fs.existsSync(msvcRoot)) {
        const dirs = fs.readdirSync(msvcRoot).sort().reverse();
        if (dirs.length > 0) {
          vcToolsVer = dirs[0];
        }
      }
    }

    if (!vcToolsVer) {
      vscode.window.showErrorMessage(`Unable to detect MSVC tools version under ${vsInstallPath}`);
      return undefined;
    }

    const msvcBase = path.join(vsInstallPath, 'VC', 'Tools', 'MSVC', vcToolsVer);
    const hostDir = fs.existsSync(path.join(msvcBase, 'bin', 'Hostx64')) ? 'Hostx64' : 'Hostx86';
    const linkExe = path.join(msvcBase, 'bin', hostDir, arch, 'link.exe');
    const msvcLibDir = path.join(msvcBase, 'lib', arch);

    if (!fs.existsSync(linkExe)) {
      vscode.window.showErrorMessage(`MSVC link.exe not found at ${linkExe}`);
      return undefined;
    }

    const sdkLibs = this.findWindowsSdkLibs(arch);

    return {
      linkExe,
      msvcLibDir,
      sdkUmLibDir: sdkLibs?.um ?? '',
      sdkUcrtLibDir: sdkLibs?.ucrt ?? '',
      arch
    };
  }

  private findWindowsSdkLibs(arch: 'x86' | 'x64'): { um: string; ucrt: string } | undefined {
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const sdkRoot = path.join(progFilesX86, 'Windows Kits', '10', 'Lib');
    if (!fs.existsSync(sdkRoot)) {
      return undefined;
    }

    const versions = fs.readdirSync(sdkRoot).filter((dir) => {
      return fs.existsSync(path.join(sdkRoot, dir, 'um', arch));
    }).sort().reverse();

    if (versions.length === 0) {
      return undefined;
    }

    const latest = versions[0];
    return {
      um: path.join(sdkRoot, latest, 'um', arch),
      ucrt: path.join(sdkRoot, latest, 'ucrt', arch)
    };
  }

  /**
   * Resolves the cvibuild directory for a given project and build mode.
   */
  getCviBuildDirectory(projectPath: string, mode: CviBuildMode): string {
    const projDir = path.dirname(projectPath);
    const projBase = path.basename(projectPath, path.extname(projectPath));
    const suffix = mode === 'debug' ? 'Debug' : mode === 'release' ? 'Release' : mode === 'debug64' ? 'Debug64' : 'Release64';
    return path.join(projDir, `cvibuild.${projBase}`, suffix);
  }

  /**
   * Executes Microsoft link.exe on the cvibuild artifacts generated by compile.exe.
   */
  async relinkWithMsvc(projectRef: CviWorkspaceProjectRef, mode: CviBuildMode): Promise<MsvcLinkResult> {
    const startTime = Date.now();
    const project = this.workspaces.getProject(projectRef);
    if (project?.targetType === 'Static Library') {
      this.output.appendLine(`[MSVC Linker] Skipping static library ${projectRef.name} (static libraries are linked directly into the consumer executable).`);
      return { success: true, exePath: '', pdbPath: '', durationMs: 0 };
    }
    const arch: 'x86' | 'x64' = (mode === 'debug64' || mode === 'release64') ? 'x64' : 'x86';
    const cviBuildDir = this.getCviBuildDirectory(projectRef.absolutePath, mode);
    const linkOptionsFile = path.join(cviBuildDir, 'link_options.txt');

    if (!fs.existsSync(linkOptionsFile)) {
      const err = `link_options.txt not found in ${cviBuildDir}. Run build first.`;
      return { success: false, exePath: '', pdbPath: '', error: err, durationMs: Date.now() - startTime };
    }

    const msvc = await this.findMsvcEnvironment(arch);
    if (!msvc) {
      return { success: false, exePath: '', pdbPath: '', error: 'MSVC environment not found', durationMs: Date.now() - startTime };
    }

    const optionsContent = fs.readFileSync(linkOptionsFile, 'utf8');
    const lines = optionsContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    let targetExe = '';
    let resFile = '';
    let isConsole = false;
    let stackReserve = '';
    let stackCommit = '';
    let baseAddr = '';
    let entryPoint = '';
    const inObjects: string[] = [];
    const moreLibraries: string[] = [];

    for (const line of lines) {
      if (line.startsWith('-out:')) {
        targetExe = line.substring(5).trim();
      } else if (line.startsWith('-res:')) {
        resFile = line.substring(5).trim();
      } else if (line.startsWith('-console')) {
        isConsole = true;
      } else if (line.startsWith('-stackreserve:')) {
        stackReserve = line.substring(14).trim();
      } else if (line.startsWith('-stackcommit:')) {
        stackCommit = line.substring(13).trim();
      } else if (line.startsWith('-base:')) {
        baseAddr = line.substring(6).trim();
      } else if (line.startsWith('-entry:')) {
        entryPoint = line.substring(7).trim();
      } else if (line.startsWith('-in:')) {
        inObjects.push(line.substring(4).trim());
      } else if (line.startsWith('-more:')) {
        moreLibraries.push(line.substring(6).trim());
      }
    }

    if (!targetExe) {
      targetExe = this.parser.getTargetPath(projectRef.absolutePath, mode) || path.join(cviBuildDir, `${projectRef.name}.exe`);
    }

    const targetDir = path.dirname(targetExe);
    const targetName = path.basename(targetExe, path.extname(targetExe));
    const pdbPath = path.join(targetDir, `${targetName}.pdb`);

    // Prepare MSVC arguments
    const rspArgs: string[] = [
      '/NOLOGO',
      `/OUT:"${targetExe}"`,
      '/DEBUG',
      `/PDB:"${pdbPath}"`,
      '/FORCE:MULTIPLE',
      `/SUBSYSTEM:${isConsole ? 'CONSOLE' : 'WINDOWS'}`
    ];

    if (project?.targetType === 'Dynamic Link Library') {
      rspArgs.push('/DLL');
      const implib = targetExe.replace(/\.dll$/i, '.lib');
      rspArgs.push(`/IMPLIB:"${implib}"`);
    }

    if (arch === 'x86') {
      rspArgs.push('/MACHINE:X86');
      if (entryPoint) {
        // CVI standard entry point mapping for x86 stdcall
        const entrySym = entryPoint.startsWith('_') ? entryPoint : `_${entryPoint}`;
        rspArgs.push(`/ENTRY:${entrySym}`);
      } else if (!isConsole) {
        rspArgs.push('/ENTRY:CVIWinMainStartupCode@0');
      }
    } else {
      rspArgs.push('/MACHINE:X64');
      if (entryPoint) {
        const cleanEntry = entryPoint.replace(/^_+/, '').replace(/@.*$/, '');
        rspArgs.push(`/ENTRY:${cleanEntry}`);
      }
    }

    if (baseAddr) {
      rspArgs.push(`/BASE:${baseAddr}`);
    }
    if (stackReserve) {
      rspArgs.push(stackCommit ? `/STACK:${stackReserve},${stackCommit}` : `/STACK:${stackReserve}`);
    }

    if (msvc.msvcLibDir) rspArgs.push(`/LIBPATH:"${msvc.msvcLibDir}"`);
    if (msvc.sdkUmLibDir) rspArgs.push(`/LIBPATH:"${msvc.sdkUmLibDir}"`);
    if (msvc.sdkUcrtLibDir) rspArgs.push(`/LIBPATH:"${msvc.sdkUcrtLibDir}"`);

    // Compatibility stub object
    const compatObjName = arch === 'x64' ? 'cvi-msvc-compat-x64.obj' : 'cvi-msvc-compat-x86.obj';
    const compatObjPath = path.join(this.context.extensionPath, 'native', compatObjName);
    if (fs.existsSync(compatObjPath)) {
      rspArgs.push(`"${compatObjPath}"`);
    }

    // Standard CRT & Windows definitions
    rspArgs.push('legacy_stdio_definitions.lib');
    rspArgs.push('ucrt.lib');

    // Input object files
    for (const obj of inObjects) {
      if (fs.existsSync(obj)) {
        rspArgs.push(`"${obj}"`);
      }
    }

    // Input libraries and objects
    for (const lib of moreLibraries) {
      if (fs.existsSync(lib)) {
        rspArgs.push(`"${lib}"`);
      }
    }

    // Resource file
    if (resFile && fs.existsSync(resFile)) {
      rspArgs.push(`"${resFile}"`);
    }

    const rspFileName = 'msvc_link.rsp';
    const rspFile = path.join(cviBuildDir, rspFileName);
    fs.writeFileSync(rspFile, rspArgs.join('\r\n'), 'utf8');

    this.output.appendLine(`[MSVC Linker] Linking ${projectRef.name} with Microsoft link.exe...`);
    this.output.appendLine(`  Linker   : ${msvc.linkExe}`);
    this.output.appendLine(`  Target   : ${targetExe}`);
    this.output.appendLine(`  PDB      : ${pdbPath}`);
    this.output.appendLine(`  Arch     : ${arch}`);
    this.traceOutput.appendLine(`[MSVC Linker] Command: "${msvc.linkExe}" @"${rspFile}"`);

    const runLinker = (isRetry: boolean): Promise<MsvcLinkResult> => {
      return new Promise<MsvcLinkResult>((resolve) => {
        const child = cp.spawn(msvc.linkExe, [`@${rspFileName}`], {
          cwd: cviBuildDir,
          windowsHide: true,
          shell: false
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (d: Buffer) => {
          const text = d.toString();
          stdout += text;
          this.traceOutput.append(text);
        });

        child.stderr.on('data', (d: Buffer) => {
          const text = d.toString();
          stderr += text;
          this.traceOutput.append(text);
        });

        child.on('close', async (code) => {
          const durationMs = Date.now() - startTime;
          if (code === 0 && fs.existsSync(targetExe) && fs.existsSync(pdbPath)) {
            this.output.appendLine(`[MSVC Linker] Link succeeded (${durationMs} ms). PDB generated at: ${pdbPath}`);
            resolve({ success: true, exePath: targetExe, pdbPath, durationMs });
            return;
          }

          // If link failed, check if it was due to unresolved CVI Extended Debugging symbols (_UP_*)
          // from static libraries compiled in Extended Debug mode.
          const combinedOutput = `${stdout}\n${stderr}`;
          const upMatches = [...combinedOutput.matchAll(/\b(_UP_\w+)\b/g)].map(m => m[1]);
          const uniqueUpSymbols = Array.from(new Set(upMatches));
          const clExe = path.join(path.dirname(msvc.linkExe), 'cl.exe');

          if (!isRetry && uniqueUpSymbols.length > 0 && fs.existsSync(clExe)) {
            this.output.appendLine(`[MSVC Linker] Detected ${uniqueUpSymbols.length} unresolved Extended Debugging symbol(s) (_UP_*) from static libraries.`);
            this.output.appendLine(`[MSVC Linker] Auto-generating compatibility stubs (${uniqueUpSymbols.slice(0, 5).join(', ')}${uniqueUpSymbols.length > 5 ? '...' : ''})...`);

            const stubSrcPath = path.join(cviBuildDir, 'cvi_up_stubs.c');
            const stubObjPath = path.join(cviBuildDir, 'cvi_up_stubs.obj');
            const stubLines = [
              '// Auto-generated stubs for CVI Extended Debugging symbols',
              '#ifdef __cplusplus',
              'extern "C" {',
              '#endif',
              ...uniqueUpSymbols.map(sym => {
                const cName = (arch === 'x86' && sym.startsWith('_')) ? sym.slice(1) : sym;
                return `__declspec(dllexport) char ${cName}[64] = {0};`;
              }),
              '#ifdef __cplusplus',
              '}',
              '#endif'
            ];
            fs.writeFileSync(stubSrcPath, stubLines.join('\r\n'), 'utf8');

            const clRes = cp.spawnSync(clExe, ['/c', '/nologo', 'cvi_up_stubs.c'], {
              cwd: cviBuildDir,
              windowsHide: true,
              encoding: 'utf8'
            });

            if (clRes.status === 0 && fs.existsSync(stubObjPath)) {
              this.output.appendLine(`[MSVC Linker] Stubs compiled successfully. Retrying link...`);
              rspArgs.push(`"${stubObjPath}"`);
              fs.writeFileSync(rspFile, rspArgs.join('\r\n'), 'utf8');
              const retryResult = await runLinker(true);
              resolve(retryResult);
              return;
            } else {
              this.output.appendLine(`[MSVC Linker] Stub compilation failed: ${clRes.stderr || clRes.stdout}`);
            }
          }

          const err = `MSVC Linker failed with exit code ${code}.\n${stdout}\n${stderr}`;
          this.output.appendLine(`[MSVC Linker] Link failed (exit code ${code})`);
          this.output.appendLine(stdout);
          if (stderr) this.output.appendLine(stderr);
          resolve({ success: false, exePath: targetExe, pdbPath, error: err, durationMs });
        });

        child.on('error', (err) => {
          const durationMs = Date.now() - startTime;
          this.output.appendLine(`[MSVC Linker] Failed to launch link.exe: ${err.message}`);
          resolve({ success: false, exePath: targetExe, pdbPath, error: err.message, durationMs });
        });
      });
    };

    return await runLinker(false);
  }
}
