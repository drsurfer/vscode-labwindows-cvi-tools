import * as vscode from 'vscode';
import { CviBuildMode } from '../model/types';
import { CviBuildService } from '../services/cviBuildService';
import { CviProjectSettingsService } from '../services/cviProjectSettingsService';
import { CviWorkspaceService } from '../services/cviWorkspaceService';

interface QuickActionsSummary {
  workspaceName: string;
  projectCount: number;
  projectName: string;
  projectPath: string;
  buildMode: CviBuildMode;
  customConfig?: string;
  targetType: string;
  commandLine: string;
  workingDirectory: string;
  environment: string;
  buildSteps: string;
  dependencies: string;
  files: string;
  hasMissingFiles: boolean;
}

interface QuickActionNode {
  label: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  command?: vscode.Command;
  contextValue?: string;
}

export class QuickActionsView implements vscode.TreeDataProvider<QuickActionNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<QuickActionNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly workspaces: CviWorkspaceService,
    private readonly builds: CviBuildService,
    private readonly projectSettings: CviProjectSettingsService
  ) {
    this.disposables.push(this.workspaces.onDidChange(() => this.update()));
    this.disposables.push(this.builds.onDidChangeBuilding(() => this.update()));
    this.disposables.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('labwindowsCvi.buildMode') || e.affectsConfiguration('labwindowsCvi.customBuildConfiguration')) {
        this.update();
      }
    }));
  }

  update(): void {
    this.emitter.fire();
  }

  getTreeItem(element: QuickActionNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.tooltip = element.tooltip ?? [element.label, element.description].filter(Boolean).join(' — ');
    item.contextValue = element.contextValue ?? 'cviQuickActionSummary';
    if (element.icon) {
      item.iconPath = new vscode.ThemeIcon(element.icon);
    }
    item.command = element.command;
    return item;
  }

  getChildren(): QuickActionNode[] {
    const workspace = this.workspaces.currentWorkspace;
    const ref = this.workspaces.activeProjectRef;
    if (!workspace) {
      return [
        info('No workspace loaded', 'Open or create a CVI workspace to display the active target summary.', 'info'),
        action('Open workspace or project…', 'labwindowsCvi.openWorkspace', 'folder-opened'),
        action('Create workspace and project…', 'labwindowsCvi.createWorkspaceProject', 'new-folder')
      ];
    }
    if (!ref?.exists) {
      return [
        info('No active project', 'Select an existing project in the workspace tree.', 'info'),
        action('Open workspace or project…', 'labwindowsCvi.openWorkspace', 'folder-opened')
      ];
    }

    const summary = this.createSummary();
    if (!summary) {
      return [];
    }
    const items: QuickActionNode[] = [];
    if (this.builds.isBuilding) {
      items.push(action('Build in progress…', 'labwindowsCvi.showFullBuildTrace', 'sync~spin', 'Compiling target…', 'Click to view build trace'));
    }
    items.push(
      action(summary.projectName, 'labwindowsCvi.openProjectFile', 'project', `${summary.workspaceName} · ${summary.projectCount} project${summary.projectCount === 1 ? '' : 's'}`, 'Click to open project file (.prj)'),
      action('Target type', 'labwindowsCvi.selectTargetType', 'symbol-enum', summary.targetType, 'Click to switch CVI target type (Executable, DLL, Static Library)'),
      action(
        'Build mode',
        'labwindowsCvi.selectBuildMode',
        'settings-gear',
        summary.customConfig
          ? `${summary.customConfig} (${modeDescription(summary.buildMode)})`
          : modeDescription(summary.buildMode),
        'Click to switch build mode or custom configuration (Manage Configurations…)'
      ),
      action('Command line', 'labwindowsCvi.quickActions.editCommandLine', 'terminal', summary.commandLine, 'Click to edit runtime command-line arguments'),
      action('Working directory', 'labwindowsCvi.quickActions.editWorkingDirectory', 'folder', summary.workingDirectory, 'Click to edit runtime working directory'),
      action('Environment', 'labwindowsCvi.quickActions.editEnvironment', 'symbol-key', summary.environment, 'Click to edit runtime environment options'),
      action('Build steps', 'labwindowsCvi.editTargetSettings', 'list-ordered', summary.buildSteps, 'Click to configure pre-build, custom, and post-build actions', ['build']),
      action('Dependencies', 'labwindowsCvi.editTargetSettings', 'references', summary.dependencies, 'Click to configure project dependencies', ['dependencies']),
      action('Project files', 'workbench.view.extension.labwindowsCvi', summary.hasMissingFiles ? 'warning' : 'pass', summary.files, 'Click to explore project files in CVI workspace view'),
      action('Target settings…', 'labwindowsCvi.editTargetSettings', 'settings-gear'),
      action('Build options…', 'labwindowsCvi.editBuildOptions', 'tools'),
      action('Run options…', 'labwindowsCvi.chooseRunAction', 'list-selection'),
      action('Debug in VS Code', 'labwindowsCvi.debugWithVsCode', 'debug')
    );
    return items;
  }

  async editCommandLine(): Promise<void> {
    const ref = this.workspaces.activeProjectRef;
    if (!ref?.exists) {
      return;
    }
    const settings = this.projectSettings.getSettings(ref);
    const value = await vscode.window.showInputBox({
      title: `Command-line arguments — ${ref.name}`,
      prompt: 'Enter command-line arguments to pass when executing this target',
      value: settings.run.arguments
    });
    if (value !== undefined) {
      settings.run.arguments = value.trim();
      this.projectSettings.setSettings(ref, settings);
      this.update();
    }
  }

  async editWorkingDirectory(): Promise<void> {
    const ref = this.workspaces.activeProjectRef;
    if (!ref?.exists) {
      return;
    }
    const settings = this.projectSettings.getSettings(ref);
    const value = await vscode.window.showInputBox({
      title: `Working directory — ${ref.name}`,
      prompt: 'Enter working directory for execution (leave empty for project directory)',
      value: settings.run.workingDirectory
    });
    if (value !== undefined) {
      settings.run.workingDirectory = value.trim();
      this.projectSettings.setSettings(ref, settings);
      this.update();
    }
  }

  async editEnvironment(): Promise<void> {
    const ref = this.workspaces.activeProjectRef;
    if (!ref?.exists) {
      return;
    }
    const settings = this.projectSettings.getSettings(ref);
    const value = await vscode.window.showInputBox({
      title: `Environment options — ${ref.name}`,
      prompt: 'Enter environment variables (e.g. VAR1=val;VAR2=val)',
      value: settings.run.environmentOptions
    });
    if (value !== undefined) {
      settings.run.environmentOptions = value.trim();
      this.projectSettings.setSettings(ref, settings);
      this.update();
    }
  }

  dispose(): void {
    this.emitter.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }

  private createSummary(): QuickActionsSummary | undefined {
    const workspace = this.workspaces.currentWorkspace;
    const ref = this.workspaces.activeProjectRef;
    if (!workspace || !ref?.exists) {
      return undefined;
    }
    const project = this.workspaces.getProject(ref);
    const settings = this.projectSettings.getSettings(ref);
    const actionCounts = [settings.preBuildActions.length, settings.customBuildActions.length, settings.postBuildActions.length];
    const actionTotal = actionCounts.reduce((sum, count) => sum + count, 0);
    const missingFiles = project?.files.filter((file) => !file.exists).length ?? 0;
    const totalFiles = project?.files.length ?? 0;
    const customConfig = vscode.workspace.getConfiguration('labwindowsCvi').get<string>('customBuildConfiguration', '').trim();
    return {
      workspaceName: workspace.name,
      projectCount: workspace.projects.length,
      projectName: ref.name,
      projectPath: ref.absolutePath,
      buildMode: this.builds.buildMode,
      customConfig: customConfig || undefined,
      targetType: project?.targetType || 'Unknown',
      commandLine: settings.run.arguments.trim() ? settings.run.arguments.trim() : 'None',
      workingDirectory: settings.run.workingDirectory.trim() ? settings.run.workingDirectory.trim() : 'Default',
      environment: settings.run.environmentOptions.trim() ? settings.run.environmentOptions.trim() : 'Default',
      buildSteps: actionTotal === 0 ? 'Empty' : `Pre ${actionCounts[0]} · Custom ${actionCounts[1]} · Post ${actionCounts[2]}`,
      dependencies: settings.dependencies.length === 0 ? 'None' : String(settings.dependencies.length),
      files: missingFiles === 0 ? `${totalFiles} · no missing file` : `${totalFiles} · ${missingFiles} missing`,
      hasMissingFiles: missingFiles > 0
    };
  }
}

function info(label: string, description: string, icon: string): QuickActionNode {
  return { label, description, icon };
}

function action(label: string, command: string, icon: string, description?: string, tooltip?: string, commandArgs?: any[]): QuickActionNode {
  return {
    label,
    icon,
    description,
    tooltip: tooltip ?? (description ? `${label}: ${description}` : label),
    contextValue: 'cviQuickActionCommand',
    command: { command, title: label, arguments: commandArgs }
  };
}

function modeDescription(mode: CviBuildMode): string {
  switch (mode) {
    case 'release': return 'Release x86';
    case 'debug64': return 'Debug x64';
    case 'release64': return 'Release x64';
    default: return 'Debug x86';
  }
}
