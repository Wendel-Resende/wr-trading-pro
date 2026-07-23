@echo off
set "PATH=C:\Users\rwres\AppData\Local\Programs\Python\Python313;C:\Users\rwres\AppData\Local\Programs\Python\Python313\Scripts;%PATH%"
echo PATH test: python --version
python --version
node node_modules/tsx/dist/cli.mjs scripts/ml-training-run/ml-training-run-test.ts
exit /b %ERRORLEVEL%
