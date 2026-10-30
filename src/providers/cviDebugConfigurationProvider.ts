import * as vscode from 'vscode';
import { CviBuildService } from '../services/cviBuildService';
import { CviWorkspaceService } from '../services/cviWorkspaceService';

export class CviDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  constructor(
    private readonly workspaces: CviWorkspaceService,
    private readonly builds: CviBuildService
  ) {}

  provideDebugConfigurations(
    _folder: vscode.WorkspaceFolder | undefined,
    _token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration[]> {
    return [
      {
        name: 'LabWindows/CVI: Debug Active Project',
        type: 'cvi',
        request: 'launch'
      }
    ];
  }

  async resolveDebugConfiguration(
    _folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    _token?: vscode.CancellationToken
  ): Promise<vscode.DebugConfiguration | undefined | null> {
    // If empty config (e.g. user pressed F5 without launch.json)
    if (!config.type && !config.request && !config.name) {
      config.type = 'cvi';
      config.name = 'LabWindows/CVI: Debug Active Project';
      config.request = 'launch';
    }

    if (config.type === 'cvi') {
      const projectRef = this.workspaces.activeProjectRef;
      if (!projectRef?.exists) {
        vscode.window.showErrorMessage('No active LabWindows/CVI project found to debug. Please open or select a project.');
        return undefined;
      }

      const resolved = await this.builds.prepareDebugConfiguration(projectRef);
      if (!resolved) {
        return undefined;
      }
      return resolved;
    }

    return config;
  }
}
