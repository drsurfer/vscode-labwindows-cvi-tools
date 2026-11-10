import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CviProject, CviProjectFile, CviWorkspaceProjectRef } from '../model/types';
import { CviWorkspaceService } from '../services/cviWorkspaceService';
import { CviBuildService } from '../services/cviBuildService';

export type CviTreeNode = WorkspaceNode | ProjectNode | FolderNode | FileNode | PlaceholderNode;

export interface WorkspaceNode { kind: 'workspace'; }
export interface ProjectNode { kind: 'project'; ref: CviWorkspaceProjectRef; }
export interface FolderNode { kind: 'folder'; ref: CviWorkspaceProjectRef; project: CviProject; folderPath: string; }
export interface FileNode { kind: 'file'; ref: CviWorkspaceProjectRef; file: CviProjectFile; }
export interface PlaceholderNode { kind: 'placeholder'; label: string; }

interface FilesDragPayload {
  kind: 'files';
  files: Array<{
    projectPath: string;
    projectIndex: number;
    sectionName: string;
    filePath: string;
    fileName: string;
    folder: string;
  }>;
}

interface FolderDragPayload {
  kind: 'folder';
  projectPath: string;
  folderPath: string;
}

type DragPayload = FilesDragPayload | FolderDragPayload;

export class CviTreeProvider implements vscode.TreeDataProvider<CviTreeNode>, vscode.TreeDragAndDropController<CviTreeNode> {
  private static readonly dragMimeType = 'application/vnd.code.tree.labwindows-cvi.workspaceexplorer';

  readonly dragMimeTypes = [CviTreeProvider.dragMimeType];
  readonly dropMimeTypes = [CviTreeProvider.dragMimeType];
  private readonly changeEmitter = new vscode.EventEmitter<CviTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly workspaces: CviWorkspaceService,
    private readonly builds?: CviBuildService
  ) {
    this.workspaces.onDidChange(() => this.refresh());
    if (this.builds) {
      this.builds.onDidChangeBuilding(() => this.refresh());
    }
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  handleDrag(source: readonly CviTreeNode[], dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void {
    const files = source
      .filter((node): node is FileNode => node.kind === 'file')
      .map((node) => ({
        projectPath: node.ref.absolutePath,
        projectIndex: node.ref.index,
        sectionName: node.file.sectionName,
        filePath: node.file.absolutePath,
        fileName: path.basename(node.file.absolutePath),
        folder: node.file.folder
      }));

    if (files.length > 0) {
      const payload: FilesDragPayload = { kind: 'files', files };
      dataTransfer.set(CviTreeProvider.dragMimeType, new vscode.DataTransferItem(JSON.stringify(payload)));
      return;
    }

    const folderNode = source.find((node): node is FolderNode => node.kind === 'folder');
    if (folderNode) {
      const payload: FolderDragPayload = {
        kind: 'folder',
        projectPath: folderNode.ref.absolutePath,
        folderPath: folderNode.folderPath
      };
      dataTransfer.set(CviTreeProvider.dragMimeType, new vscode.DataTransferItem(JSON.stringify(payload)));
    }
  }

  async handleDrop(target: CviTreeNode | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
    if (token.isCancellationRequested) {
      return;
    }

    const transfer = dataTransfer.get(CviTreeProvider.dragMimeType);
    if (!transfer) {
      return;
    }

    const payload = this.parseDragPayload(transfer.value);
    if (!payload) {
      return;
    }

    if (payload.kind === 'files') {
      if (!target) {
        return;
      }
      if (target.kind === 'file') {
        const matching = payload.files.filter((f) => path.normalize(f.projectPath).toLowerCase() === path.normalize(target.ref.absolutePath).toLowerCase());
        if (matching.length === 0) {
          vscode.window.showWarningMessage('Files can only be moved inside their own CVI project.');
          return;
        }
        for (const f of matching) {
          await this.workspaces.moveFileBefore(target.ref, f.sectionName, target.file.sectionName, target.file.folder);
        }
        return;
      }

      if (target.kind === 'folder') {
        const matching = payload.files.filter((f) => path.normalize(f.projectPath).toLowerCase() === path.normalize(target.ref.absolutePath).toLowerCase());
        if (matching.length === 0) {
          vscode.window.showWarningMessage('Files can only be moved inside their own CVI project.');
          return;
        }
        await this.workspaces.moveFilesToFolder(target.ref, matching.map((f) => f.sectionName), target.folderPath, { silent: true });
        return;
      }

      if (target.kind === 'project') {
        const matching = payload.files.filter((f) => path.normalize(f.projectPath).toLowerCase() === path.normalize(target.ref.absolutePath).toLowerCase());
        if (matching.length === 0) {
          vscode.window.showWarningMessage('Files can only be moved inside their own CVI project.');
          return;
        }
        await this.workspaces.moveFilesToFolder(target.ref, matching.map((f) => f.sectionName), '', { silent: true });
        return;
      }
    }

    if (payload.kind === 'folder') {
      if (!target || (target.kind !== 'folder' && target.kind !== 'project')) {
        return;
      }
      const targetRef = target.ref;
      if (path.normalize(payload.projectPath).toLowerCase() !== path.normalize(targetRef.absolutePath).toLowerCase()) {
        vscode.window.showWarningMessage('Folders can only be reordered inside their own CVI project.');
        return;
      }
      const targetFolder = target.kind === 'folder' ? target.folderPath : undefined;
      await this.workspaces.moveFolderBefore(targetRef, payload.folderPath, targetFolder);
    }
  }

  private parseDragPayload(value: unknown): DragPayload | undefined {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed?.kind === 'files' && Array.isArray(parsed.files)) {
          return parsed as FilesDragPayload;
        }
        if (parsed?.kind === 'folder' && typeof parsed.folderPath === 'string' && typeof parsed.projectPath === 'string') {
          return parsed as FolderDragPayload;
        }
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  getTreeItem(element: CviTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'workspace': return this.workspaceItem();
      case 'project': return this.projectItem(element);
      case 'folder': return this.folderItem(element);
      case 'file': return this.fileItem(element);
      case 'placeholder': return this.placeholderItem(element);
    }
  }

  getChildren(element?: CviTreeNode): CviTreeNode[] {
    const workspace = this.workspaces.currentWorkspace;
    if (!workspace) {
      return [];
    }
    if (!element) {
      return [{ kind: 'workspace' }];
    }

    switch (element.kind) {
      case 'workspace':
        return workspace.projects.map((ref) => ({ kind: 'project', ref }));
      case 'project': {
        const project = this.workspaces.getProject(element.ref);
        if (!project) {
          return [{ kind: 'placeholder', label: element.ref.exists ? 'Unable to parse project' : 'Project file not found' }];
        }
        return this.childrenForFolder(element.ref, project, '');
      }
      case 'folder':
        return this.childrenForFolder(element.ref, element.project, element.folderPath);
      case 'file':
      case 'placeholder':
        return [];
    }
  }

  private childrenForFolder(ref: CviWorkspaceProjectRef, project: CviProject, parentFolder: string): CviTreeNode[] {
    const directFolders: string[] = [];
    const seenFolders = new Set<string>();

    const checkAndAddFolder = (folderName: string) => {
      const folder = normalizeLogicalFolder(folderName);
      if (parentFolder === '') {
        const nextSegment = folder.split('/')[0];
        if (nextSegment && !seenFolders.has(nextSegment.toLowerCase())) {
          seenFolders.add(nextSegment.toLowerCase());
          directFolders.push(nextSegment);
        }
      } else if (folder.toLowerCase().startsWith(`${parentFolder.toLowerCase()}/`)) {
        const remainder = folder.slice(parentFolder.length + 1);
        const nextSegment = remainder.split('/')[0];
        const fullCandidate = `${parentFolder}/${nextSegment}`;
        if (nextSegment && !seenFolders.has(fullCandidate.toLowerCase())) {
          seenFolders.add(fullCandidate.toLowerCase());
          directFolders.push(fullCandidate);
        }
      }
    };

    // 1. First add declared virtual folders in their exact [Folders] sequence
    for (const declared of project.folders) {
      checkAndAddFolder(declared);
    }

    // 2. Then check any file folders that might not be declared in [Folders]
    for (const file of project.files) {
      if (file.folder) {
        checkAndAddFolder(file.folder);
      }
    }

    const folderNodes: FolderNode[] = directFolders.map((folderPath) => ({
      kind: 'folder',
      ref,
      project,
      folderPath
    }));

    // 3. Direct files in their exact sequence within project.files (no sorting)
    const directFiles: FileNode[] = [];
    for (const file of project.files) {
      const folder = normalizeLogicalFolder(file.folder);
      if (folder.toLowerCase() === parentFolder.toLowerCase()) {
        directFiles.push({ kind: 'file', ref, file });
      }
    }

    return [...folderNodes, ...directFiles];
  }

  private workspaceItem(): vscode.TreeItem {
    const workspace = this.workspaces.currentWorkspace!;
    const item = new vscode.TreeItem(workspace.name, vscode.TreeItemCollapsibleState.Expanded);
    item.description = path.extname(workspace.path).toLowerCase() === '.cws' ? `${workspace.projects.length} project(s)` : 'standalone project';
    item.tooltip = workspace.path;
    item.contextValue = 'cviWorkspace';
    item.iconPath = new vscode.ThemeIcon('root-folder');
    return item;
  }

  private projectItem(node: ProjectNode): vscode.TreeItem {
    const workspace = this.workspaces.currentWorkspace!;
    const active = node.ref.index === workspace.activeProjectIndex;
    const project = this.workspaces.getProject(node.ref);
    const item = new vscode.TreeItem(node.ref.name, vscode.TreeItemCollapsibleState.Collapsed);
    const isCurrentlyBuilding = this.builds?.isBuilding && this.builds.buildingProjectPath === node.ref.absolutePath;
    item.description = isCurrentlyBuilding
      ? `${active ? 'active · ' : ''}building...`
      : `${active ? 'active · ' : ''}${project?.targetType ?? (node.ref.exists ? 'project' : 'missing')}`;
    item.tooltip = isCurrentlyBuilding
      ? `${node.ref.absolutePath} (Build in progress)`
      : node.ref.absolutePath;
    item.contextValue = 'cviProject';
    item.iconPath = isCurrentlyBuilding
      ? new vscode.ThemeIcon('sync~spin')
      : new vscode.ThemeIcon(active ? 'star-full' : node.ref.exists ? 'project' : 'warning');
    return item;
  }

  private folderItem(node: FolderNode): vscode.TreeItem {
    const label = node.folderPath.split('/').pop() ?? node.folderPath;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
    item.contextValue = 'cviFolder';
    const count = node.project.files.filter((f) => {
      const fld = normalizeLogicalFolder(f.folder).toLowerCase();
      return fld === node.folderPath.toLowerCase() || fld.startsWith(`${node.folderPath.toLowerCase()}/`);
    }).length;
    item.description = count > 0 ? `${count} file${count === 1 ? '' : 's'}` : 'empty';
    item.tooltip = `CVI virtual folder: ${node.folderPath} (${count} file${count === 1 ? '' : 's'})`;
    item.iconPath = new vscode.ThemeIcon('folder');
    return item;
  }

  private fileItem(node: FileNode): vscode.TreeItem {
    const showFullFilePaths = vscode.workspace.getConfiguration('labwindowsCvi').get<boolean>('showFullFilePaths', false);
    const label = showFullFilePaths ? node.file.absolutePath : path.basename(node.file.absolutePath);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = statusDescription(node.file);
    item.tooltip = [
      node.file.type,
      node.file.absolutePath,
      node.file.excluded ? 'Excluded from build' : 'Included in build',
      node.file.type === 'CSource' ? `.Obj option: ${node.file.compileIntoObjectFile ? 'enabled' : 'disabled'}` : undefined
    ].filter(Boolean).join('\n');
    item.contextValue = contextValueForFile(node.file);
    item.iconPath = new vscode.ThemeIcon(iconForFile(node.file));
    item.resourceUri = vscode.Uri.file(node.file.absolutePath);
    item.command = isPanel(node.file)
      ? { command: 'labwindowsCvi.openPanelInCvi', title: 'Open Panel in CVI UI Editor', arguments: [node] }
      : isFunctionPanel(node.file)
        ? { command: 'labwindowsCvi.openFunctionPanel', title: 'Open CVI Function Panel', arguments: [node] }
        : { command: 'labwindowsCvi.openFile', title: 'Open File', arguments: [node] };
    return item;
  }

  private placeholderItem(node: PlaceholderNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('warning');
    return item;
  }
}

function normalizeLogicalFolder(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function isPanel(file: CviProjectFile): boolean {
  return file.type === 'User Interface Resource' || path.extname(file.absolutePath).toLowerCase() === '.uir';
}

function isFunctionPanel(file: CviProjectFile): boolean {
  return file.type === 'Function Panel' || path.extname(file.absolutePath).toLowerCase() === '.fp';
}

function contextValueForFile(file: CviProjectFile): string {
  const kind = file.type === 'CSource' ? 'source'
    : isPanel(file) ? 'panel'
      : isFunctionPanel(file) ? 'functionPanel'
        : file.type === 'Include' ? 'header'
        : file.type === 'Library' ? 'library'
          : 'other';
  const build = file.excluded ? 'excluded' : 'included';
  const obj = file.type === 'CSource' ? (file.compileIntoObjectFile ? 'objOn' : 'objOff') : 'objNA';
  return `cviFile.${kind}.${build}.${obj}`;
}

function statusDescription(file: CviProjectFile): string | undefined {
  const parts: string[] = [];
  if (file.excluded) {
    parts.push('excluded');
  }
  if (!file.exists) {
    parts.push('missing');
  }
  if (file.type === 'CSource' && file.compileIntoObjectFile) {
    parts.push('.obj');
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function iconForFile(file: CviProjectFile): string {
  if (!fs.existsSync(file.absolutePath)) {
    return 'warning';
  }
  switch (path.extname(file.absolutePath).toLowerCase()) {
    case '.c': return 'file-code';
    case '.h': return 'symbol-interface';
    case '.uir': return 'preview';
    case '.lib': return 'library';
    case '.fp': return 'symbol-method';
    default: return 'file';
  }
}
