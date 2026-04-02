const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function loadConfig() {
  const configPath = path.join(__dirname, 'sites.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function createWindow() {
  const isFullscreen = process.argv.includes('--fullscreen');

  mainWindow = new BrowserWindow({
    width: 768,
    height: 1366,
    fullscreen: isFullscreen,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      nodeIntegrationInSubFrames: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
    },
  });

  mainWindow.loadFile('renderer.html');

  mainWindow.webContents.on('did-finish-load', () => {
    const config = loadConfig();
    mainWindow.webContents.send('config', config);
  });
}

// Config neu laden wenn angefragt
ipcMain.handle('reload-config', () => {
  return loadConfig();
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
