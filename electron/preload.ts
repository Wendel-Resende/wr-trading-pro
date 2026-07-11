import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  saveOptionsScan: (data: any) => ipcRenderer.invoke('save-options-scan', data),
  getLastOptionsScan: (asset: string) => ipcRenderer.invoke('get-last-options-scan', asset),
  getOptionsHistory: (limit?: number) => ipcRenderer.invoke('get-options-history', limit),
});
