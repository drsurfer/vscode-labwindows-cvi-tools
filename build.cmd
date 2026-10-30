@echo off
setlocal EnableDelayedExpansion

set EXTENSION_VSIX=labwindows-cvi-tools-0.0.0.vsix

echo ========================================================
echo   LabWindows/CVI Tools - Build, Package e Install
echo ========================================================
echo.
echo Directory di lavoro corrente: %CD%
echo.

:: Controllo di sicurezza: verifica che ci troviamo nella cartella del progetto
if not exist "package.json" (
    echo [ERRORE] package.json non trovato in %CD%.
    echo Assicurati di lanciare lo script posizionandoti dentro la cartella del progetto:
    echo cd percorso\del\progetto
    echo build.cmd
    goto :error
)

:: -----------------------------------------------------------
:: STEP 1: COMPILAZIONE E PACKAGING (gestito da vsce)
:: -----------------------------------------------------------
echo [STEP 1/2] Compilazione TypeScript e creazione pacchetto VSIX (%EXTENSION_VSIX%)...

call npx vsce package
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERRORE] Creazione pacchetto VSIX fallita. Operazione interrotta.
    goto :error
)
 
if not exist "%EXTENSION_VSIX%" (
    echo.
    echo [ERRORE] File %EXTENSION_VSIX% non trovato dopo il packaging.
    goto :error
)
echo [OK] Pacchetto %EXTENSION_VSIX% generato con successo.
echo.

:: -----------------------------------------------------------
:: STEP 2: INSTALLAZIONE IN VS CODE
:: -----------------------------------------------------------
echo [STEP 2/2] Installazione dell'estensione in VS Code...
pause

call code --install-extension "%EXTENSION_VSIX%" --force
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERRORE] Installazione in VS Code fallita.
    goto :error
)
echo [OK] Estensione installata correttamente in VS Code!
echo.
echo ========================================================
echo Processo completato con successo.
echo Ricarica la finestra in VS Code (Ctrl+Shift+P - Developer: Reload Window).
echo ========================================================
exit /b 0

:error
echo.
echo ========================================================
echo Si e' verificato un errore durante la procedura.
echo ========================================================
pause
exit /b 1
