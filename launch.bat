@echo off
title WR Trading Pro
cd /d "C:\WR\wr_trade_pro_"
echo Iniciando WR Trading Pro...
echo.
echo Electron: %cd%
echo Node: 
where node
echo.
echo Verificando build Next.js...
if not exist ".next\BUILD_ID" (
    echo ERRO: Build Next.js nao encontrado. Execute 'npm run build' primeiro.
    pause
    exit /b 1
)
echo Build OK.
echo Verificando Electron dist...
if not exist "electron\dist\main.js" (
    echo ERRO: electron/dist/main.js nao encontrado.
    pause
    exit /b 1
)
echo Electron OK.
echo.
echo Iniciando Electron...
call npx electron . 2> "%TEMP%\wr_electron_err.log"
if %ERRORLEVEL% NEQ 0 (
    echo ERRO: Electron falhou (codigo %ERRORLEVEL%).
    echo Log de erro em %TEMP%\wr_electron_err.log:
    type "%TEMP%\wr_electron_err.log"
    pause
) else (
    echo Electron encerrado normalmente.
)
