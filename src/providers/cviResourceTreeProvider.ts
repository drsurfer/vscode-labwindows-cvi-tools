import * as path from 'path';
import * as vscode from 'vscode';
import { CviResourceCategory, CviResourceItem, formatBytes } from '../model/cviResourceModel';
import { CviResourceTrackerService } from '../services/cviResourceTrackerService';

export type CviResourceTreeNode = CviStatusNode | CviCategoryGroupNode | CviResourceItemNode | CviStackFrameNode;

export class CviResourceTreeProvider implements vscode.TreeDataProvider<CviResourceTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<CviResourceTreeNode | undefined | void>();
  public readonly onDidChangeTreeData: vscode.Event<CviResourceTreeNode | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private readonly tracker: CviResourceTrackerService) {
    this.tracker.onDidChangeData(() => {
      this._onDidChangeTreeData.fire();
    });
  }

  refresh(): void {
    void this.tracker.refreshFromSession();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CviResourceTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: CviResourceTreeNode): Promise<CviResourceTreeNode[]> {
    if (!element) {
      return this.getRootNodes();
    }

    if (element instanceof CviCategoryGroupNode) {
      return element.items.map((item) => new CviResourceItemNode(item));
    }

    if (element instanceof CviResourceItemNode) {
      if (element.item.callStack && element.item.callStack.length > 0) {
        return element.item.callStack.map((frame, index) => new CviStackFrameNode(frame, index));
      }
      return [];
    }

    return [];
  }

  private getRootNodes(): CviResourceTreeNode[] {
    const nodes: CviResourceTreeNode[] = [];
    const snap = this.tracker.snapshot;
    const isSessionActive = this.tracker.isSessionActive;

    // Status header
    if (isSessionActive) {
      const count = snap?.summary.totalCount ?? 0;
      const bytesStr = snap ? ` (${formatBytes(snap.totalBytes)})` : '';
      nodes.push(
        new CviStatusNode(
          count > 0 ? `Active Debug Session: ${count} resources${bytesStr}` : 'Active Debug Session: Running',
          count > 0 ? 'Paused at breakpoint / live tracking' : 'No allocations recorded yet (or Extended Debugging off)',
          new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('charts.green'))
        )
      );
    } else if (snap?.isCleanExit) {
      nodes.push(
        new CviStatusNode(
          'Clean Exit: No leaks detected',
          'All allocated resources were successfully freed before termination',
          new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'))
        )
      );
    } else if (snap && snap.items.length > 0) {
      nodes.push(
        new CviStatusNode(
          `⚠️ ${snap.items.length} Resource Leak(s) Detected`,
          `${formatBytes(snap.totalBytes)} unreleased memory / open handles`,
          new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'))
        )
      );
    } else {
      nodes.push(
        new CviStatusNode(
          'No Active CVI Debug Session',
          'Start debugging (F5) with Extended Debugging to inspect live resources and leaks',
          new vscode.ThemeIcon('debug-alt', new vscode.ThemeColor('disabledForeground'))
        )
      );
      return nodes;
    }

    if (!snap || snap.items.length === 0) {
      return nodes;
    }

    // Categories
    const categories: Array<{ id: CviResourceCategory; label: string; icon: string; items: CviResourceItem[] }> = [
      {
        id: 'memory',
        label: 'Dynamic Memory',
        icon: 'database',
        items: snap.items.filter((i) => i.category === 'memory')
      },
      {
        id: 'ui',
        label: 'User Interface & Panels',
        icon: 'window',
        items: snap.items.filter((i) => i.category === 'ui')
      },
      {
        id: 'file',
        label: 'File & System Handles',
        icon: 'file',
        items: snap.items.filter((i) => i.category === 'file')
      },
      {
        id: 'thread',
        label: 'Threads & Synchronization',
        icon: 'sync',
        items: snap.items.filter((i) => i.category === 'thread')
      },
      {
        id: 'communication',
        label: 'Communication & I/O',
        icon: 'radio-tower',
        items: snap.items.filter((i) => i.category === 'communication')
      },
      {
        id: 'other',
        label: 'Other Resources',
        icon: 'package',
        items: snap.items.filter((i) => i.category === 'other')
      }
    ];

    for (const cat of categories) {
      if (cat.items.length > 0) {
        nodes.push(new CviCategoryGroupNode(cat.label, cat.items, cat.icon));
      }
    }

    return nodes;
  }
}

export class CviStatusNode extends vscode.TreeItem {
  constructor(label: string, description: string, icon: vscode.ThemeIcon) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = icon;
    this.contextValue = 'cviStatusNode';
  }
}

export class CviCategoryGroupNode extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly items: CviResourceItem[],
    iconName: string
  ) {
    const totalBytes = items.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
    const sizeStr = totalBytes > 0 ? ` · ${formatBytes(totalBytes)}` : '';
    super(`${label} (${items.length}${sizeStr})`, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon(iconName);
    this.contextValue = 'cviCategoryGroup';
  }
}

export class CviResourceItemNode extends vscode.TreeItem {
  constructor(public readonly item: CviResourceItem) {
    const hasStack = !!(item.callStack && item.callStack.length > 0);
    super(item.id, hasStack ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

    const parts: string[] = [];
    if (item.sizeBytes) {
      parts.push(formatBytes(item.sizeBytes));
    }
    if (item.details && item.details !== item.id) {
      parts.push(item.details);
    }
    if (item.sourceFile) {
      parts.push(`${path.basename(item.sourceFile)}:${item.lineNumber ?? 0}`);
    }
    this.description = parts.join(' · ');

    const tooltipMd = new vscode.MarkdownString();
    tooltipMd.appendMarkdown(`### ${item.isLeaked ? '⚠️ Memory / Resource Leak' : 'CVI Allocated Resource'}\n\n`);
    tooltipMd.appendMarkdown(`* **Handle / Pointer**: \`${item.id}\`\n`);
    tooltipMd.appendMarkdown(`* **Type**: ${item.typeLabel}\n`);
    if (item.sizeBytes) {
      tooltipMd.appendMarkdown(`* **Size**: ${formatBytes(item.sizeBytes)} (${item.sizeBytes} bytes)\n`);
    }
    if (item.sourceFile) {
      tooltipMd.appendMarkdown(`* **Allocated at**: [\`${item.sourceFile}:${item.lineNumber ?? 1}\`](command:labwindowsCvi.openResourceLocation?${encodeURIComponent(JSON.stringify({ file: item.sourceFile, line: item.lineNumber }))})\n`);
    }
    if (item.callStack && item.callStack.length > 0) {
      tooltipMd.appendMarkdown('\n**Call Stack**:\n');
      for (const frame of item.callStack) {
        tooltipMd.appendMarkdown(`- \`${frame}\`\n`);
      }
    }
    tooltipMd.isTrusted = true;
    this.tooltip = tooltipMd;

    if (item.isLeaked) {
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'));
    } else {
      switch (item.category) {
        case 'memory':
          this.iconPath = new vscode.ThemeIcon('database', new vscode.ThemeColor('symbolIcon.variableForeground'));
          break;
        case 'ui':
          this.iconPath = new vscode.ThemeIcon('window', new vscode.ThemeColor('symbolIcon.classForeground'));
          break;
        case 'file':
          this.iconPath = new vscode.ThemeIcon('file', new vscode.ThemeColor('symbolIcon.fileForeground'));
          break;
        case 'thread':
          this.iconPath = new vscode.ThemeIcon('sync', new vscode.ThemeColor('symbolIcon.eventForeground'));
          break;
        case 'communication':
          this.iconPath = new vscode.ThemeIcon('radio-tower', new vscode.ThemeColor('symbolIcon.interfaceForeground'));
          break;
        default:
          this.iconPath = new vscode.ThemeIcon('package');
          break;
      }
    }

    if (item.sourceFile) {
      this.command = {
        command: 'labwindowsCvi.openResourceLocation',
        title: 'Open Source Location',
        arguments: [{ file: item.sourceFile, line: item.lineNumber }]
      };
    }

    this.contextValue = 'cviResourceItem';
  }
}

export class CviStackFrameNode extends vscode.TreeItem {
  constructor(frameText: string, index: number) {
    super(frameText, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('debug-stackframe');

    const locMatch = frameText.match(/([a-zA-Z0-9_\-\.\/\\]+\.[cChHpP]+)(?::(\d+))?/);
    if (locMatch) {
      const file = locMatch[1];
      const line = locMatch[2] ? parseInt(locMatch[2], 10) : 1;
      this.command = {
        command: 'labwindowsCvi.openResourceLocation',
        title: 'Open Source Location',
        arguments: [{ file, line }]
      };
    }
  }
}
