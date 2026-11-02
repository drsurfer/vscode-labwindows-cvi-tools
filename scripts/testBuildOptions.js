const fs = require('fs');
const path = require('path');
const Module = require('module');

// Mock vscode module so we can require our built extension modules in standalone Node
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      window: {
        showErrorMessage: console.error,
        showWarningMessage: console.warn,
        showInformationMessage: console.log,
        createWebviewPanel: () => ({ webview: {}, onDidDispose: () => ({ dispose: () => {} }) }),
        showQuickPick: async () => undefined,
        showInputBox: async () => undefined
      },
      ViewColumn: { One: 1, Beside: -2 },
      Uri: { file: (f) => ({ fsPath: f, scheme: 'file', toString: () => 'file://' + f }) },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: path.resolve(__dirname, '..') } }],
        getConfiguration: () => ({ get: (_key, def) => def }),
        fs: {
          readFile: async (uri) => fs.readFileSync(uri.fsPath),
          writeFile: async (uri, data) => fs.writeFileSync(uri.fsPath, data)
        }
      },
      ConfigurationTarget: { Workspace: 2 }
    };
  }
  return originalLoad.apply(this, arguments);
};

const { CVI_WARNING_CATALOG, getDefaultWarningsForLevel, getWarningById } = require('../out/model/cviWarningCatalog');
const { CviParser } = require('../out/model/cviParser');

console.log('--- 1. Testing CVI Warning Catalog ---');
console.log('Catalog items count:', CVI_WARNING_CATALOG.length);
if (CVI_WARNING_CATALOG.length !== 139) {
  throw new Error(`Expected 139 warnings, got ${CVI_WARNING_CATALOG.length}`);
}

const id6 = getWarningById(6);
console.log('Warning ID 6:', id6);
const id84 = getWarningById(84);
console.log('Warning ID 84:', id84);
const id131 = getWarningById(131);
console.log('Warning ID 131:', id131);

console.log('--- 2. Testing Reading Demo Antigravity.prj & .cws (Debug config) ---');
const prjPath = 'D:\\Megaris\\_VScode\\CVItools\\ni\\prj\\Demo Antigravity.prj';
const cwsPath = 'D:\\Megaris\\_VScode\\CVItools\\ni\\prj\\Demo Antigravity.cws';

const parser = new CviParser();
const optsDebug = parser.getNativeBuildOptions(prjPath, cwsPath, 'debug');
console.log('Debug Options parsed:');
console.log('  Selected Warning Level:', optsDebug.selectedWarningLevel);
console.log('  Error Warnings:', optsDebug.errorWarningIds);
console.log('  Disabled Warnings:', optsDebug.disabledWarningIds);
console.log('  Compiler Defines:', optsDebug.compilerDefines);
console.log('  Build with C99:', optsDebug.enableC99);
console.log('  OpenMP:', optsDebug.enableOpenMP);
console.log('  Stack Commit:', optsDebug.stackCommit);
console.log('  Stack Reserve:', optsDebug.stackReserve);
console.log('  Image Base Address (hex):', optsDebug.imageBaseAddress);

if (optsDebug.selectedWarningLevel !== 'Common') {
  throw new Error(`Expected warning level 'Common', got '${optsDebug.selectedWarningLevel}'`);
}
if (!optsDebug.errorWarningIds.includes(6) || !optsDebug.errorWarningIds.includes(124)) {
  throw new Error(`Expected warning 6 & 124 in error list, got ${optsDebug.errorWarningIds}`);
}
if (!optsDebug.disabledWarningIds.includes(131) || !optsDebug.disabledWarningIds.includes(5)) {
  throw new Error(`Expected warning 131 & 5 in disabled list, got ${optsDebug.disabledWarningIds}`);
}
if (!optsDebug.compilerDefines.includes('ANTIGRAVITY')) {
  throw new Error(`Expected compiler defines to contain ANTIGRAVITY`);
}
if (optsDebug.enableC99 !== true) {
  throw new Error('Expected enableC99 to be true');
}
if (optsDebug.enableOpenMP !== true) {
  throw new Error('Expected enableOpenMP to be true');
}
if (optsDebug.stackCommit !== 8192) {
  throw new Error(`Expected stackCommit 8192, got ${optsDebug.stackCommit}`);
}

console.log('--- 3. Testing Roundtrip setNativeBuildOptions on temp copies ---');
const tmpPrj = path.join(__dirname, 'temp_test.prj');
const tmpCws = path.join(__dirname, 'temp_test.cws');
fs.copyFileSync(prjPath, tmpPrj);
fs.copyFileSync(cwsPath, tmpCws);

try {
  const modifiedOpts = {
    ...optsDebug,
    compilerDefines: '/D_TEST_MACRO=1 /D_ANOTHER',
    enableC99: false,
    errorWarningIds: [6, 84, 10],
    disabledWarningIds: [131, 20]
  };

  parser.setNativeBuildOptions(tmpPrj, tmpCws, 'debug', modifiedOpts);
  const reReadOpts = parser.getNativeBuildOptions(tmpPrj, tmpCws, 'debug');

  console.log('Re-read modified options:');
  console.log('  Compiler Defines:', reReadOpts.compilerDefines);
  console.log('  C99:', reReadOpts.enableC99);
  console.log('  Error Warnings:', reReadOpts.errorWarningIds);
  console.log('  Disabled Warnings:', reReadOpts.disabledWarningIds);

  if (reReadOpts.compilerDefines !== '/D_TEST_MACRO=1 /D_ANOTHER') {
    throw new Error('Compiler defines roundtrip failed');
  }
  if (reReadOpts.enableC99 !== false) {
    throw new Error('C99 roundtrip failed');
  }
  if (!reReadOpts.errorWarningIds.includes(10)) {
    throw new Error('Error list roundtrip failed');
  }
  if (!reReadOpts.disabledWarningIds.includes(20)) {
    throw new Error('Disabled list roundtrip failed');
  }
} finally {
  if (fs.existsSync(tmpPrj)) fs.unlinkSync(tmpPrj);
  if (fs.existsSync(tmpCws)) fs.unlinkSync(tmpCws);
}

console.log('--- ALL TESTS PASSED SUCCESSFULLY! ---');
