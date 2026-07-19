"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    openExternal: (url) => electron_1.ipcRenderer.invoke('open-external', url),
    getAppVersion: () => electron_1.ipcRenderer.invoke('get-app-version'),
    getMcpStatus: () => electron_1.ipcRenderer.invoke('mcp-status'),
    startMcpPilot: () => electron_1.ipcRenderer.invoke('mcp-start'),
    stopMcpPilot: () => electron_1.ipcRenderer.invoke('mcp-stop'),
    getMlStatus: () => electron_1.ipcRenderer.invoke('ml-status'),
    startMlEngine: () => electron_1.ipcRenderer.invoke('ml-start'),
    stopMlEngine: () => electron_1.ipcRenderer.invoke('ml-stop'),
    saveOptionsScan: (data) => electron_1.ipcRenderer.invoke('save-options-scan', data),
    getLastOptionsScan: (asset) => electron_1.ipcRenderer.invoke('get-last-options-scan', asset),
    getOptionsHistory: (limit) => electron_1.ipcRenderer.invoke('get-options-history', limit),
});
//# sourceMappingURL=preload.js.map