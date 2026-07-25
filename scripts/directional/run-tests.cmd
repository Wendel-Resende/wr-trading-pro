@echo off
set "PATH=C:\Users\rwres\AppData\Local\Programs\Python\Python313;C:\Users\rwres\AppData\Local\Programs\Python\Python313\Scripts;%PATH%"
node node_modules/tsx/dist/cli.mjs scripts/directional/directional-test.ts
exit /b %ERRORLEVEL%
