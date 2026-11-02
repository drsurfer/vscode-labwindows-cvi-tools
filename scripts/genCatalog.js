const fs = require('fs');
const path = require('path');

const mdPath = path.join(__dirname, '../ni/compiler_warning_flags_table.md');
const mdContent = fs.readFileSync(mdPath, 'utf8');
const mdRows = mdContent.split('\n')
  .map(l => l.trim())
  .filter(l => l.startsWith('|') && !l.includes('---'))
  .slice(1)
  .map(l => {
    const p = l.split('|').map(s => s.trim()).filter(Boolean);
    const flag = p[1].replace(/[`]/g, '').trim();
    return { name: p[0], flag: flag.startsWith('-W') ? flag : ('-W' + flag), level: p[2], desc: p[3] };
  });

const cviExePath = 'C:\\Program Files (x86)\\National Instruments\\CVI2020\\compile.exe';
const cviBuf = fs.readFileSync(cviExePath);
const peOffset = cviBuf.readUInt32LE(0x3C);
const imageBase = cviBuf.readUInt32LE(peOffset + 0x34);
const numSections = cviBuf.readUInt16LE(peOffset + 0x06);
const optHeaderSize = cviBuf.readUInt16LE(peOffset + 0x14);
const secTableOffset = peOffset + 0x18 + optHeaderSize;

function vaToFile(va) {
  const rva = va - imageBase;
  for (let i = 0; i < numSections; i++) {
    const secOffset = secTableOffset + i * 40;
    const vSize = cviBuf.readUInt32LE(secOffset + 8);
    const vAddr = cviBuf.readUInt32LE(secOffset + 12);
    const rawSize = cviBuf.readUInt32LE(secOffset + 16);
    const rawAddr = cviBuf.readUInt32LE(secOffset + 20);
    if (rva >= vAddr && rva < vAddr + vSize) {
      return rawAddr + (rva - vAddr);
    }
  }
  return null;
}

function readString(fileOffset) {
  if (!fileOffset || fileOffset >= cviBuf.length) return null;
  let end = fileOffset;
  while (end < cviBuf.length && cviBuf[end] !== 0) end++;
  return cviBuf.slice(fileOffset, end).toString('latin1');
}

const warnings = [];
for (let i = 0; i < 139; i++) {
  const base = 1315240 + i * 20;
  const ptr = cviBuf.readUInt32LE(base);
  const flagStr = '-W' + readString(vaToFile(ptr));
  const mdMatch = mdRows.find(r => r.flag.toLowerCase() === flagStr.toLowerCase());
  const levelNum = cviBuf.readUInt32LE(base + 12);
  const level = mdMatch ? mdMatch.level : (levelNum === 1 ? 'Common' : levelNum === 2 ? 'Extended' : 'All');
  const name = mdMatch ? mdMatch.name : flagStr.slice(2);
  const desc = mdMatch ? mdMatch.desc : '';
  warnings.push({
    id: i + 1,
    name,
    flag: flagStr,
    level,
    description: desc
  });
}

const code = `export type CviWarningLevel = 'None' | 'Common' | 'Extended' | 'All';

export interface CviWarningItem {
  id: number;
  name: string;
  flag: string;
  level: 'Common' | 'Extended' | 'All';
  description: string;
}

export const CVI_WARNING_CATALOG: CviWarningItem[] = ${JSON.stringify(warnings, null, 2)};

export function getWarningById(id: number): CviWarningItem | undefined {
  return CVI_WARNING_CATALOG.find((w) => w.id === id);
}

export function parseWarningIdList(str: string | undefined): number[] {
  if (!str) return [];
  return str.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => !isNaN(n));
}

export function formatWarningIdList(ids: number[]): string {
  return ids.filter((id) => id !== 0).join(',');
}

export function getDefaultWarningsForLevel(level: CviWarningLevel): Set<number> {
  const result = new Set<number>();
  if (level === 'None') return result;
  for (const w of CVI_WARNING_CATALOG) {
    if (level === 'Common' && w.level === 'Common') {
      result.add(w.id);
    } else if (level === 'Extended' && (w.level === 'Common' || w.level === 'Extended')) {
      result.add(w.id);
    } else if (level === 'All') {
      result.add(w.id);
    }
  }
  return result;
}
`;

const targetPath = path.join(__dirname, '../src/model/cviWarningCatalog.ts');
fs.writeFileSync(targetPath, code, 'utf8');
console.log('Successfully wrote', targetPath, 'with', warnings.length, 'warnings.');
