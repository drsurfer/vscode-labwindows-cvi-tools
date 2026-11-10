import * as vscode from 'vscode';
import { CviParser } from '../model/cviParser';
import { CviBuildMode, CviWorkspaceProjectRef } from '../model/types';
import { CviWorkspaceService } from './cviWorkspaceService';

export class CviConfigurationService {
  constructor(
    private readonly workspaces: CviWorkspaceService,
    private readonly parser: CviParser
  ) {}

  async manageConfigurations(projectRef?: CviWorkspaceProjectRef): Promise<void> {
    const ref = projectRef ?? this.workspaces.activeProjectRef;
    if (!ref?.exists) {
      vscode.window.showErrorMessage('No active CVI project is available to manage configurations.');
      return;
    }

    const customConfigs = this.parser.getCustomConfigurations(ref.absolutePath);
    const currentCustom = vscode.workspace.getConfiguration('labwindowsCvi').get<string>('customBuildConfiguration', '').trim();
    const currentMode = vscode.workspace.getConfiguration('labwindowsCvi').get<CviBuildMode>('buildMode', 'debug');

    interface ActionPickItem extends vscode.QuickPickItem {
      actionId?: 'add' | 'duplicate' | 'rename' | 'delete' | 'setActive';
      customName?: string;
      standardMode?: CviBuildMode;
    }

    const items: ActionPickItem[] = [
      {
        label: '$(add) Add New Configuration...',
        description: 'Create a new custom build configuration for this project',
        actionId: 'add'
      },
      {
        label: '$(copy) Duplicate Configuration...',
        description: 'Duplicate an existing build configuration settings',
        actionId: 'duplicate'
      },
      {
        label: '$(edit) Rename Custom Configuration...',
        description: 'Rename an existing custom configuration',
        actionId: 'rename'
      },
      {
        label: '$(trash) Delete Custom Configuration...',
        description: 'Remove a custom build configuration from the .prj',
        actionId: 'delete'
      },
      {
        label: 'Select Active Configuration',
        kind: vscode.QuickPickItemKind.Separator
      } as any,
      {
        label: '$(gear) Debug x86',
        description: 'Standard 32-bit Debug configuration',
        detail: !currentCustom && currentMode === 'debug' ? '✓ Currently active' : undefined,
        actionId: 'setActive',
        standardMode: 'debug'
      },
      {
        label: '$(rocket) Release x86',
        description: 'Standard 32-bit Release configuration',
        detail: !currentCustom && currentMode === 'release' ? '✓ Currently active' : undefined,
        actionId: 'setActive',
        standardMode: 'release'
      },
      {
        label: '$(gear) Debug x64',
        description: 'Standard 64-bit Debug configuration',
        detail: !currentCustom && currentMode === 'debug64' ? '✓ Currently active' : undefined,
        actionId: 'setActive',
        standardMode: 'debug64'
      },
      {
        label: '$(rocket) Release x64',
        description: 'Standard 64-bit Release configuration',
        detail: !currentCustom && currentMode === 'release64' ? '✓ Currently active' : undefined,
        actionId: 'setActive',
        standardMode: 'release64'
      }
    ];

    if (customConfigs.length > 0) {
      items.push({
        label: 'Custom Configurations',
        kind: vscode.QuickPickItemKind.Separator
      } as any);

      for (const c of customConfigs) {
        const isCurrent = currentCustom.toLowerCase() === c.name.toLowerCase();
        const arch = c.is64Bit ? 'x64' : 'x86';
        const type = c.isRelease ? 'Release' : 'Debug';
        items.push({
          label: `$(layers) ${c.name}`,
          description: `Custom ${arch} ${type} configuration`,
          detail: isCurrent ? '✓ Currently active' : undefined,
          actionId: 'setActive',
          customName: c.name
        });
      }
    }

    const selected = await vscode.window.showQuickPick(items, {
      title: `LabWindows/CVI Manage Configurations — ${ref.name}`,
      placeHolder: 'Select an action or switch active configuration'
    });

    if (!selected) return;

    switch (selected.actionId) {
      case 'add':
        await this.promptAddConfiguration(ref);
        break;
      case 'duplicate':
        await this.promptDuplicateConfiguration(ref);
        break;
      case 'rename':
        await this.promptRenameConfiguration(ref);
        break;
      case 'delete':
        await this.promptDeleteConfiguration(ref);
        break;
      case 'setActive':
        if (selected.customName) {
          await this.setActiveConfiguration(ref, selected.customName);
        } else if (selected.standardMode) {
          await this.setActiveConfiguration(ref, undefined, selected.standardMode);
        }
        break;
    }
  }

  async promptAddConfiguration(ref: CviWorkspaceProjectRef): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: 'Add New CVI Build Configuration — Step 1 of 2 (or 4)',
      prompt: 'Enter a name for the new configuration (e.g. Profiling, UnitTesting, HighOptimization)',
      validateInput: (val) => {
        const clean = val.trim();
        if (!clean) return 'Configuration name cannot be empty.';
        if (!/^[a-zA-Z0-9_\-\s]+$/.test(clean)) return 'Name contains invalid characters.';
        const existing = this.parser.getCustomConfigurations(ref.absolutePath);
        if (existing.some((c) => c.name.toLowerCase() === clean.toLowerCase())) {
          return `A configuration named "${clean}" already exists.`;
        }
        if (['debug', 'release', 'debug64', 'release64'].includes(clean.toLowerCase())) {
          return `"${clean}" is a reserved standard configuration name.`;
        }
        return null;
      }
    });

    if (!name?.trim()) return;
    const cleanName = name.trim();

    // Step 2: Choose whether to copy settings from an existing configuration OR create a blank one
    const customConfigs = this.parser.getCustomConfigurations(ref.absolutePath);
    interface CopySourceItem extends vscode.QuickPickItem {
      isCopy: boolean;
      value?: string;
      is64?: boolean;
      isRelease?: boolean;
    }

    const sourceOptions: CopySourceItem[] = [
      {
        label: '$(gear) Debug x64 (Standard 64-bit Debug)',
        description: 'Inherits 64-bit Debug settings',
        isCopy: true,
        value: 'debug64',
        is64: true,
        isRelease: false
      },
      {
        label: '$(rocket) Release x64 (Standard 64-bit Release)',
        description: 'Inherits 64-bit Release settings',
        isCopy: true,
        value: 'release64',
        is64: true,
        isRelease: true
      },
      {
        label: '$(gear) Debug x86 (Standard 32-bit Debug)',
        description: 'Inherits 32-bit Debug settings',
        isCopy: true,
        value: 'debug',
        is64: false,
        isRelease: false
      },
      {
        label: '$(rocket) Release x86 (Standard 32-bit Release)',
        description: 'Inherits 32-bit Release settings',
        isCopy: true,
        value: 'release',
        is64: false,
        isRelease: true
      }
    ];

    for (const c of customConfigs) {
      const arch = c.is64Bit ? 'x64' : 'x86';
      const mode = c.isRelease ? 'Release' : 'Debug';
      sourceOptions.push({
        label: `$(layers) ${c.name}`,
        description: `Custom ${arch} ${mode} configuration`,
        isCopy: true,
        value: c.name,
        is64: c.is64Bit,
        isRelease: c.isRelease
      });
    }

    sourceOptions.push({
      label: '$(file) Do not copy (create blank configuration with default settings)',
      description: 'Prompts for target architecture and build mode, with clean CVI defaults',
      isCopy: false
    });

    const sourceChoice = await vscode.window.showQuickPick(sourceOptions, {
      title: `New Configuration "${cleanName}" — Select Base Configuration`,
      placeHolder: 'Select an existing configuration to copy from, or choose blank defaults'
    });

    if (!sourceChoice) return;

    let is64Bit = sourceChoice.is64 ?? true;
    let isRelease = sourceChoice.isRelease ?? false;
    let baseConfigName: string | undefined = sourceChoice.value;

    if (!sourceChoice.isCopy) {
      // User chose blank configuration: prompt for bitness and mode
      const bitnessChoice = await vscode.window.showQuickPick(
        [
          { label: '$(server) 64-bit (x64)', value: true, description: 'Target 64-bit Windows architecture' },
          { label: '$(device-desktop) 32-bit (x86)', value: false, description: 'Target 32-bit Windows architecture' }
        ],
        {
          title: `New Configuration "${cleanName}" — Step 3 of 4: Target Architecture`,
          placeHolder: 'Select 64-bit or 32-bit bitness'
        }
      );

      if (!bitnessChoice) return;
      is64Bit = bitnessChoice.value;

      const modeChoice = await vscode.window.showQuickPick(
        [
          { label: '$(bug) Debug', value: false, description: 'Generate debugging symbols, runtime checking enabled' },
          { label: '$(rocket) Release', value: true, description: 'Compiler optimizations enabled, release symbols' }
        ],
        {
          title: `New Configuration "${cleanName}" — Step 4 of 4: Build Mode`,
          placeHolder: 'Select Debug or Release build mode'
        }
      );

      if (!modeChoice) return;
      isRelease = modeChoice.value;
      baseConfigName = undefined;
    }

    try {
      this.parser.addCustomConfiguration(
        ref.absolutePath,
        cleanName,
        baseConfigName,
        is64Bit,
        isRelease
      );

      // Immediately activate new configuration so CVI Actions updates right away
      await this.setActiveConfiguration(ref, cleanName);
      vscode.window.showInformationMessage(
        `Build configuration "${cleanName}" (${is64Bit ? 'x64' : 'x86'} ${isRelease ? 'Release' : 'Debug'}) created and set as active.`
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to add configuration: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async promptDuplicateConfiguration(ref: CviWorkspaceProjectRef): Promise<void> {
    const customConfigs = this.parser.getCustomConfigurations(ref.absolutePath);
    const sourceOptions: Array<{ label: string; value: string }> = [
      { label: '$(gear) Debug x86', value: 'debug' },
      { label: '$(rocket) Release x86', value: 'release' },
      { label: '$(gear) Debug x64', value: 'debug64' },
      { label: '$(rocket) Release x64', value: 'release64' },
      ...customConfigs.map((c) => ({ label: `$(layers) ${c.name}`, value: c.name }))
    ];

    const source = await vscode.window.showQuickPick(sourceOptions, {
      title: 'Duplicate Build Configuration',
      placeHolder: 'Select the configuration to duplicate'
    });

    if (!source) return;

    const targetName = await vscode.window.showInputBox({
      title: `Duplicate "${source.value}"`,
      prompt: 'Enter name for the duplicated configuration',
      value: `${source.value}_Copy`,
      validateInput: (val) => {
        const clean = val.trim();
        if (!clean) return 'Configuration name cannot be empty.';
        const existing = this.parser.getCustomConfigurations(ref.absolutePath);
        if (existing.some((c) => c.name.toLowerCase() === clean.toLowerCase())) {
          return `A configuration named "${clean}" already exists.`;
        }
        return null;
      }
    });

    if (!targetName?.trim()) return;

    try {
      this.parser.duplicateConfiguration(ref.absolutePath, source.value, targetName.trim());
      await this.setActiveConfiguration(ref, targetName.trim());
      vscode.window.showInformationMessage(`Configuration "${targetName.trim()}" duplicated from "${source.value}" and set as active.`);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to duplicate configuration: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async promptRenameConfiguration(ref: CviWorkspaceProjectRef): Promise<void> {
    const customConfigs = this.parser.getCustomConfigurations(ref.absolutePath);
    if (customConfigs.length === 0) {
      vscode.window.showInformationMessage('No custom build configurations exist in this project to rename.');
      return;
    }

    const choice = await vscode.window.showQuickPick(
      customConfigs.map((c) => ({ label: `$(layers) ${c.name}`, value: c.name })),
      { title: 'Rename Custom Build Configuration', placeHolder: 'Select configuration to rename' }
    );

    if (!choice) return;

    const newName = await vscode.window.showInputBox({
      title: `Rename "${choice.value}"`,
      prompt: 'Enter the new configuration name',
      value: choice.value,
      validateInput: (val) => {
        const clean = val.trim();
        if (!clean) return 'Configuration name cannot be empty.';
        if (clean.toLowerCase() === choice.value.toLowerCase()) return null;
        const existing = this.parser.getCustomConfigurations(ref.absolutePath);
        if (existing.some((c) => c.name.toLowerCase() === clean.toLowerCase())) {
          return `A configuration named "${clean}" already exists.`;
        }
        return null;
      }
    });

    if (!newName?.trim() || newName.trim() === choice.value) return;

    try {
      this.parser.renameCustomConfiguration(ref.absolutePath, choice.value, newName.trim());
      const currentCustom = vscode.workspace.getConfiguration('labwindowsCvi').get<string>('customBuildConfiguration', '').trim();
      if (currentCustom.toLowerCase() === choice.value.toLowerCase()) {
        await vscode.workspace.getConfiguration('labwindowsCvi').update('customBuildConfiguration', newName.trim(), vscode.ConfigurationTarget.Workspace);
      }
      vscode.window.showInformationMessage(`Configuration renamed to "${newName.trim()}".`);
      this.workspaces.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to rename configuration: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async promptDeleteConfiguration(ref: CviWorkspaceProjectRef): Promise<void> {
    const customConfigs = this.parser.getCustomConfigurations(ref.absolutePath);
    if (customConfigs.length === 0) {
      vscode.window.showInformationMessage('No custom build configurations exist in this project to delete.');
      return;
    }

    const choice = await vscode.window.showQuickPick(
      customConfigs.map((c) => ({ label: `$(layers) ${c.name}`, value: c.name })),
      { title: 'Delete Custom Build Configuration', placeHolder: 'Select configuration to permanently remove' }
    );

    if (!choice) return;

    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to permanently delete custom configuration "${choice.value}" from project ${ref.name}?`,
      { modal: true },
      'Delete'
    );

    if (confirm !== 'Delete') return;

    try {
      this.parser.removeCustomConfiguration(ref.absolutePath, choice.value);
      const currentCustom = vscode.workspace.getConfiguration('labwindowsCvi').get<string>('customBuildConfiguration', '').trim();
      if (currentCustom.toLowerCase() === choice.value.toLowerCase()) {
        await vscode.workspace.getConfiguration('labwindowsCvi').update('customBuildConfiguration', '', vscode.ConfigurationTarget.Workspace);
      }
      vscode.window.showInformationMessage(`Configuration "${choice.value}" deleted.`);
      this.workspaces.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to delete configuration: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async setActiveConfiguration(ref: CviWorkspaceProjectRef, customName?: string, standardMode?: CviBuildMode): Promise<void> {
    const config = vscode.workspace.getConfiguration('labwindowsCvi');
    const target = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0)
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;

    if (customName) {
      const customs = this.parser.getCustomConfigurations(ref.absolutePath);
      const found = customs.find((c) => c.name.toLowerCase() === customName.toLowerCase());
      const baseMode: CviBuildMode = found
        ? found.is64Bit ? (found.isRelease ? 'release64' : 'debug64') : (found.isRelease ? 'release' : 'debug')
        : 'debug';
      await config.update('buildMode', baseMode, target);
      await config.update('customBuildConfiguration', customName, target);
      vscode.window.showInformationMessage(`Active build configuration: ${customName} (${baseMode}).`);
    } else if (standardMode) {
      await config.update('buildMode', standardMode, target);
      await config.update('customBuildConfiguration', '', target);
      vscode.window.showInformationMessage(`Active build mode: ${standardMode}.`);
    }
    this.workspaces.refresh();
  }
}
