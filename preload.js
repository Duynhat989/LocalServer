const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localServer', {
  getStatus: () => ipcRenderer.invoke('server:status'),
  openWeb: () => ipcRenderer.invoke('server:open-web'),
  checkLicense: () => ipcRenderer.invoke('license:check'),
  onStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('server:status-changed', handler);
    return () => ipcRenderer.removeListener('server:status-changed', handler);
  },
});
