import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url: unknown): Promise<void> => ipcRenderer.invoke('open-external', url),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  getMcpStatus: (): Promise<unknown> => ipcRenderer.invoke('mcp-status'),
  startMcpPilot: (): Promise<unknown> => ipcRenderer.invoke('mcp-start'),
  stopMcpPilot: (): Promise<unknown> => ipcRenderer.invoke('mcp-stop'),
  saveOptionsScan: (data: unknown): Promise<unknown> => ipcRenderer.invoke('save-options-scan', data),
  getLastOptionsScan: (asset: unknown): Promise<unknown> => ipcRenderer.invoke('get-last-options-scan', asset),
  getOptionsHistory: (limit?: unknown): Promise<unknown> => ipcRenderer.invoke('get-options-history', limit),
});
