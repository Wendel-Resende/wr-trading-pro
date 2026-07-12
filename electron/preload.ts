import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url: unknown): Promise<void> => ipcRenderer.invoke('open-external', url),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  saveOptionsScan: (data: unknown): Promise<unknown> => ipcRenderer.invoke('save-options-scan', data),
  getLastOptionsScan: (asset: unknown): Promise<unknown> => ipcRenderer.invoke('get-last-options-scan', asset),
  getOptionsHistory: (limit?: unknown): Promise<unknown> => ipcRenderer.invoke('get-options-history', limit),
});
