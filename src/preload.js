const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  getData: () => ipcRenderer.invoke('get-data'),
  getLocalCosts: () => ipcRenderer.invoke('get-local-costs'),
  rescanLocalCosts: () => ipcRenderer.invoke('rescan-local-costs'),
  getHistory: () => ipcRenderer.invoke('get-history')
});
