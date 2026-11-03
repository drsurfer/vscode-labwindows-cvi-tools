# LabWindows/CVI Tools - Project Status & Knowledge Base

Questo documento funge da memoria storica permanente e punto di raccordo dello stato del progetto per le sessioni di sviluppo con Antigravity / AI.

---

## 1. Identità e Scopo del Progetto

* **Nome Estensione**: LabWindows/CVI Tools (`labwindows-cvi-tools`)
* **ID Publisher**: `drsurfer`
* **Repository GitHub**: [vscode-labwindows-cvi-tools](https://github.com/drsurfer/vscode-labwindows-cvi-tools)
* **Obiettivo**: Offrire una suite completa e moderna per Visual Studio Code che consenta di gestire, compilare e sottoporre a debug progetti e workspace **National Instruments LabWindows™/CVI™** (ANSI C), ponendosi come un'alternativa produttiva e leggera all'IDE CVI nativo.
* **Ispirazione & Riconoscimenti**: Il progetto nasce dal lavoro pionieristico di **Jerry Crozet** (*JC Tools* / *JC Lib*), evoluto e rifattorizzato come progetto open source assistito da strumenti avanzati di AI engineering.

---

## 2. Architettura Tecnica

1. **Workspace & Project Management**:
   - Parser e serializzatore nativo per workspace `.cws` e progetti `.prj`.
   - Struttura logica ad albero CVI (cartelle virtuali, file inclusi/esclusi, target attivi).
   - Rilevamento automatico delle installazioni di LabWindows/CVI nel sistema Windows o configurazione manuale percorso toolchain.

2. **Dialoghi di Configurazione (Webview)**:
   - **Target Settings** (`labwindowsCvi.editTargetSettings`): Configurazione tipo target (EXE, DLL, Lib), convenzioni di chiamata, thread locking, estensioni runtime.
   - **Build Options** (`labwindowsCvi.editBuildOptions`): Gestione opzioni compilatore multi-configurazione (Debug, Release, x86, x64), stack size, base addresses, C99, OpenMP, header precompilati, macro define.
   - **Catalogo Warning Clang 3.3**: Gestione interattiva di tutti i 139 warning del compilatore CVI (`compile.exe`), con filtri di ricerca, attivazione/disattivazione e promozione a errore (`-Werror`).
   - Sincronizzazione automatica con `.vscode/c_cpp_properties.json` per IntelliSense C/C++.

3. **Build Pipeline & Diagnostica**:
   - Compilazione ed esecuzione diretta tramite `compile.exe`.
   - Supporto passi di pre-build, post-build e custom build steps.
   - Parsing in tempo reale degli errori e warning del compilatore con emissione nella view *Problems* di VS Code.

4. **Debugging Nativo**:
   - Architettura basata su **Native GDB Pipeline** con generazione simboli DWARF 4 (`NATIVE_DEBUGGING.md`).
   - Provider di configurazione debug nativo `cvi` con supporto per F5 (Run & Debug).
   - Dismissione completa del vecchio ponte legacy DDE/ActiveX per un'esperienza unificata e fluida direttamente dentro VS Code.

5. **Tool & Utility di Supporto**:
   - CVI API & Library Explorer con supporto parsing header `.h` e reverse generation.
   - Snippet di codice dedicati ad ANSI C e intestazioni funzioni Doxygen-ready.
   - Color picker CVI per `MakeColor(r, g, b)`, hex, RGB e codici web.
   - Convertitore di basi numeriche (decimale, esadecimale, binario).

---

## 3. Cronistoria delle Versioni e Decisioni Architetturali

### Baseline (v0.0.0 - 2026-10-30)
* Separazione del codice in un repository standalone dedicato esclusivamente a LabWindows/CVI e ANSI C.
* Rimozione di linguaggi terzi, template obsoleti (`my_util`), mock runner e script di test non pertinenti.
* Implementazione iniziale dell'albero `.cws` / `.prj`, integrazione di `compile.exe` e debugging DAP.

### v0.0.1 (2026-11-02)
* **Dismissione DDE / ActiveX**: Rimossi definitivamente i file script e i bridge di comando legacy (`cvi-dde-command.ps1`, `cvi-activex-command.ps1`, `cviNativeCommandService.ts`, `cviBreakpointSyncService.ts`) e la view laterale CVI Debug, a favore del debug nativo VS Code/GDB.
* **Documentazione Debug Nativo**: Redatto `NATIVE_DEBUGGING.md` che descrive l'intera pipeline DWARF 4 e risoluzione sezioni PE/COFF.
* **Branding & UI Refresh**: Create nuove icone SVG dedicate (`media/cvi-tools.svg`, `media/cvi-tools-hero.svg`) e ridisegnata la Home Page (rimozione bordi/ombre rigide, scaling 74x74 px, link repository).
* **Script di Build**: Modernizzato `build.cmd` in lingua inglese, con stop immediato su errore e risoluzione automatica versione da `package.json`.

### v0.0.2 (2026-11-02 / 2026-11-03)
* **Dialogo Nativo Build Options**: Aggiunta Webview per la configurazione granulare del compilatore per tutte le configurazioni CVI.
* **Catalogo 139 Warning Clang 3.3**: Riconciliazione totale con le definizioni interne del compilatore NI `compile.exe`, con serializzazione rigorosa in `.prj`.
* **Riallineamento Nomenclatura**: Distinzione chiara tra *Target Settings* e *Build Options*, mantenendo alias retrocompatibili per i comandi.
* **Aggiornamento Dipendenze**: Upgrade `@vscode/vsce` a 4.1.0 e soppressione warning di deprecazione CLI.
* **Introduzione & Riconoscimenti nel README**: Aggiunto cappello introduttivo che descrive le origini del progetto, i riconoscimenti a Jerry Crozet e il supporto dei tool di AI engineering.
* **Release & Tag GitHub**: Tag ufficiale `v0.0.2` pushato su `origin/main`.

---

## 4. Linee Guida per le Prossime Sessioni

Quando riparti con una nuova sessione di chat in Antigravity:
1. Non è necessario caricare le vecchie chat: **questo documento contiene tutto il contesto essenziale**.
2. Per compilare o testare l'estensione localmente:
   - Compilazione TypeScript: `npm run compile`
   - Packaging VSIX: `build.cmd` o `npx vsce package`
3. Riferimento per il debugging: consulta [NATIVE_DEBUGGING.md](../NATIVE_DEBUGGING.md).
