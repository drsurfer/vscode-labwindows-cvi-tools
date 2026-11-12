import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CviProcessDebugInfo, CviStackFrameInfo, CviThreadInfo, CviThreadTrackerService } from '../services/cviThreadTrackerService';

export type ThreadTreeNode = ProcessHeaderItem | ThreadTreeItem | StackFrameTreeItem | PlaceholderItem;

export class ProcessHeaderItem extends vscode.TreeItem {
  constructor(public readonly info: CviProcessDebugInfo) {
    const label = `Process: ${info.processName || info.sessionName}`;
    super(label, vscode.TreeItemCollapsibleState.None);

    const pidText = info.processId ? `PID: ${info.processId}` : 'PID: active';
    const cpuVal = info.cpuPercent !== undefined ? `${info.cpuPercent.toFixed(1)}%` : '--%';
    this.description = `${pidText} — ${info.threads.length} threads | CPU: ${cpuVal}`;
    this.tooltip = `LabWindows/CVI Debugged Process\nSession: ${info.sessionName}\n${pidText}\nActive threads: ${info.threads.length}\nCPU Usage: ${cpuVal}\nClick to open live CPU stripchart and thread diagnostics`;
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
    const isMain = thread.role === 'main';
    const mainSuffix = isMain ? ' · Main GUI Thread' : '';
    super(
      `#${thread.id}`,
      thread.frames.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    this.description = `TID ${thread.osThreadId || '-'}${mainSuffix}`;

    const stateDesc = thread.state || (thread.topFrame ? 'Suspended' : 'Running');
    const waitDesc = thread.waitReason ? ` (${thread.waitReason})` : '';
    const prioDesc = thread.priority ? `\nPriority: ${thread.priority}` : '';
    const cpuDesc = thread.cpuMs !== undefined ? `\nCPU Time: ${thread.cpuMs.toFixed(1)} ms` : '';
    const entryDesc = thread.entryPoint ? `\nEntry Point: ${thread.entryPoint}` : '';
    const frameDesc = thread.topFrame
      ? `\nTop location: ${thread.topFrame.name} (${thread.topFrame.file || 'unknown'}:${thread.topFrame.line || 0})`
      : '';

    this.tooltip = `Thread #${thread.id} (TID ${thread.osThreadId || '-'})\nName: ${thread.name}${mainSuffix}\nState: ${stateDesc}${waitDesc}${prioDesc}${cpuDesc}${entryDesc}${frameDesc}\nFrames captured: ${thread.frames.length}`;

    if (thread.role === 'main') {
      this.iconPath = new vscode.ThemeIcon('window');
    } else if (thread.state === 'Suspended') {
      this.iconPath = new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('charts.red'));
    } else if (thread.state === 'Running') {
      this.iconPath = new vscode.ThemeIcon('play', new vscode.ThemeColor('testing.iconPassed'));
    } else {
      // Waiting
      this.iconPath = new vscode.ThemeIcon('debug-stackframe-dot');
    }

    this.contextValue = thread.state === 'Suspended' ? 'cviThreadItem_suspended' : 'cviThreadItem_running';
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
