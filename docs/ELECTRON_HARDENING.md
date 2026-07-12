# Hardening do Electron

A janela desktop usa sandbox e isolamento de contexto, sem Node.js ou `webview` no renderer. Navegação e abertura de janelas são bloqueadas fora das origens locais exatas `http://localhost:3001` e `http://127.0.0.1:3001`; permissões Electron são negadas por padrão.

Todos os handlers IPC passam por validação de `mainWindow`, main frame e origem confiável. Payloads de opções têm limites de tamanho/tipo; URLs externas aceitam apenas HTTPS sem credenciais. O preload expõe somente métodos nomeados, nunca `ipcRenderer`.

Verificação determinística:

```bash
npm run smoke:electron-hardening
npm run electron:compile
npx tsc --noEmit
```
