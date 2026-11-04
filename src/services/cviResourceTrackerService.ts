import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CviResourceItem, CviResourceSnapshot, formatBytes, parseResourceDump } from '../model/cviResourceModel';

export class CviResourceTrackerService implements vscode.Disposable {
  private readonly _onDidChangeData = new vscode.EventEmitter<void>();
  public readonly onDidChangeData: vscode.Event<void> = this._onDidChangeData.event;

  private currentSnapshot: CviResourceSnapshot | null = null;
  private lastSessionLeaks: CviResourceSnapshot | null = null;
  private exitSnapshot: CviResourceSnapshot | null = null;
  private activeCviSession: vscode.DebugSession | null = null;
  private dumpFilePath: string | null = null;
  private disposables: vscode.Disposable[] = [];
  private isRefreshing = false;
  private sessionExitedNaturally = false;

  constructor(
    private readonly output: vscode.OutputChannel
  ) {
    this.registerDebugLifecycle();
  }

  get snapshot(): CviResourceSnapshot | null {
    return this.currentSnapshot ?? this.lastSessionLeaks;
  }

  get isSessionActive(): boolean {
    return !!this.activeCviSession;
  }

  get hasLeaks(): boolean {
    return !!this.lastSessionLeaks && this.lastSessionLeaks.items.length > 0;
  }

  private isCviSession(session: vscode.DebugSession): boolean {
    if (session.type === 'cvi') {
      return true;
    }
    if (session.type === 'cppdbg') {
      const name = session.name.toLowerCase();
      const config = session.configuration;
      return name.includes('cvi') || !!config?.cviProject || !!config?.program?.toLowerCase().includes('cvi');
    }
    return false;
  }

  private registerDebugLifecycle(): void {
    // 1. Session start
    this.disposables.push(
      vscode.debug.onDidStartDebugSession((session) => {
        if (!this.isCviSession(session)) {
          return;
        }
        this.activeCviSession = session;
        this.lastSessionLeaks = null;
        this.dumpFilePath = path.join(os.tmpdir(), 'cvi_res_dump.txt');
        this.sessionExitedNaturally = false;

        this.currentSnapshot = {
          sessionId: session.id,
          timestamp: new Date(),
          isActiveSession: true,
          totalBytes: 0,
          items: [],
          summary: {
            totalCount: 0,
            memoryCount: 0,
            uiCount: 0,
            fileCount: 0,
            threadCount: 0,
            communicationCount: 0,
            otherCount: 0
          }
        };

        this.output.appendLine(`[CVI Resources] Debug session started: ${session.name}. Resource tracker initialized.`);
        this._onDidChangeData.fire();
      })
    );

    // 2. Session terminate
    this.disposables.push(
      vscode.debug.onDidTerminateDebugSession((session) => {
        if (this.activeCviSession?.id !== session.id) {
          return;
        }
        this.finalizeSession();
      })
    );

    // 3. Debug adapter tracker for breakpoints / pause
    this.disposables.push(
      vscode.debug.registerDebugAdapterTrackerFactory('cppdbg', {
        createDebugAdapterTracker: (session: vscode.DebugSession) => {
          if (!this.isCviSession(session)) {
            return undefined;
          }

          return {
            onDidSendMessage: async (message: any) => {
              if (message.type === 'event' && message.event === 'output') {
                const outText = message.body?.output ?? '';
                if (outText.includes('[LABWINDOWS/CVI RUN-TIME CHECK ERROR]')) {
                  this.output.appendLine('[CVI Runtime] ⚠️ LabWindows/CVI Run-Time Check Error encountered! Execution paused.');
                  void vscode.window.showWarningMessage('LabWindows/CVI Run-Time Check Error: Execution paused at failed run-time check (e.g. uninitialized variable or bounds check). See Debug Console and source line.');
                } else if (outText.includes('[LABWINDOWS/CVI LIBRARY ERROR]')) {
                  this.output.appendLine('[CVI Runtime] ⚠️ LabWindows/CVI Library Error encountered! Execution paused.');
                  void vscode.window.showWarningMessage('LabWindows/CVI Library Error: A library function reported an error. Check Call Stack in VS Code.');
                } else if (outText.includes('[LABWINDOWS/CVI ASSERTION FAILURE]')) {
                  this.output.appendLine('[CVI Runtime] ⚠️ LabWindows/CVI Assertion Failed! Execution paused.');
                  void vscode.window.showWarningMessage('LabWindows/CVI Assertion: CVIAssert() failed. Check Call Stack in VS Code.');
                }
                return;
              }

              if (message.type === 'event' && message.event === 'exited') {
                this.sessionExitedNaturally = true;
                this.output.appendLine(`[CVI Resources] Target process exited naturally (code: ${message.body?.exitCode ?? 0}).`);
                return;
              }

              if (message.type === 'event' && message.event === 'stopped') {
                const reason = message.body?.reason ?? 'breakpoint';
                if (reason === 'exception' && typeof message.body?.description === 'string' && message.body.description.includes('breakpoint')) {
                  message.body.description = 'LabWindows/CVI Run-Time Check Error: variable uninitialized, array bounds, or assertion check failed.';
                }
                this.output.appendLine(`[CVI Resources] Target stopped (reason: ${reason}). Querying live resources...`);
                const autoRefresh = vscode.workspace.getConfiguration('labwindowsCvi').get<boolean>('resourceTracking.autoRefreshOnBreakpoint', true);
                if (autoRefresh) {
                  void this.refreshFromSession(session);
                }
              }
            }
          };
        }
      })
    );
  }

  /**
   * Triggers an evaluation inside GDB to dump active CVI resources and refreshes the tree.
   */
  async refreshFromSession(session?: vscode.DebugSession): Promise<void> {
    const targetSession = session ?? this.activeCviSession ?? vscode.debug.activeDebugSession;
    if (!targetSession || this.isRefreshing) {
      return;
    }

    this.isRefreshing = true;
    try {
      if (!this.dumpFilePath) {
        this.dumpFilePath = path.join(os.tmpdir(), 'cvi_res_dump.txt');
        this.sessionExitedNaturally = false;
      }

      // Remove stale dump file if present
      if (fs.existsSync(this.dumpFilePath)) {
        try {
          fs.unlinkSync(this.dumpFilePath);
        } catch {
          // ignore
        }
      }

      const normalizedDumpPath = this.dumpFilePath.replace(/\\/g, '/');

      // 1. Prepare raw buffer via VirtualAlloc to bypass CVI CRT malloc tracking entirely!
      const strLen = normalizedDumpPath.length + 1;
      const prepareCommands = [
        '-exec call (void)__SetCurrentDebuggingLevel(3)',
        '-exec call (int)SetEnableResourceTracking(1)',
        '-exec set $cvi_buf = (char*)VirtualAlloc(0, 512, 0x1000, 4)',
        `-exec set {char[${strLen}]}$cvi_buf = "${normalizedDumpPath}"`
      ];
      for (const cmd of prepareCommands) {
        try {
          await targetSession.customRequest('evaluate', { expression: cmd, context: 'repl' });
        } catch {
          // ignore
        }
      }

      // 2. Invoke __CVI_Resource_DumpToFile using $cvi_buf (no string literal -> zero CRT mallocs!)
      const dumpCommands = [
        '-exec call (int)__CVI_Resource_DumpToFile($cvi_buf)',
        '-exec p (int)__CVI_Resource_DumpToFile($cvi_buf)',
        `-exec call (int)__CVI_Resource_DumpToFile("${normalizedDumpPath}")`,
        `call (int)__CVI_Resource_DumpToFile("${normalizedDumpPath}")`
      ];

      let dumpSuccess = false;
      for (const cmd of dumpCommands) {
        try {
          const res = await targetSession.customRequest('evaluate', { expression: cmd, context: 'repl' });
          this.output.appendLine(`[CVI Resources] Sent: ${cmd} -> Result: ${JSON.stringify(res)}`);

          if (fs.existsSync(this.dumpFilePath)) {
            const stat = fs.statSync(this.dumpFilePath);
            this.output.appendLine(`[CVI Resources] Dump file generated: ${this.dumpFilePath} (${stat.size} bytes).`);
            dumpSuccess = true;
            break;
          }
        } catch (err: any) {
          const msg = err?.message || String(err);
          this.output.appendLine(`[CVI Resources] Command '${cmd}' failed: ${msg}`);
        }
      }

      // 3. Read dump file if generated
      if (dumpSuccess && fs.existsSync(this.dumpFilePath)) {
        const content = fs.readFileSync(this.dumpFilePath, 'utf8');
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        let defaultSourceFile = vscode.window.activeTextEditor?.document.fileName;
        if (!defaultSourceFile && workspaceRoot) {
          try {
            const findC = (dir: string): string | undefined => {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const e of entries) {
                if (e.isFile() && e.name.endsWith('.c') && !e.name.startsWith('.')) {
                  return path.join(dir, e.name);
                }
                if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '.git') {
                  const sub = findC(path.join(dir, e.name));
                  if (sub) {
                    return sub;
                  }
                }
              }
              return undefined;
            };
            defaultSourceFile = findC(workspaceRoot);
          } catch {
            // ignore
          }
        }
        const parsed = parseResourceDump(content, workspaceRoot, defaultSourceFile);
        parsed.sessionId = targetSession.id;
        parsed.isActiveSession = true;
        this.currentSnapshot = parsed;
        this.output.appendLine(`[CVI Resources] Parsed ${parsed.items.length} active resource allocations (${formatBytes(parsed.totalBytes)}).`);
      } else {
        this.output.appendLine('[CVI Resources] No dump file was produced by CVI runtime. Verify that:');
        this.output.appendLine('  1. Project Build Mode is set to Debug64 or Debug.');
        this.output.appendLine('  2. Debugging Level is set to Extended.');
        this.output.appendLine('  3. In code, SetEnableResourceTracking(1) is called (from <utility.h>).');
      }
    } catch (error) {
      this.output.appendLine(`[CVI Resources] Error querying resource tracker: ${error}`);
    } finally {
      this.isRefreshing = false;
      this._onDidChangeData.fire();
    }
  }

  /**
   * Finalizes session upon program exit, checking if any resources were leaked.
   */
  private finalizeSession(): void {
    const dumpFile = this.dumpFilePath ?? path.join(os.tmpdir(), 'cvi_res_dump.txt');
    if (this.sessionExitedNaturally && fs.existsSync(dumpFile)) {
      const content = fs.readFileSync(dumpFile, 'utf8');
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      let defaultSourceFile = vscode.window.activeTextEditor?.document.fileName;
      if (!defaultSourceFile && workspaceRoot) {
        try {
          const findC = (dir: string): string | undefined => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
              if (e.isFile() && e.name.endsWith('.c') && !e.name.startsWith('.')) {
                return path.join(dir, e.name);
              }
              if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '.git') {
                const sub = findC(path.join(dir, e.name));
                if (sub) {
                  return sub;
                }
              }
            }
            return undefined;
          };
          defaultSourceFile = findC(workspaceRoot);
        } catch {
          // ignore
        }
      }
      const parsed = parseResourceDump(content, workspaceRoot, defaultSourceFile);
      if (parsed.items.length > 0) {
        const leakedItems = parsed.items.map((item) => ({ ...item, isLeaked: true }));
        this.lastSessionLeaks = {
          ...parsed,
          isActiveSession: false,
          isCleanExit: false,
          items: leakedItems
        };

        this.output.appendLine(`[CVI Resources] ⚠️ Program terminated with ${leakedItems.length} unreleased resources (${formatBytes(this.lastSessionLeaks.totalBytes)}).`);
        for (const item of leakedItems) {
          const varStr = item.variableName ? ` [${item.variableName}]` : '';
          const loc = item.sourceFile ? ` at ${path.basename(item.sourceFile)}:${item.lineNumber ?? 0}` : '';
          this.output.appendLine(`  - [${item.typeLabel}] ${item.id}${varStr}${loc} (${formatBytes(item.sizeBytes)})`);
        }

        const notify = vscode.workspace.getConfiguration('labwindowsCvi').get<boolean>('resourceTracking.notifyOnLeaks', true);
        if (notify) {
          void vscode.window.showWarningMessage(
            `LabWindows/CVI: ${leakedItems.length} resource leak(s) detected (${formatBytes(this.lastSessionLeaks.totalBytes)}). Check the CVI Resource Tracking view.`,
            'Open View'
          ).then((action) => {
            if (action === 'Open View') {
              void vscode.commands.executeCommand('workbench.view.debug');
            }
          });
        }
      } else {
        // Normal termination: Clean exit, no leaks
        this.lastSessionLeaks = {
          timestamp: new Date(),
          isActiveSession: false,
          isCleanExit: true,
          totalBytes: 0,
          items: [],
          summary: {
            totalCount: 0,
            memoryCount: 0,
            uiCount: 0,
            fileCount: 0,
            threadCount: 0,
            communicationCount: 0,
            otherCount: 0
          }
        };
        this.output.appendLine('[CVI Resources] ✅ Program terminated cleanly. No resource leaks detected.');
      }
    } else {
      // Normal termination without leaks or session aborted by user
      this.lastSessionLeaks = {
        timestamp: new Date(),
        isActiveSession: false,
        isCleanExit: true,
        totalBytes: 0,
        items: [],
        summary: {
          totalCount: 0,
          memoryCount: 0,
          uiCount: 0,
          fileCount: 0,
          threadCount: 0,
          communicationCount: 0,
          otherCount: 0
        }
      };
      if (this.sessionExitedNaturally) {
        this.output.appendLine('[CVI Resources] ✅ Program terminated cleanly. No resource leaks detected.');
      } else {
        this.output.appendLine('[CVI Resources] Debug session ended.');
      }
    }

    // Clean up temporary dump file
    if (this.dumpFilePath && fs.existsSync(this.dumpFilePath)) {
      try {
        fs.unlinkSync(this.dumpFilePath);
      } catch {
        // ignore
      }
    }

    this.activeCviSession = null;
    this.currentSnapshot = null;
    this._onDidChangeData.fire();
  }

  clear(): void {
    this.currentSnapshot = null;
    this.lastSessionLeaks = null;
    this._onDidChangeData.fire();
  }

  async exportReport(): Promise<void> {
    const snap = this.snapshot;
    if (!snap || snap.items.length === 0) {
      vscode.window.showInformationMessage('No CVI resource data available to export.');
      return;
    }

    const lines: string[] = [
      '# LabWindows/CVI Resource Tracking Report',
      `* Generated: ${new Date().toLocaleString()}`,
      `* Status: ${snap.isActiveSession ? 'Active Debug Session' : snap.isCleanExit ? 'Clean Exit (No Leaks)' : 'Terminated with Leaks'}`,
      `* Total Tracked Items: ${snap.summary.totalCount}`,
      `* Total Tracked Memory: ${formatBytes(snap.totalBytes)}`,
      '',
      '## Summary by Category',
      `- Dynamic Memory: ${snap.summary.memoryCount}`,
      `- User Interface: ${snap.summary.uiCount}`,
      `- Files & Handles: ${snap.summary.fileCount}`,
      `- Threads & Synchronization: ${snap.summary.threadCount}`,
      `- Communication: ${snap.summary.communicationCount}`,
      `- Other: ${snap.summary.otherCount}`,
      '',
      '## Allocated Resources',
      '| Handle / Address | Type | Size | Source Location | Leaked |',
      '| ---------------- | ---- | ---- | --------------- | ------ |'
    ];

    for (const item of snap.items) {
      const loc = item.sourceFile ? `${path.basename(item.sourceFile)}:${item.lineNumber ?? 0}` : '-';
      lines.push(`| \`${item.id}\` | ${item.typeLabel} | ${formatBytes(item.sizeBytes) || '-'} | ${loc} | ${item.isLeaked ? '⚠️ YES' : 'No'} |`);
    }

    const doc = await vscode.workspace.openTextDocument({
      content: lines.join('\n'),
      language: 'markdown'
    });
    await vscode.window.showTextDocument(doc);
  }

  dispose(): void {
    this.finalizeSession();
    for (const d of this.disposables) {
      d.dispose();
    }
    this._onDidChangeData.dispose();
  }
}
