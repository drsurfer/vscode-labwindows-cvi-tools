import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CviInstallationService } from './cviInstallationService';
import { writeCviTextFile } from '../utils/pathUtils';

interface StoredFileTemplate {
  id: string;
  label: string;
  description?: string;
  extension: string;
  content: string;
}

interface StoredSnippet {
  id: string;
  label: string;
  description?: string;
  body: string;
}

interface StoredCollection<T> {
  version: number;
  items: T[];
}

interface PendingFile {
  absolutePath: string;
  contents: string | Buffer;
  binary?: boolean;
}


export interface NewFileGenerationResult {
  files: string[];
  createdFiles: string[];
  primaryPath?: string;
  uirPath?: string;
}

export interface TemplateVariables {
  baseName: string;
  fileName: string;
  headerFile: string;
  guard: string;
  prefix: string;
  uirFile: string;
  date: string;
  year: string;
}

export interface BuiltInSnippet {
  id: string;
  label: string;
  description: string;
  body: string;
}

const FILE_TEMPLATE_STORE = 'file-templates.json';
const SNIPPET_STORE = 'snippets.json';
const TEXT_TEMPLATE_EXTENSIONS = new Set(['.c', '.h', '.cpp', '.hpp', '.txt', '.ini', '.json', '.xml', '.md', '.lua', '.js', '.ts', '.bat', '.cmd', '.ps1']);

function normalizeExtension(extension: string): string {
  const trimmed = String(extension || '').trim();
  if (!trimmed) {
    return '.txt';
  }
  return trimmed.startsWith('.') ? trimmed.toLowerCase() : `.${trimmed.toLowerCase()}`;
}

function sanitizeId(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'custom';
}

function sanitizePrefix(value: string): string {
  let prefix = String(value || '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  if (!prefix) {
    prefix = 'CVI_MODULE';
  }
  if (/^[0-9]/.test(prefix)) {
    prefix = `_${prefix}`;
  }
  return prefix;
}

function toCrlf(value: string): string {
  return String(value || '').replace(/\r?\n/g, '\r\n');
}

export function headerGuardForPath(filePath: string): string {
  const withoutExtension = path.basename(filePath, path.extname(filePath));
  return `${sanitizePrefix(withoutExtension)}_H`;
}

export function renderTemplateText(template: string, variables: TemplateVariables): string {
  return String(template || '').replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, key: string) => {
    const value = variables[key as keyof TemplateVariables];
    return value === undefined ? `{{${key}}}` : String(value);
  });
}

export function resolveUirTemplateVersion(preference: string, installationRoot?: string): 'cvi2012' | 'cvi2020' {
  const normalizedPreference = String(preference || 'auto').toLowerCase();
  if (normalizedPreference === 'cvi2020') {
    return 'cvi2020';
  }
  if (normalizedPreference === 'cvi2012') {
    return 'cvi2012';
  }
  const root = String(installationRoot || '');
  const year = root.match(/(?:CVI|LabWindows[^0-9]*)(20\d{2})/i)?.[1];
  return year && Number(year) >= 2020 ? 'cvi2020' : 'cvi2012';
}

const GUARDED_HEADER_TEMPLATE = `#ifndef {{guard}}
#define {{guard}}

#ifdef __cplusplus
extern "C" {
#endif

/* Public declarations for {{baseName}}. */

#ifdef __cplusplus
}
#endif

#endif /* {{guard}} */
`;

const MODULE_SOURCE_TEMPLATE = `#include "{{headerFile}}"

/* Add the implementation of {{baseName}} here. */
`;

const MAIN_TEMPLATE = `#include <cvirte.h>

int main (int argc, char *argv[])
{
    if (InitCVIRTE (0, argv, 0) == 0)
        return -1;    /* out of memory */

    /* application code */

    CloseCVIRTE ();
    return 0;
}
`;

const WINMAIN_TEMPLATE = `#include <windows.h>
#include <cvirte.h>

int __stdcall WinMain (HINSTANCE hInstance, HINSTANCE hPrevInstance,
                       LPSTR lpszCmdLine, int nCmdShow)
{
    (void)hPrevInstance;
    (void)lpszCmdLine;
    (void)nCmdShow;

    if (InitCVIRTE (hInstance, 0, 0) == 0)
        return -1;    /* out of memory */

    /* application code */

    CloseCVIRTE ();
    return 0;
}
`;

const RTMAIN_TEMPLATE = `#include <windows.h>
#include <cvirte.h>
#include <rtutil.h>

void CVIFUNC_C RTmain (void)
{
    if (InitCVIRTE (0, 0, 0) == 0)
        return;    /* out of memory */

    /* initialization code */

    while (!RTIsShuttingDown ())
    {
        /* periodic code */
        Sleep (100);
    }

    /* cleanup code */
    CloseCVIRTE ();
}
`;

const DLL_HEADER_TEMPLATE = `#ifndef {{guard}}
#define {{guard}}

#ifdef __cplusplus
extern "C" {
#endif

#if defined(_WIN32)
#  if defined({{prefix}}_EXPORTS)
#    define {{prefix}}_API __declspec(dllexport)
#  else
#    define {{prefix}}_API __declspec(dllimport)
#  endif
#else
#  define {{prefix}}_API
#endif

/* Add exported declarations here. Example:
 * {{prefix}}_API int {{baseName}}_Initialize (void);
 */

#ifdef __cplusplus
}
#endif

#endif /* {{guard}} */
`;

const DLL_SOURCE_TEMPLATE = `#include <windows.h>
#include <cvirte.h>
#include "{{headerFile}}"

BOOL WINAPI DllMain (HINSTANCE hinstDLL, DWORD fdwReason, LPVOID lpvReserved)
{
    switch (fdwReason)
    {
        case DLL_PROCESS_ATTACH:    // Code to run when the DLL is loaded
            if (InitCVIRTE (hinstDLL, 0, 0) == 0)
                return FALSE;    /* out of memory */
            break;

        case DLL_THREAD_ATTACH:     // Code to run when a thread is created
            break;

        case DLL_THREAD_DETACH:     // Code to run when a thread ends
            break;

        case DLL_PROCESS_DETACH:    // Code to run when the DLL is unloaded
            if (!CVIRTEHasBeenDetached ())
                CloseCVIRTE ();
            break;
    }

    return TRUE;
}
`;

const UI_APP_SOURCE_TEMPLATE = `//==============================================================================
//
// Title:       {{baseName}}
// Purpose:     CVI user-interface application starter.
//
// Generated on: {{date}}
//
//==============================================================================

#include <cvirte.h>
#include <userint.h>
#include "{{headerFile}}"

static int panelHandle = 0;

int CVICALLBACK panelCB (int panel, int event, void *callbackData,
                         int eventData1, int eventData2);

int main (int argc, char *argv[])
{
    int status = 0;

    if (InitCVIRTE (0, argv, 0) == 0)
        return -1;

    panelHandle = LoadPanel (0, "{{uirFile}}", PANEL);
    if (panelHandle < 0)
    {
        status = -2;
        goto Cleanup;
    }

    DisplayPanel (panelHandle);
    RunUserInterface ();

Cleanup:
    if (panelHandle > 0)
        DiscardPanel (panelHandle);
    CloseCVIRTE ();
    return status;
}

int CVICALLBACK panelCB (int panel, int event, void *callbackData,
                         int eventData1, int eventData2)
{
    (void)panel;
    (void)callbackData;
    (void)eventData1;
    (void)eventData2;

    if (event == EVENT_CLOSE)
        QuitUserInterface (0);

    return 0;
}
`;

const ERROR_HEADER_TEMPLATE = `#ifndef {{guard}}
#define {{guard}}

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>

#define CVI_ERROR_LOG_PATH_SIZE 1024
#define CVI_ERROR_MAX_LOG_LINES 1000

extern int g_cviErrorCode;

void CviError_SetLogFile (const char *filePath);
void CviError_Log (const char *format, ...);
void CviError_Report (int code, const char *message, const char *file,
                      int line, const char *functionName);

#if defined(_MSC_VER) || defined(__CVI__)
#  define CVI_ERROR_FUNCTION __FUNCTION__
#else
#  define CVI_ERROR_FUNCTION __func__
#endif

#define CVI_ERROR_GOTO(code, message, label) \\
    do { \\
        int cviErrorCodeLocal = (code); \\
        if (cviErrorCodeLocal < 0) { \\
            g_cviErrorCode = cviErrorCodeLocal; \\
            CviError_Report (cviErrorCodeLocal, (message), __FILE__, __LINE__, CVI_ERROR_FUNCTION); \\
            goto label; \\
        } \\
    } while (0)

#define CVI_CHECK_GOTO(expression, label) \\
    CVI_ERROR_GOTO ((expression), #expression, label)

#define CVI_CHECK_PTR_GOTO(pointer, label) \\
    do { \\
        if ((pointer) == NULL) { \\
            g_cviErrorCode = -999; \\
            CviError_Report (g_cviErrorCode, "NULL pointer: " #pointer, __FILE__, __LINE__, CVI_ERROR_FUNCTION); \\
            goto label; \\
        } \\
    } while (0)

#ifdef __cplusplus
}
#endif

#endif /* {{guard}} */
`;

const ERROR_SOURCE_TEMPLATE = `#include "{{headerFile}}"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

static char cviErrorLogPath[CVI_ERROR_LOG_PATH_SIZE] = "";
int g_cviErrorCode = 0;

static void CviError_TrimLogIfNeeded (void)
{
    FILE *file;
    char line[512];
    int lineCount = 0;

    if (cviErrorLogPath[0] == '\\0')
        return;

    file = fopen (cviErrorLogPath, "r");
    if (file == NULL)
        return;

    while (fgets (line, sizeof (line), file) != NULL)
        ++lineCount;
    fclose (file);

    if (lineCount > CVI_ERROR_MAX_LOG_LINES)
    {
        file = fopen (cviErrorLogPath, "w");
        if (file != NULL)
            fclose (file);
    }
}

void CviError_SetLogFile (const char *filePath)
{
    if (filePath == NULL)
    {
        cviErrorLogPath[0] = '\\0';
        return;
    }

    strncpy (cviErrorLogPath, filePath, sizeof (cviErrorLogPath) - 1);
    cviErrorLogPath[sizeof (cviErrorLogPath) - 1] = '\\0';
}

void CviError_Log (const char *format, ...)
{
    char message[2048];
    FILE *file;
    va_list args;

    va_start (args, format);
    vsnprintf (message, sizeof (message), format, args);
    va_end (args);
    message[sizeof (message) - 1] = '\\0';

    if (cviErrorLogPath[0] != '\\0')
    {
        CviError_TrimLogIfNeeded ();
        file = fopen (cviErrorLogPath, "a");
        if (file != NULL)
        {
            fputs (message, file);
            fflush (file);
            fclose (file);
        }
    }

    fputs (message, stdout);
}

void CviError_Report (int code, const char *message, const char *file,
                      int line, const char *functionName)
{
    time_t now = time (NULL);
    const char *timestamp = ctime (&now);

    CviError_Log ("*** CVI ERROR ***\\n"
                  "Code: %d\\n"
                  "Message: %s\\n"
                  "File: %s\\n"
                  "Line: %d\\n"
                  "Function: %s\\n"
                  "Time: %s\\n",
                  code,
                  message != NULL ? message : "(none)",
                  file != NULL ? file : "(unknown)",
                  line,
                  functionName != NULL ? functionName : "(unknown)",
                  timestamp != NULL ? timestamp : "(unknown)\\n");
}
`;


function buildBlankUirHeader(): string {
  return `/**************************************************************************/
/* LabWindows/CVI User Interface Resource (UIR) Include File              */
/*                                                                        */
/* WARNING: Do not add to, delete from, or otherwise modify the contents  */
/*          of this include file.                                         */
/**************************************************************************/

#include <userint.h>

#ifdef __cplusplus
    extern "C" {
#endif

     /* Panels and Controls: */

#define  PANEL                            1


     /* Control Arrays: */

          /* (no control arrays in the resource file) */


     /* Menu Bars, Menus, and Menu Items: */

          /* (no menu bars in the resource file) */


     /* (no callbacks specified in the resource file) */


#ifdef __cplusplus
    }
#endif
`;
}

const FILE_DESCRIPTION_HEADER_TEMPLATE = `//****************************************************************************
//**                                                                        **
//**   {{company}}                                                          **
//**   {{address1}}                                                         **
//**   {{address2}}                                                         **
//**   {{tel}}                                                              **
//**   {{fax}}                                                              **
//**   {{email}}                                                            **
//**                                                                        **
//****************************************************************************
//**                         CHANGES/EVOLUTIONS                             **
//**________________________________________________________________________**
//**   Date   |   Author   | Version |          Description                 **
//**__________|____________|_________|______________________________________**
{{changeLine}}
//**          |            |         |                                      **
//****************************************************************************

`;

const MAIN_WITH_ERROR_SOURCE_TEMPLATE = `{{fileHeader}}// Includes files
{{mainHeaderInclude}}#include "cpm_error.h"

//==============================================================================
// Error management
/*
    CPM_ERR_INFZ(code, message)     // Jump to error if code < 0
    CPM_ERR_INFEQZ(code, message)   // Jump to error if code <= 0
    CPM_ERR_CHCK_INFZ(expression)   // Evaluate expression and check < 0
    CPM_ERR_CHCK_INFEQZ(expression) // Evaluate expression and check <= 0
    CPM_ERR_PTR(pointer)            // Jump to error if pointer == NULL
*/

//==============================================================================
// Constants

//==============================================================================
// Types

//==============================================================================
// Static global variables

//==============================================================================
// Static functions

//==============================================================================
// Global variables

//==============================================================================
// Global functions

int main(int argc, char **argv)
{
    int status = 0;

    CpmError_InitDefaults();
    CpmError_LoadConfig("cpm_error.ini");

    //==============================================================================
    // Command-line arguments
    if (argc > 1)
    {
        const char *firstArgument = argv[1];

        if (firstArgument == NULL)
        {
            g_cpmErrorCode = -1;
            CpmError_Report(g_cpmErrorCode, "Invalid first argument", __FILE__, __LINE__, CPM_ERROR_FUNCTION);
            goto error;
        }

        /* Use firstArgument or iterate argv[1..argc-1] here. */
    }

    /* Application code starts here. */

    goto cleanup;

error:
    status = g_cpmErrorCode;

cleanup:
    return status;
}
`;

const MAIN_WITH_ERROR_HEADER_TEMPLATE = `#ifndef {{guard}}
#define {{guard}}

#ifdef __cplusplus
extern "C" {
#endif

/* Public declarations for {{baseName}}. */

#ifdef __cplusplus
}
#endif

#endif /* {{guard}} */
`;

function formatDateDdMmYy(date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function sanitizeHeaderText(value: string | undefined, fallback: string): string {
  const cleaned = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  return cleaned || fallback;
}

function fitCell(value: string, width: number, align: 'left' | 'center' = 'left'): string {
  const clean = sanitizeHeaderText(value, '').replace(/\t/g, ' ');
  const text = clean.length > width ? clean.slice(0, Math.max(0, width - 1)) + '…' : clean;
  if (align === 'center') {
    const left = Math.floor((width - text.length) / 2);
    const right = Math.max(0, width - text.length - left);
    return `${' '.repeat(Math.max(0, left))}${text}${' '.repeat(right)}`;
  }
  return text.padEnd(width, ' ');
}

const HEADER_CHANGE_DESCRIPTION_WIDTH = 36;
const HEADER_CHANGE_SEPARATOR = '//**__________|____________|_________|______________________________________**';

function splitLongHeaderWord(word: string, width: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < word.length; index += width) {
    chunks.push(word.slice(index, index + width));
  }
  return chunks;
}

function wrapHeaderDescription(value: string, width = HEADER_CHANGE_DESCRIPTION_WIDTH): string[] {
  const clean = sanitizeHeaderText(value, '').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) {
    return [''];
  }

  const lines: string[] = [];
  let current = '';

  for (const rawWord of clean.split(' ')) {
    const wordParts = rawWord.length > width ? splitLongHeaderWord(rawWord, width) : [rawWord];
    for (const word of wordParts) {
      if (!current) {
        current = word;
      } else if (current.length + 1 + word.length <= width) {
        current = `${current} ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }
  }

  if (current) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

function renderHeaderChangeRow(date: string, author: string, version: string, description: string): string {
  return `//** ${fitCell(date, 8)} | ${fitCell(author, 10)} | ${fitCell(version, 7, 'center')} | ${description.padEnd(HEADER_CHANGE_DESCRIPTION_WIDTH, ' ')} **`;
}

function renderHeaderChangeLine(date: string, author: string, version: string, description: string): string {
  const wrappedDescription = wrapHeaderDescription(description);
  return wrappedDescription
    .map((part, index) => renderHeaderChangeRow(
      index === 0 ? date : '',
      index === 0 ? author : '',
      index === 0 ? version : '',
      part
    ))
    .join('\n');
}

function renderHeaderChangeEntry(date: string, author: string, version: string, description: string): string {
  return `${renderHeaderChangeLine(date, author, version, description)}\n${HEADER_CHANGE_SEPARATOR}`;
}

function renderFileDescriptionHeader(values: { company: string; address1: string; address2: string; tel: string; fax: string; email: string; date: string; author: string; version: string; description: string }): string {
  return FILE_DESCRIPTION_HEADER_TEMPLATE
    .replace('{{company}}', fitCell(values.company, 64))
    .replace('{{address1}}', fitCell(values.address1, 64))
    .replace('{{address2}}', fitCell(values.address2, 64))
    .replace('{{tel}}', fitCell(values.tel, 64))
    .replace('{{fax}}', fitCell(values.fax, 64))
    .replace('{{email}}', fitCell(values.email, 64))
    .replace('{{changeLine}}', renderHeaderChangeLine(values.date, values.author, values.version, values.description));
}

function renderCommentSection(title: string, style: string): string {
  const label = sanitizeHeaderText(title, 'Section');
  if (style === 'line') {
    return `//==============================================================================\n// ${label}\n\n`;
  }
  if (style === 'compact') {
    return `/* ${label} */\n`;
  }
  const content = ` ${label} `;
  const total = 54;
  const left = Math.max(1, Math.floor((total - content.length - 2) / 2));
  const right = Math.max(1, total - content.length - left - 2);
  return `/${'*'.repeat(left)}${content}${'*'.repeat(right)}/\n/${'*'.repeat(total - 2)}/\n`;
}

const SPECIAL_TEXT_FONT: Record<string, string[]> = {
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  'C': ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  'G': ['01111', '10000', '10000', '10011', '10001', '10001', '01111'],
  'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  'I': ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  'V': ['10001', '10001', '10001', '10001', '01010', '01010', '00100'],
  'W': ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  ' ': ['000', '000', '000', '000', '000', '000', '000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '_': ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
  '.': ['000', '000', '000', '000', '000', '011', '011'],
  ':': ['000', '011', '011', '000', '011', '011', '000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '\\': ['10000', '01000', '01000', '00100', '00010', '00010', '00001'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000']
};

const SPECIAL_TEXT_UNKNOWN_GLYPH = ['11111', '00001', '00010', '00100', '00100', '00000', '00100'];

const SPECIAL_TEXT_COMPACT_FONT: Record<string, string[]> = {
  'A': ['010', '101', '111', '101', '101'],
  'B': ['110', '101', '110', '101', '110'],
  'C': ['011', '100', '100', '100', '011'],
  'D': ['110', '101', '101', '101', '110'],
  'E': ['111', '100', '110', '100', '111'],
  'F': ['111', '100', '110', '100', '100'],
  'G': ['011', '100', '101', '101', '011'],
  'H': ['101', '101', '111', '101', '101'],
  'I': ['111', '010', '010', '010', '111'],
  'J': ['001', '001', '001', '101', '010'],
  'K': ['101', '110', '100', '110', '101'],
  'L': ['100', '100', '100', '100', '111'],
  'M': ['10001', '11011', '10101', '10001', '10001'],
  'N': ['1001', '1101', '1011', '1001', '1001'],
  'O': ['010', '101', '101', '101', '010'],
  'P': ['110', '101', '110', '100', '100'],
  'Q': ['010', '101', '101', '111', '011'],
  'R': ['110', '101', '110', '101', '101'],
  'S': ['011', '100', '010', '001', '110'],
  'T': ['111', '010', '010', '010', '010'],
  'U': ['101', '101', '101', '101', '111'],
  'V': ['101', '101', '101', '101', '010'],
  'W': ['10001', '10001', '10101', '10101', '01010'],
  'X': ['101', '101', '010', '101', '101'],
  'Y': ['101', '101', '010', '010', '010'],
  'Z': ['111', '001', '010', '100', '111'],
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['110', '001', '010', '100', '111'],
  '3': ['110', '001', '010', '001', '110'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '110', '001', '110'],
  '6': ['011', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '110'],
  ' ': ['0', '0', '0', '0', '0'],
  '-': ['000', '000', '111', '000', '000'],
  '_': ['000', '000', '000', '000', '111'],
  '.': ['0', '0', '0', '0', '1'],
  ':': ['0', '1', '0', '1', '0'],
  '/': ['001', '001', '010', '100', '100'],
  '\\': ['100', '100', '010', '001', '001'],
  '+': ['000', '010', '111', '010', '000']
};

const SPECIAL_TEXT_COMPACT_UNKNOWN_GLYPH = ['111', '001', '010', '000', '010'];

type SpecialTextFontName = 'compact' | 'standard';
type SpecialTextOutputMode = 'line-comment' | 'block-comment' | 'raw';

interface SpecialTextSizePreset {
  id: string;
  label: string;
  description: string;
  font: SpecialTextFontName;
  horizontalScale: number;
  verticalScale: number;
  singleCharacterToken: boolean;
}

const SPECIAL_TEXT_SIZE_PRESETS: SpecialTextSizePreset[] = [
  {
    id: 'micro',
    label: '1 - Micro',
    description: 'Smallest output: compact 3x5 font and first character of the selected pattern.',
    font: 'compact',
    horizontalScale: 1,
    verticalScale: 1,
    singleCharacterToken: true
  },
  {
    id: 'small',
    label: '2 - Small',
    description: 'Compact 3x5 font with the selected pattern.',
    font: 'compact',
    horizontalScale: 1,
    verticalScale: 1,
    singleCharacterToken: false
  },
  {
    id: 'narrow',
    label: '3 - Narrow',
    description: 'Standard 5x7 font with a single-character stroke.',
    font: 'standard',
    horizontalScale: 1,
    verticalScale: 1,
    singleCharacterToken: true
  },
  {
    id: 'standard',
    label: '4 - Standard',
    description: 'Previous size 1: standard 5x7 font with the selected pattern.',
    font: 'standard',
    horizontalScale: 1,
    verticalScale: 1,
    singleCharacterToken: false
  },
  {
    id: 'large',
    label: '5 - Large',
    description: 'Previous size 2 and new maximum.',
    font: 'standard',
    horizontalScale: 2,
    verticalScale: 2,
    singleCharacterToken: false
  }
];

function normalizeSpecialTextPattern(value: string | undefined): string {
  const cleaned = String(value ?? '').replace(/[\r\n\t]/g, '').trim();
  return cleaned.slice(0, 8) || '//';
}

function getSingleCharacterToken(pattern: string): string {
  return [...pattern][0] ?? '/';
}

function normalizeSpecialTextSize(value: string | number | undefined): SpecialTextSizePreset {
  const raw = String(value ?? '').trim().toLowerCase();
  const byId = SPECIAL_TEXT_SIZE_PRESETS.find((preset) => preset.id === raw);
  if (byId) {
    return byId;
  }

  const numeric = Number.parseInt(raw, 10);
  if (Number.isFinite(numeric)) {
    const index = Math.min(SPECIAL_TEXT_SIZE_PRESETS.length, Math.max(1, numeric)) - 1;
    return SPECIAL_TEXT_SIZE_PRESETS[index];
  }

  return SPECIAL_TEXT_SIZE_PRESETS.find((preset) => preset.id === 'standard') ?? SPECIAL_TEXT_SIZE_PRESETS[3];
}

function getSpecialTextGlyph(character: string, font: SpecialTextFontName): string[] {
  if (font === 'compact') {
    return SPECIAL_TEXT_COMPACT_FONT[character] ?? SPECIAL_TEXT_COMPACT_UNKNOWN_GLYPH;
  }
  return SPECIAL_TEXT_FONT[character] ?? SPECIAL_TEXT_UNKNOWN_GLYPH;
}

function renderSpecialTextRow(row: string, pattern: string, horizontalScale: number): string {
  const blank = ' '.repeat(pattern.length * horizontalScale);
  let output = '';
  for (const cell of row) {
    output += cell === '1' ? pattern.repeat(horizontalScale) : blank;
  }
  return output;
}

function renderSpecialCharacterText(text: string, pattern: string, size: string | number, mode: SpecialTextOutputMode): string {
  const label = sanitizeHeaderText(text, 'CVI').toUpperCase();
  const token = normalizeSpecialTextPattern(pattern);
  const preset = normalizeSpecialTextSize(size);
  const strokeToken = preset.singleCharacterToken ? getSingleCharacterToken(token) : token;
  const glyphs = [...label].map((character) => getSpecialTextGlyph(character, preset.font));
  const rowCount = Math.max(0, ...glyphs.map((glyph) => glyph.length));
  const separator = ' '.repeat(strokeToken.length * Math.max(1, preset.horizontalScale));
  const lines: string[] = [];

  for (let glyphRow = 0; glyphRow < rowCount; glyphRow += 1) {
    const rowParts = glyphs.map((glyph) => renderSpecialTextRow(glyph[glyphRow] ?? '0', strokeToken, preset.horizontalScale));
    const baseRow = rowParts.join(separator).trimEnd();
    for (let verticalScale = 0; verticalScale < preset.verticalScale; verticalScale += 1) {
      lines.push(baseRow);
    }
  }

  const rendered = lines.join('\n');
  if (mode === 'raw') {
    return `${rendered}\n`;
  }
  if (mode === 'block-comment') {
    return `/*\n${rendered}\n*/\n`;
  }
  return `${lines.map((line) => `// ${line}`).join('\n')}\n`;
}

async function promptInput(title: string, prompt: string, value: string): Promise<string | undefined> {
  return vscode.window.showInputBox({ title, prompt, value });
}


export function getBuiltInSnippets(): BuiltInSnippet[] {
  return [
    {
      id: 'cvi-main',
      label: 'CVI main entry point',
      description: 'Initialize and close the CVI Run-Time Engine from main().',
      body: MAIN_TEMPLATE
    },
    {
      id: 'cvi-winmain',
      label: 'CVI WinMain entry point',
      description: 'Windows GUI application entry point with InitCVIRTE().',
      body: WINMAIN_TEMPLATE
    },
    {
      id: 'cvi-rtmain',
      label: 'CVI RTmain entry point',
      description: 'Real-Time loop starter with RTIsShuttingDown().',
      body: RTMAIN_TEMPLATE
    },
    {
      id: 'cvi-dllmain',
      label: 'CVI DllMain lifecycle',
      description: 'Initialize CVIRTE on DLL attach and close it on detach.',
      body: DLL_SOURCE_TEMPLATE.replace('#include "{{headerFile}}"\n', '')
    },
    {
      id: 'cvi-panel-callback',
      label: 'Panel callback',
      description: 'Panel callback skeleton handling EVENT_CLOSE.',
      body: `int CVICALLBACK \${1:panelCB} (int panel, int event, void *callbackData,\n                         int eventData1, int eventData2)\n{\n    (void)panel;\n    (void)callbackData;\n    (void)eventData1;\n    (void)eventData2;\n\n    if (event == EVENT_CLOSE)\n        QuitUserInterface (0);\n\n    return 0;\n}\n`
    },
    {
      id: 'cvi-control-callback',
      label: 'Control callback',
      description: 'Control callback skeleton handling EVENT_COMMIT.',
      body: `int CVICALLBACK \${1:controlCB} (int panel, int control, int event,\n                           void *callbackData, int eventData1, int eventData2)\n{\n    (void)panel;\n    (void)control;\n    (void)callbackData;\n    (void)eventData1;\n    (void)eventData2;\n\n    if (event == EVENT_COMMIT)\n    {\n        \${0:/* handle commit */}\n    }\n\n    return 0;\n}\n`
    },
    {
      id: 'cvi-load-panel-run-ui',
      label: 'Load panel and run UI',
      description: 'Load, display, run and discard a CVI panel.',
      body: `panelHandle = LoadPanel (0, "\${1:interface.uir}", \${2:PANEL});\nif (panelHandle < 0)\n    goto Cleanup;\n\nDisplayPanel (panelHandle);\nRunUserInterface ();\n\nCleanup:\nif (panelHandle > 0)\n    DiscardPanel (panelHandle);\n`
    },
    {
      id: 'cvi-error-check-goto',
      label: 'Error check with cleanup label',
      description: 'Check a negative CVI status and branch to cleanup.',
      body: `status = \${1:CviFunctionCall ()};\nif (status < 0)\n    goto Cleanup;\n`
    },
    {
      id: 'cvi-set-control-attribute',
      label: 'SetCtrlAttribute call',
      description: 'Parameterized control attribute update.',
      body: `SetCtrlAttribute (\${1:panel}, \${2:control}, \${3:ATTR_VISIBLE}, \${4:1});`
    },
    {
      id: 'doc-file-header',
      label: 'File header comment',
      description: 'Program/file header with company block and wrapped changes table.',
      body: renderFileDescriptionHeader({
        company: '${1:Company}',
        address1: '${2:Address 1}',
        address2: '${3:Address 2}',
        tel: '${4:Tel}',
        fax: '${5:Fax}',
        email: '${6:E-mail}',
        date: formatDateDdMmYy(),
        author: '${7:S.NAME}',
        version: '${8:1.0.0}',
        description: '${9:Creation}'
      })
    },
    {
      id: 'doc-comment-section',
      label: 'Boxed comment section',
      description: 'Readable section separator for Parameters, Constants, Types or Functions.',
      body: renderCommentSection('${1:Section}', 'box')
    },
    {
      id: 'doc-change-line',
      label: 'Header change line',
      description: 'Wrapped CHANGES/EVOLUTIONS table entry followed by the separator line.',
      body: renderHeaderChangeEntry('${1:' + formatDateDdMmYy() + '}', '${2:S.NAME}', '${3:1.0.0}', '${4:Description}') + '\n${0}'
    }
  ];
}

export class CviTemplateService {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly installations: CviInstallationService,
    private readonly output: vscode.OutputChannel
  ) {}

  async generateNewFiles(projectDirectory: string): Promise<NewFileGenerationResult | undefined> {
    const userTemplates = this.loadFileTemplates();
    const choices: Array<vscode.QuickPickItem & { value: string }> = [
      { label: 'C source file', description: 'Create an empty source or choose a CVI entry-point template', value: 'c-source' },
      { label: 'C header file', description: 'Create an empty guarded header or use a saved template', value: 'c-header' },
      { label: 'C module (.c + .h)', description: 'Create a paired implementation file and guarded header', value: 'c-module' },
      { label: 'CVI user-interface resource (.uir + .h)', description: 'Create a blank panel resource and its generated-style include file', value: 'uir' },
      { label: 'CVI UI application starter (.c + .uir + .h)', description: 'Create a panel resource and a complete LoadPanel / RunUserInterface baseline', value: 'ui-app' },
      { label: 'CVI DLL starter (.c + .h)', description: 'Create DllMain with the CVIRTE attach / detach lifecycle', value: 'dll' },
      { label: 'CVI error-management module (.c + .h)', description: 'Create a cleaned generic logger and goto-based error-check helpers', value: 'error-module' },
      { label: 'Text file', description: 'Create an empty .txt file', value: 'text' }
    ];
    if (userTemplates.length > 0) {
      choices.push({ label: 'Saved user template...', description: 'Create a file from one of your reusable examples', value: 'user-template' });
    }

    const selected = await vscode.window.showQuickPick(choices, { title: 'Create a new LabWindows/CVI file or starter module' });
    if (!selected) {
      return undefined;
    }

    switch (selected.value) {
      case 'c-source': return this.generateCSource(projectDirectory);
      case 'c-header': return this.generateHeader(projectDirectory);
      case 'c-module': return this.generateModulePair(projectDirectory);
      case 'uir': return this.generateUir(projectDirectory, false);
      case 'ui-app': return this.generateUir(projectDirectory, true);
      case 'dll': return this.generateDll(projectDirectory);
      case 'error-module': return this.generateErrorModule(projectDirectory);
      case 'text': return this.generateSingleTextFile(projectDirectory, '.txt', 'new_file', '', 'Text file');
      case 'user-template': return this.generateUserTemplate(projectDirectory, userTemplates);
      default: return undefined;
    }
  }

  async insertSnippet(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Open a source file before inserting a CVI snippet.');
      return;
    }

    const builtIns = getBuiltInSnippets();
    const userSnippets = this.loadSnippets();
    const items: Array<vscode.QuickPickItem & { body: string }> = [
      ...builtIns.map((snippet) => ({ label: snippet.label, description: snippet.description, detail: 'Built-in CVI snippet', body: snippet.body })),
      ...userSnippets.map((snippet) => ({ label: snippet.label, description: snippet.description || '', detail: 'Saved user snippet', body: snippet.body }))
    ];
    const selected = await vscode.window.showQuickPick(items, {
      title: 'Insert CVI snippet',
      placeHolder: 'Select a reusable code fragment to insert at the current cursor position',
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (!selected) {
      return;
    }
    await editor.insertSnippet(new vscode.SnippetString(selected.body));
  }

  async insertBuiltInSnippet(snippetId: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Open a source file before inserting a CVI snippet.');
      return;
    }
    const snippet = getBuiltInSnippets().find((item) => item.id === snippetId);
    if (!snippet) {
      vscode.window.showErrorMessage(`Built-in CVI snippet not found: ${snippetId}`);
      return;
    }
    await editor.insertSnippet(new vscode.SnippetString(snippet.body));
  }


  async insertFileDescriptionHeader(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Open a C/CVI editor before inserting a file header.');
      return;
    }

    const title = 'CVI: Insert file header';
    const defaultAuthor = sanitizeHeaderText(process.env.USERNAME || process.env.USER || 'S.NAME', 'S.NAME');
    const company = await promptInput(title, 'Company name shown in the header.', 'Company');
    if (company === undefined) return;
    const author = await promptInput(title, 'Author used in the first CHANGES/EVOLUTIONS row.', defaultAuthor);
    if (author === undefined) return;
    const version = await promptInput(title, 'Initial version.', '1.0.0');
    if (version === undefined) return;
    const description = await promptInput(title, 'Initial change description.', 'Creation');
    if (description === undefined) return;

    const header = renderFileDescriptionHeader({
      company: sanitizeHeaderText(company, 'Company'),
      address1: 'Address 1',
      address2: 'Address 2',
      tel: 'Tel',
      fax: 'Fax',
      email: 'E-mail',
      date: formatDateDdMmYy(),
      author: sanitizeHeaderText(author, defaultAuthor),
      version: sanitizeHeaderText(version, '1.0.0'),
      description: sanitizeHeaderText(description, 'Creation')
    });
    await this.insertTextAtSelections(editor, header);
  }

  async insertHeaderChangeEntry(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Open a C/CVI editor before inserting a header change entry.');
      return;
    }

    const title = 'CVI: Insert header change line';
    const defaultAuthor = sanitizeHeaderText(process.env.USERNAME || process.env.USER || 'S.NAME', 'S.NAME');
    const date = await promptInput(title, 'Date displayed in the CHANGES/EVOLUTIONS table.', formatDateDdMmYy());
    if (date === undefined) return;
    const author = await promptInput(title, 'Author initials or name.', defaultAuthor);
    if (author === undefined) return;
    const version = await promptInput(title, 'Version for this change.', '1.0.1');
    if (version === undefined) return;
    const description = await promptInput(title, 'Change description. Long descriptions are wrapped automatically.', 'Description');
    if (description === undefined) return;

    await this.insertTextAtSelections(editor, `${renderHeaderChangeEntry(date, author, version, description)}\n`);
  }

  async insertCommentSection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Open a C/CVI editor before inserting a comment section.');
      return;
    }

    const title = await promptInput('CVI: Insert comment section', 'Section title, for example Parameters, Constants, Types, Static functions.', 'Parameters');
    if (title === undefined) return;
    const style = await vscode.window.showQuickPick([
      { label: 'Boxed C section', description: '/**************** Parameters **********************/', value: 'box' },
      { label: 'CVI line section', description: '//==============================================================================', value: 'line' },
      { label: 'Compact one-line section', description: '/* Parameters */', value: 'compact' }
    ], { title: 'Comment section style' });
    if (!style) return;

    await this.insertTextAtSelections(editor, renderCommentSection(title, style.value));
  }

  async insertSpecialCharacterText(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Open a C/CVI editor before inserting special-character text.');
      return;
    }

    const commandTitle = 'CVI: Insert special-character text';
    const text = await promptInput(commandTitle, 'Text to render as large special-character text.', 'CVI');
    if (text === undefined) return;

    const patternChoice = await vscode.window.showQuickPick([
      { label: '//', description: 'Slash style', value: '//' },
      { label: '\\\\', description: 'Backslash style', value: '\\\\' },
      { label: '||', description: 'Vertical-bar style', value: '||' },
      { label: '**', description: 'Asterisk style', value: '**' },
      { label: '##', description: 'Hash style', value: '##' },
      { label: '==', description: 'Equals style', value: '==' },
      { label: '--', description: 'Dash style', value: '--' },
      { label: '++', description: 'Plus style', value: '++' },
      { label: 'Custom...', description: 'Use another 1 to 8 character pattern', value: 'custom' }
    ], { title: commandTitle, placeHolder: 'Select the fill character pattern' });
    if (!patternChoice) return;

    let pattern = patternChoice.value;
    if (patternChoice.value === 'custom') {
      const customPattern = await promptInput(commandTitle, 'Special-character pattern. 1 to 8 characters, for example //, \\, ||, **.', '//');
      if (customPattern === undefined) return;
      pattern = customPattern;
    }

    const sizeChoice = await vscode.window.showQuickPick(
      SPECIAL_TEXT_SIZE_PRESETS.map((preset) => ({ ...preset, picked: preset.id === 'standard' })),
      { title: commandTitle, placeHolder: 'Select the generated text size' }
    );
    if (!sizeChoice) return;

    const outputMode = await vscode.window.showQuickPick([
      { label: 'CVI line comments', description: 'Prefix every generated row with //', value: 'line-comment' as const },
      { label: 'C block comment', description: 'Wrap generated rows between /* and */', value: 'block-comment' as const },
      { label: 'Raw characters', description: 'Insert only the generated special characters', value: 'raw' as const }
    ], { title: commandTitle, placeHolder: 'Select how to insert the generated text' });
    if (!outputMode) return;

    const rendered = renderSpecialCharacterText(text, pattern, sizeChoice.id, outputMode.value);
    await this.insertTextAtSelections(editor, rendered);
  }

  async saveSelectionAsSnippet(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Open a source file before saving a snippet.');
      return;
    }
    const selectedText = editor.document.getText(editor.selection);
    const body = selectedText || editor.document.getText();
    if (!body.trim()) {
      vscode.window.showErrorMessage('The current selection or document is empty.');
      return;
    }
    const label = await vscode.window.showInputBox({
      title: 'Save CVI snippet',
      prompt: 'Name displayed in the snippet picker',
      validateInput: validateRequiredName
    });
    if (!label) {
      return;
    }
    const description = await vscode.window.showInputBox({
      title: 'Save CVI snippet',
      prompt: 'Optional description',
      value: ''
    });
    if (description === undefined) {
      return;
    }
    const snippets = this.loadSnippets();
    snippets.push({ id: `${sanitizeId(label)}-${Date.now()}`, label, description, body });
    this.saveSnippets(snippets);
    vscode.window.showInformationMessage(`Saved CVI snippet: ${label}`);
  }

  async manageSnippets(): Promise<void> {
    const snippets = this.loadSnippets();
    const selected = await vscode.window.showQuickPick([
      { label: 'Save current selection as snippet...', value: 'save' },
      { label: 'Import snippet from text file...', value: 'import' },
      { label: 'Delete a saved snippet...', value: 'delete', description: `${snippets.length} saved snippet(s)` },
      { label: 'Open saved snippets JSON', value: 'open' }
    ], { title: 'Manage CVI snippets' });
    if (!selected) {
      return;
    }
    if (selected.value === 'save') {
      await this.saveSelectionAsSnippet();
      return;
    }
    if (selected.value === 'import') {
      const files = await vscode.window.showOpenDialog({ title: 'Import a snippet text file', canSelectFiles: true, canSelectFolders: false, canSelectMany: false });
      if (!files?.[0]) {
        return;
      }
      await this.saveTextAsSnippet(path.basename(files[0].fsPath, path.extname(files[0].fsPath)), fs.readFileSync(files[0].fsPath, 'utf8'));
      return;
    }
    if (selected.value === 'delete') {
      const item = await vscode.window.showQuickPick(snippets.map((snippet) => ({ label: snippet.label, description: snippet.description, snippet })), { title: 'Delete a saved CVI snippet' });
      if (!item) {
        return;
      }
      this.saveSnippets(snippets.filter((snippet) => snippet.id !== item.snippet.id));
      vscode.window.showInformationMessage(`Deleted CVI snippet: ${item.snippet.label}`);
      return;
    }
    await this.openJsonStore(this.getSnippetStorePath(), { version: 1, items: snippets });
  }

  async saveCurrentFileAsTemplate(filePath?: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const resolvedPath = filePath || editor?.document.uri.fsPath;
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      vscode.window.showErrorMessage('Open or select a text file before saving a creation template.');
      return;
    }
    const activeContents = editor && path.normalize(editor.document.uri.fsPath) === path.normalize(resolvedPath)
      ? editor.document.getText()
      : undefined;
    await this.saveTemplateFromPath(resolvedPath, activeContents);
  }

  async importFileTemplate(): Promise<void> {
    const files = await vscode.window.showOpenDialog({ title: 'Import a reusable file template', canSelectFiles: true, canSelectFolders: false, canSelectMany: false });
    if (!files?.[0]) {
      return;
    }
    await this.saveTemplateFromPath(files[0].fsPath);
  }

  async manageFileTemplates(): Promise<void> {
    const templates = this.loadFileTemplates();
    const selected = await vscode.window.showQuickPick([
      { label: 'Save current file as template...', value: 'save' },
      { label: 'Import template from file...', value: 'import' },
      { label: 'Delete a saved template...', value: 'delete', description: `${templates.length} saved template(s)` },
      { label: 'Open saved templates JSON', value: 'open' }
    ], { title: 'Manage CVI creation templates' });
    if (!selected) {
      return;
    }
    if (selected.value === 'save') {
      await this.saveCurrentFileAsTemplate();
      return;
    }
    if (selected.value === 'import') {
      await this.importFileTemplate();
      return;
    }
    if (selected.value === 'delete') {
      const item = await vscode.window.showQuickPick(templates.map((template) => ({ label: template.label, description: `${template.extension} · ${template.description || ''}`, template })), { title: 'Delete a saved creation template' });
      if (!item) {
        return;
      }
      this.saveFileTemplates(templates.filter((template) => template.id !== item.template.id));
      vscode.window.showInformationMessage(`Deleted creation template: ${item.template.label}`);
      return;
    }
    await this.openJsonStore(this.getFileTemplateStorePath(), { version: 1, items: templates });
  }


  private async insertTextAtSelections(editor: vscode.TextEditor, text: string): Promise<void> {
    const selections = editor.selections.length > 0 ? editor.selections : [editor.selection];
    await editor.edit((edit) => {
      for (const selection of selections) {
        if (selection.isEmpty) {
          edit.insert(selection.active, text);
        } else {
          edit.replace(selection, text);
        }
      }
    });
  }

  private async generateCSource(projectDirectory: string): Promise<NewFileGenerationResult | undefined> {
    const choice = await vscode.window.showQuickPick([
      { label: 'Empty C source', value: 'empty', description: 'Create a blank .c file' },
      { label: 'main()', value: 'main', description: 'CVI Run-Time Engine lifecycle for a standard executable' },
      { label: 'WinMain()', value: 'winmain', description: 'Windows GUI executable entry point' },
      { label: 'RTmain()', value: 'rtmain', description: 'LabWindows/CVI Real-Time entry point' }
    ], { title: 'Select a C source template' });
    if (!choice) {
      return undefined;
    }
    const content = choice.value === 'main' ? MAIN_TEMPLATE : choice.value === 'winmain' ? WINMAIN_TEMPLATE : choice.value === 'rtmain' ? RTMAIN_TEMPLATE : '';
    const suggested = choice.value === 'main' ? 'main' : choice.value === 'winmain' ? 'winmain' : choice.value === 'rtmain' ? 'rtmain' : 'new_file';
    return this.generateSingleTextFile(projectDirectory, '.c', suggested, content, 'C source file');
  }

  private async generateHeader(projectDirectory: string): Promise<NewFileGenerationResult | undefined> {
    const target = await this.askTargetPath(projectDirectory, '.h', 'new_header', 'C header file');
    if (!target) {
      return undefined;
    }
    const variables = this.createVariables(target, target, undefined);
    return this.writeFiles([{ absolutePath: target, contents: toCrlf(renderTemplateText(GUARDED_HEADER_TEMPLATE, variables)) }], target);
  }

  private async generateModulePair(projectDirectory: string): Promise<NewFileGenerationResult | undefined> {
    const sourcePath = await this.askTargetPath(projectDirectory, '.c', 'new_module', 'C module implementation');
    if (!sourcePath) {
      return undefined;
    }
    const base = sourcePath.slice(0, -path.extname(sourcePath).length);
    const headerPath = `${base}.h`;
    const variables = this.createVariables(sourcePath, headerPath, undefined);
    return this.writeFiles([
      { absolutePath: sourcePath, contents: toCrlf(renderTemplateText(MODULE_SOURCE_TEMPLATE, variables)) },
      { absolutePath: headerPath, contents: toCrlf(renderTemplateText(GUARDED_HEADER_TEMPLATE, variables)) }
    ], sourcePath);
  }

  private async generateUir(projectDirectory: string, includeApplicationSource: boolean): Promise<NewFileGenerationResult | undefined> {
    const uirPath = await this.askTargetPath(projectDirectory, '.uir', includeApplicationSource ? 'interface' : 'new_panel', 'CVI user-interface resource');
    if (!uirPath) {
      return undefined;
    }
    const base = uirPath.slice(0, -path.extname(uirPath).length);
    const headerPath = `${base}.h`;
    const sourcePath = `${base}.c`;
    const variables = this.createVariables(sourcePath, headerPath, uirPath);
    const binary = this.readBundledUirTemplate();
    const files: PendingFile[] = [
      { absolutePath: uirPath, contents: binary, binary: true },
      { absolutePath: headerPath, contents: toCrlf(buildBlankUirHeader()) }
    ];
    if (includeApplicationSource) {
      files.unshift({ absolutePath: sourcePath, contents: toCrlf(renderTemplateText(UI_APP_SOURCE_TEMPLATE, variables)) });
    }
    return this.writeFiles(files, includeApplicationSource ? sourcePath : headerPath, uirPath);
  }

  private async generateDll(projectDirectory: string): Promise<NewFileGenerationResult | undefined> {
    const sourcePath = await this.askTargetPath(projectDirectory, '.c', 'my_dll', 'CVI DLL source file');
    if (!sourcePath) {
      return undefined;
    }
    const base = sourcePath.slice(0, -path.extname(sourcePath).length);
    const headerPath = `${base}.h`;
    const variables = this.createVariables(sourcePath, headerPath, undefined);
    return this.writeFiles([
      { absolutePath: sourcePath, contents: toCrlf(renderTemplateText(DLL_SOURCE_TEMPLATE, variables)) },
      { absolutePath: headerPath, contents: toCrlf(renderTemplateText(DLL_HEADER_TEMPLATE, variables)) }
    ], sourcePath);
  }

  private async generateErrorModule(projectDirectory: string): Promise<NewFileGenerationResult | undefined> {
    const sourcePath = await this.askTargetPath(projectDirectory, '.c', 'cvi_error', 'CVI error-management source file');
    if (!sourcePath) {
      return undefined;
    }
    const base = sourcePath.slice(0, -path.extname(sourcePath).length);
    const headerPath = `${base}.h`;
    const variables = this.createVariables(sourcePath, headerPath, undefined);
    return this.writeFiles([
      { absolutePath: sourcePath, contents: toCrlf(renderTemplateText(ERROR_SOURCE_TEMPLATE, variables)) },
      { absolutePath: headerPath, contents: toCrlf(renderTemplateText(ERROR_HEADER_TEMPLATE, variables)) }
    ], sourcePath);
  }

  private async generateSingleTextFile(projectDirectory: string, extension: string, suggestedBaseName: string, template: string, title: string): Promise<NewFileGenerationResult | undefined> {
    const target = await this.askTargetPath(projectDirectory, extension, suggestedBaseName, title);
    if (!target) {
      return undefined;
    }
    const variables = this.createVariables(target, target, undefined);
    return this.writeFiles([{ absolutePath: target, contents: toCrlf(renderTemplateText(template, variables)) }], target);
  }

  private async generateUserTemplate(projectDirectory: string, templates: StoredFileTemplate[]): Promise<NewFileGenerationResult | undefined> {
    const selected = await vscode.window.showQuickPick(templates.map((template) => ({
      label: template.label,
      description: `${template.extension} · ${template.description || ''}`,
      template
    })), { title: 'Select a saved creation template' });
    if (!selected) {
      return undefined;
    }
    const target = await this.askTargetPath(projectDirectory, selected.template.extension, `new_${sanitizeId(selected.template.label).replace(/-/g, '_')}`, selected.template.label);
    if (!target) {
      return undefined;
    }
    const variables = this.createVariables(target, target, undefined);
    return this.writeFiles([{ absolutePath: target, contents: toCrlf(renderTemplateText(selected.template.content, variables)) }], target);
  }

  private async askTargetPath(projectDirectory: string, extension: string, suggestedBaseName: string, title: string): Promise<string | undefined> {
    const normalizedExtension = normalizeExtension(extension);
    const uri = await vscode.window.showSaveDialog({
      title: `Create ${title}`,
      defaultUri: vscode.Uri.file(path.join(projectDirectory, `${suggestedBaseName}${normalizedExtension}`)),
      filters: { [title]: [normalizedExtension.slice(1)] }
    });
    if (!uri) {
      return undefined;
    }
    return path.extname(uri.fsPath) ? uri.fsPath : `${uri.fsPath}${normalizedExtension}`;
  }

  private async writeFiles(files: PendingFile[], primaryPath?: string, uirPath?: string): Promise<NewFileGenerationResult | undefined> {
    const existing = files.filter((file) => fs.existsSync(file.absolutePath));
    let overwrite = false;
    if (existing.length > 0) {
      const names = existing.map((file) => path.basename(file.absolutePath)).join(', ');
      const action = await vscode.window.showWarningMessage(
        `${names} already exist. Choose whether to preserve them or overwrite them with the selected CVI template.`,
        { modal: true },
        'Keep existing and add references',
        'Overwrite generated files'
      );
      if (!action) {
        return undefined;
      }
      overwrite = action === 'Overwrite generated files';
    }

    const createdFiles: string[] = [];
    for (const file of files) {
      if (fs.existsSync(file.absolutePath) && !overwrite) {
        continue;
      }
      fs.mkdirSync(path.dirname(file.absolutePath), { recursive: true });
      if (file.binary) {
        fs.writeFileSync(file.absolutePath, file.contents);
      } else {
        writeCviTextFile(file.absolutePath, String(file.contents));
      }
      createdFiles.push(file.absolutePath);
      this.output.appendLine(`[CVI Templates] Wrote ${file.absolutePath}`);
    }
    return { files: files.map((file) => file.absolutePath), createdFiles, primaryPath, uirPath };
  }

  private readBundledUirTemplate(): Buffer {
    const preference = vscode.workspace.getConfiguration('labwindowsCvi').get<string>('uirTemplateVersion', 'auto');
    const installation = this.installations.getActiveInstallation();
    const version = resolveUirTemplateVersion(preference, installation?.root);
    const filePath = path.join(this.context.extensionPath, 'data', 'templates', `blank-${version}.uir`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Bundled ${version} UIR template not found: ${filePath}`);
    }
    this.output.appendLine(`[CVI Templates] Using ${version} blank UIR template.`);
    return fs.readFileSync(filePath);
  }

  private createVariables(filePath: string, headerPath: string, uirPath?: string): TemplateVariables {
    const baseName = path.basename(filePath, path.extname(filePath));
    const now = new Date();
    return {
      baseName,
      fileName: path.basename(filePath),
      headerFile: path.basename(headerPath),
      guard: headerGuardForPath(headerPath),
      prefix: sanitizePrefix(baseName),
      uirFile: path.basename(uirPath || `${baseName}.uir`),
      date: now.toISOString().slice(0, 10),
      year: String(now.getFullYear())
    };
  }

  private getStorageDirectory(): string {
    const directory = path.join(this.context.globalStorageUri.fsPath, 'templates');
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  private getFileTemplateStorePath(): string {
    return path.join(this.getStorageDirectory(), FILE_TEMPLATE_STORE);
  }

  private getSnippetStorePath(): string {
    return path.join(this.getStorageDirectory(), SNIPPET_STORE);
  }

  private loadFileTemplates(): StoredFileTemplate[] {
    return this.readCollection<StoredFileTemplate>(this.getFileTemplateStorePath());
  }

  private saveFileTemplates(items: StoredFileTemplate[]): void {
    this.writeCollection(this.getFileTemplateStorePath(), items);
  }

  private loadSnippets(): StoredSnippet[] {
    return this.readCollection<StoredSnippet>(this.getSnippetStorePath());
  }

  private saveSnippets(items: StoredSnippet[]): void {
    this.writeCollection(this.getSnippetStorePath(), items);
  }

  private readCollection<T>(filePath: string): T[] {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as StoredCollection<T> | T[];
      return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
    } catch (error) {
      this.output.appendLine(`[CVI Templates] Cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private writeCollection<T>(filePath: string, items: T[]): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify({ version: 1, items }, null, 2)}\n`, 'utf8');
  }

  private async saveTemplateFromPath(filePath: string, suppliedContents?: string): Promise<void> {
    const extension = normalizeExtension(path.extname(filePath));
    if (!TEXT_TEMPLATE_EXTENSIONS.has(extension)) {
      vscode.window.showErrorMessage(`The ${extension} file type is not handled as a text creation template.`);
      return;
    }
    const label = await vscode.window.showInputBox({
      title: 'Save creation template',
      prompt: 'Name displayed when creating a new CVI file',
      value: path.basename(filePath),
      validateInput: validateRequiredName
    });
    if (!label) {
      return;
    }
    const description = await vscode.window.showInputBox({ title: 'Save creation template', prompt: 'Optional description', value: '' });
    if (description === undefined) {
      return;
    }
    const templates = this.loadFileTemplates();
    templates.push({ id: `${sanitizeId(label)}-${Date.now()}`, label, description, extension, content: suppliedContents ?? fs.readFileSync(filePath, 'utf8') });
    this.saveFileTemplates(templates);
    vscode.window.showInformationMessage(`Saved creation template: ${label}`);
  }

  private async saveTextAsSnippet(defaultLabel: string, body: string): Promise<void> {
    const label = await vscode.window.showInputBox({ title: 'Import CVI snippet', prompt: 'Name displayed in the snippet picker', value: defaultLabel, validateInput: validateRequiredName });
    if (!label) {
      return;
    }
    const snippets = this.loadSnippets();
    snippets.push({ id: `${sanitizeId(label)}-${Date.now()}`, label, body });
    this.saveSnippets(snippets);
    vscode.window.showInformationMessage(`Imported CVI snippet: ${label}`);
  }

  private async openJsonStore<T>(filePath: string, initial: StoredCollection<T>): Promise<void> {
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `${JSON.stringify(initial, null, 2)}\n`, 'utf8');
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(document, { preview: false });
  }
}

function validateRequiredName(value: string): string | undefined {
  return value.trim() ? undefined : 'A name is required.';
}
