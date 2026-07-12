import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../../electron/preload.ts', import.meta.url), 'utf8');
const optionsService = readFileSync(new URL('../../src/services/optionsService.ts', import.meta.url), 'utf8');
const compiledMain = readFileSync(new URL('../../electron/dist/main.js', import.meta.url), 'utf8');
const compiledPreload = readFileSync(new URL('../../electron/dist/preload.js', import.meta.url), 'utf8');

for (const invariant of [
  'sandbox: true', 'contextIsolation: true', 'nodeIntegration: false',
  'webSecurity: true', 'allowRunningInsecureContent: false', 'webviewTag: false',
  'navigateOnDragDrop: false', "setWindowOpenHandler(() => ({ action: 'deny' }))",
  "on('will-attach-webview'", 'setPermissionRequestHandler', 'setPermissionCheckHandler',
  'event.senderFrame === mainWindow.webContents.mainFrame', 'isTrustedRendererUrl(event.senderFrame.url)',
]) assert.ok(main.includes(invariant), `invariante ausente: ${invariant}`);

assert.match(main, /TRUSTED_ORIGINS[\s\S]*http:\/\/localhost:[^\n]*PORT[\s\S]*http:\/\/127\.0\.0\.1:/);
assert.ok(main.includes('event.sender === mainWindow.webContents'));
assert.match(main, /will-navigate[\s\S]*isTrustedRendererUrl\(navigationUrl\)[\s\S]*preventDefault/);
assert.match(main, /url\.protocol !== 'https:' \|\| url\.username \|\| url\.password/);
assert.ok(main.includes('MAX_EXTERNAL_URL_LENGTH'));
assert.ok(main.includes('MAX_OPTIONS_PER_SIDE = 500'));
assert.ok(main.includes('MIN_OPTIONS_SAVE_INTERVAL_MS'));
assert.ok(main.includes('isNumberInRange'));
assert.ok(main.includes('hasOnlyKeys'));
assert.ok(main.includes('db.transaction('));
assert.match(main, /function ensureOptionsDB[\s\S]*catch \(error\)[\s\S]*db\.close\(\)[\s\S]*throw error/);
assert.equal((main.match(/ipcMain\.handle\(/g) ?? []).length, 1, 'handlers devem passar pelo wrapper confiável');
assert.doesNotMatch(main + preload, /get-user-data-path|getUserDataPath/);
assert.doesNotMatch(preload, /\bany\b|exposeInMainWorld\([^]*ipcRenderer\s*[,}]/);

for (const invariant of ['sandbox: true', 'nodeIntegration: false', 'setPermissionRequestHandler', 'MAX_OPTIONS_PER_SIDE = 500', '.transaction(']) {
  assert.ok(compiledMain.includes(invariant), `dist/main.js desatualizado: ${invariant}`);
}
assert.doesNotMatch(compiledPreload, /getUserDataPath|get-user-data-path/);
assert.ok(optionsService.includes('calls: calls.map(toIpcOption)'));
assert.ok(optionsService.includes('puts: puts.map(toIpcOption)'));
assert.doesNotMatch(optionsService, /calls\.map\(\([^)]*\) => \(\{ \.\.\./);

console.log('Electron hardening smoke test: OK');
