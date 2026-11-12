import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CviCpuStripchartPanel } from '../views/cviCpuStripchartPanel';

export type CviThreadRole = 'main' | 'pool' | 'worker' | 'runtime';

export interface CviStackFrameInfo {
  id: number;
  name: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface CviThreadInfo {
  id: number;
  osThreadId?: number;
  name: string;
  role: CviThreadRole;
  roleLabel: string;
  status: string;
  state?: string;
  waitReason?: string;
  priority?: string;
  cpuMs?: number;
  entryPoint?: string;
  module?: string;
  topFrame?: CviStackFrameInfo;
  frames: CviStackFrameInfo[];
}

export interface CviProcessDebugInfo {
  sessionId: string;
  sessionName: string;
  processName?: string;
  processId?: number;
  cpuPercent?: number;
  cpuHistory?: Array<{ time: number; cpuPercent: number }>;
  threads: CviThreadInfo[];
  updatedAt: Date;
}

export class CviThreadTrackerService implements vscode.Disposable {
  private readonly _onDidChangeThreads = new vscode.EventEmitter<void>();
  public readonly onDidChangeThreads: vscode.Event<void> = this._onDidChangeThreads.event;

  private currentProcessInfo: CviProcessDebugInfo | null = null;
  private activeSession: vscode.DebugSession | null = null;
  private disposables: vscode.Disposable[] = [];
  private helperProcess: cp.ChildProcess | null = null;
  private helperStdoutBuffer = '';
  private historyBuffer: Array<{ time: number; cpuPercent: number }> = [];

  constructor(private readonly output: vscode.OutputChannel) {
    this.registerDebugLifecycle();
  }

  dispose(): void {
    this.stopNativeTelemetry();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this._onDidChangeThreads.dispose();
  }

  get processInfo(): CviProcessDebugInfo | null {
    return this.currentProcessInfo;
  }

  get isSessionActive(): boolean {
    return !!this.activeSession;
  }

  get cpuHistory(): Array<{ time: number; cpuPercent: number }> {
    return [...this.historyBuffer];
  }

  private isCviSession(session: vscode.DebugSession): boolean {
    if (session.type === 'cvi') {
      return true;
    }
    if (session.type === 'cppdbg') {
      const name = session.name.toLowerCase();
      const config = session.configuration;
      return (
        name.includes('cvi') ||
        !!config?.cviProject ||
        (typeof config?.program === 'string' && config.program.toLowerCase().includes('cvi')) ||
        true
      );
    }
    return false;
  }

  private registerDebugLifecycle(): void {
    // 1. Debug Session Start
    this.disposables.push(
      vscode.debug.onDidStartDebugSession((session) => {
        if (!this.isCviSession(session)) return;
        this.activeSession = session;
        this.historyBuffer = [];

        const program = session.configuration?.program as string | undefined;
        const procName = program ? path.basename(program, path.extname(program)) : undefined;

        this.currentProcessInfo = {
          sessionId: session.id,
          sessionName: session.name,
          processName: procName,
          threads: [],
          cpuHistory: [],
          updatedAt: new Date()
        };

        void vscode.commands.executeCommand('setContext', 'labwindowsCvi.hasActiveDebugSession', true);
        this._onDidChangeThreads.fire();
        this.startNativeTelemetry();
        CviCpuStripchartPanel.currentPanel?.setSessionActive(true);
      })
    );

    // 2. Debug Session Terminate
    this.disposables.push(
      vscode.debug.onDidTerminateDebugSession((session) => {
        if (this.activeSession?.id !== session.id) return;
        this.stopNativeTelemetry();
        this.activeSession = null;
        this.currentProcessInfo = null;
        this.historyBuffer = [];
        void vscode.commands.executeCommand('setContext', 'labwindowsCvi.hasActiveDebugSession', false);
        this._onDidChangeThreads.fire();
        CviCpuStripchartPanel.currentPanel?.setSessionActive(false);
      })
    );

    // 3. Adapter tracker for cppdbg and cvi
    const trackerFactory: vscode.DebugAdapterTrackerFactory = {
      createDebugAdapterTracker: (session: vscode.DebugSession) => {
        if (!this.isCviSession(session)) return undefined;
        return {
          onDidSendMessage: (message: any) => {
            if (message.type === 'response' && message.command === 'initialize') {
              if (message.body) {
                message.body.supportsReadMemoryRequest = false;
                message.body.supportsWriteMemoryRequest = false;
              }
            } else if (message.type === 'event') {
              if (message.event === 'process' && message.body?.systemProcessId) {
                if (this.currentProcessInfo) {
                  this.currentProcessInfo.processId = message.body.systemProcessId;
                  if (message.body.name) {
                    this.currentProcessInfo.processName = path.basename(message.body.name, path.extname(message.body.name));
                  }
                  this._onDidChangeThreads.fire();
                  if (!this.helperProcess) {
                    this.startNativeTelemetry();
                  }
                }
              } else if (message.event === 'stopped') {
                // Intercept pause / exception "Signal 0"
                if (message.body && message.body.reason === 'exception') {
                  const desc = String(message.body.description || message.body.text || '');
                  if (desc.includes('Signal 0') || desc.includes('SIGINT') || desc.includes('Interrupt') || desc.includes('0x0')) {
                    message.body.reason = 'pause';
                    message.body.description = 'Paused by user';
                    delete message.body.text;
                  }
                }
                this.onTargetStopped(message.body?.threadId);
              } else if (message.event === 'continued' || message.event === 'thread') {
                void this.captureDapStackFrames();
              }
            }
          }
        };
      }
    };

    this.disposables.push(vscode.debug.registerDebugAdapterTrackerFactory('cppdbg', trackerFactory));
    this.disposables.push(vscode.debug.registerDebugAdapterTrackerFactory('cvi', trackerFactory));
  }

  private startNativeTelemetry(): void {
    this.stopNativeTelemetry();

    const enabled = vscode.workspace.getConfiguration('labwindowsCvi').get<boolean>('debug.enableTelemetry', true);
    if (!enabled || !this.currentProcessInfo) return;

    // Locate helper executable in bin/
    const helperPath = path.resolve(__dirname, '..', '..', 'bin', 'cvi_telemetry.exe');
    if (!fs.existsSync(helperPath)) {
      this.output.appendLine(`[CVI Telemetry] Native helper not found at: ${helperPath}`);
      return;
    }

    const target = this.currentProcessInfo.processId
      ? String(this.currentProcessInfo.processId)
      : (this.currentProcessInfo.processName ? `${this.currentProcessInfo.processName}.exe` : '');

    if (!target) return;

    const interval = vscode.workspace.getConfiguration('labwindowsCvi').get<number>('debug.telemetryIntervalMs', 1000);

    try {
      this.helperProcess = cp.spawn(helperPath, [target, String(interval)], {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true
      });

      this.helperStdoutBuffer = '';

      this.helperProcess.stdout?.on('data', (chunk: Buffer) => {
        this.helperStdoutBuffer += chunk.toString('utf8');
        const lines = this.helperStdoutBuffer.split(/\r?\n/);
        this.helperStdoutBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const data = JSON.parse(trimmed);
              if (data.threads) {
                this.onTelemetryData(data);
              }
            } catch {}
          }
        }
      });

      this.helperProcess.on('exit', () => {
        this.helperProcess = null;
      });
      this.helperProcess.on('error', (err) => {
        this.output.appendLine(`[CVI Telemetry] Native helper error: ${err.message}`);
        this.helperProcess = null;
      });
    } catch (err: any) {
      this.output.appendLine(`[CVI Telemetry] Failed to spawn helper: ${err?.message || err}`);
    }
  }

  private stopNativeTelemetry(): void {
    if (this.helperProcess) {
      try {
        this.helperProcess.kill();
      } catch {}
      this.helperProcess = null;
    }
    this.helperStdoutBuffer = '';
  }

  private onTelemetryData(data: {
    pid: number;
    cpuPercent: number;
    cpuMs: number;
    threads: Array<{ id: number; state: string; waitReason: string; priority: string; cpuMs: number; entryPoint: string; module?: string }>;
  }): void {
    if (!this.currentProcessInfo || !this.activeSession) return;

    this.currentProcessInfo.processId = data.pid;
    this.currentProcessInfo.cpuPercent = data.cpuPercent;

    const now = Date.now();
    this.historyBuffer.push({ time: now, cpuPercent: data.cpuPercent });
    if (this.historyBuffer.length > 60) {
      this.historyBuffer.shift();
    }
    this.currentProcessInfo.cpuHistory = [...this.historyBuffer];

    const osThreads = Array.isArray(data.threads) ? data.threads : [];
    const existing = this.currentProcessInfo.threads || [];
    const updatedThreads: CviThreadInfo[] = [];

    for (let i = 0; i < osThreads.length; i++) {
      const ost = osThreads[i];
      const match = existing.find((et) => et.osThreadId === ost.id)
        ?? (existing[i] && !existing[i].osThreadId ? existing[i] : undefined);

      const isMain = i === 0;
      const isCviRuntime = ost.module && /cvirte/i.test(ost.module);
      const role: CviThreadRole = match?.role ?? (isMain ? 'main' : (isCviRuntime ? 'runtime' : 'worker'));
      const roleLabel: string = match?.roleLabel ?? (isMain ? 'Main GUI Thread' : (isCviRuntime ? 'CVI Runtime' : 'Worker Thread'));

      const name: string = isMain
        ? 'Main GUI Thread'
        : `Thread #${match?.id ?? (i + 1)}`;

      updatedThreads.push({
        id: match?.id ?? (i + 1),
        osThreadId: ost.id,
        name,
        role,
        roleLabel,
        status: ost.state || 'Running',
        state: ost.state || 'Running',
        waitReason: ost.waitReason || '-',
        priority: ost.priority || 'Normal',
        cpuMs: ost.cpuMs,
        entryPoint: ost.entryPoint,
        module: ost.module,
        topFrame: match?.topFrame,
        frames: match?.frames || []
      });
    }

    // Freeze sidebar tree items during normal 1 Hz ticks so hover tooltips NEVER get destroyed!
    // Only fire when thread count changes, or when a thread is suspended / resumed.
    const threadCountChanged = existing.length !== updatedThreads.length;
    const suspendStateChanged = updatedThreads.some((ut, idx) => {
      const et = existing[idx];
      return !et || (et.state === 'Suspended') !== (ut.state === 'Suspended');
    });

    this.currentProcessInfo.threads = updatedThreads;
    this.currentProcessInfo.updatedAt = new Date();

    if (threadCountChanged || suspendStateChanged) {
      this._onDidChangeThreads.fire();
    }

    if (CviCpuStripchartPanel.currentPanel) {
      CviCpuStripchartPanel.currentPanel.updateData({
        processName: this.currentProcessInfo.processName || 'CVI Process',
        processId: this.currentProcessInfo.processId,
        cpuPercent: this.currentProcessInfo.cpuPercent,
        cpuHistory: this.currentProcessInfo.cpuHistory,
        threads: this.currentProcessInfo.threads
      });
    }
  }

  private onTargetStopped(threadId?: number): void {
    setTimeout(() => {
      void this.navigateAndCaptureOnStop(threadId);
    }, 150);
  }

  private async navigateAndCaptureOnStop(stoppedThreadId?: number): Promise<void> {
    if (!this.activeSession || !this.currentProcessInfo) return;
    const session = this.activeSession;

    try {
      let threadResp: any = null;
      try {
        threadResp = await session.customRequest('threads');
      } catch {
        return;
      }

      const rawThreads: Array<{ id: number; name: string }> = threadResp?.threads ?? [];
      if (!rawThreads.length) return;

      // Capture frames for all threads
      for (const t of rawThreads) {
        try {
          const stackResp = await session.customRequest('stackTrace', {
            threadId: t.id,
            startFrame: 0,
            levels: 25
          });
          if (stackResp?.stackFrames && Array.isArray(stackResp.stackFrames)) {
            const frames: CviStackFrameInfo[] = stackResp.stackFrames.map((sf: any) => ({
              id: sf.id,
              name: sf.name || '<unknown>',
              file: sf.source?.path || sf.source?.name,
              line: sf.line,
              column: sf.column
            }));

            const targetThread = this.currentProcessInfo.threads.find(
              (th) => th.id === t.id || (th.osThreadId && t.name.includes(String(th.osThreadId)))
            );

            if (targetThread) {
              targetThread.frames = frames;
              targetThread.topFrame = frames[0];
            }
          }
        } catch {
          // ignore
        }
      }

      // Always fire on stop so user can inspect fresh frames in sidebar
      this._onDidChangeThreads.fire();

      // Priority order to find user source code frame:
      // 1. stopped thread
      // 2. thread 1 (Main GUI thread)
      // 3. all other threads
      const candidateThreadIds: number[] = [];
      if (stoppedThreadId) candidateThreadIds.push(stoppedThreadId);
      if (!candidateThreadIds.includes(1)) candidateThreadIds.push(1);
      for (const t of rawThreads) {
        if (!candidateThreadIds.includes(t.id)) candidateThreadIds.push(t.id);
      }

      for (const tid of candidateThreadIds) {
        try {
          const stackResp = await session.customRequest('stackTrace', {
            threadId: tid,
            startFrame: 0,
            levels: 30
          });
          const frames = stackResp?.stackFrames || [];
          for (const frame of frames) {
            const rawFile = frame.source?.path || frame.source?.name;
            if (!rawFile) continue;

            const resolvedFile = this.resolveSourceFilePath(rawFile);
            if (resolvedFile && typeof frame.line === 'number') {
              const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedFile));
              const line = Math.max(0, frame.line - 1);
              const col = Math.max(0, (frame.column || 1) - 1);
              await vscode.window.showTextDocument(doc, {
                selection: new vscode.Range(line, col, line, col),
                preserveFocus: false
              });
              return;
            }
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  private resolveSourceFilePath(rawFile: string): string | null {
    if (!rawFile) return null;

    try {
      if (fs.existsSync(rawFile)) return rawFile;
    } catch {}

    const normalized = path.normalize(rawFile);
    try {
      if (fs.existsSync(normalized)) return normalized;
    } catch {}

    const basename = path.basename(rawFile);
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    for (const folder of workspaceFolders) {
      const p1 = path.join(folder.uri.fsPath, rawFile);
      if (fs.existsSync(p1)) return p1;

      const p2 = path.join(folder.uri.fsPath, basename);
      if (fs.existsSync(p2)) return p2;

      const found = this.findFileRecursive(folder.uri.fsPath, basename, 3);
      if (found) return found;
    }

    return null;
  }

  private findFileRecursive(dir: string, targetBaseName: string, maxDepth: number): string | null {
    if (maxDepth < 0) return null;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === targetBaseName.toLowerCase()) {
          return fullPath;
        } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const res = this.findFileRecursive(fullPath, targetBaseName, maxDepth - 1);
          if (res) return res;
        }
      }
    } catch {}
    return null;
  }

  private async captureDapStackFrames(): Promise<void> {
    if (!this.activeSession || !this.currentProcessInfo) return;
    const session = this.activeSession;

    try {
      let threadResp: any = null;
      try {
        threadResp = await session.customRequest('threads');
      } catch {
        return;
      }

      const rawThreads: Array<{ id: number; name: string }> = threadResp?.threads ?? [];
      if (!rawThreads.length) return;

      for (const t of rawThreads) {
        try {
          const stackResp = await session.customRequest('stackTrace', {
            threadId: t.id,
            startFrame: 0,
            levels: 10
          });
          if (stackResp?.stackFrames && Array.isArray(stackResp.stackFrames)) {
            const frames: CviStackFrameInfo[] = stackResp.stackFrames.map((sf: any) => ({
              id: sf.id,
              name: sf.name || '<unknown>',
              file: sf.source?.path || sf.source?.name,
              line: sf.line,
              column: sf.column
            }));

            const targetThread = this.currentProcessInfo.threads.find(
              (th) => th.id === t.id || (th.osThreadId && t.name.includes(String(th.osThreadId)))
            );

            if (targetThread) {
              targetThread.frames = frames;
              targetThread.topFrame = frames[0];
            }
          }
        } catch {
          // ignore
        }
      }

      this._onDidChangeThreads.fire();
    } catch {
      // ignore
    }
  }

  async suspendThread(threadIdOrTid: number): Promise<boolean> {
    if (!this.helperProcess || !this.helperProcess.stdin) {
      vscode.window.showErrorMessage('Telemetry helper is not running.');
      return false;
    }
    const th = this.currentProcessInfo?.threads.find(t => t.id === threadIdOrTid || t.osThreadId === threadIdOrTid);
    const osTid = th?.osThreadId || threadIdOrTid;
    try {
      this.helperProcess.stdin.write(`suspend ${osTid}\n`);
      vscode.window.showInformationMessage(`Suspended thread #${th?.id ?? ''} (TID ${osTid})`);
      if (th) th.state = 'Suspended';
      this._onDidChangeThreads.fire();
      return true;
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to suspend thread: ${err}`);
      return false;
    }
  }

  async resumeThread(threadIdOrTid: number): Promise<boolean> {
    if (!this.helperProcess || !this.helperProcess.stdin) {
      vscode.window.showErrorMessage('Telemetry helper is not running.');
      return false;
    }
    const th = this.currentProcessInfo?.threads.find(t => t.id === threadIdOrTid || t.osThreadId === threadIdOrTid);
    const osTid = th?.osThreadId || threadIdOrTid;
    try {
      this.helperProcess.stdin.write(`resume ${osTid}\n`);
      vscode.window.showInformationMessage(`Resumed thread #${th?.id ?? ''} (TID ${osTid})`);
      if (th) th.state = 'Running';
      this._onDidChangeThreads.fire();
      return true;
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to resume thread: ${err}`);
      return false;
    }
  }

  async refresh(): Promise<void> {
    if (!this.helperProcess) {
      this.startNativeTelemetry();
    }
    await this.captureDapStackFrames();
    this._onDidChangeThreads.fire();
  }

  async pauseAllThreads(): Promise<void> {
    if (!this.activeSession) return;
    try {
      await this.activeSession.customRequest('pause', { threadId: 1 });
      void this.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(`Unable to pause threads: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
