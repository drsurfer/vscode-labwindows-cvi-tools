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
      title: 'Add New CVI Build Configuration — Step 1 of 4',
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

    // Step 2: Bit-ness (32-bit vs 64-bit) as in native LabWindows/CVI
    const bitnessChoice = await vscode.window.showQuickPick(
      [
        { label: '$(server) 64-bit (x64)', value: true, description: 'Target 64-bit Windows architecture' },
        { label: '$(device-desktop) 32-bit (x86)', value: false, description: 'Target 32-bit Windows architecture' }
      ],
      {
        title: `New Configuration "${cleanName}" — Step 2 of 4: Target Architecture`,
        placeHolder: 'Select 64-bit or 32-bit bitness'
      }
    );

    if (!bitnessChoice) return;
    const is64Bit = bitnessChoice.value;

    // Step 3: Build Mode (Debug vs Release) as in native LabWindows/CVI
    const modeChoice = await vscode.window.showQuickPick(
      [
        { label: '$(bug) Debug', value: false, description: 'Generate debugging symbols, runtime checking enabled' },
        { label: '$(rocket) Release', value: true, description: 'Compiler optimizations enabled, release symbols' }
      ],
      {
        title: `New Configuration "${cleanName}" — Step 3 of 4: Build Mode`,
        placeHolder: 'Select Debug or Release build mode'
      }
    );

    if (!modeChoice) return;
    const isRelease = modeChoice.value;

    // Step 4: Copy settings from existing configuration
    const defaultBaseKey = is64Bit ? (isRelease ? 'release64' : 'debug64') : (isRelease ? 'release' : 'debug');
    const customConfigs = this.parser.getCustomConfigurations(ref.absolutePath);
    const baseOptions: Array<{ label: string; value: string; is64?: boolean; isRelease?: boolean }> = [
      {
        label: is64Bit
          ? (isRelease ? '$(rocket) Release x64 (Recommended)' : '$(gear) Debug x64 (Recommended)')
          : (isRelease ? '$(rocket) Release x86 (Recommended)' : '$(gear) Debug x86 (Recommended)'),
        value: defaultBaseKey,
        is64: is64Bit,
        isRelease
      },
      ...['debug', 'release', 'debug64', 'release64']
        .filter((k) => k !== defaultBaseKey)
        .map((k) => ({
          label: k === 'debug' ? '$(gear) Debug x86' : k === 'release' ? '$(rocket) Release x86' : k === 'debug64' ? '$(gear) Debug x64' : '$(rocket) Release x64',
          value: k,
          is64: k.endsWith('64'),
          isRelease: k.toLowerCase().includes('release')
        })),
      ...customConfigs.map((c) => ({
        label: `$(layers) Copy settings from ${c.name}`,
        value: c.name,
        is64: c.is64Bit,
        isRelease: c.isRelease
      }))
    ];

    const baseChoice = await vscode.window.showQuickPick(baseOptions, {
      title: `New Configuration "${cleanName}" — Step 4 of 4: Copy Settings From`,
      placeHolder: 'Select a base configuration to inherit compiler & linker options from'
    });

    if (!baseChoice) return;

    try {
      this.parser.addCustomConfiguration(
        ref.absolutePath,
        cleanName,
        baseChoice.value,
        is64Bit,
        isRelease
      );

      const activate = await vscode.window.showInformationMessage(
        `Created build configuration "${cleanName}" (${is64Bit ? 'x64' : 'x86'} ${isRelease ? 'Release' : 'Debug'}). Set as active configuration now?`,
        'Yes',
        'No'
      );

      if (activate === 'Yes') {
        await this.setActiveConfiguration(ref, cleanName);
      } else {
        this.workspaces.refresh();
      }
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
      vscode.window.showInformationMessage(`Configuration "${targetName.trim()}" duplicated from "${source.value}".`);
      this.workspaces.refresh();
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
    if (customName) {
      const customs = this.parser.getCustomConfigurations(ref.absolutePath);
      const found = customs.find((c) => c.name.toLowerCase() === customName.toLowerCase());
      const baseMode: CviBuildMode = found
        ? found.is64Bit ? (found.isRelease ? 'release64' : 'debug64') : (found.isRelease ? 'release' : 'debug')
        : 'debug';
      await config.update('buildMode', baseMode, vscode.ConfigurationTarget.Workspace);
      await config.update('customBuildConfiguration', customName, vscode.ConfigurationTarget.Workspace);
      vscode.window.showInformationMessage(`Active build configuration: ${customName} (${baseMode}).`);
    } else if (standardMode) {
      await config.update('buildMode', standardMode, vscode.ConfigurationTarget.Workspace);
      await config.update('customBuildConfiguration', '', vscode.ConfigurationTarget.Workspace);
      vscode.window.showInformationMessage(`Active build mode: ${standardMode}.`);
    }
    this.workspaces.refresh();
  }
}
