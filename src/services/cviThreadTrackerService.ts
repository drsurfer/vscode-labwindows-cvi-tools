import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

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
  name: string;
  role: CviThreadRole;
  roleLabel: string;
  status: string;
  topFrame?: CviStackFrameInfo;
  frames: CviStackFrameInfo[];
}

export interface CviProcessDebugInfo {
  sessionId: string;
  sessionName: string;
  processName?: string;
  processId?: number;
  cpuPercent?: number;
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

  constructor(private readonly output: vscode.OutputChannel) {
    this.registerDebugLifecycle();
  }

  dispose(): void {
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
        this.currentProcessInfo = {
          sessionId: session.id,
          sessionName: session.name,
          processName: session.configuration?.program ? path.basename(session.configuration.program) : undefined,
          threads: [],
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
        this.activeSession = null;
        this.currentProcessInfo = null;
        this.lastCpuSample = undefined;
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

      for (const t of rawThreads) {
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

        threads.push({
          id: t.id,
          name: t.name || `Thread #${t.id}`,
          role,
          roleLabel,
          status,
          topFrame: top,
          frames
        });
      }

      // Sample CPU if processId is known
      let cpuPercent = this.currentProcessInfo?.cpuPercent;
      if (this.currentProcessInfo?.processId) {
        const sampled = await this.sampleProcessCpu(this.currentProcessInfo.processId);
        if (sampled !== undefined) {
          cpuPercent = sampled;
        }
      }

      this.currentProcessInfo = {
        sessionId: session.id,
        sessionName: session.name,
        processName:
          this.currentProcessInfo?.processName ||
          (session.configuration?.program ? path.basename(session.configuration.program) : undefined),
        processId: this.currentProcessInfo?.processId,
        cpuPercent,
        threads,
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

  private async sampleProcessCpu(pid: number): Promise<number | undefined> {
    return new Promise<number | undefined>((resolve) => {
      // Lightweight Windows PowerShell query to get CPU (TotalProcessorTime seconds)
      const cmd = `powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).CPU"`;
      cp.exec(cmd, { timeout: 1200 }, (err, stdout) => {
        if (err || !stdout) {
          resolve(undefined);
          return;
        }
        const cpuSeconds = parseFloat(stdout.trim().replace(',', '.'));
        if (isNaN(cpuSeconds)) {
          resolve(undefined);
          return;
        }
        const now = Date.now();
        const totalCpuMs = cpuSeconds * 1000;
        if (this.lastCpuSample) {
          const deltaMs = now - this.lastCpuSample.time;
          const cpuDelta = totalCpuMs - this.lastCpuSample.totalCpuMs;
          if (deltaMs > 300 && cpuDelta >= 0) {
            const numCores = navigator?.hardwareConcurrency || 4;
            const pct = Math.min(100, Math.max(0, (cpuDelta / deltaMs / numCores) * 100));
            this.lastCpuSample = { time: now, totalCpuMs };
            resolve(Math.round(pct * 10) / 10);
            return;
          }
        }
        this.lastCpuSample = { time: now, totalCpuMs };
        resolve(undefined);
      });
    });
  }
}
