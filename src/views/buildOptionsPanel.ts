import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CviBuildOptions, CviParser } from '../model/cviParser';
import { CviBuildMode, CviWorkspaceProjectRef } from '../model/types';
import { CVI_WARNING_CATALOG, CviWarningItem, CviWarningLevel, getDefaultWarningsForLevel } from '../model/cviWarningCatalog';
import { CviWorkspaceService } from '../services/cviWorkspaceService';
import { CviCppToolsService } from '../services/cviCppToolsService';
import { normalizeRuntimePath } from '../utils/pathUtils';

type BuildOptionsScope = CviBuildMode | 'all' | string;

const ALL_BUILD_MODES: CviBuildMode[] = ['debug', 'release', 'debug64', 'release64'];

const OPTIMIZATION_OPTIONS: [string, string][] = [
  ['No optimizations', 'No optimizations (level 0)'],
  ['Optimize for speed (level 1)', 'Optimize for speed (level 1)'],
  ['Optimize for speed (level 2)', 'Optimize for speed (level 2)'],
  ['Optimize for size', 'Optimize for size']
];

const DEBUGGING_LEVEL_OPTIONS: [string, string][] = [
  ['None', 'None'],
  ['Standard', 'Standard'],
  ['Extended', 'Extended']
];

const PROFILING_OPTIONS: [string, string][] = [
  ['Disabled', 'Disabled'],
  ['Function Profiling', 'Function Profiling']
];

const WARNING_LEVEL_OPTIONS: [CviWarningLevel, string][] = [
  ['None', 'None (no warnings)'],
  ['Common', 'Common'],
  ['Extended', 'Extended'],
  ['All', 'All']
];

export class BuildOptionsPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private projectRef?: CviWorkspaceProjectRef;
  private selectedScope: BuildOptionsScope = 'debug';

  constructor(
    private readonly workspaces: CviWorkspaceService,
    private readonly parser: CviParser,
    private readonly cppTools?: CviCppToolsService
  ) {}

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  show(projectRef?: CviWorkspaceProjectRef): void {
    const ref = projectRef ?? this.workspaces.activeProjectRef;
    if (!ref?.exists) {
      vscode.window.showErrorMessage('No existing CVI project is selected.');
      return;
    }
    this.projectRef = ref;
    if (!this.panel) {
      this.selectedScope = this.workspaces.currentWorkspace ? this.buildMode : 'debug';
      this.panel = vscode.window.createWebviewPanel(
        'labwindowsCvi.buildOptions',
        'CVI Project Build Options',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.projectRef = undefined;
      });
      this.panel.webview.onDidReceiveMessage((message) => void this.handleMessage(message));
    }
    this.panel.title = `CVI Build Options — ${ref.name}`;
    this.panel.webview.html = this.render(ref);
    this.panel.reveal(vscode.ViewColumn.Active);
  }

  update(): void {
    if (this.panel && this.projectRef?.exists) {
      this.panel.webview.html = this.render(this.projectRef);
    }
  }


  private mutate(ref: CviWorkspaceProjectRef, scope: BuildOptionsScope, fn: (opt: CviBuildOptions) => void): void {
    const modes = scope === 'all' ? ALL_BUILD_MODES : [scope];
    const workspacePath = this.workspaces.currentWorkspace?.path;
    for (const m of modes) {
      const opt = this.parser.getNativeBuildOptions(ref.absolutePath, workspacePath, m);
      fn(opt);
      this.parser.setNativeBuildOptions(ref.absolutePath, workspacePath, m, opt);
    }
    this.cppTools?.requestSync(this.workspaces.currentWorkspace);
    this.update();
  }

  private get buildMode(): CviBuildMode {
    return vscode.workspace.getConfiguration('labwindowsCvi').get<CviBuildMode>('buildMode', 'debug');
  }

  private representativeMode(scope: BuildOptionsScope): CviBuildMode | string {
    return scope === 'all' ? this.buildMode : scope;
  }

  private async handleMessage(message: any): Promise<void> {
    if (!this.projectRef?.exists) return;
    const ref = this.projectRef;
    const workspacePath = this.workspaces.currentWorkspace?.path;

    if (message.command === 'changeScope') {
      this.selectedScope = message.scope;
      this.update();
      return;
    }

    if (message.command === 'browsePrecompiledFile') {
      const selected = await vscode.window.showOpenDialog({
        title: 'Select precompiled include file',
        defaultUri: vscode.Uri.file(path.dirname(ref.absolutePath)),
        filters: { 'Header Files': ['h', 'hh', 'hpp'] },
        canSelectMany: false
      });
      if (selected?.[0] && this.panel) {
        this.panel.webview.postMessage({ command: 'setPrecompiledFile', path: selected[0].fsPath });
      }
      return;
    }

    if (message.command === 'save') {
      try {
        const payload: CviBuildOptions = message.options;
        const customConfigs = this.parser.getCustomConfigurations(ref.absolutePath, workspacePath);
        const modes: Array<CviBuildMode | string> =
          this.selectedScope === 'all'
            ? [...ALL_BUILD_MODES, ...customConfigs.map((c) => `custom:${c.name}`)]
            : [this.selectedScope];
        for (const mode of modes) {
          this.parser.setNativeBuildOptions(ref.absolutePath, workspacePath, mode, payload);
        }
        this.cppTools?.requestSync(this.workspaces.currentWorkspace);
        this.panel?.webview.postMessage({ command: 'saved' });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.panel?.webview.postMessage({ command: 'saveError', error: msg });
      }
    }
  }

  private render(ref: CviWorkspaceProjectRef): string {
    const scope = this.selectedScope;
    const mode = this.representativeMode(scope);
    const workspacePath = this.workspaces.currentWorkspace?.path;
    const options = this.parser.getNativeBuildOptions(ref.absolutePath, workspacePath, mode);
    const customConfigs = this.parser.getCustomConfigurations(ref.absolutePath, workspacePath);
    const is64 = mode.endsWith('64') || (typeof mode === 'string' && mode.startsWith('custom:') && (customConfigs.find(c => `custom:${c.name}` === mode)?.is64Bit ?? false));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CVI Build Options</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --card-bg: var(--vscode-sideBar-background, #1e1e1e);
      --border: var(--vscode-widget-border, #3c3c3c);
      --input-bg: var(--vscode-input-background, #252526);
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --btn-bg: var(--vscode-button-background, #0e639c);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
      --btn-sec-bg: var(--vscode-button-secondaryBackground, #3a3d41);
      --btn-sec-fg: var(--vscode-button-secondaryForeground, #ffffff);
      --accent: var(--vscode-focusBorder, #007acc);
      --font: var(--vscode-font-family, system-ui, sans-serif);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--font);
      font-size: 13px;
      padding: 20px 24px 30px;
    }
    header {
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 14px;
    }
    h1 { font-size: 18px; font-weight: 600; }
    .save-status {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .scope-selector {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    select, input[type="text"], input[type="number"], textarea {
      background-color: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--border);
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 13px;
      font-family: inherit;
    }
    select:focus, input:focus, textarea:focus {
      outline: 1px solid var(--accent);
      border-color: var(--accent);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 16px;
    }
    .card {
      background-color: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
    }
    .card-title {
      font-weight: 600;
      font-size: 14px;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      padding-bottom: 6px;
    }
    .form-group {
      margin-bottom: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .form-group label {
      font-weight: 500;
      color: var(--vscode-descriptionForeground, #999);
      font-size: 12px;
    }
    .checkbox-group {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      cursor: pointer;
    }
    .checkbox-group input[type="checkbox"] {
      cursor: pointer;
      width: 15px;
      height: 15px;
    }
    textarea {
      width: 100%;
      min-height: 70px;
      resize: vertical;
      font-family: monospace;
    }
    .btn {
      background-color: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn:hover { opacity: 0.9; }
    .btn-secondary {
      background-color: var(--btn-sec-bg);
      color: var(--btn-sec-fg);
    }
    .warning-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 8px;
      padding: 10px 12px;
      background: rgba(255,255,255,0.03);
      border-radius: 4px;
      border: 1px solid var(--border);
    }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 10px;
      font-size: 11px;
      background: rgba(255,255,255,0.1);
    }
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.65);
      z-index: 500;
      align-items: center;
      justify-content: center;
    }
    .modal {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      width: 90vw;
      max-width: 980px;
      height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    .modal-header {
      padding: 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .modal-body {
      flex: 1;
      display: flex;
      overflow: hidden;
    }
    .warning-table-container {
      flex: 3;
      overflow-y: auto;
      border-right: 1px solid var(--border);
    }
    .warning-preview {
      flex: 2;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: rgba(0,0,0,0.1);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th, td {
      padding: 8px 10px;
      text-align: left;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    th {
      position: sticky;
      top: 0;
      background: var(--card-bg);
      z-index: 2;
      border-bottom: 1px solid var(--border);
    }
    tr:hover { background: rgba(255,255,255,0.04); cursor: pointer; }
    tr.selected { background: rgba(0,122,204,0.2); }
    .modal-footer {
      padding: 12px 16px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .filter-bar {
      display: flex;
      gap: 8px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      background: rgba(0,0,0,0.08);
      align-items: center;
    }
    .filter-bar input { flex: 1; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>CVI Build Options</h1>
      <span style="color:var(--vscode-descriptionForeground); font-size:12px;">Project: ${escapeHtml(ref.name)}</span>
    </div>
    <div style="display:flex; align-items:center; gap:16px;">
      <span id="saveStatus" class="save-status">
        <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background-color:#4ec9b0;"></span>
        Saved
      </span>
      <div class="scope-selector">
        <label for="scopeSelect"><strong>Configuration:</strong></label>
        <select id="scopeSelect" onchange="changeScope(this.value)">
          <option value="debug" ${scope === 'debug' ? 'selected' : ''}>Debug (x86)</option>
          <option value="release" ${scope === 'release' ? 'selected' : ''}>Release (x86)</option>
          <option value="debug64" ${scope === 'debug64' ? 'selected' : ''}>Debug (x64)</option>
          <option value="release64" ${scope === 'release64' ? 'selected' : ''}>Release (x64)</option>
          ${customConfigs.map((c) => `<option value="custom:${escapeHtml(c.name)}" ${scope === `custom:${c.name}` ? 'selected' : ''}>${escapeHtml(c.name)} (${c.is64Bit ? 'x64' : 'x86'} ${c.isRelease ? 'Release' : 'Debug'})</option>`).join('')}
          <option value="all" ${scope === 'all' ? 'selected' : ''}>All configurations</option>
        </select>
      </div>
    </div>
  </header>

  <div class="grid">
    <!-- CODE GENERATION -->
    <div class="card">
      <div class="card-title">Code Generation</div>
      <div class="form-group">
        <label for="callingConvention">Default calling convention (32-bit):</label>
        <select id="callingConvention" ${is64 ? 'disabled' : ''}>
          <option value="cdecl" ${options.callingConvention === 'cdecl' ? 'selected' : ''}>_cdecl</option>
          <option value="stdcall" ${options.callingConvention === 'stdcall' ? 'selected' : ''}>__stdcall</option>
        </select>
      </div>
      <div class="form-group">
        <label for="stackReserve">Maximum stack size (bytes):</label>
        <input type="number" id="stackReserve" value="${options.stackReserve}" min="4096" step="4096" />
      </div>
      <div class="form-group">
        <label for="stackCommit">Stack allocation size (bytes):</label>
        <input type="number" id="stackCommit" value="${options.stackCommit}" min="512" step="512" />
      </div>
      <div class="form-group">
        <label for="imageBaseAddress">Image base address:</label>
        <input type="text" id="imageBaseAddress" value="${escapeHtml(options.imageBaseAddress)}" />
      </div>
      <div class="form-group">
        <label for="optimizationLevel">Optimization level:</label>
        <select id="optimizationLevel">
          ${OPTIMIZATION_OPTIONS.map(([val, label]) => `<option value="${escapeHtml(val)}" ${options.optimizationLevel === val ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label for="profiling">Profiling:</label>
        <select id="profiling">
          ${PROFILING_OPTIONS.map(([val, label]) => `<option value="${escapeHtml(val)}" ${options.profiling === val ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
        </select>
      </div>
    </div>

    <!-- DEBUGGING & STRICTNESS OPTIONS -->
    <div class="card">
      <div class="card-title">Debugging & Strictness</div>
      <div class="form-group">
        <label for="debuggingLevel">Debugging level:</label>
        <select id="debuggingLevel">
          ${DEBUGGING_LEVEL_OPTIONS.map(([val, label]) => `<option value="${escapeHtml(val)}" ${options.debuggingLevel === val ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
        </select>
      </div>
      <label class="checkbox-group">
        <input type="checkbox" id="detectUninitializedLocals" ${options.detectUninitializedLocalsRuntime ? 'checked' : ''} />
        <span>Detect uninitialized local variables at run time</span>
      </label>

      <div class="card-title" style="margin-top:20px;">C Language Strictness</div>
      <label class="checkbox-group">
        <input type="checkbox" id="requirePrototypes" ${options.requirePrototypes ? 'checked' : ''} />
        <span>Require function prototypes</span>
      </label>
      <label class="checkbox-group">
        <input type="checkbox" id="requireReturnValues" ${options.requireReturnValues ? 'checked' : ''} />
        <span>Require return values for non-void functions</span>
      </label>
      <div class="form-group" style="margin-top:6px;">
        <label for="uninitializedLocalsCompile">Uninitialized locals check (compiler):</label>
        <select id="uninitializedLocalsCompile">
          <option value="None" ${options.uninitializedLocalsCompile === 'None' ? 'selected' : ''}>None (Disabled)</option>
          <option value="Conservative" ${options.uninitializedLocalsCompile === 'Conservative' ? 'selected' : ''}>Conservative</option>
          <option value="Aggressive" ${options.uninitializedLocalsCompile === 'Aggressive' ? 'selected' : ''}>Aggressive (Default)</option>
        </select>
      </div>

      <div class="card-title" style="margin-top:20px;">Language Extensions</div>
      <label class="checkbox-group">
        <input type="checkbox" id="enableC99" ${options.enableC99 ? 'checked' : ''} />
        <span>Build with C99 extensions</span>
      </label>
      <label class="checkbox-group">
        <input type="checkbox" id="enableOpenMP" ${options.enableOpenMP ? 'checked' : ''} />
        <span>Enable OpenMP support</span>
      </label>

      <div class="card-title" style="margin-top:20px;">Precompiled Header</div>
      <label class="checkbox-group">
        <input type="checkbox" id="compileWithPrecompiled" ${options.compileWithPrecompiledInclude ? 'checked' : ''} />
        <span>Compile with precompiled include file</span>
      </label>
      <div class="form-group" style="display:flex; flex-direction:row; gap:8px;">
        <input type="text" id="precompiledFile" style="flex:1;" value="${escapeHtml(options.precompiledIncludeFile)}" placeholder="e.g. stdafx.h or my_header.h" />
        <button class="btn btn-secondary" type="button" onclick="browsePrecompiled()">Browse...</button>
      </div>
    </div>

    <!-- BUILD PROCESS & CONCURRENCY -->
    <div class="card" style="grid-column: 1 / -1;">
      <div class="card-title">Build Process & Multi-Threading</div>
      <div class="form-group">
        <label for="concurrentCompiles">Number of concurrent compiles:</label>
        <input type="number" id="concurrentCompiles" min="0" max="32" value="${options.concurrentCompiles ?? 0}" style="max-width:200px;" />
        <span style="font-size:11px; color:var(--vscode-descriptionForeground);">0 = Automatic (utilizes all logical CPU cores). Set a value between 1 and 32 to cap concurrent compiler processes during builds.</span>
      </div>
    </div>

    <!-- COMPILER DEFINES -->
    <div class="card" style="grid-column: 1 / -1;">
      <div class="card-title">
        <span>Compiler Defines</span>
        <button class="btn btn-secondary" type="button" onclick="openMacrosModal()" style="font-size:11px; padding:3px 8px;">Predefined Macros...</button>
      </div>
      <div class="form-group">
        <label for="compilerDefines">Preprocessor macro definitions:</label>
        <textarea id="compilerDefines" spellcheck="false">${escapeHtml(options.compilerDefines)}</textarea>
        <span style="font-size:11px; color:var(--vscode-descriptionForeground);">Example: /DWIN32_LEAN_AND_MEAN /DANTIGRAVITY /DCONTVAL=4</span>
      </div>
    </div>

    <!-- COMPILER WARNINGS -->
    <div class="card" style="grid-column: 1 / -1;">
      <div class="card-title">Compiler Warnings (Clang 3.3 Engine)</div>
      <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
        <div class="form-group" style="margin-bottom:0; min-width:200px;">
          <label for="warningLevel">Warning level:</label>
          <select id="warningLevel" onchange="onWarningLevelChange(this.value)">
            ${WARNING_LEVEL_OPTIONS.map(([val, label]) => `<option value="${escapeHtml(val)}" ${options.selectedWarningLevel === val ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-secondary" type="button" onclick="openWarningsModal()" style="margin-top:16px;">
          <span>Configure Warning Flags (139 Warnings)...</span>
        </button>
      </div>

      <div style="margin-top:14px; border-top:1px solid rgba(255,255,255,0.06); padding-top:12px; display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap:8px;">
        <label class="checkbox-group" style="margin-bottom:0;">
          <input type="checkbox" id="enableUnreferencedIdentifiers" ${options.enableUnreferencedIdentifiersWarning ? 'checked' : ''} />
          <span>Unreferenced identifiers</span>
        </label>
        <label class="checkbox-group" style="margin-bottom:0;">
          <input type="checkbox" id="enablePointerMismatch" ${options.enablePointerMismatchWarning ? 'checked' : ''} />
          <span>Pointer type mismatch</span>
        </label>
        <label class="checkbox-group" style="margin-bottom:0;">
          <input type="checkbox" id="enableUnreachableCode" ${options.enableUnreachableCodeWarning ? 'checked' : ''} />
          <span>Unreachable code</span>
        </label>
        <label class="checkbox-group" style="margin-bottom:0;">
          <input type="checkbox" id="enableAssignmentInConditional" ${options.enableAssignmentInConditionalWarning ? 'checked' : ''} />
          <span>Assignment in conditional</span>
        </label>
      </div>

      <div class="warning-summary">
        <div>
          <span>Status: </span>
          <strong id="warningSummaryText"></strong>
        </div>
        <label class="checkbox-group" style="margin-bottom:0;">
          <input type="checkbox" id="showWarningFlagsInOutput" ${options.showWarningFlagsInBuildOutput ? 'checked' : ''} />
          <span style="font-size:12px;">Show warning flags in Build Output window</span>
        </label>
      </div>
    </div>
  </div>

  <!-- COMPILER WARNINGS MODAL -->
  <div id="warningsModal" class="modal-overlay">
    <div class="modal">
      <div class="modal-header">
        <h2>Compiler Warnings Configuration</h2>
        <button class="btn btn-secondary" onclick="closeWarningsModal()">✕</button>
      </div>
      <div class="filter-bar">
        <input type="text" id="warningSearch" placeholder="Search by name, flag (-W...) or description..." oninput="filterWarnings()" />
        <select id="warningFilterLevel" onchange="filterWarnings()">
          <option value="ALL">All Levels (139)</option>
          <option value="Common">Common Only</option>
          <option value="Extended">Extended Only</option>
          <option value="All">All level Only</option>
        </select>
        <button class="btn btn-secondary" onclick="restoreWarningDefaults()">Restore to default</button>
      </div>
      <div class="modal-body">
        <div class="warning-table-container">
          <table>
            <thead>
              <tr>
                <th style="width:40px; text-align:center;">Enabled</th>
                <th>Warning Name</th>
                <th>Flag</th>
                <th style="width:80px;">Level</th>
                <th style="width:60px; text-align:center;">Error</th>
              </tr>
            </thead>
            <tbody id="warningTableBody"></tbody>
          </table>
        </div>
        <div class="warning-preview" id="warningDetailPane">
          <h3 id="previewTitle" style="font-size:14px;">Select a warning</h3>
          <div id="previewFlag" style="font-family:monospace; color:var(--accent);"></div>
          <p id="previewDesc" style="font-size:12px; line-height:1.5; color:var(--vscode-descriptionForeground);"></p>
        </div>
      </div>
      <div class="modal-footer">
        <span id="modalWarningCount" style="font-size:12px; color:var(--vscode-descriptionForeground);"></span>
        <button class="btn" onclick="closeWarningsModal()">Done</button>
      </div>
    </div>
  </div>

  <!-- PREDEFINED MACROS MODAL -->
  <div id="macrosModal" class="modal-overlay">
    <div class="modal" style="max-width:600px; height:auto; max-height:80vh;">
      <div class="modal-header">
        <h2>Predefined Preprocessor Macros</h2>
        <button class="btn btn-secondary" onclick="closeMacrosModal()">✕</button>
      </div>
      <div style="padding:16px; overflow-y:auto; font-size:12px; line-height:1.6;">
        <p style="margin-bottom:10px;">LabWindows/CVI and the Clang compiler automatically define the following macros based on the project configuration:</p>
        <ul style="margin-left:20px; font-family:monospace; margin-bottom:14px;">
          <li><strong>_CVI_</strong> : Defined as CVI version (e.g. "2000" for CVI 2020)</li>
          <li><strong>_CVI_DEBUG_</strong> : Defined as 1 in Debug configurations</li>
          <li><strong>_CVI_EXE_</strong> / <strong>_CVI_DLL_</strong> / <strong>_CVI_LIB_</strong> : Target type identifier</li>
          <li><strong>_NI_mswin32_</strong> / <strong>_NI_i386_</strong> : Defined in 32-bit builds</li>
          <li><strong>_NI_mswin64_</strong> / <strong>_NI_x64_</strong> : Defined in 64-bit builds</li>
          <li><strong>_WIN32</strong> / <strong>WIN32</strong> : Defined for all Windows targets</li>
          <li><strong>_CVI_C99_EXTENSIONS_</strong> : Defined as 1 when C99 is enabled</li>
          <li><strong>_CVI_RTE_SHARED_</strong> : Defined when using shared runtime engine</li>
          <li><strong>CVI_UTF8</strong> : Defined when project encoding is set to UTF-8</li>
        </ul>
      </div>
      <div class="modal-footer" style="justify-content:flex-end;">
        <button class="btn" onclick="closeMacrosModal()">Close</button>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const catalog = ${JSON.stringify(CVI_WARNING_CATALOG)};

    let currentWarningLevel = "${escapeJs(options.selectedWarningLevel)}";
    let disabledWarningIds = new Set(${JSON.stringify(options.disabledWarningIds)});
    let errorWarningIds = new Set(${JSON.stringify(options.errorWarningIds)});
    let selectedWarningId = null;
    let autoSaveTimer = null;

    function setSaveStatus(text, color) {
      const el = document.getElementById('saveStatus');
      if (el) {
        el.innerHTML = \`<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background-color:\${color};"></span> \${text}\`;
      }
    }

    function triggerAutoSave(delay = 350) {
      setSaveStatus('Saving...', '#cca700');
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        save();
      }, delay);
    }

    function escapeHtml(str) {
      return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function changeScope(scope) {
      vscode.postMessage({ command: 'changeScope', scope });
    }

    function browsePrecompiled() {
      vscode.postMessage({ command: 'browsePrecompiledFile' });
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'setPrecompiledFile') {
        document.getElementById('precompiledFile').value = msg.path;
        triggerAutoSave(50);
      } else if (msg.command === 'saved') {
        setSaveStatus('Saved', '#4ec9b0');
      } else if (msg.command === 'saveError') {
        setSaveStatus('Save error', '#f44336');
      }
    });

    function isWarningActiveByDefault(w, level) {
      if (level === 'None') return false;
      if (level === 'Common') return w.level === 'Common';
      if (level === 'Extended') return w.level === 'Common' || w.level === 'Extended';
      return true; // 'All'
    }

    function isWarningActive(w) {
      const activeByDefault = isWarningActiveByDefault(w, currentWarningLevel);
      if (activeByDefault) {
        return !disabledWarningIds.has(w.id);
      } else {
        return false;
      }
    }

    function updateSummary() {
      let activeCount = 0;
      catalog.forEach(w => { if (isWarningActive(w)) activeCount++; });
      const summary = \`\${activeCount} of 139 warnings enabled · \${disabledWarningIds.size} disabled · \${errorWarningIds.size} treated as error\`;
      document.getElementById('warningSummaryText').textContent = summary;
      const modalCount = document.getElementById('modalWarningCount');
      if (modalCount) modalCount.textContent = summary;
    }

    function renderWarningTable() {
      const tbody = document.getElementById('warningTableBody');
      const search = (document.getElementById('warningSearch')?.value || '').toLowerCase();
      const levelFilter = document.getElementById('warningFilterLevel')?.value || 'ALL';

      let html = '';
      for (const w of catalog) {
        if (levelFilter !== 'ALL' && w.level !== levelFilter) continue;
        if (search && !w.name.toLowerCase().includes(search) && !w.flag.toLowerCase().includes(search) && !w.description.toLowerCase().includes(search)) {
          continue;
        }

        const active = isWarningActive(w);
        const isError = errorWarningIds.has(w.id);
        const isSel = selectedWarningId === w.id;

        html += \`<tr class="\${isSel ? 'selected' : ''}" onclick="selectWarning(\${w.id})">
          <td style="text-align:center;">
            <input type="checkbox" \${active ? 'checked' : ''} onclick="event.stopPropagation(); toggleWarningActive(\${w.id}, this.checked)" />
          </td>
          <td><strong>\${escapeHtml(w.name)}</strong></td>
          <td style="font-family:monospace; font-size:11px; color:var(--accent);">\${escapeHtml(w.flag)}</td>
          <td><span class="badge">\${w.level}</span></td>
          <td style="text-align:center;">
            <input type="checkbox" \${isError ? 'checked' : ''} onclick="event.stopPropagation(); toggleWarningError(\${w.id}, this.checked)" />
          </td>
        </tr>\`;
      }
      tbody.innerHTML = html;
      updateSummary();
    }

    function selectWarning(id) {
      selectedWarningId = id;
      const w = catalog.find(x => x.id === id);
      if (w) {
        document.getElementById('previewTitle').textContent = w.name;
        document.getElementById('previewFlag').textContent = w.flag + ' (' + w.level + ')';
        document.getElementById('previewDesc').textContent = w.description || 'No additional documentation available.';
      }
      renderWarningTable();
    }

    function toggleWarningActive(id, checked) {
      const w = catalog.find(x => x.id === id);
      if (!w) return;
      const activeByDefault = isWarningActiveByDefault(w, currentWarningLevel);
      if (activeByDefault) {
        if (checked) disabledWarningIds.delete(id);
        else disabledWarningIds.add(id);
      }
      renderWarningTable();
      triggerAutoSave(150);
    }

    function toggleWarningError(id, checked) {
      if (checked) {
        errorWarningIds.add(id);
        disabledWarningIds.delete(id);
      } else {
        errorWarningIds.delete(id);
      }
      renderWarningTable();
      triggerAutoSave(150);
    }

    function onWarningLevelChange(newLevel) {
      currentWarningLevel = newLevel;
      disabledWarningIds.clear();
      errorWarningIds.clear();
      renderWarningTable();
      triggerAutoSave(150);
    }

    function restoreWarningDefaults() {
      disabledWarningIds.clear();
      errorWarningIds.clear();
      renderWarningTable();
      triggerAutoSave(150);
    }

    function filterWarnings() {
      renderWarningTable();
    }

    function openWarningsModal() {
      document.getElementById('warningsModal').style.display = 'flex';
      renderWarningTable();
      if (!selectedWarningId && catalog.length > 0) selectWarning(catalog[0].id);
    }

    function closeWarningsModal() {
      document.getElementById('warningsModal').style.display = 'none';
      updateSummary();
    }

    function openMacrosModal() {
      document.getElementById('macrosModal').style.display = 'flex';
    }

    function closeMacrosModal() {
      document.getElementById('macrosModal').style.display = 'none';
    }

    function save() {
      const payload = {
        callingConvention: document.getElementById('callingConvention').value,
        stackReserve: Number(document.getElementById('stackReserve').value) || 1048576,
        stackCommit: Number(document.getElementById('stackCommit').value) || 4096,
        imageBaseAddress: document.getElementById('imageBaseAddress').value.trim() || '0x00400000',
        optimizationLevel: document.getElementById('optimizationLevel').value,
        profiling: document.getElementById('profiling').value,
        debuggingLevel: document.getElementById('debuggingLevel').value,
        detectUninitializedLocalsRuntime: document.getElementById('detectUninitializedLocals').checked,
        compilerDefines: document.getElementById('compilerDefines').value.trim(),
        selectedWarningLevel: currentWarningLevel,
        showWarningFlagsInBuildOutput: document.getElementById('showWarningFlagsInOutput').checked,
        enableC99: document.getElementById('enableC99').checked,
        enableOpenMP: document.getElementById('enableOpenMP').checked,
        compileWithPrecompiledInclude: document.getElementById('compileWithPrecompiled').checked,
        precompiledIncludeFile: document.getElementById('precompiledFile').value.trim(),
        disabledWarningIds: Array.from(disabledWarningIds),
        errorWarningIds: Array.from(errorWarningIds),
        requirePrototypes: document.getElementById('requirePrototypes').checked,
        requireReturnValues: document.getElementById('requireReturnValues').checked,
        uninitializedLocalsCompile: document.getElementById('uninitializedLocalsCompile').value,
        enableUnreferencedIdentifiersWarning: document.getElementById('enableUnreferencedIdentifiers').checked,
        enablePointerMismatchWarning: document.getElementById('enablePointerMismatch').checked,
        enableUnreachableCodeWarning: document.getElementById('enableUnreachableCode').checked,
        enableAssignmentInConditionalWarning: document.getElementById('enableAssignmentInConditional').checked,
        concurrentCompiles: Number(document.getElementById('concurrentCompiles').value) || 0
      };

      vscode.postMessage({ command: 'save', options: payload });
    }

    document.querySelectorAll('input, select, textarea').forEach(el => {
      if (el.id === 'scopeSelect' || el.id === 'warningSearch' || el.id === 'warningFilterLevel') return;
      if (el.type === 'checkbox' || el.tagName === 'SELECT') {
        el.addEventListener('change', () => triggerAutoSave(50));
      } else {
        el.addEventListener('input', () => triggerAutoSave(350));
        el.addEventListener('change', () => triggerAutoSave(50));
      }
    });

    updateSummary();
  </script>
</body>
</html>`;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeJs(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
}

function scopeLabel(scope: BuildOptionsScope): string {
  if (scope.startsWith('custom:')) {
    return scope.substring(7);
  }
  switch (scope) {
    case 'debug': return 'Debug (x86)';
    case 'release': return 'Release (x86)';
    case 'debug64': return 'Debug (x64)';
    case 'release64': return 'Release (x64)';
    case 'all': return 'All build configurations';
    default: return scope;
  }
}

function scopeChoices(): Array<{ id: BuildOptionsScope; label: string; description: string }> {
  return [
    { id: 'debug', label: '$(gear) Debug x86', description: 'Apply only to 32-bit Debug configuration' },
    { id: 'release', label: '$(rocket) Release x86', description: 'Apply only to 32-bit Release configuration' },
    { id: 'debug64', label: '$(gear) Debug x64', description: 'Apply only to 64-bit Debug configuration' },
    { id: 'release64', label: '$(rocket) Release x64', description: 'Apply only to 64-bit Release configuration' },
    { id: 'all', label: '$(layers) All configurations', description: 'Apply build options to all 4 configurations' }
  ];
}
