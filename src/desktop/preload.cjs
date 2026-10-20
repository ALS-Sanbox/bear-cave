const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bearCaveLocal', Object.freeze({
  read: () => ipcRenderer.invoke('local:read'),
  save: (settings, password) => ipcRenderer.invoke('local:save', { settings, password }),
  pickFolder: () => ipcRenderer.invoke('local:folder')
}));
