import * as path from 'path';
import * as vscode from 'vscode';
import { CviParser } from './model/cviParser';
import { CviTreeProvider, CviTreeNode, FileNode, FolderNode, ProjectNode } from './providers/cviTreeProvider';
import { CviFileSymbolsProvider } from './providers/cviFileSymbolsProvider';
import { CviBuildService } from './services/cviBuildService';
import { CviCppToolsService } from './services/cviCppToolsService';
import { CviInstallationService } from './services/cviInstallationService';
import { CviWorkspaceService } from './services/cviWorkspaceService';
import { HomePanel } from './views/homePanel';
import { activate as activateCviLibraryExplorer } from './jcLibEmbedded';
import { ensureBundledCviLibraryPack } from './services/cviLibraryPackService';
import { CviTemplateService } from './services/cviTemplateService';
import { CviProjectSettingsService } from './services/cviProjectSettingsService';
import { BuildSettingsPanel } from './views/buildSettingsPanel';
import { BuildOptionsPanel } from './views/buildOptionsPanel';
import { QuickActionsView } from './views/quickActionsView';
import { CviCompletionProvider, CviSourceSymbol, CviSymbolService, isSourceOrHeader } from './services/cviSymbolService';
import { CviFunctionPanelService } from './services/cviFunctionPanelService';
import { CviColorValueService } from './services/cviColorValueService';
import { CviContextToolsService } from './services/cviContextToolsService';
import { CviEncodingService } from './services/cviEncodingService';
import { CviGdbDebugService } from './services/cviGdbDebugService';
import { CviDebugConfigurationProvider } from './providers/cviDebugConfigurationProvider';
import { CviResourceTrackerService } from './services/cviResourceTrackerService';
import { CviResourceTreeProvider } from './providers/cviResourceTreeProvider';
import { CviThreadTrackerService } from './services/cviThreadTrackerService';
import { CviThreadTreeProvider } from './providers/cviThreadTreeProvider';
import { CviCpuStripchartPanel } from './views/cviCpuStripchartPanel';
import { CviConfigurationService } from './services/cviConfigurationService';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('LabWindows/CVI');
  const buildTraceOutput = vscode.window.createOutputChannel('LabWindows/CVI - Build Trace');
  const buildDiagnostics = vscode.languages.createDiagnosticCollection('labwindowsCviBuild');
  const parser = new CviParser();
  const installations = new CviInstallationService(output);
  const cppTools = new CviCppToolsService(installations, parser, output);
  const templates = new CviTemplateService(context, installations, output);
  const workspaces = new CviWorkspaceService(context, parser, installations, templates, output);
  const projectSettings = new CviProjectSettingsService(workspaces, parser, output);
  const colorValues = new CviColorValueService();
  const contextTools = new CviContextToolsService(context);
  const encodingService = new CviEncodingService(workspaces, output);
  const gdbService = new CviGdbDebugService(context, output, buildTraceOutput);
  const builds = new CviBuildService(parser, workspaces, installations, projectSettings, gdbService, output, buildTraceOutput, buildDiagnostics);
  const treeProvider = new CviTreeProvider(workspaces, builds);
  const treeView = vscode.window.createTreeView('labwindowsCvi.workspaceExplorer', { treeDataProvider: treeProvider, dragAndDropController: treeProvider, showCollapseAll: true, canSelectMany: true });
  const symbols = new CviSymbolService(context.extensionPath, workspaces);
  const fileSymbolsProvider = new CviFileSymbolsProvider(symbols);
  const fileSymbolsView = vscode.window.createTreeView('labwindowsCvi.fileSymbols', { treeDataProvider: fileSymbolsProvider });
  fileSymbolsProvider.attachView(fileSymbolsView);
  const completionProvider = new CviCompletionProvider(symbols);
  const functionPanels = new CviFunctionPanelService();
  const completionRegistration = vscode.languages.registerCompletionItemProvider(
    [{ language: 'c', scheme: 'file' }, { language: 'cpp', scheme: 'file' }],
    completionProvider
  );
  const documentSymbolRegistration = vscode.languages.registerDocumentSymbolProvider(
    [{ language: 'c', scheme: 'file' }, { language: 'cpp', scheme: 'file' }],
    {
      async provideDocumentSymbols(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
        const fileSymbols = await symbols.symbolsForFile(document.uri.fsPath);
        return fileSymbols.map((sym) => {
          const line = Math.max(0, Math.min(sym.line, document.lineCount - 1));
          const char = Math.max(0, sym.character);
          const range = new vscode.Range(line, char, line, char + sym.name.length);
          return new vscode.DocumentSymbol(
            sym.label || sym.name,
            sym.isDeclaration ? 'declaration' : '',
            sym.kind,
            range,
            range
          );
        });
      }
    }
  );
  void vscode.commands.executeCommand('setContext', 'labwindowsCvi.outlineFollowCursor', true);
  void vscode.commands.executeCommand('setContext', 'labwindowsCvi.outlineFilterOnType', false);
  void vscode.commands.executeCommand('setContext', 'labwindowsCvi.outlineSortMode', 'position');
  const home = new HomePanel(context, workspaces, builds, installations);
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer('labwindowsCvi.home', {
      async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, _state: unknown) {
        home.attach(webviewPanel);
      }
    })
  );
  void vscode.commands.executeCommand('setContext', 'labwindowsCvi.showFullFilePaths', vscode.workspace.getConfiguration('labwindowsCvi').get<boolean>('showFullFilePaths', false));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('labwindowsCvi.showFullFilePaths')) {
      const val = vscode.workspace.getConfiguration('labwindowsCvi').get<boolean>('showFullFilePaths', false);
      void vscode.commands.executeCommand('setContext', 'labwindowsCvi.showFullFilePaths', val);
      treeProvider.refresh();
    }
  }));
  const buildSettings = new BuildSettingsPanel(workspaces, parser, projectSettings);
  const buildOptions = new BuildOptionsPanel(workspaces, parser, cppTools);
  const quickActions = new QuickActionsView(workspaces, builds, projectSettings);
  const quickActionsRegistration = vscode.window.registerTreeDataProvider('labwindowsCvi.quickActions', quickActions);
  const resourceTracker = new CviResourceTrackerService(output);
  const resourceTreeProvider = new CviResourceTreeProvider(resourceTracker);
  const resourceTreeView = vscode.window.createTreeView('labwindowsCvi.resourceTracking', { treeDataProvider: resourceTreeProvider, showCollapseAll: true });
  const configService = new CviConfigurationService(workspaces, parser);
  const threadTracker = new CviThreadTrackerService(output);
  const threadTreeProvider = new CviThreadTreeProvider(threadTracker);
  const threadTreeView = vscode.window.createTreeView('labwindowsCvi.processThreads', { treeDataProvider: threadTreeProvider, showCollapseAll: true });

  const statusBarItems = [
    createStatusBarAction('$(home)', 'LabWindows/CVI home', 'labwindowsCvi.openHome', 99),
    createStatusBarAction('$(folder-opened)', 'Open a CVI workspace or project', 'labwindowsCvi.openWorkspace', 98),
    createStatusBarAction('$(tools)', 'Build / rebuild / clean the active CVI project', 'labwindowsCvi.chooseBuildAction', 97),
    createStatusBarAction('$(play)', 'Build and run the active CVI target', 'labwindowsCvi.run', 96),
    createStatusBarAction('$(debug)', 'Build and debug active CVI project in VS Code (GDB)', 'labwindowsCvi.debugWithVsCode', 95.5),
    createStatusBarAction('$(list-selection)', 'Advanced CVI run options', 'labwindowsCvi.chooseRunAction', 95),
    createStatusBarAction('D32', 'Select the LabWindows/CVI build mode', 'labwindowsCvi.selectBuildMode', 94),
    createStatusBarAction('EXE', 'Select the LabWindows/CVI target type', 'labwindowsCvi.selectTargetType', 93)
  ];

  const updateToolbarContexts = (): void => {
    const activeRef = workspaces.activeProjectRef;
    const targetType = activeRef?.exists ? workspaces.getProject(activeRef)?.targetType : undefined;
    const targetKey = targetType === 'Dynamic Link Library' ? 'dll' : targetType === 'Static Library' ? 'lib' : targetType === 'Executable' ? 'exe' : 'none';
    void vscode.commands.executeCommand('setContext', 'labwindowsCvi.buildMode', builds.buildMode);
    void vscode.commands.executeCommand('setContext', 'labwindowsCvi.targetType', targetKey);
  };

  const updateStatusBar = (): void => {
    const targetType = workspaces.activeProject?.targetType;
    const customConfig = vscode.workspace.getConfiguration('labwindowsCvi').get<string>('customBuildConfiguration', '').trim();
    const baseModeText = builds.buildMode === 'debug64' ? 'D64' : builds.buildMode === 'release64' ? 'R64' : builds.buildMode === 'release' ? 'R32' : 'D32';
    const modeText = customConfig ? (customConfig.length > 7 ? customConfig.slice(0, 6) + '…' : customConfig) : baseModeText;
    const targetText = targetType === 'Dynamic Link Library' ? 'DLL' : targetType === 'Static Library' ? 'LIB' : targetType === 'Executable' ? 'EXE' : '---';

    if (builds.isBuilding) {
      statusBarItems[2].text = '$(sync~spin) Building…';
      statusBarItems[2].tooltip = 'LabWindows/CVI build in progress. Click to view build trace.';
      statusBarItems[2].command = 'labwindowsCvi.showFullBuildTrace';
    } else {
      statusBarItems[2].text = '$(tools)';
      statusBarItems[2].tooltip = 'Build / rebuild / clean the active CVI project';
      statusBarItems[2].command = 'labwindowsCvi.chooseBuildAction';
    }

    statusBarItems[6].text = modeText;
    statusBarItems[6].tooltip = customConfig
      ? `LabWindows/CVI custom build configuration: ${customConfig} (base: ${baseModeText}). Click to change.`
      : `LabWindows/CVI build mode: ${modeText}. Click to change.`;
    statusBarItems[7].text = targetText;
    statusBarItems[7].tooltip = `LabWindows/CVI target type: ${targetText}. Click to change.`;
    const show = vscode.workspace.getConfiguration('labwindowsCvi').get<boolean>('showPersistentStatusBarActions', true);
    for (const item of statusBarItems) {
      if (show) item.show(); else item.hide();
    }
    updateToolbarContexts();
  };

  const register = (command: string, handler: (...args: any[]) => unknown): vscode.Disposable => vscode.commands.registerCommand(command, async (...args: any[]) => {
    try {
      return await handler(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`[CVI] ${command} failed: ${message}`);
      vscode.window.showErrorMessage(`LabWindows/CVI: ${message}`);
      return undefined;
    }
  });

  const focusTreeThen = async (command: string): Promise<void> => {
    await vscode.commands.executeCommand('labwindowsCvi.workspaceExplorer.focus');
    await vscode.commands.executeCommand(command);
  };

  context.subscriptions.push(
    output,
    buildTraceOutput,
    buildDiagnostics,
    workspaces,
    home,
    buildSettings,
    buildOptions,
    quickActions,
    quickActionsRegistration,
    cppTools,
    encodingService,
    treeView,
    fileSymbolsView,
    completionRegistration,
    documentSymbolRegistration,
    vscode.window.onDidChangeTextEditorSelection((event) => {
      void fileSymbolsProvider.onEditorCursorMoved(event.textEditor);
    }),
    ...statusBarItems,
    treeView.onDidChangeSelection((event) => {
      const selected = event.selection[0];
      if (selected?.kind === 'file' && isSourceOrHeader(selected.file.absolutePath)) {
        fileSymbolsProvider.setSelectedFile(selected.file.absolutePath);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document.uri.scheme === 'file' && isSourceOrHeader(editor.document.uri.fsPath)) {
        fileSymbolsProvider.setSelectedFile(editor.document.uri.fsPath);
      }
    }),
    workspaces.onDidChange(() => {
      symbols.invalidateProjectCache();
      fileSymbolsProvider.refresh();
      updateStatusBar();
      void cppTools.ensureConfigurationRootInWorkspace(workspaces.currentWorkspace).finally(() => {
        cppTools.requestSync(workspaces.currentWorkspace);
      });
    }),
    builds.onDidChangeBuilding(() => {
      updateStatusBar();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('labwindowsCvi')) {
        updateStatusBar();
        home.update();
        quickActions.update();
      }
      if (event.affectsConfiguration('labwindowsCvi.activeInstallation') || event.affectsConfiguration('labwindowsCvi.autoConfigureCppTools') || event.affectsConfiguration('labwindowsCvi.autoAddCviFolderToWorkspace') || event.affectsConfiguration('labwindowsCvi.useCppToolsConfigurationProvider') || event.affectsConfiguration('labwindowsCvi.intelliSenseCompilerPath') || event.affectsConfiguration('labwindowsCvi.additionalIncludePaths')) {
        void cppTools.ensureConfigurationRootInWorkspace(workspaces.currentWorkspace).finally(() => {
          cppTools.requestSync(workspaces.currentWorkspace);
        });
      }
    }),
    register('labwindowsCvi.openHome', () => home.show()),
    register('labwindowsCvi.openWorkspace', () => workspaces.openWorkspace()),
    register('labwindowsCvi.createWorkspaceProject', () => workspaces.createWorkspaceProject()),
    register('labwindowsCvi.refresh', () => workspaces.refresh()),
    register('labwindowsCvi.configureInstallation', async () => {
      const installation = await installations.selectInstallation(workspaces.currentWorkspace?.cviDir);
      if (installation) {
        await cppTools.sync(workspaces.currentWorkspace);
        home.update();
      }
    }),
    register('labwindowsCvi.syncCppTools', () => cppTools.sync(workspaces.currentWorkspace, true)),
    register('labwindowsCvi.diagnoseCppTools', () => cppTools.diagnose(workspaces.currentWorkspace)),
    register('labwindowsCvi.repairCppToolsProvider', () => cppTools.repairCppToolsProviderSelection(workspaces.currentWorkspace)),
    register('labwindowsCvi.repairNativeWorkspaceCompatibility', () => workspaces.repairNativeWorkspaceCompatibility()),
    register('labwindowsCvi.addWorkspaceFolderForIntelliSense', () => cppTools.addConfigurationRootToWorkspace(workspaces.currentWorkspace)),
    register('labwindowsCvi.selectBuildMode', () => builds.selectBuildMode()),
    register('labwindowsCvi.selectBuildModeD32', () => builds.selectBuildMode()),
    register('labwindowsCvi.selectBuildModeR32', () => builds.selectBuildMode()),
    register('labwindowsCvi.selectBuildModeD64', () => builds.selectBuildMode()),
    register('labwindowsCvi.selectBuildModeR64', () => builds.selectBuildMode()),
    register('labwindowsCvi.chooseBuildAction', () => builds.chooseBuildAction()),
    register('labwindowsCvi.build', () => builds.build(false)),
    register('labwindowsCvi.rebuild', () => builds.build(true)),
    register('labwindowsCvi.clean', () => builds.clean()),
    register('labwindowsCvi.batchBuild', (node?: ProjectNode) => builds.batchBuildModal(node?.ref)),
    register('labwindowsCvi.showBuildProblems', () => builds.showBuildProblems()),
    register('labwindowsCvi.showFullBuildTrace', () => builds.showFullBuildTrace()),
    register('labwindowsCvi.run', () => builds.buildAndRun()),
    register('labwindowsCvi.chooseRunAction', () => builds.chooseRunAction()),
    register('labwindowsCvi.runWithoutBuild', () => builds.runWithoutBuild()),
    register('labwindowsCvi.debugWithVsCode', (node?: ProjectNode) => builds.debugWithVsCode(node?.ref)),
    register('labwindowsCvi.openWorkspaceInCvi', () => builds.openWorkspaceInCvi()),
    register('labwindowsCvi.setActiveProject', (node?: ProjectNode) => workspaces.setActiveProject(node?.ref)),
    register('labwindowsCvi.buildProject', (node?: ProjectNode) => node ? builds.build(false, node.ref) : undefined),
    register('labwindowsCvi.rebuildProject', (node?: ProjectNode) => node ? builds.build(true, node.ref) : undefined),
    register('labwindowsCvi.cleanProject', (node?: ProjectNode) => node ? builds.clean(node.ref) : undefined),
    register('labwindowsCvi.selectTargetType', (node?: ProjectNode) => workspaces.selectTargetType(node?.ref)),
    register('labwindowsCvi.selectTargetTypeEXE', () => workspaces.selectTargetType()),
    register('labwindowsCvi.selectTargetTypeDLL', () => workspaces.selectTargetType()),
    register('labwindowsCvi.selectTargetTypeLIB', () => workspaces.selectTargetType()),
    register('labwindowsCvi.editTargetSettings', (nodeOrRefOrPage?: ProjectNode | any | string, page?: string) => {
      let ref: any = undefined;
      let targetPage: string | undefined = page;
      if (typeof nodeOrRefOrPage === 'string') {
        targetPage = nodeOrRefOrPage;
      } else if (nodeOrRefOrPage && typeof nodeOrRefOrPage === 'object') {
        if ('ref' in nodeOrRefOrPage && nodeOrRefOrPage.ref) {
          ref = nodeOrRefOrPage.ref;
        } else if ('absolutePath' in nodeOrRefOrPage) {
          ref = nodeOrRefOrPage;
        }
      }
      return buildSettings.show(ref, targetPage);
    }),
    register('labwindowsCvi.editBuildSettings', (nodeOrRefOrPage?: ProjectNode | any | string, page?: string) => {
      let ref: any = undefined;
      let targetPage: string | undefined = page;
      if (typeof nodeOrRefOrPage === 'string') {
        targetPage = nodeOrRefOrPage;
      } else if (nodeOrRefOrPage && typeof nodeOrRefOrPage === 'object') {
        if ('ref' in nodeOrRefOrPage && nodeOrRefOrPage.ref) {
          ref = nodeOrRefOrPage.ref;
        } else if ('absolutePath' in nodeOrRefOrPage) {
          ref = nodeOrRefOrPage;
        }
      }
      return buildSettings.show(ref, targetPage);
    }),
    register('labwindowsCvi.editBuildOptions', (node?: ProjectNode) => buildOptions.show(node?.ref)),
    register('labwindowsCvi.quickActions.editCommandLine', () => quickActions.editCommandLine()),
    register('labwindowsCvi.quickActions.editWorkingDirectory', () => quickActions.editWorkingDirectory()),
    register('labwindowsCvi.quickActions.editEnvironment', () => quickActions.editEnvironment()),
    register('labwindowsCvi.executeProject', (node?: ProjectNode) => node ? builds.buildAndRun(node.ref) : undefined),
    register('labwindowsCvi.debugProjectInCvi', async (node?: ProjectNode) => { if (node?.ref) await workspaces.setActiveProject(node.ref); return await builds.debugWithVsCode(node?.ref); }),
    register('labwindowsCvi.editProjectInCvi', (node?: ProjectNode) => node ? builds.openProjectInCvi(node.ref.absolutePath) : undefined),
    register('labwindowsCvi.openProjectFile', (node?: ProjectNode) => node ? workspaces.openPath(node.ref.absolutePath) : undefined),
    register('labwindowsCvi.createProjectInWorkspace', () => workspaces.createProjectInWorkspace()),
    register('labwindowsCvi.addExistingProject', () => workspaces.addExistingProject()),
    register('labwindowsCvi.removeProject', (node?: ProjectNode) => node ? workspaces.removeProject(node.ref) : undefined),
    register('labwindowsCvi.addFiles', (node?: ProjectNode | FolderNode) => {
      if (node?.kind === 'folder') {
        return workspaces.addFiles(node.ref, node.folderPath);
      }
      return workspaces.addFiles(node?.ref);
    }),
    register('labwindowsCvi.createNewFile', (node?: ProjectNode | FolderNode) => {
      if (node?.kind === 'folder') {
        return workspaces.createNewFile(node.ref, node.folderPath);
      }
      return workspaces.createNewFile(node?.ref);
    }),
    register('labwindowsCvi.addFolder', (node?: ProjectNode | FolderNode) => {
      if (node?.kind === 'folder') {
        return workspaces.addFolder(node.ref, node.folderPath);
      }
      return workspaces.addFolder(node?.ref);
    }),
    register('labwindowsCvi.renameFolder', (node?: FolderNode) => node ? workspaces.renameFolder(node.ref, node.folderPath) : undefined),
    register('labwindowsCvi.removeFolder', (node?: FolderNode) => node ? workspaces.removeFolder(node.ref, node.folderPath) : undefined),
    register('labwindowsCvi.openRecent', () => workspaces.promptOpenRecent()),
    register('labwindowsCvi.toggleShowFullFilePaths', async () => {
      const config = vscode.workspace.getConfiguration('labwindowsCvi');
      const current = config.get<boolean>('showFullFilePaths', false);
      await config.update('showFullFilePaths', !current, vscode.ConfigurationTarget.Global);
      void vscode.commands.executeCommand('setContext', 'labwindowsCvi.showFullFilePaths', !current);
      treeProvider.refresh();
    }),
    register('labwindowsCvi.toggleShowFullFilePathsOn', async () => {
      const config = vscode.workspace.getConfiguration('labwindowsCvi');
      const current = config.get<boolean>('showFullFilePaths', false);
      await config.update('showFullFilePaths', !current, vscode.ConfigurationTarget.Global);
      void vscode.commands.executeCommand('setContext', 'labwindowsCvi.showFullFilePaths', !current);
      treeProvider.refresh();
    }),
    register('labwindowsCvi.moveItemUp', async (node?: CviTreeNode) => {
      if (!node) return;
      if (node.kind === 'file') {
        await workspaces.moveFileUp(node.ref, node.file.sectionName);
      } else if (node.kind === 'folder') {
        await workspaces.moveFolderUp(node.ref, node.folderPath);
      }
    }),
    register('labwindowsCvi.moveItemDown', async (node?: CviTreeNode) => {
      if (!node) return;
      if (node.kind === 'file') {
        await workspaces.moveFileDown(node.ref, node.file.sectionName);
      } else if (node.kind === 'folder') {
        await workspaces.moveFolderDown(node.ref, node.folderPath);
      }
    }),
    register('labwindowsCvi.removeFile', async (node?: FileNode, allSelected?: CviTreeNode[]) => {
      const files = getSelectedFiles(node, allSelected);
      for (const f of files) {
        await workspaces.removeFile(f.ref, f.file.sectionName, f.file.absolutePath);
      }
    }),
    register('labwindowsCvi.excludeFile', async (node?: FileNode, allSelected?: CviTreeNode[]) => {
      const files = getSelectedFiles(node, allSelected);
      for (const f of files) {
        await workspaces.setFileExcluded(f.ref, f.file, true);
      }
    }),
    register('labwindowsCvi.includeFile', async (node?: FileNode, allSelected?: CviTreeNode[]) => {
      const files = getSelectedFiles(node, allSelected);
      for (const f of files) {
        await workspaces.setFileExcluded(f.ref, f.file, false);
      }
    }),
    register('labwindowsCvi.toggleObjOption', async (node?: FileNode, allSelected?: CviTreeNode[]) => {
      const files = getSelectedFiles(node, allSelected);
      for (const f of files) {
        await workspaces.toggleCompileIntoObjectFile(f.ref, f.file);
      }
    }),
    register('labwindowsCvi.replaceFile', (node?: FileNode) => node ? workspaces.replaceFile(node.ref, node.file) : undefined),
    register('labwindowsCvi.moveFileToFolder', async (node?: FileNode, allSelected?: CviTreeNode[]) => {
      const files = getSelectedFiles(node, allSelected);
      if (files.length === 1) {
        await workspaces.moveFileToFolder(files[0].ref, files[0].file);
      } else if (files.length > 1) {
        const ref = files[0].ref;
        const project = workspaces.getProject(ref);
        if (!project) return;
        const folders = project.folders;
        const items = [
          { label: '$(root-folder) Project root', description: 'No logical folder', targetFolder: '' },
          ...folders.map((f) => ({ label: f, description: 'CVI virtual folder', targetFolder: f }))
        ];
        const picked = await vscode.window.showQuickPick(items, { title: `Move ${files.length} Files to Folder` });
        if (picked) {
          await workspaces.moveFilesToFolder(ref, files.map((f) => f.file.sectionName), picked.targetFolder);
        }
      }
    }),
    register('labwindowsCvi.compileFile', (node?: FileNode) => node ? builds.compileFile(node.file.absolutePath, node.ref) : undefined),
    register('labwindowsCvi.generatePrototypes', (node?: FileNode) => node ? workspaces.generatePrototypes(node.ref, node.file) : undefined),
    register('labwindowsCvi.prepareDllImportLibraryGeneration', (node?: FileNode) => node ? builds.prepareDllImportLibraryGeneration(node.file.absolutePath) : undefined),
    register('labwindowsCvi.refreshFileSymbols', () => fileSymbolsProvider.refresh()),
    register('labwindowsCvi.revealFileSymbol', (symbol?: CviSourceSymbol) => symbol ? fileSymbolsProvider.reveal(symbol) : undefined),
    register('labwindowsCvi.copyFileSymbol', (symbol?: CviSourceSymbol) => fileSymbolsProvider.copySymbol(symbol)),
    register('labwindowsCvi.copyFileSymbolDeclaration', (symbol?: CviSourceSymbol) => fileSymbolsProvider.copySymbolDeclaration(symbol)),
    register('labwindowsCvi.copyFileSymbols', () => fileSymbolsProvider.copyAllSymbols(false)),
    register('labwindowsCvi.copyFileSymbolDeclarations', () => fileSymbolsProvider.copyAllSymbols(true)),
    register('labwindowsCvi.exportFileSymbols', () => fileSymbolsProvider.exportSymbols()),
    register('labwindowsCvi.generateFileSymbolsHeader', () => fileSymbolsProvider.generateHeader()),
    register('labwindowsCvi.generateFileSymbolsSource', () => fileSymbolsProvider.generateSource()),
    register('labwindowsCvi.outline.toggleFollowCursor', () => {
      const next = !fileSymbolsProvider.isFollowCursor();
      fileSymbolsProvider.setFollowCursor(next);
      void vscode.commands.executeCommand('setContext', 'labwindowsCvi.outlineFollowCursor', next);
    }),
    register('labwindowsCvi.outline.toggleFollowCursorOn', () => {
      const next = !fileSymbolsProvider.isFollowCursor();
      fileSymbolsProvider.setFollowCursor(next);
      void vscode.commands.executeCommand('setContext', 'labwindowsCvi.outlineFollowCursor', next);
    }),
    register('labwindowsCvi.outline.toggleFilterOnType', () => fileSymbolsProvider.toggleFilterOnType()),
    register('labwindowsCvi.outline.toggleFilterOnTypeOn', () => fileSymbolsProvider.toggleFilterOnType()),
    register('labwindowsCvi.outline.sortByPosition', () => {
      fileSymbolsProvider.setSortMode('position');
      void vscode.commands.executeCommand('setContext', 'labwindowsCvi.outlineSortMode', 'position');
    }),
    register('labwindowsCvi.outline.sortByPositionOn', () => {
      fileSymbolsProvider.setSortMode('position');
      void vscode.commands.executeCommand('setContext', 'labwindowsCvi.outlineSortMode', 'position');
    }),
    register('labwindowsCvi.outline.sortByName', () => {
      fileSymbolsProvider.setSortMode('name');
      void vscode.commands.executeCommand('setContext', 'labwindowsCvi.outlineSortMode', 'name');
    }),
    register('labwindowsCvi.outline.sortByNameOn', () => {
      fileSymbolsProvider.setSortMode('name');
      void vscode.commands.executeCommand('setContext', 'labwindowsCvi.outlineSortMode', 'name');
    }),
    register('labwindowsCvi.outline.sortByCategory', () => {
      fileSymbolsProvider.setSortMode('category');
      void vscode.commands.executeCommand('setContext', 'labwindowsCvi.outlineSortMode', 'category');
    }),
    register('labwindowsCvi.outline.sortByCategoryOn', () => {
      fileSymbolsProvider.setSortMode('category');
      void vscode.commands.executeCommand('setContext', 'labwindowsCvi.outlineSortMode', 'category');
    }),
    register('labwindowsCvi.saveFile', (node?: FileNode) => node ? workspaces.saveFile(node.file.absolutePath) : undefined),
    register('labwindowsCvi.openPanelInCvi', (node?: FileNode) => node ? builds.openPanelInCvi(node.file.absolutePath) : undefined),
    register('labwindowsCvi.openPanelPathInCvi', (filePath?: string) => filePath ? builds.openPanelInCvi(filePath) : undefined),
    register('labwindowsCvi.openFunctionPanel', (node?: FileNode) => node ? functionPanels.open(node.file.absolutePath) : undefined),
    register('labwindowsCvi.insertSnippet', () => templates.insertSnippet()),
    register('labwindowsCvi.saveSelectionAsSnippet', () => templates.saveSelectionAsSnippet()),
    register('labwindowsCvi.manageSnippets', () => templates.manageSnippets()),
    register('labwindowsCvi.context.insertSnippet', () => templates.insertSnippet()),
    register('labwindowsCvi.context.saveSelectionAsSnippet', () => templates.saveSelectionAsSnippet()),
    register('labwindowsCvi.context.manageSnippets', () => templates.manageSnippets()),
    register('labwindowsCvi.context.insertFileHeader', () => templates.insertFileDescriptionHeader()),
    register('labwindowsCvi.context.insertCommentSection', () => templates.insertCommentSection()),
    register('labwindowsCvi.context.insertHeaderChangeEntry', () => templates.insertHeaderChangeEntry()),
    register('labwindowsCvi.context.insertSpecialCharacterText', () => templates.insertSpecialCharacterText()),
    register('labwindowsCvi.context.insertColorValue', () => colorValues.openColorValuePicker()),
    register('labwindowsCvi.context.openCharacterTable', () => contextTools.openCharacterTable()),
    register('labwindowsCvi.context.convertSelectedTextToDecimalValues', () => contextTools.convertSelectedTextToDecimalValues()),
    register('labwindowsCvi.context.convertSelectedNumbersToText', () => contextTools.convertSelectedNumbersToText()),
    register('labwindowsCvi.context.openNumberConverter', () => contextTools.openNumberConverter()),
    register('labwindowsCvi.context.openTruthTableDesigner', () => contextTools.openTruthTableDesigner()),
    register('labwindowsCvi.context.openDigitalFilterDesigner', () => contextTools.openDigitalFilterDesigner()),
    register('labwindowsCvi.saveFileAsTemplate', (node?: FileNode) => templates.saveCurrentFileAsTemplate(node?.file.absolutePath)),
    register('labwindowsCvi.importFileTemplate', () => templates.importFileTemplate()),
    register('labwindowsCvi.manageFileTemplates', () => templates.manageFileTemplates()),
    register('labwindowsCvi.openFile', (node?: FileNode) => node ? workspaces.openPath(node.file.absolutePath) : undefined),
    register('labwindowsCvi.revealProjectFile', (node?: ProjectNode) => node ? workspaces.revealInExplorer(node.ref.absolutePath) : undefined),
    register('labwindowsCvi.revealFile', (node?: FileNode) => node ? workspaces.revealInExplorer(node.file.absolutePath) : undefined),
    register('labwindowsCvi.copyFilePath', (node?: FileNode) => node ? workspaces.copyFilePath(node.file.absolutePath) : undefined),
    register('labwindowsCvi.copyRelativeFilePath', (node?: FileNode) => node ? workspaces.copyRelativeFilePath(node.ref, node.file.absolutePath) : undefined),
    register('labwindowsCvi.convertSelectedIntegerToDecimal', () => convertSelectedIntegerLiteral('decimal')),
    register('labwindowsCvi.convertSelectedIntegerToHexadecimal', () => convertSelectedIntegerLiteral('hexadecimal')),
    register('labwindowsCvi.convertSelectedIntegerToBinary', () => convertSelectedIntegerLiteral('binary')),
    register('labwindowsCvi.exploreProjectDirectory', (node?: ProjectNode) => node ? workspaces.revealInExplorer(path.dirname(node.ref.absolutePath)) : undefined),
    register('labwindowsCvi.exploreFolderDirectory', (node?: FolderNode) => node ? workspaces.revealInExplorer(workspaces.directoryForLogicalFolder(node.ref, node.folderPath)) : undefined),
    register('labwindowsCvi.exploreFileDirectory', (node?: FileNode) => node ? workspaces.revealInExplorer(path.dirname(node.file.absolutePath)) : undefined),
    register('labwindowsCvi.findProject', (node?: ProjectNode) => node ? workspaces.findInDirectory(path.dirname(node.ref.absolutePath)) : undefined),
    register('labwindowsCvi.findFolder', (node?: FolderNode) => node ? workspaces.findInDirectory(workspaces.directoryForLogicalFolder(node.ref, node.folderPath)) : undefined),
    register('labwindowsCvi.findFile', (node?: FileNode) => node ? workspaces.findInDirectory(path.dirname(node.file.absolutePath)) : undefined),
    register('labwindowsCvi.saveAll', () => vscode.commands.executeCommand('workbench.action.files.saveAll')),
    register('labwindowsCvi.expandAll', () => focusTreeThen('list.expandAll')),
    register('labwindowsCvi.collapseAll', () => focusTreeThen('list.collapseAll')),
    register('labwindowsCvi.sanitizeCurrentFile', () => encodingService.sanitizeActiveDocument()),
    register('labwindowsCvi.refreshResourceTracking', () => resourceTreeProvider.refresh()),
    register('labwindowsCvi.clearResourceTracking', () => resourceTracker.clear()),
    register('labwindowsCvi.exportResourceReport', () => resourceTracker.exportReport()),
    register('labwindowsCvi.manageConfigurations', () => configService.manageConfigurations()),
    register('labwindowsCvi.refreshProcessThreads', () => threadTreeProvider.refresh()),
    register('labwindowsCvi.openCpuStripchart', () => CviCpuStripchartPanel.createOrShow(context.extensionUri, threadTracker)),
    register('labwindowsCvi.pauseAllThreads', () => threadTracker.pauseAllThreads()),
    register('labwindowsCvi.suspendThread', async (item?: any) => {
      const tid = item?.thread?.osThreadId ?? item?.thread?.id ?? item?.osThreadId ?? item?.id ?? item;
      if (typeof tid === 'number') {
        await threadTracker.suspendThread(tid);
        threadTreeProvider.refresh();
      }
    }),
    register('labwindowsCvi.resumeThread', async (item?: any) => {
      const tid = item?.thread?.osThreadId ?? item?.thread?.id ?? item?.osThreadId ?? item?.id ?? item;
      if (typeof tid === 'number') {
        await threadTracker.resumeThread(tid);
        threadTreeProvider.refresh();
      }
    }),
    register('labwindowsCvi.openResourceLocation', async (arg?: { file?: string; line?: number }) => {
      if (!arg?.file) return;
      try {
        const document = await vscode.workspace.openTextDocument(arg.file);
        const line = Math.max(0, (arg.line ?? 1) - 1);
        const range = new vscode.Range(line, 0, line, 0);
        await vscode.window.showTextDocument(document, { selection: range, preview: true });
      } catch {
        vscode.window.showErrorMessage(`Could not open source file: ${arg.file}`);
      }
    })
  );

  const debugConfigProvider = new CviDebugConfigurationProvider(workspaces, builds);
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider('cvi', debugConfigProvider),
    resourceTracker,
    resourceTreeView,
    threadTracker,
    threadTreeProvider,
    threadTreeView
  );

  ensureBundledCviLibraryPack(context, output);
  activateCviLibraryExplorer(context);

  await workspaces.restoreOrAutoLoad();
  const repairedProvider = await cppTools.autoRepairStaleProviderSelection(workspaces.currentWorkspace);
  await cppTools.ensureConfigurationRootInWorkspace(workspaces.currentWorkspace);
  await cppTools.sync(workspaces.currentWorkspace);
  if (repairedProvider) {
    void vscode.window.showWarningMessage(
      'LabWindows/CVI removed an obsolete C/C++ configuration provider reference that could disable normal completion outside CVI projects. Reload VS Code, then run C/C++: Reset IntelliSense Database once.',
      'Reload Window'
    ).then((action) => action === 'Reload Window' ? vscode.commands.executeCommand('workbench.action.reloadWindow') : undefined);
  }
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor?.document.uri.scheme === 'file' && isSourceOrHeader(activeEditor.document.uri.fsPath)) {
    fileSymbolsProvider.setSelectedFile(activeEditor.document.uri.fsPath);
  }
  updateStatusBar();

  const isWorkspaceOpen = Boolean(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0);
  const showOnStartup = vscode.workspace.getConfiguration('labwindowsCvi').get<boolean>('showHomeOnStartup', true);
  if (showOnStartup && !isWorkspaceOpen) {
    home.showOnStartup();
  }
}

function createStatusBarAction(text: string, tooltip: string, command: string, priority: number): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
  item.text = text;
  item.tooltip = tooltip;
  item.command = command;
  return item;
}

type IntegerLiteralTarget = 'decimal' | 'hexadecimal' | 'binary';

async function convertSelectedIntegerLiteral(target: IntegerLiteralTarget): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showInformationMessage('Select an integer literal before converting it.');
    return;
  }
  const selectedText = editor.document.getText(editor.selection);
  const leadingWhitespace = selectedText.match(/^\s*/)?.[0] ?? '';
  const trailingWhitespace = selectedText.match(/\s*$/)?.[0] ?? '';
  const literal = selectedText.trim();
  const converted = formatIntegerLiteral(literal, target);
  if (!converted) {
    vscode.window.showErrorMessage('The selected text is not a supported decimal, hexadecimal (0x...) or binary (0b...) integer literal.');
    return;
  }
  await editor.edit((builder) => builder.replace(editor.selection, `${leadingWhitespace}${converted}${trailingWhitespace}`));
}

function formatIntegerLiteral(literal: string, target: IntegerLiteralTarget): string | undefined {
  const match = literal.match(/^([+-]?)(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)([uUlL]*)$/);
  if (!match) {
    return undefined;
  }
  const [, sign, digits, suffix] = match;
  const unsignedDigits = digits.replace(/^0[xX]/, '').replace(/^0[bB]/, '');
  const base = /^0[xX]/.test(digits) ? 16 : /^0[bB]/.test(digits) ? 2 : 10;
  let value: bigint;
  try {
    value = BigInt(base === 16 ? `0x${unsignedDigits}` : base === 2 ? `0b${unsignedDigits}` : unsignedDigits);
  } catch {
    return undefined;
  }
  const body = target === 'hexadecimal'
    ? `0x${value.toString(16).toUpperCase()}`
    : target === 'binary'
      ? `0b${value.toString(2)}`
      : value.toString(10);
  return `${sign}${body}${suffix}`;
}

export function deactivate(): void {
  // Resources are disposed through context.subscriptions.
}


function getSelectedFiles(node?: FileNode, allSelected?: CviTreeNode[]): FileNode[] {
  if (allSelected && allSelected.length > 0) {
    const files = allSelected.filter((n): n is FileNode => n.kind === 'file');
    if (files.length > 0) {
      return files;
    }
  }
  return node && node.kind === 'file' ? [node] : [];
}
