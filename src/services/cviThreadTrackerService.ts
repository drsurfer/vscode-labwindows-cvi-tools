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
  private isSampling = false;
  private lastCpuSample?: { time: number; totalCpuMs: number };

  private workerProcess: cp.ChildProcessWithoutNullStreams | null = null;
  private workerStdoutBuffer = '';
  private historyBuffer: Array<{ time: number; cpuPercent: number }> = [];

  constructor(private readonly output: vscode.OutputChannel) {
    this.registerDebugLifecycle();
  }

  dispose(): void {
    this.stopWorker();
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
    // 1. Session Start
    this.disposables.push(
      vscode.debug.onDidStartDebugSession((session) => {
        if (!this.isCviSession(session)) return;
        this.activeSession = session;
        this.historyBuffer = [];
        this.currentProcessInfo = {
          sessionId: session.id,
          sessionName: session.name,
          processName: session.configuration?.program ? path.basename(session.configuration.program) : undefined,
          threads: [],
          cpuHistory: [],
          updatedAt: new Date()
        };
        void vscode.commands.executeCommand('setContext', 'labwindowsCvi.hasActiveDebugSession', true);
        this._onDidChangeThreads.fire();
        void this.refresh();
      })
    );

    // 2. Session Terminate
    this.disposables.push(
      vscode.debug.onDidTerminateDebugSession((session) => {
        if (this.activeSession?.id !== session.id) return;
        this.stopWorker();
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
                    this.currentProcessInfo.processName = path.basename(message.body.name);
                  }
                  this.startWorker(message.body.systemProcessId);
                  this._onDidChangeThreads.fire();
                }
              } else if (
                message.event === 'stopped' ||
                message.event === 'thread' ||
                message.event === 'continued'
              ) {
                void this.refresh();
              }
            } else if (message.type === 'response') {
              if (
                message.command === 'continue' ||
                message.command === 'next' ||
                message.command === 'stepIn' ||
                message.command === 'stepOut' ||
                message.command === 'pause' ||
                message.command === 'threads'
              ) {
                void this.refresh();
              }
            }
          }
        };
      }
    };

    this.disposables.push(vscode.debug.registerDebugAdapterTrackerFactory('cppdbg', trackerFactory));
    this.disposables.push(vscode.debug.registerDebugAdapterTrackerFactory('cvi', trackerFactory));
  }

  private startWorker(pid: number): void {
    this.stopWorker();
    this.historyBuffer = [];

    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$targetPid = ${pid}
$p = [System.Diagnostics.Process]::GetProcessById($targetPid)
if (!$p) { exit }

$numCores = [Environment]::ProcessorCount
$prevCpu = $p.TotalProcessorTime.TotalMilliseconds
$prevTime = [DateTime]::UtcNow

while (!$p.HasExited) {
    Start-Sleep -Milliseconds 1000
    $p.Refresh()
    $curTime = [DateTime]::UtcNow
    $curCpu = $p.TotalProcessorTime.TotalMilliseconds
    $timeDelta = ($curTime - $prevTime).TotalMilliseconds
    $cpuDelta = $curCpu - $prevCpu
    $pct = 0.0
    if ($timeDelta -gt 0) {
        $pct = [Math]::Round([Math]::Min(100.0, [Math]::Max(0.0, ($cpuDelta / ($timeDelta * $numCores)) * 100.0)), 1)
    }
    $prevCpu = $curCpu
    $prevTime = $curTime

    $threads = @()
    foreach ($th in $p.Threads) {
        $wr = ''
        if ($th.ThreadState -eq [System.Diagnostics.ThreadState]::Wait) {
            $wr = $th.WaitReason.ToString()
        }
        $threads += @{
            id = $th.Id
            state = $th.ThreadState.ToString()
            waitReason = $wr
            priority = $th.PriorityLevel.ToString()
            cpuMs = [Math]::Round($th.TotalProcessorTime.TotalMilliseconds, 1)
        }
    }
    $out = @{
        pid = $targetPid
        cpuPercent = $pct
        timestamp = $curTime.ToString('o')
        threads = $threads
    }
    [Console]::WriteLine(($out | ConvertTo-Json -Compress))
}
`;

    try {
      this.workerProcess = cp.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.workerProcess.stdin.write(script);
      this.workerProcess.stdin.end();

      this.workerProcess.stdout.on('data', (chunk: Buffer) => {
        this.workerStdoutBuffer += chunk.toString('utf8');
        const lines = this.workerStdoutBuffer.split(/\r?\n/);
        this.workerStdoutBuffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const data = JSON.parse(trimmed);
              this.onWorkerSample(data);
            } catch {}
          }
        }
      });

      this.workerProcess.on('error', () => {
        this.stopWorker();
      });

      this.workerProcess.on('exit', () => {
        this.workerProcess = null;
      });
    } catch {
      this.workerProcess = null;
    }
  }

  private stopWorker(): void {
    if (this.workerProcess) {
      try {
        this.workerProcess.kill();
      } catch {}
      this.workerProcess = null;
    }
    this.workerStdoutBuffer = '';
  }

  private onWorkerSample(data: {
    pid: number;
    cpuPercent: number;
    timestamp: string;
    threads: Array<{ id: number; state: string; waitReason: string; priority: string; cpuMs: number }>;
  }): void {
    if (!this.currentProcessInfo || this.currentProcessInfo.processId !== data.pid) {
      return;
    }

    const now = Date.now();
    this.currentProcessInfo.cpuPercent = data.cpuPercent;
    this.historyBuffer.push({ time: now, cpuPercent: data.cpuPercent });
    if (this.historyBuffer.length > 60) {
      this.historyBuffer.shift();
    }
    this.currentProcessInfo.cpuHistory = [...this.historyBuffer];

    const osThreads = Array.isArray(data.threads) ? data.threads : [];

    if (this.currentProcessInfo.threads.length > 0) {
      // Merge into existing DAP threads
      for (const [idx, th] of this.currentProcessInfo.threads.entries()) {
        const match = osThreads.find((ost) => ost.id === th.osThreadId)
          ?? osThreads.find((ost) => th.name.includes(String(ost.id)))
          ?? osThreads[idx];
        if (match) {
          th.osThreadId = match.id;
          th.state = match.state;
          th.waitReason = match.waitReason;
          th.priority = match.priority;
          th.cpuMs = match.cpuMs;
        }
      }
    } else if (osThreads.length > 0) {
      // Populate threads directly from OS telemetry during free-run
      this.currentProcessInfo.threads = osThreads.map((ost, idx) => ({
        id: idx + 1,
        osThreadId: ost.id,
        name: idx === 0 ? 'Main GUI Thread' : `Worker Thread #${idx + 1}`,
        role: idx === 0 ? 'main' : 'worker',
        roleLabel: idx === 0 ? 'Main GUI Thread' : 'Worker Thread',
        status: ost.state === 'Wait' ? `Wait (${ost.waitReason || 'UserRequest'})` : 'Running',
        state: ost.state,
        waitReason: ost.waitReason,
        priority: ost.priority,
        cpuMs: ost.cpuMs,
        frames: []
      }));
    }

    this.currentProcessInfo.updatedAt = new Date();
    this._onDidChangeThreads.fire();

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

  async refresh(): Promise<void> {
    if (!this.activeSession) return;
    const session = this.activeSession;
    if (this.isSampling) return;
    this.isSampling = true;

    try {
      let threadResp: any = null;
      try {
        threadResp = await session.customRequest('threads');
      } catch {
        threadResp = null;
      }
      const rawThreads: Array<{ id: number; name: string }> = threadResp?.threads ?? [];
      const threads: CviThreadInfo[] = [];

      for (const [idx, t] of rawThreads.entries()) {
        let frames: CviStackFrameInfo[] = [];
        try {
          const stackResp = await session.customRequest('stackTrace', {
            threadId: t.id,
            startFrame: 0,
            levels: 10
          });
          if (stackResp?.stackFrames && Array.isArray(stackResp.stackFrames)) {
            frames = stackResp.stackFrames.map((sf: any) => ({
              id: sf.id,
              name: sf.name || '<unknown>',
              file: sf.source?.path || sf.source?.name,
              line: sf.line,
              column: sf.column
            }));
          }
        } catch {
          // If thread is running, stackTrace may be unavailable
        }

        // Determine thread role
        let role: CviThreadRole = 'worker';
        let roleLabel = 'Worker Thread';
        const isMain = t.id === 1 || /main/i.test(t.name);
        const hasCmtPool = frames.some((f) =>
          /Cmt|ThreadPool|CmtScheduleThreadPoolFunction|__Cmt|PoolFunc/i.test(f.name)
        );
        const hasCviRuntime = frames.some(
          (f) =>
            /cvirte|cvi_run|cviruntime/i.test(f.name) ||
            (f.file && /cvirte|cviauto|toolbox/i.test(f.file))
        );

        if (isMain) {
          role = 'main';
          roleLabel = 'Main GUI Thread';
        } else if (hasCmtPool) {
          role = 'pool';
          roleLabel = 'CVI Thread Pool Worker';
        } else if (hasCviRuntime) {
          role = 'runtime';
          roleLabel = 'CVI Runtime Internal';
        } else {
          role = 'worker';
          roleLabel = 'Worker Thread';
        }

        const top = frames[0];
        let status = 'Running';
        if (top) {
          status = top.file
            ? `Stopped at ${path.basename(top.file)}:${top.line}`
            : `Stopped at ${top.name}`;
        }

        // Retain existing telemetry if available
        const existing = this.currentProcessInfo?.threads.find((th) => th.id === t.id)
          ?? this.currentProcessInfo?.threads[idx];

        threads.push({
          id: t.id,
          osThreadId: existing?.osThreadId,
          name: t.name || `Thread #${t.id}`,
          role,
          roleLabel,
          status,
          state: existing?.state || (top ? 'Suspended' : 'Running'),
          waitReason: existing?.waitReason,
          priority: existing?.priority || 'Normal',
          cpuMs: existing?.cpuMs,
          topFrame: top,
          frames
        });
      }

      this.currentProcessInfo = {
        sessionId: session.id,
        sessionName: session.name,
        processName:
          this.currentProcessInfo?.processName ||
          (session.configuration?.program ? path.basename(session.configuration.program) : undefined),
        processId: this.currentProcessInfo?.processId,
        cpuPercent: this.currentProcessInfo?.cpuPercent,
        cpuHistory: this.currentProcessInfo?.cpuHistory || [...this.historyBuffer],
        threads: threads.length > 0 ? threads : (this.currentProcessInfo?.threads || []),
        updatedAt: new Date()
      };

      this._onDidChangeThreads.fire();
    } catch {
      // Ignore request failures during active stepping
    } finally {
      this.isSampling = false;
    }
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
