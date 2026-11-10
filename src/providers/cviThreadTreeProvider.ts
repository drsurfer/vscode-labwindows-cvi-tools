import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CviProcessDebugInfo, CviStackFrameInfo, CviThreadInfo, CviThreadTrackerService } from '../services/cviThreadTrackerService';

export type ThreadTreeNode = ProcessHeaderItem | ThreadTreeItem | StackFrameTreeItem | PlaceholderItem;

function sparklineFromHistory(history: Array<{ time: number; cpuPercent: number }> = []): string {
  if (!history || history.length === 0) return '';
  const sparks = [' ', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const max = Math.max(...history.map((h) => h.cpuPercent || 0), 1);
  return history
    .slice(-10)
    .map((h) => sparks[Math.min(sparks.length - 1, Math.floor(((h.cpuPercent || 0) / max) * (sparks.length - 1)))])
    .join('');
}

export class ProcessHeaderItem extends vscode.TreeItem {
  constructor(public readonly info: CviProcessDebugInfo) {
    const label = `Process: ${info.processName || info.sessionName}`;
    super(label, vscode.TreeItemCollapsibleState.None);

    const pidText = info.processId ? `PID: ${info.processId}` : 'PID: active';
    const cpuVal = info.cpuPercent !== undefined ? `${info.cpuPercent.toFixed(1)}%` : '--%';
    const spark = sparklineFromHistory(info.cpuHistory);
    const cpuText = ` | CPU: ${cpuVal}${spark ? ` [${spark}]` : ''}`;
    this.description = `${pidText} — ${info.threads.length} threads${cpuText}`;
    this.tooltip = `LabWindows/CVI Debugged Process\nSession: ${info.sessionName}\n${pidText}\nActive threads: ${info.threads.length}${cpuText}\nClick to open live CPU Stripchart & diagnostics`;
    this.iconPath = new vscode.ThemeIcon('pulse');
    this.contextValue = 'cviProcessHeader';
    this.command = {
      command: 'labwindowsCvi.openCpuStripchart',
      title: 'Open CPU Stripchart & Thread Diagnostics'
    };
  }
}

export class ThreadTreeItem extends vscode.TreeItem {
  constructor(public readonly thread: CviThreadInfo) {
    const tidPart = thread.osThreadId ? ` (TID ${thread.osThreadId})` : '';
    super(
      `Thread #${thread.id}${tidPart}: ${thread.name}`,
      thread.frames.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    const stateDesc = thread.state || (thread.topFrame ? 'Suspended' : 'Running');
    const waitDesc = thread.waitReason ? ` (${thread.waitReason})` : '';
    const prioDesc = thread.priority ? ` · ${thread.priority}` : '';
    const cpuDesc = thread.cpuMs !== undefined ? ` · ${thread.cpuMs.toFixed(1)}ms` : '';
    this.description = `[${thread.roleLabel}] ${stateDesc}${waitDesc}${prioDesc}${cpuDesc}`;
    this.tooltip = `Thread #${thread.id}${tidPart}\nName: ${thread.name}\nRole: ${thread.roleLabel}\nState: ${stateDesc}${waitDesc}\nPriority: ${thread.priority || 'Normal'}\nCPU Time: ${thread.cpuMs !== undefined ? thread.cpuMs.toFixed(1) + ' ms' : 'N/A'}\nTop location: ${thread.topFrame ? `${thread.topFrame.name} (${thread.topFrame.file || 'unknown'}:${thread.topFrame.line || 0})` : 'Running'}\nFrames captured: ${thread.frames.length}`;

    switch (thread.role) {
      case 'main':
        this.iconPath = new vscode.ThemeIcon('window');
        break;
      case 'pool':
        this.iconPath = new vscode.ThemeIcon('server-process');
        break;
      case 'runtime':
        this.iconPath = new vscode.ThemeIcon('shield');
        break;
      case 'worker':
      default:
        this.iconPath = new vscode.ThemeIcon('symbol-event');
        break;
    }

    this.contextValue = `cviThreadItem_${thread.role}`;
  }
}

export class StackFrameTreeItem extends vscode.TreeItem {
  constructor(public readonly frame: CviStackFrameInfo, public readonly thread: CviThreadInfo) {
    const hasSource = !!frame.file && fs.existsSync(frame.file);
    const loc = frame.file ? `${path.basename(frame.file)}:${frame.line || 0}` : '';
    super(frame.name, vscode.TreeItemCollapsibleState.None);

    this.description = loc;
    this.tooltip = `${frame.name}\nFile: ${frame.file || 'Source not available'}\nLine: ${frame.line || 0}`;
    this.iconPath = new vscode.ThemeIcon(hasSource ? 'debug-stackframe' : 'debug-stackframe-dot');

    if (hasSource && frame.file && typeof frame.line === 'number') {
      const lineNum = Math.max(0, frame.line - 1);
      const colNum = Math.max(0, (frame.column || 1) - 1);
      this.command = {
        command: 'vscode.open',
        title: 'Open Source File',
        arguments: [
          vscode.Uri.file(frame.file),
          { selection: new vscode.Range(lineNum, colNum, lineNum, colNum) }
        ]
      };
    }
  }
}

export class PlaceholderItem extends vscode.TreeItem {
  constructor(message: string, description?: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

export class CviThreadTreeProvider implements vscode.TreeDataProvider<ThreadTreeNode>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ThreadTreeNode | undefined | void>();
  public readonly onDidChangeTreeData: vscode.Event<ThreadTreeNode | undefined | void> = this._onDidChangeTreeData.event;

  private disposables: vscode.Disposable[] = [];

  constructor(private readonly tracker: CviThreadTrackerService) {
    this.disposables.push(
      this.tracker.onDidChangeThreads(() => this._onDidChangeTreeData.fire())
    );
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this._onDidChangeTreeData.dispose();
  }

  refresh(): void {
    void this.tracker.refresh();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ThreadTreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ThreadTreeNode): vscode.ProviderResult<ThreadTreeNode[]> {
    const info = this.tracker.processInfo;
    if (!info || !this.tracker.isSessionActive) {
      return [
        new PlaceholderItem(
          'No active CVI debugging session',
          'Threads & CVI Thread Pool appear during debug'
        )
      ];
    }

    if (!element) {
      // Root: Process header + Threads
      const nodes: ThreadTreeNode[] = [new ProcessHeaderItem(info)];
      for (const t of info.threads) {
        nodes.push(new ThreadTreeItem(t));
      }
      return nodes;
    }

    if (element instanceof ThreadTreeItem) {
      return element.thread.frames.map((f) => new StackFrameTreeItem(f, element.thread));
    }

    return [];
  }
}
