@echo off
setlocal EnableDelayedExpansion

:: Ensure working directory is the script directory
cd /d "%~dp0"

:: Suppress Node internal deprecation warnings (e.g. url.parse in VS Code CLI/Node 22+)
set "NODE_OPTIONS=--no-deprecation"

echo ========================================================
echo   LabWindows/CVI Tools - Build, Package and Install
echo ========================================================
echo.
echo Working directory: %CD%
echo.

:: Safety check: ensure package.json exists in current folder
if not exist "package.json" (
    echo [ERROR] package.json not found in %CD%.
    echo Please run this script from the project root directory.
    goto :error
)

:: Extract package name and version dynamically from package.json
for /f "delims=" %%i in ('node -p "require('./package.json').version" 2^>nul') do set "VERSION=%%i"
for /f "delims=" %%i in ('node -p "require('./package.json').name" 2^>nul') do set "PACKAGE_NAME=%%i"

if "%VERSION%"=="" (
    echo [ERROR] Unable to extract version from package.json.
    goto :error
)
if "%PACKAGE_NAME%"=="" (
    echo [ERROR] Unable to extract package name from package.json.
    goto :error
)

set "EXTENSION_VSIX=%PACKAGE_NAME%-%VERSION%.vsix"
echo Target package: %EXTENSION_VSIX% (Version: %VERSION%)
echo.

:: -----------------------------------------------------------
:: STEP 1: COMPILATION AND PACKAGING (managed by vsce)
:: -----------------------------------------------------------
echo [STEP 1/2] Compiling TypeScript and creating VSIX package (%EXTENSION_VSIX%)...

call npx vsce package --no-git-tag-version
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] VSIX packaging failed with exit code %ERRORLEVEL%. Aborting.
    goto :error
)

if not exist "%EXTENSION_VSIX%" (
    echo.
    echo [ERROR] Expected package file %EXTENSION_VSIX% was not found after packaging.
    goto :error
)
echo [OK] Package %EXTENSION_VSIX% generated successfully.
echo.

:: -----------------------------------------------------------
:: STEP 2: INSTALLATION IN VS CODE
:: -----------------------------------------------------------
echo [STEP 2/2] Installing extension in VS Code...

call code --install-extension "%EXTENSION_VSIX%" --force
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Installation into VS Code failed with exit code %ERRORLEVEL%.
    goto :error
)
echo [OK] Extension installed successfully in VS Code!
echo.
echo ========================================================
echo Build and installation completed successfully.
echo Reload window in VS Code (Ctrl+Shift+P -^> Developer: Reload Window).
echo ========================================================
exit /b 0

:error
echo.
echo ========================================================
echo An error occurred during the build/install process.
echo ========================================================
exit /b 1
