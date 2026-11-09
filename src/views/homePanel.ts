import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CviBuildService } from '../services/cviBuildService';
import { CviInstallationService } from '../services/cviInstallationService';
import { CviWorkspaceService } from '../services/cviWorkspaceService';

export class HomePanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspaces: CviWorkspaceService,
    private readonly builds: CviBuildService,
    private readonly installations: CviInstallationService
  ) {
    this.disposables.push(this.workspaces.onDidChange(() => this.update()));
    this.disposables.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('labwindowsCvi.showHomeOnStartup')) {
        this.update();
      }
    }));
  }

  dispose(): void {
    this.panel?.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  isOpen(): boolean {
    if (this.panel) {
      return true;
    }
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputWebview && tab.input.viewType === 'labwindowsCvi.home') {
          return true;
        }
        if (tab.input && typeof tab.input === 'object' && 'viewType' in tab.input && (tab.input as any).viewType === 'labwindowsCvi.home') {
          return true;
        }
      }
    }
    return false;
  }

  attach(panel: vscode.WebviewPanel): void {
    if (this.panel && this.panel !== panel) {
      panel.dispose();
      return;
    }
    this.panel = panel;
    this.configurePanel();
    this.update();
  }

  show(options?: { preserveFocus?: boolean }): void {
    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.One, options?.preserveFocus);
      this.update();
      return;
    }

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const isHome = (tab.input instanceof vscode.TabInputWebview && tab.input.viewType === 'labwindowsCvi.home') ||
          (tab.input && typeof tab.input === 'object' && 'viewType' in tab.input && (tab.input as any).viewType === 'labwindowsCvi.home');
        if (isHome) {
          if (options?.preserveFocus) {
            return;
          }
          void vscode.window.tabGroups.close(tab);
        }
      }
    }

    this.panel = vscode.window.createWebviewPanel(
      'labwindowsCvi.home',
      'LabWindows/CVI Home',
      { viewColumn: vscode.ViewColumn.One, preserveFocus: options?.preserveFocus ?? false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
      }
    );
    this.configurePanel();
    this.update();
  }

  showOnStartup(): void {
    if (this.isOpen()) {
      return;
    }
    this.show({ preserveFocus: true });
  }

  private configurePanel(): void {
    if (!this.panel) {
      return;
    }
    this.updateTabIcon();
    this.panel.onDidDispose(() => { this.panel = undefined; });
    this.panel.webview.onDidReceiveMessage(async (message: { command?: string; value?: any }) => {
      if (!message.command) {
        return;
      }
      if (message.command === 'toggleShowAtStartup') {
        const newValue = Boolean(message.value);
        await vscode.workspace.getConfiguration('labwindowsCvi').update('showHomeOnStartup', newValue, vscode.ConfigurationTarget.Global);
        this.update();
        return;
      }
      if (message.command === 'openUrl' && typeof message.value === 'string') {
        await vscode.env.openExternal(vscode.Uri.parse(message.value));
        return;
      }
      if (message.command === 'openRecentPath' && typeof message.value === 'string') {
        await this.workspaces.openProjectOrWorkspace(message.value);
        this.update();
        return;
      }
      if (message.command === 'removeRecentPath' && typeof message.value === 'string') {
        await this.workspaces.removeRecentItem(message.value);
        this.update();
        return;
      }
      if (message.command === 'clearRecentItems') {
        await this.workspaces.clearRecentItems();
        this.update();
        return;
      }
      await vscode.commands.executeCommand(message.command);
      this.update();
    });
  }

  private updateTabIcon(): void {
    if (!this.panel) {
      return;
    }
    const mediaDir = path.join(this.context.extensionPath, 'media');
    const heroLight = path.join(mediaDir, 'cvi-tools-hero-light.svg');
    const heroDark = path.join(mediaDir, 'cvi-tools-hero-dark.svg');
    const heroDefault = path.join(mediaDir, 'cvi-tools-hero.svg');
    const fallback = path.join(mediaDir, 'cvi-tools.svg');
    const legacy = path.join(mediaDir, 'cvi.svg');

    let defaultFile = 'cvi-tools-hero.svg';
    if (!fs.existsSync(heroDefault)) {
      if (fs.existsSync(fallback)) {
        defaultFile = 'cvi-tools.svg';
      } else if (fs.existsSync(legacy)) {
        defaultFile = 'cvi.svg';
      }
    }

    const defaultUri = vscode.Uri.joinPath(this.context.extensionUri, 'media', defaultFile);
    const lightUri = fs.existsSync(heroLight)
      ? vscode.Uri.joinPath(this.context.extensionUri, 'media', 'cvi-tools-hero-light.svg')
      : defaultUri;
    const darkUri = fs.existsSync(heroDark)
      ? vscode.Uri.joinPath(this.context.extensionUri, 'media', 'cvi-tools-hero-dark.svg')
      : defaultUri;

    this.panel.iconPath = { light: lightUri, dark: darkUri };
  }

  private loadLogoSvg(): string {
    const mediaDir = path.join(this.context.extensionPath, 'media');
    const heroLight = path.join(mediaDir, 'cvi-tools-hero-light.svg');
    const heroDark = path.join(mediaDir, 'cvi-tools-hero-dark.svg');
    const heroDefault = path.join(mediaDir, 'cvi-tools-hero.svg');
    const fallback = path.join(mediaDir, 'cvi-tools.svg');
    const legacy = path.join(mediaDir, 'cvi.svg');

    const cleanSvg = (raw: string): string => {
      return raw
        .replace(/<\?xml[\s\S]*?\?>/i, '')
        .replace(/<!DOCTYPE[\s\S]*?>/i, '')
        .trim();
    };

    try {
      const hasLight = fs.existsSync(heroLight);
      const hasDark = fs.existsSync(heroDark);

      if (hasLight && hasDark) {
        const lightSvg = cleanSvg(fs.readFileSync(heroLight, 'utf8'));
        const darkSvg = cleanSvg(fs.readFileSync(heroDark, 'utf8'));
        return `<span class="theme-logo theme-logo-light">${lightSvg}</span><span class="theme-logo theme-logo-dark">${darkSvg}</span>`;
      }
      if (fs.existsSync(heroDefault)) {
        const defaultSvg = cleanSvg(fs.readFileSync(heroDefault, 'utf8'));
        return `<span class="theme-logo">${defaultSvg}</span>`;
      }
      if (fs.existsSync(fallback)) {
        const fallbackSvg = cleanSvg(fs.readFileSync(fallback, 'utf8'));
        return `<span class="theme-logo">${fallbackSvg}</span>`;
      }
      if (fs.existsSync(legacy)) {
        const legacySvg = cleanSvg(fs.readFileSync(legacy, 'utf8'));
        return `<span class="theme-logo">${legacySvg}</span>`;
      }
    } catch {
      // Fallback below
    }

    return '<svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm1 4h5v2H7v6h3v2H5V7Zm6 0h2l1.5 6L16 7h2l-2.5 10h-2L11 7Zm8 0h2v10h-2V7Z"/></svg>';
  }

  update(): void {
    if (!this.panel) {
      return;
    }
    this.updateTabIcon();
    const workspace = this.workspaces.currentWorkspace;
    const activeProject = this.workspaces.activeProjectRef;
    const installation = this.installations.getActiveInstallation(workspace?.cviDir);
    const mode = this.builds.buildMode;
    const activeProjectDetails = activeProject ? this.workspaces.getProject(activeProject) : undefined;
    const extensionVersion = String(this.context.extension?.packageJSON?.version ?? '0.0.0');
    const showAtStartup = vscode.workspace.getConfiguration('labwindowsCvi').get<boolean>('showHomeOnStartup', true);

    const rawRecents = this.workspaces.getRecentItems();
    const recentItems = rawRecents.map((item) => ({
      path: item.path,
      name: item.name,
      type: item.type,
      formattedTime: formatRelativeTime(item.lastOpened)
    }));

    this.panel.webview.html = renderHtml({
      workspace: workspace?.path,
      workspaceName: workspace?.name,
      projectCount: workspace?.projects.length ?? 0,
      projectName: activeProject?.name,
      projectPath: activeProject?.absolutePath,
      targetType: activeProjectDetails?.targetType,
      installation: installation?.root,
      compiler: installation?.compileExe,
      ide: installation?.ideExe,
      mode,
      extensionVersion,
      showAtStartup,
      hasProject: Boolean(activeProject?.absolutePath),
      logoSvg: this.loadLogoSvg(),
      cspSource: this.panel.webview.cspSource,
      recentItems
    });
  }
}

interface HomeState {
  workspace?: string;
  workspaceName?: string;
  projectCount: number;
  projectName?: string;
  projectPath?: string;
  targetType?: string;
  installation?: string;
  compiler?: string;
  ide?: string;
  mode: string;
  extensionVersion: string;
  showAtStartup: boolean;
  hasProject: boolean;
  logoSvg: string;
  cspSource: string;
  recentItems: Array<{ path: string; name: string; type: 'workspace' | 'project'; formattedTime: string }>;
}

function renderHtml(state: HomeState): string {
  const nonce = makeNonce();
  const hasWorkspace = Boolean(state.workspace);
  const hasProject = state.hasProject;
  const workspaceName = escapeHtml(state.workspaceName ?? 'No workspace loaded');
  const workspacePath = escapeHtml(state.workspace ?? 'Open an existing .cws/.prj file or create a new workspace.');
  const projectName = escapeHtml(state.projectName ?? 'No project loaded');
  const projectPath = escapeHtml(state.projectPath ?? 'Load or create a CVI project to enable build, run and file-generation actions.');
  const installation = escapeHtml(state.installation ?? 'No LabWindows/CVI installation selected');
  const compiler = escapeHtml(state.compiler ? path.basename(state.compiler) : 'compile.exe not detected');
  const ide = escapeHtml(state.ide ? path.basename(state.ide) : 'cvi.exe not detected');
  const mode = escapeHtml(state.mode);
  const targetType = escapeHtml(state.targetType ?? 'No target');
  const projectCountLabel = `${state.projectCount} project${state.projectCount === 1 ? '' : 's'}`;

  const emptyState = !hasProject ? `
      <div class="empty-state">
        <div class="empty-icon">CVI</div>
        <div>
          <h3>No project loaded</h3>
          <p>Open an existing LabWindows/CVI workspace or create a new project. The selected folder will also be added to the standard VS Code Explorer for IntelliSense.</p>
          <div class="actions primary-row">
            <button data-command="labwindowsCvi.openWorkspace">Open workspace</button>
            <button data-command="labwindowsCvi.createWorkspaceProject">Create workspace and project</button>
            <button data-command="labwindowsCvi.configureInstallation">Select CVI installation</button>
          </div>
        </div>
      </div>` : '';

  const workspaceActions = hasWorkspace ? `
        <div class="actions">
          <button data-command="labwindowsCvi.openWorkspace">Open another workspace</button>
          <button class="secondary" data-command="labwindowsCvi.createWorkspaceProject">Create</button>
          <button class="secondary" data-command="labwindowsCvi.openWorkspaceInCvi">Open in CVI</button>
        </div>` : '';

  const projectActions = hasProject ? `
        <div class="actions project-actions">
          <button data-command="labwindowsCvi.chooseBuildAction">Build / rebuild / clean</button>
          <button class="secondary" data-command="labwindowsCvi.run">Build + run</button>
          <button class="secondary" data-command="labwindowsCvi.chooseRunAction">Run options</button>
          <button class="secondary" data-command="labwindowsCvi.selectBuildMode">Build mode</button>
          <button class="secondary" data-command="labwindowsCvi.selectTargetType">Target type</button>
          <button class="secondary" data-command="labwindowsCvi.editTargetSettings">Target settings</button>
          <button class="secondary" data-command="labwindowsCvi.editBuildOptions">Build options</button>
          <button class="secondary" data-command="labwindowsCvi.createNewFile">Create file</button>
        </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${state.cspSource} data: https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LabWindows/CVI Tools</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body.vscode-light .theme-logo-dark,
    body.vscode-high-contrast-light .theme-logo-dark {
      display: none !important;
    }
    body.vscode-dark .theme-logo-light,
    body.vscode-high-contrast .theme-logo-light {
      display: none !important;
    }
    .theme-logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
    }
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      overflow: hidden;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }

    /* --- TOP HEADER ROW (PlatformIO Inspired) --- */
    .top-header {
      height: 46px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      background: var(--vscode-titleBar-activeBackground, #1e1e1e);
      border-bottom: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.2));
      user-select: none;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .header-logo-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      background: transparent;
      color: var(--vscode-foreground);
    }
    .header-logo-badge svg {
      width: 24px;
      height: 24px;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .github-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      text-decoration: none;
      color: var(--vscode-foreground);
      background: var(--vscode-button-secondaryBackground, #2d2d2d);
      border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.25));
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .github-link:hover {
      background: var(--vscode-button-secondaryHoverBackground, #3a3a3a);
      border-color: var(--vscode-focusBorder, #007acc);
    }
    .github-link svg {
      width: 15px;
      height: 15px;
      fill: currentColor;
    }

    /* --- MAIN APP LAYOUT (Sidebar + Content) --- */
    .app-body {
      display: flex;
      height: calc(100% - 46px);
      overflow: hidden;
    }

    /* --- LEFT NAVIGATION RAIL (PlatformIO Style) --- */
    .nav-rail {
      width: 72px;
      min-width: 72px;
      background: var(--vscode-sideBar-background, #1e1e1e);
      border-right: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.2));
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 14px 0;
      gap: 10px;
      user-select: none;
    }
    .nav-button {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 60px;
      height: 54px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      padding: 0;
    }
    .nav-button:hover:not(.disabled) {
      background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.08));
    }
    .nav-button.active {
      color: #3794ff;
      background: rgba(55, 148, 255, 0.12);
    }
    .nav-button.disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .nav-button svg {
      width: 22px;
      height: 22px;
    }
    .nav-button span {
      font-size: 11px;
      margin-top: 4px;
      font-weight: 500;
    }

    /* --- SCROLLABLE MAIN CONTENT AREA --- */
    .content-area {
      flex: 1;
      overflow-y: auto;
      padding: 24px 36px 48px;
    }
    .content-container {
      max-width: 1200px;
      margin: 0 auto;
    }

    /* --- WELCOME TITLE ROW --- */
    .welcome-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 22px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.2));
    }
    .welcome-row h1 {
      font-size: 26px;
      font-weight: 600;
      margin: 0;
      letter-spacing: .2px;
    }
    .welcome-row h1 .highlight {
      color: #3794ff;
    }
    .startup-toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      user-select: none;
    }
    .startup-toggle input[type="checkbox"] {
      width: 16px;
      height: 16px;
      cursor: pointer;
      accent-color: #3794ff;
    }

    /* --- LOGO & VERSION HERO SECTION (PlatformIO Style) --- */
    .hero-panel {
      display: flex;
      align-items: center;
      gap: 28px;
      padding: 20px 24px;
      background: var(--vscode-sideBar-background, rgba(128, 128, 128, 0.05));
      border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.2));
      border-radius: 8px;
      margin-bottom: 24px;
    }
    .hero-logo-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex-shrink: 0;
    }
    .hero-logo-circle, .hero-logo-container {
      width: 74px;
      height: 74px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .hero-logo-circle svg, .hero-logo-container svg {
      width: 74px;
      height: 74px;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .hero-version-tag {
      margin-top: 9px;
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
      display: flex;
      align-items: center;
    }
    .version-pill {
      display: inline-block;
      padding: 1px 7px;
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-foreground);
      background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.15));
      border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.3));
      margin-left: 5px;
    }
    .hero-description {
      flex: 1;
    }
    .hero-description h2 {
      font-size: 16px;
      margin: 0 0 6px;
      font-weight: 600;
    }
    .hero-description p {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
      line-height: 1.55;
    }

    /* --- CARDS, GRIDS & ACTIONS (Preserved functionality) --- */
    h2 { font-size: 18px; margin: 0; }
    h3 { font-size: 16px; margin: 0 0 7px; }
    p { margin: 0; line-height: 1.55; }
    .muted { color: var(--vscode-descriptionForeground); }
    .section { margin-top: 24px; }
    .section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .section-heading span { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .overview-grid, .tools-grid { display: grid; gap: 12px; }
    .overview-grid { grid-template-columns: repeat(auto-fit, minmax(390px, 1fr)); }
    .tools-grid { grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); }
    .card { border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.2)); background: var(--vscode-sideBar-background); padding: 17px; border-radius: 8px; min-width: 0; }
    .card-header { display: flex; align-items: center; gap: 11px; margin-bottom: 12px; }
    .tile-icon { display: grid; place-items: center; flex: 0 0 auto; width: 38px; height: 38px; border-radius: 9px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 11px; font-weight: 800; letter-spacing: .3px; }
    .title-stack { min-width: 0; }
    .title-stack strong { display: block; font-size: 15px; overflow-wrap: anywhere; }
    .title-stack small { color: var(--vscode-descriptionForeground); }
    .path { font-family: var(--vscode-editor-font-family); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; color: var(--vscode-descriptionForeground); background: var(--vscode-textCodeBlock-background); border-radius: 4px; padding: 8px 9px; margin: 9px 0 13px; }
    .tag { display: inline-block; border: 1px solid var(--vscode-panel-border); padding: 3px 8px; border-radius: 999px; font-size: 12px; margin-right: 5px; color: var(--vscode-descriptionForeground); }
    .actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 13px; }
    button { border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: 7px 11px; cursor: pointer; border-radius: 3px; font: inherit; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .empty-state { display: grid; grid-template-columns: auto 1fr; gap: 16px; align-items: start; border: 1px dashed var(--vscode-panel-border); background: var(--vscode-sideBar-background); padding: 19px; border-radius: 8px; margin-bottom: 12px; }
    .empty-state p { color: var(--vscode-descriptionForeground); max-width: 840px; }
    .empty-icon { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 15px; font-weight: 800; letter-spacing: .5px; }
    .primary-row button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .installation-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px; align-items: center; }
    .installation-card .actions { margin-top: 0; justify-content: flex-end; }
    .recent-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 10px; margin-top: 10px; }
    .recent-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
    .recent-card:hover { border-color: var(--vscode-focusBorder, #007acc); background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.05)); }
    .recent-content { flex: 1; min-width: 0; }
    .recent-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .recent-card .icon-btn { padding: 4px 8px; font-size: 14px; line-height: 1; background: transparent; border: 1px solid transparent; color: var(--vscode-descriptionForeground); }
    .recent-card .icon-btn:hover { color: var(--vscode-foreground); border-color: var(--vscode-panel-border); background: var(--vscode-button-secondaryBackground); }
    .recent-badge-ws { background: #007acc; color: #fff; }
    .recent-badge-prj { background: #16825d; color: #fff; }
    .mini-btn { font-size: 11px; padding: 2px 8px; }

    @media (max-width: 860px) {
      .hero-panel { flex-direction: column; text-align: center; }
      .welcome-row { flex-direction: column; align-items: flex-start; gap: 12px; }
      .overview-grid, .tools-grid { grid-template-columns: 1fr; }
      .installation-card { grid-template-columns: 1fr; }
      .installation-card .actions { justify-content: flex-start; }
      .empty-state { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <!-- TOP HEADER ROW -->
  <header class="top-header">
    <div class="header-left">
      <div class="header-logo-badge" title="LabWindows/CVI Tools">
        ${state.logoSvg}
      </div>
      <a class="github-link" data-url="https://github.com/drsurfer/vscode-labwindows-cvi-tools" title="View repository on GitHub">
        <svg viewBox="0 0 16 16">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
        </svg>
        GitHub
      </a>
    </div>
  </header>

  <!-- APP BODY (NAV RAIL + MAIN CONTENT) -->
  <div class="app-body">
    <!-- LEFT NAVIGATION RAIL -->
    <nav class="nav-rail" aria-label="Main Navigation">
      <button class="nav-button active" title="Home">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
        <span>Home</span>
      </button>

      <button class="nav-button ${hasProject ? '' : 'disabled'}" ${hasProject ? 'data-command="labwindowsCvi.editTargetSettings"' : ''} title="${hasProject ? 'CVI Target Settings' : 'CVI Target Settings (Disabled: no active project)'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
        <span>Settings</span>
      </button>
    </nav>

    <!-- MAIN SCROLLABLE CONTENT -->
    <main class="content-area">
      <div class="content-container">
        <!-- WELCOME & STARTUP TOGGLE ROW -->
        <div class="welcome-row">
          <h1>Welcome to <span class="highlight">LabWindows/CVI Tools</span></h1>
          <label class="startup-toggle" title="Open this home page automatically whenever VS Code opens">
            <input type="checkbox" id="showAtStartup" ${state.showAtStartup ? 'checked' : ''} />
            <span>Show at startup</span>
          </label>
        </div>

        <!-- HERO PANEL WITH LOGO & VERSION -->
        <div class="hero-panel">
          <div class="hero-logo-wrapper">
            <div class="hero-logo-circle" title="LabWindows/CVI Tools">
              ${state.logoSvg}
            </div>
            <div class="hero-version-tag">
              Tools <span class="version-pill">${state.extensionVersion}</span>
            </div>
          </div>
          <div class="hero-description">
            <h2>Modern CVI Development in Visual Studio Code</h2>
            <p>Manage LabWindows/CVI workspaces and projects, native builds, run integrated GDB / MSVC debug sessions, and explore CVI library APIs seamlessly.</p>
          </div>
        </div>

        <!-- WORKSPACE AND PROJECT OVERVIEW -->
        <section class="section">
          <div class="section-heading">
            <h2>Workspace and active project</h2>
            <span>${escapeHtml(projectCountLabel)}</span>
          </div>
          ${emptyState}
          <div class="overview-grid">
            <article class="card">
              <div class="card-header">
                <div class="tile-icon">WS</div>
                <div class="title-stack">
                  <small>Workspace</small>
                  <strong>${workspaceName}</strong>
                </div>
              </div>
              <div class="path">${workspacePath}</div>
              ${workspaceActions}
            </article>

            <article class="card">
              <div class="card-header">
                <div class="tile-icon">PRJ</div>
                <div class="title-stack">
                  <small>Active project</small>
                  <strong>${projectName}</strong>
                </div>
              </div>
              <div class="path">${projectPath}</div>
              <span class="tag">${mode}</span><span class="tag">${targetType}</span>
              ${projectActions}
            </article>
          </div>
        </section>

        <!-- RECENT WORKSPACES & PROJECTS -->
        <section class="section">
          <div class="section-heading">
            <h2>Recent workspaces and projects</h2>
            <div>
              <span>${state.recentItems.length} item${state.recentItems.length === 1 ? '' : 's'}</span>
              ${state.recentItems.length > 0 ? '<button class="secondary mini-btn" data-command="clearRecentItems" title="Clear all recent entries" style="margin-left: 10px;">Clear all</button>' : ''}
            </div>
          </div>
          ${state.recentItems.length === 0 ? `
            <article class="card">
              <p class="muted">No recent LabWindows/CVI workspaces or projects. Opened .cws and .prj files will appear here for fast access.</p>
            </article>` : `
            <div class="recent-grid">
              ${state.recentItems.map((item) => `
                <article class="card recent-card" data-recent-path="${escapeHtml(item.path)}" title="Click to open ${escapeHtml(item.name)}">
                  <div class="recent-content">
                    <div class="card-header" style="margin-bottom: 4px;">
                      <div class="tile-icon ${item.type === 'workspace' ? 'recent-badge-ws' : 'recent-badge-prj'}" style="width: 28px; height: 28px; font-size: 10px; border-radius: 6px;">${item.type === 'workspace' ? 'WS' : 'PRJ'}</div>
                      <div class="title-stack">
                        <strong>${escapeHtml(item.name)}</strong>
                        <small>${escapeHtml(item.formattedTime)} · ${item.type === 'workspace' ? 'Workspace (.cws)' : 'Project (.prj)'}</small>
                      </div>
                    </div>
                    <div class="path" style="margin: 4px 0 0; font-size: 11px; padding: 4px 7px;">${escapeHtml(item.path)}</div>
                  </div>
                  <div class="recent-actions">
                    <button class="secondary recent-open-btn" data-open-path="${escapeHtml(item.path)}" title="Open ${escapeHtml(item.name)}">Open</button>
                    <button class="secondary icon-btn" data-remove-path="${escapeHtml(item.path)}" title="Remove from recent list">&times;</button>
                  </div>
                </article>
              `).join('')}
            </div>`}
        </section>

        <!-- LIBRARIES AND REUSABLE TOOLS -->
        <section class="section">
          <div class="section-heading">
            <h2>Libraries and reusable development tools</h2>
            <span>CVI API explorer, templates and snippets</span>
          </div>
          <div class="tools-grid">
            <article class="card">
              <div class="card-header">
                <div class="tile-icon">LIB</div>
                <div class="title-stack">
                  <small>CVI libraries</small>
                  <strong>Embedded CVI function explorer</strong>
                </div>
              </div>
              <p class="muted">Browse CVI APIs, search symbols and open parameterized prototype pages from the CVI Libraries view.</p>
              <div class="actions">
                <button data-command="labwindowsCvi.library.findFunction">Find symbol</button>
                <button class="secondary" data-command="labwindowsCvi.library.reloadPacks">Reload pack</button>
              </div>
            </article>

            <article class="card">
              <div class="card-header">
                <div class="tile-icon">TPL</div>
                <div class="title-stack">
                  <small>Templates and snippets</small>
                  <strong>CVI starter files and reusable fragments</strong>
                </div>
              </div>
              <p class="muted">Create .c, .h, .uir, DLL and error-management baselines, or insert snippets at the active cursor position.</p>
              <div class="actions">
                <button data-command="labwindowsCvi.createNewFile">Create file</button>
                <button class="secondary" data-command="labwindowsCvi.insertSnippet">Insert snippet</button>
                <button class="secondary" data-command="labwindowsCvi.manageFileTemplates">Manage templates</button>
                <button class="secondary" data-command="labwindowsCvi.manageSnippets">Manage snippets</button>
              </div>
            </article>
          </div>
        </section>

        <!-- INSTALLATION SETTINGS -->
        <section class="section">
          <div class="section-heading">
            <h2>LabWindows/CVI installation</h2>
            <span>Compiler, native IDE and IntelliSense synchronization</span>
          </div>
          <article class="card installation-card">
            <div>
              <div class="card-header">
                <div class="tile-icon">CFG</div>
                <div class="title-stack">
                  <small>Selected installation</small>
                  <strong>${installation}</strong>
                </div>
              </div>
              <div class="path">${compiler} · ${ide}</div>
            </div>
            <div class="actions">
              <button data-command="labwindowsCvi.configureInstallation">Select installation</button>
              <button class="secondary" data-command="labwindowsCvi.syncCppTools">Sync IntelliSense</button>
              <button class="secondary" data-command="labwindowsCvi.diagnoseCppTools">Diagnose IntelliSense</button>
              <button class="secondary" data-command="labwindowsCvi.repairCppToolsProvider">Repair provider</button>
            </div>
          </article>
        </section>
      </div>
    </main>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Command buttons
    document.querySelectorAll('[data-command]').forEach((button) => {
      button.addEventListener('click', () => {
        const cmd = button.getAttribute('data-command');
        if (cmd) {
          vscode.postMessage({ command: cmd });
        }
      });
    });

    // External URL links
    document.querySelectorAll('[data-url]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const url = el.getAttribute('data-url');
        if (url) {
          vscode.postMessage({ command: 'openUrl', value: url });
        }
      });
    });

    // Recent items click handlers
    document.querySelectorAll('[data-open-path]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = btn.getAttribute('data-open-path');
        if (p) {
          vscode.postMessage({ command: 'openRecentPath', value: p });
        }
      });
    });

    document.querySelectorAll('[data-remove-path]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = btn.getAttribute('data-remove-path');
        if (p) {
          vscode.postMessage({ command: 'removeRecentPath', value: p });
        }
      });
    });

    document.querySelectorAll('.recent-card').forEach((card) => {
      card.addEventListener('click', () => {
        const p = card.getAttribute('data-recent-path');
        if (p) {
          vscode.postMessage({ command: 'openRecentPath', value: p });
        }
      });
    });

        // Show at startup checkbox
    const showAtStartupCheckbox = document.getElementById('showAtStartup');
    if (showAtStartupCheckbox) {
      showAtStartupCheckbox.addEventListener('change', (e) => {
        vscode.postMessage({ command: 'toggleShowAtStartup', value: e.target.checked });
      });
    }
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function makeNonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let index = 0; index < 32; index += 1) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}


function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) {
    return 'Just now';
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return `${diffHr}h ago`;
  }
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
