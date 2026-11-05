const fs = require('fs');
const path = require('path');
const Module = require('module');

// Mock vscode module so we can test the compiled output
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      SymbolKind: {
        Function: 11,
        Variable: 12,
        Constant: 13,
        Method: 5,
        Constructor: 8
      },
      ThemeIcon: class {
        constructor(id) { this.id = id; }
      },
      TreeItem: class {
        constructor(label, collapsibleState) {
          this.label = label;
          this.collapsibleState = collapsibleState;
        }
      },
      TreeItemCollapsibleState: { None: 0 },
      EventEmitter: class {
        constructor() { this.event = () => {}; }
        fire() {}
      },
      Position: class { constructor(l, c) { this.line = l; this.character = c; } },
      Range: class { constructor(s, e) { this.start = s; this.end = e; } },
      Selection: class { constructor(a, p) { this.anchor = a; this.active = p; } },
      window: {
        showErrorMessage: console.error,
        showWarningMessage: console.warn,
        showInformationMessage: console.log
      },
      workspace: {
        openTextDocument: async () => ({})
      }
    };
  }
  return originalLoad.apply(this, arguments);
};

const { scanCFunctions, buildHeaderFromSourceSymbols, buildSourceFromSourceSymbols } = require('../out/services/cviSymbolService');
const { CviFileSymbolsProvider } = require('../out/providers/cviFileSymbolsProvider');

const sampleCode = `
#include <cvirte.h>
#include <userint.h>
#include "test.h"

#define SIMBOLO 123

static int panelHandle = 0;

int CVICALLBACK panelCB (int panel, int event, void *callbackData,
                         int eventData1, int eventData2);

int main (int argc, char *argv[])
{
    int status = 0;
    if (InitCVIRTE (0, argv, 0) == 0)
        return -1;
    panelHandle = LoadPanel (0, "test.uir", PANEL);
    DisplayPanel (panelHandle);
    RunUserInterface ();
    return status;
}

int CVICALLBACK panelCB (int panel, int event, void *callbackData,
                         int eventData1, int eventData2)
{
    return 0;
}
`;

const tempFilePath = path.join(__dirname, 'temp_test.c');
fs.writeFileSync(tempFilePath, sampleCode, 'utf8');

try {
  console.log('--- 1. Testing scanCFunctions (Outline symbols) ---');
  const symbols = scanCFunctions(sampleCode, tempFilePath);
  console.log('Detected symbols count:', symbols.length);
  
  symbols.forEach((s, idx) => {
    console.log(`[${idx}] L${s.line + 1}: ${s.kind === 13 ? 'Constant' : s.kind === 12 ? 'Variable' : 'Function'} -> label: "${s.label || s.name}" | isDeclaration: ${!!s.isDeclaration} | isDefinition: ${!!s.isDefinition}`);
  });

  if (symbols.length !== 5) {
    throw new Error(`Expected 5 symbols, got ${symbols.length}`);
  }

  // Symbol 0: SIMBOLO (#define Constant)
  if (symbols[0].name !== 'SIMBOLO' || symbols[0].kind !== 13) {
    throw new Error(`Expected SIMBOLO constant, got ${JSON.stringify(symbols[0])}`);
  }

  // Symbol 1: panelHandle (Variable)
  if (symbols[1].name !== 'panelHandle' || symbols[1].kind !== 12) {
    throw new Error(`Expected panelHandle variable, got ${JSON.stringify(symbols[1])}`);
  }

  // Symbol 2: panelCB prototype (declaration)
  if (symbols[2].name !== 'panelCB' || !symbols[2].isDeclaration || symbols[2].label !== 'panelCB(int, int, void *, int, int)') {
    throw new Error(`Expected panelCB prototype declaration, got ${JSON.stringify(symbols[2])}`);
  }

  // Symbol 3: main definition
  if (symbols[3].name !== 'main' || !symbols[3].isDefinition || symbols[3].label !== 'main(int, char * [])') {
    throw new Error(`Expected main definition, got ${JSON.stringify(symbols[3])}`);
  }

  // Symbol 4: panelCB definition
  if (symbols[4].name !== 'panelCB' || !symbols[4].isDefinition || symbols[4].label !== 'panelCB(int, int, void *, int, int)') {
    throw new Error(`Expected panelCB definition, got ${JSON.stringify(symbols[4])}`);
  }

  console.log('\n--- 2. Testing TreeItem representations ---');
  const mockService = { symbolsForFile: async () => symbols };
  const provider = new CviFileSymbolsProvider(mockService);
  provider.setSelectedFile(tempFilePath);

  symbols.forEach((s) => {
    const item = provider.getTreeItem(s);
    console.log(`Item: "${item.label}" | description: "${item.description || ''}" | icon: "${item.iconPath.id}"`);
  });

  // Verify that panelCB prototype has description 'declaration'
  const protoItem = provider.getTreeItem(symbols[2]);
  if (protoItem.description !== 'declaration') {
    throw new Error(`Expected prototype item to have description "declaration", got "${protoItem.description}"`);
  }

  // Verify that panelCB definition does NOT have description 'declaration'
  const defItem = provider.getTreeItem(symbols[4]);
  if (defItem.description === 'declaration') {
    throw new Error(`Expected definition item to NOT have description "declaration"`);
  }

  console.log('\n--- 3. Testing Sort modes ---');
  (async () => {
    // Position sort
    provider.setSortMode('position');
    const byPos = await provider.getChildren();
    console.log('Position sort order:', byPos.map(s => s.label));
    if (byPos[0].label !== 'SIMBOLO' || byPos[1].label !== 'panelHandle') {
      throw new Error('Position sort mismatch');
    }

    // Name sort
    provider.setSortMode('name');
    const byName = await provider.getChildren();
    console.log('Name sort order:', byName.map(s => s.label));
    if (byName[0].label !== 'main(int, char * [])') {
      throw new Error('Name sort mismatch: main should be first');
    }

    // Category sort
    provider.setSortMode('category');
    const byCat = await provider.getChildren();
    console.log('Category sort order:', byCat.map(s => `${s.label} (${s.kind})`));
    if (byCat[0].label !== 'SIMBOLO' || byCat[1].label !== 'panelHandle') {
      throw new Error('Category sort mismatch: Constant then Variable expected first');
    }

    console.log('\n--- 4. Testing Header Generation ---');
    const header = buildHeaderFromSourceSymbols(symbols, tempFilePath);
    console.log('Generated header:\n' + header);
    if (header.includes('panelHandle') || header.includes('SIMBOLO')) {
      throw new Error('Generated header should not include variables or #define constants!');
    }
    // panelCB should only appear once in generated header!
    const panelCBMatches = (header.match(/panelCB/g) || []).length;
    if (panelCBMatches !== 1) {
      throw new Error(`Expected panelCB to appear exactly once in generated header, found ${panelCBMatches}`);
    }

    console.log('\n--- All tests PASSED successfully! ---');
  })().catch(err => {
    console.error('Async test error:', err);
    process.exit(1);
  });
} finally {
  if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
}
