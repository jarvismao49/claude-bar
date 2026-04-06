const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  saveToken: (data) => ipcRenderer.invoke('save-token', data),
  getToken: () => ipcRenderer.invoke('get-token')
});
