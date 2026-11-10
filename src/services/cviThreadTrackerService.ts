import * as cp from 'child_process';
import * as os from 'os';
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
  private pollTimer: NodeJS.Timeout | null = null;
  private isSampling = false;
  private lastCpuSample?: { time: number; cpuMs: number };
  private historyBuffer: Array<{ time: number; cpuPercent: number }> = [];

  constructor(private readonly output: vscode.OutputChannel) {
    this.registerDebugLifecycle();
  }

  dispose(): void {
    this.stopPollingTimer();
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
        this.lastCpuSample = undefined;

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
        this.startPollingTimer();
      })
    );

    // 2. Debug Session Terminate
    this.disposables.push(
      vscode.debug.onDidTerminateDebugSession((session) => {
        if (this.activeSession?.id !== session.id) return;
        this.stopPollingTimer();
        this.activeSession = null;
        this.currentProcessInfo = null;
        this.lastCpuSample = undefined;
        this.historyBuffer = [];
        void vscode.commands.executeCommand('setContext', 'labwindowsCvi.hasActiveDebugSession', false);
        this._onDidChangeThreads.fire();
      })
    );

    // 3. Adapter tracker for cppdbg and cvi
    const trackerFactory: vscode.DebugAdapterTrackerFactory = {
      createDebugAdapterTracker: (session: vscode.DebugSession) => {
        if (!this.isCviSession(session)) return undefined;
        return {
          onDidSendMessage: (message: any) => {
            if (message.type === 'event') {
              if (message.event === 'process' && message.body?.systemProcessId) {
                if (this.currentProcessInfo) {
                  this.currentProcessInfo.processId = message.body.systemProcessId;
                  if (message.body.name) {
                    this.currentProcessInfo.processName = path.basename(message.body.name, path.extname(message.body.name));
                  }
                  this._onDidChangeThreads.fire();
                }
              } else if (
                message.event === 'stopped' ||
                message.event === 'thread'
              ) {
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

  private startPollingTimer(): void {
    this.stopPollingTimer();
    // Fire immediately
    void this.sampleTelemetry();
    // Continuous 1 Hz sampling
    this.pollTimer = setInterval(() => {
      void this.sampleTelemetry();
    }, 1000);
  }

  private stopPollingTimer(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isSampling = false;
  }

  private async sampleTelemetry(): Promise<void> {
    if (!this.activeSession || !this.currentProcessInfo || this.isSampling) {
      return;
    }
    this.isSampling = true;

    const targetPid = this.currentProcessInfo.processId || 0;
    const procName = this.currentProcessInfo.processName || '';
    const cleanProcName = procName.replace(/['"\\]/g, '');

    // Robust PowerShell telemetry query executed via Base64 UTF-16LE EncodedCommand
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$targetPid = ${targetPid}
if ($targetPid -le 0) {
  $p = Get-Process -Name '${cleanProcName}' -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | Select-Object -First 1
} else {
  $p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
}
if (!$p -or $p.HasExited) { exit }

$tList = @()
foreach ($th in $p.Threads) {
  $wr = if ($th.ThreadState -eq [System.Diagnostics.ThreadState]::Wait) { [string]$th.WaitReason } else { '' }
  $tList += @{
    id = $th.Id
    state = [string]$th.ThreadState
    waitReason = $wr
    priority = [string]$th.PriorityLevel
    cpuMs = [math]::Round($th.TotalProcessorTime.TotalMilliseconds, 1)
  }
}
[PSCustomObject]@{
  pid = $p.Id
  processName = $p.ProcessName
  cpuMs = [math]::Round($p.TotalProcessorTime.TotalMilliseconds, 1)
  threads = $tList
} | ConvertTo-Json -Compress
`;

    const b64 = Buffer.from(script, 'utf16le').toString('base64');

    cp.execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64],
      { windowsHide: true, timeout: 3500 },
      (err, stdout) => {
        this.isSampling = false;
        if (err || !stdout || !this.activeSession || !this.currentProcessInfo) {
          return;
        }

        try {
          const raw = stdout.trim();
          if (!raw.startsWith('{') || !raw.endsWith('}')) {
            return;
          }
          const data = JSON.parse(raw);
          if (!data || !data.pid) {
            return;
          }

          this.currentProcessInfo.processId = data.pid;
          if (!this.currentProcessInfo.processName && data.processName) {
            this.currentProcessInfo.processName = data.processName;
          }

          // Calculate rolling CPU % across all CPU cores
          const now = Date.now();
          let cpuPercent = 0.0;
          if (this.lastCpuSample && this.lastCpuSample.time < now) {
            const timeDelta = now - this.lastCpuSample.time;
            const cpuDelta = data.cpuMs - this.lastCpuSample.cpuMs;
            const numCores = os.cpus().length || 1;
            if (timeDelta > 0 && cpuDelta >= 0) {
              cpuPercent = Math.min(100.0, Math.max(0.0, (cpuDelta / (timeDelta * numCores)) * 100.0));
              cpuPercent = Math.round(cpuPercent * 10) / 10;
            }
          }
          this.lastCpuSample = { time: now, cpuMs: data.cpuMs };
          this.currentProcessInfo.cpuPercent = cpuPercent;

          this.historyBuffer.push({ time: now, cpuPercent });
          if (this.historyBuffer.length > 60) {
            this.historyBuffer.shift();
          }
          this.currentProcessInfo.cpuHistory = [...this.historyBuffer];

          // Map OS thread data to CviThreadInfo
          const osThreads: Array<{ id: number; state: string; waitReason: string; priority: string; cpuMs: number }> =
            Array.isArray(data.threads) ? data.threads : [];

          const existingThreads = this.currentProcessInfo.threads || [];
          const updatedThreads: CviThreadInfo[] = [];

          for (let i = 0; i < osThreads.length; i++) {
            const ost = osThreads[i];
            const match = existingThreads.find((et) => et.osThreadId === ost.id)
              ?? (existingThreads[i] && !existingThreads[i].osThreadId ? existingThreads[i] : undefined);

            const isMain = i === 0;
            const role: CviThreadRole = match?.role ?? (isMain ? 'main' : 'worker');
            const roleLabel: string = match?.roleLabel ?? (isMain ? 'Main GUI Thread' : `Worker Thread #${i + 1}`);
            const state = ost.state || 'Running';
            const waitReason = ost.waitReason || '';
            const status = state === 'Wait' ? `Wait (${waitReason || 'UserRequest'})` : state;

            updatedThreads.push({
              id: match?.id ?? (i + 1),
              osThreadId: ost.id,
              name: match?.name ?? (isMain ? 'Main GUI Thread' : `Worker Thread #${i + 1}`),
              role,
              roleLabel,
              status,
              state,
              waitReason,
              priority: ost.priority || 'Normal',
              cpuMs: ost.cpuMs,
              topFrame: match?.topFrame,
              frames: match?.frames || []
            });
          }

          this.currentProcessInfo.threads = updatedThreads;
          this.currentProcessInfo.updatedAt = new Date();

          // Continuous 1 Hz update for sidebar tree view
          this._onDidChangeThreads.fire();

          // Continuous 1 Hz update for CPU stripchart webview if open
          if (CviCpuStripchartPanel.currentPanel) {
            CviCpuStripchartPanel.currentPanel.updateData({
              processName: this.currentProcessInfo.processName || 'CVI Process',
              processId: this.currentProcessInfo.processId,
              cpuPercent: this.currentProcessInfo.cpuPercent,
              cpuHistory: this.currentProcessInfo.cpuHistory,
              threads: this.currentProcessInfo.threads
            });
          }
        } catch {
          // Ignore JSON parse errors from transient process transitions
        }
      }
    );
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
              if (frames.length > 0) {
                const hasCmtPool = frames.some((f) =>
                  /Cmt|ThreadPool|CmtScheduleThreadPoolFunction|__Cmt|PoolFunc/i.test(f.name)
                );
                const hasCviRuntime = frames.some(
                  (f) =>
                    /cvirte|cvi_run|cviruntime/i.test(f.name) ||
                    (f.file && /cvirte|cviauto|toolbox/i.test(f.file))
                );
                if (targetThread.role !== 'main') {
                  if (hasCmtPool) {
                    targetThread.role = 'pool';
                    targetThread.roleLabel = 'CVI Thread Pool Worker';
                  } else if (hasCviRuntime) {
                    targetThread.role = 'runtime';
                    targetThread.roleLabel = 'CVI Runtime Internal';
                  }
                }
              }
            }
          }
        } catch {
          // Thread might have resumed
        }
      }

      this._onDidChangeThreads.fire();
    } catch {
      // Ignore
    }
  }

  async refresh(): Promise<void> {
    await this.sampleTelemetry();
    await this.captureDapStackFrames();
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
