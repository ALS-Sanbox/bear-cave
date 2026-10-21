const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bearCaveLocal', Object.freeze({
  read: () => ipcRenderer.invoke('local:read'),
  save: (settings, password) => ipcRenderer.invoke('local:save', { settings, password }),
  pickFolder: () => ipcRenderer.invoke('local:folder'),
  mangaConnect: (credentials) => ipcRenderer.invoke('local:manga-connect',credentials),
  mangaDisconnect: () => ipcRenderer.invoke('local:manga-disconnect'),
  sourceSession: (id) => ipcRenderer.invoke('local:source-session',id)
}));
