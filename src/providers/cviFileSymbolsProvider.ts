import * as path from 'path';
import * as vscode from 'vscode';
import {
  CviSourceSymbol,
  CviSymbolService,
  buildHeaderFromSourceSymbols,
  buildSourceFromSourceSymbols,
  formatSourceSymbolList,
  isSourceOrHeader,
  normalizeSourceSymbolDeclaration
} from '../services/cviSymbolService';

type FileSymbolNode = CviSourceSymbol | { kind: 'placeholder'; label: string };

export class CviFileSymbolsProvider implements vscode.TreeDataProvider<FileSymbolNode> {
  private readonly changeEmitter = new vscode.EventEmitter<FileSymbolNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private selectedFile?: string;
  private view?: vscode.TreeView<FileSymbolNode>;
  private sortMode: 'position' | 'name' | 'category' = 'position';
  private followCursor = true;

  constructor(private readonly symbols: CviSymbolService) {}

  attachView(view: vscode.TreeView<FileSymbolNode>): void {
    this.view = view;
    this.updateDescription();
  }

  setSelectedFile(filePath: string | undefined): void {
    const normalized = filePath && isSourceOrHeader(filePath) ? path.normalize(filePath) : undefined;
    if (normalized === this.selectedFile) {
      return;
    }
    this.selectedFile = normalized;
    this.updateDescription();
    this.refresh();
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  getSelectedFile(): string | undefined {
    return this.selectedFile;
  }

  getSortMode(): 'position' | 'name' | 'category' {
    return this.sortMode;
  }

  setSortMode(mode: 'position' | 'name' | 'category'): void {
    if (this.sortMode === mode) return;
    this.sortMode = mode;
    this.refresh();
  }

  isFollowCursor(): boolean {
    return this.followCursor;
  }

  setFollowCursor(enabled: boolean): void {
    this.followCursor = enabled;
  }

  getParent(_element: FileSymbolNode): vscode.ProviderResult<FileSymbolNode> {
    return undefined;
  }

  async currentSymbols(): Promise<CviSourceSymbol[]> {
    return this.selectedFile ? this.symbols.symbolsForFile(this.selectedFile) : [];
  }

  async reveal(symbol: CviSourceSymbol): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(symbol.filePath));
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    const position = new vscode.Position(symbol.line, symbol.character);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  async onEditorCursorMoved(editor: vscode.TextEditor): Promise<void> {
    if (!this.followCursor || !this.selectedFile || !this.view) return;
    if (path.normalize(editor.document.uri.fsPath) !== this.selectedFile) return;

    const cursorLine = editor.selection.active.line;
    const symbols = await this.currentSymbols();
    if (!symbols.length) return;

    let best: CviSourceSymbol | undefined;
    for (const s of symbols) {
      if (s.line <= cursorLine) {
        best = s;
      } else {
        break;
      }
    }
    if (!best && symbols.length > 0) {
      best = symbols[0];
    }

    if (best) {
      try {
        await this.view.reveal(best, { select: true, focus: false });
      } catch {
        // Ignore if view is not visible or reveal is not ready
      }
    }
  }

  async copySymbol(symbol?: CviSourceSymbol): Promise<void> {
    if (!symbol) return;
    await vscode.env.clipboard.writeText(symbol.signature);
    void vscode.window.setStatusBarMessage(`CVI: copied ${symbol.label || symbol.qualifiedName || symbol.name}`, 1800);
  }

  async copySymbolDeclaration(symbol?: CviSourceSymbol): Promise<void> {
    if (!symbol) return;
    const declaration = symbol.declaration || normalizeSourceSymbolDeclaration(symbol.signature);
    await vscode.env.clipboard.writeText(declaration);
    void vscode.window.setStatusBarMessage(`CVI: copied declaration for ${symbol.label || symbol.qualifiedName || symbol.name}`, 1800);
  }

  async copyAllSymbols(asDeclarations = false): Promise<void> {
    if (!this.selectedFile) {
      void vscode.window.showWarningMessage('Select a C/C++ source/header file first.');
      return;
    }
    const symbols = await this.currentSymbols();
    if (!symbols.length) {
      void vscode.window.showWarningMessage('No symbols were detected in the selected file.');
      return;
    }
    const text = asDeclarations
      ? symbols.map((symbol) => symbol.declaration || normalizeSourceSymbolDeclaration(symbol.signature)).join('\n') + '\n'
      : formatSourceSymbolList(symbols, this.selectedFile, 'text');
    await vscode.env.clipboard.writeText(text);
    void vscode.window.showInformationMessage(`Copied ${symbols.length} symbol${symbols.length === 1 ? '' : 's'} to the clipboard.`);
  }

  async exportSymbols(): Promise<void> {
    if (!this.selectedFile) {
      void vscode.window.showWarningMessage('Select a C/C++ source/header file first.');
      return;
    }
    const symbols = await this.currentSymbols();
    if (!symbols.length) {
      void vscode.window.showWarningMessage('No symbols were detected in the selected file.');
      return;
    }
    const choice = await vscode.window.showQuickPick([
      { label: 'Markdown report (.md)', value: 'markdown' as const, extension: '.symbols.md' },
      { label: 'Plain text (.txt)', value: 'text' as const, extension: '.symbols.txt' },
      { label: 'JSON (.json)', value: 'json' as const, extension: '.symbols.json' }
    ], { title: 'Export File Symbols' });
    if (!choice) return;
    const source = path.parse(this.selectedFile);
    const target = await vscode.window.showSaveDialog({
      title: 'Export File Symbols',
      defaultUri: vscode.Uri.file(path.join(source.dir, `${source.name}${choice.extension}`)),
      filters: choice.value === 'markdown'
        ? { Markdown: ['md'] }
        : choice.value === 'json' ? { JSON: ['json'] } : { Text: ['txt'] }
    });
    if (!target) return;
    const content = formatSourceSymbolList(symbols, this.selectedFile, choice.value);
    await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
    const action = await vscode.window.showInformationMessage(`Exported ${symbols.length} symbol(s) to ${target.fsPath}.`, 'Open');
    if (action === 'Open') {
      const document = await vscode.workspace.openTextDocument(target);
      await vscode.window.showTextDocument(document, { preview: false });
    }
  }

  async generateHeader(): Promise<void> {
    if (!this.selectedFile) {
      void vscode.window.showWarningMessage('Select a C/C++ source/header file first.');
      return;
    }
    const symbols = await this.currentSymbols();
    const fnSymbols = symbols.filter((s) => s.kind === vscode.SymbolKind.Function || s.kind === vscode.SymbolKind.Method || s.kind === vscode.SymbolKind.Constructor);
    if (!fnSymbols.length) {
      void vscode.window.showWarningMessage('No function/method declaration or definition was detected in the selected file.');
      return;
    }
    const source = path.parse(this.selectedFile);
    const isCpp = ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'].includes(source.ext.toLowerCase());
    const headerExtension = isCpp ? '.hpp' : '.h';
    const target = await vscode.window.showSaveDialog({
      title: 'Generate Header From File Symbols',
      defaultUri: vscode.Uri.file(path.join(source.dir, `${source.name}${headerExtension}`)),
      filters: isCpp ? { 'C++ Header': ['hpp', 'h'] } : { 'C Header': ['h'] }
    });
    if (!target) return;
    const content = buildHeaderFromSourceSymbols(symbols, this.selectedFile);
    await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
    const action = await vscode.window.showInformationMessage(`Generated header from ${fnSymbols.length} detected symbol(s): ${target.fsPath}`, 'Open');
    if (action === 'Open') {
      const document = await vscode.workspace.openTextDocument(target);
      await vscode.window.showTextDocument(document, { preview: false });
    }
  }

  async generateSource(): Promise<void> {
    if (!this.selectedFile) {
      void vscode.window.showWarningMessage('Select a C/C++ source/header file first.');
      return;
    }
    const symbols = await this.currentSymbols();
    const fnSymbols = symbols.filter((s) => s.kind === vscode.SymbolKind.Function || s.kind === vscode.SymbolKind.Method || s.kind === vscode.SymbolKind.Constructor);
    if (!fnSymbols.length) {
      void vscode.window.showWarningMessage('No function/method declaration or definition was detected in the selected file.');
      return;
    }
    const source = path.parse(this.selectedFile);
    const selectedExt = source.ext.toLowerCase();
    const isC = selectedExt === '.c';
    const isHeader = ['.h', '.hh', '.hpp', '.hxx'].includes(selectedExt);
    const sourceExtension = isC ? '.c' : '.cpp';
    const defaultName = isHeader ? `${source.name}${sourceExtension}` : `${source.name}_generated${sourceExtension}`;
    const target = await vscode.window.showSaveDialog({
      title: 'Generate Source From File Symbols',
      defaultUri: vscode.Uri.file(path.join(source.dir, defaultName)),
      filters: isC ? { 'C Source': ['c'] } : { 'C++ Source': ['cpp', 'cc', 'cxx'] }
    });
    if (!target) return;
    const content = buildSourceFromSourceSymbols(symbols, this.selectedFile);
    await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
    const action = await vscode.window.showInformationMessage(`Generated source stubs from ${fnSymbols.length} detected symbol(s): ${target.fsPath}`, 'Open');
    if (action === 'Open') {
      const document = await vscode.workspace.openTextDocument(target);
      await vscode.window.showTextDocument(document, { preview: false });
    }
  }

  getTreeItem(node: FileSymbolNode): vscode.TreeItem {
    if ('kind' in node && node.kind === 'placeholder') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('info');
      return item;
    }
    const sym = node as CviSourceSymbol;
    const displayName = sym.label || sym.qualifiedName || sym.name;
    const item = new vscode.TreeItem(displayName, vscode.TreeItemCollapsibleState.None);
    if (sym.isDeclaration) {
      item.description = 'declaration';
    }
    item.tooltip = `${sym.signature}\n${sym.filePath}:${sym.line + 1}`;
    item.contextValue = 'cviFileSymbol';
    item.iconPath = new vscode.ThemeIcon(
      sym.kind === vscode.SymbolKind.Constant
        ? 'symbol-constant'
        : sym.kind === vscode.SymbolKind.Variable
          ? 'symbol-variable'
          : sym.kind === vscode.SymbolKind.Method
            ? 'symbol-method'
            : sym.kind === vscode.SymbolKind.Constructor
              ? 'symbol-constructor'
              : 'symbol-function'
    );
    item.command = { command: 'labwindowsCvi.revealFileSymbol', title: 'Reveal CVI file symbol', arguments: [sym] };
    return item;
  }

  async getChildren(): Promise<FileSymbolNode[]> {
    if (!this.selectedFile) {
      return [{ kind: 'placeholder', label: 'Select a C/C++ source or header file in CVI Workspace.' }];
    }
    const symbols = await this.symbols.symbolsForFile(this.selectedFile);
    if (!symbols.length) {
      return [{ kind: 'placeholder', label: 'No symbols found in the selected file.' }];
    }

    const sorted = [...symbols];
    if (this.sortMode === 'name') {
      sorted.sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name) || a.line - b.line);
    } else if (this.sortMode === 'category') {
      const categoryScore = (s: CviSourceSymbol): number => {
        if (s.kind === vscode.SymbolKind.Constant) return 1;
        if (s.kind === vscode.SymbolKind.Variable) return 2;
        return 3;
      };
      sorted.sort((a, b) => categoryScore(a) - categoryScore(b) || a.line - b.line || (a.label || a.name).localeCompare(b.label || b.name));
    } else {
      // 'position'
      sorted.sort((a, b) => a.line - b.line || (a.label || a.name).localeCompare(b.label || b.name));
    }

    return sorted;
  }

  private updateDescription(): void {
    if (this.view) {
      this.view.description = this.selectedFile ? path.basename(this.selectedFile) : 'No file selected';
    }
  }
}
