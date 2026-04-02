const { ipcRenderer } = require('electron');

window.kiosk = {
  onConfig: (callback) => ipcRenderer.on('config', (_event, config) => callback(config)),
  reloadConfig: () => ipcRenderer.invoke('reload-config'),
};
