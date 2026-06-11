const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Datei, in die die aktuell angezeigte Seite geschrieben wird; der Kiosk-Agent
// liest sie und meldet sie ans Dashboard (fuer die Wiedergabe-Statistik).
const CURRENT_SITE_FILE = path.join(os.homedir(), '.cache', 'kiosk-current-site');
try { fs.mkdirSync(path.dirname(CURRENT_SITE_FILE), { recursive: true }); } catch (e) {}

// Kumulative Interaktions-Zaehler je Seite (Haeufigkeit + Dauer der Timer-Stopps,
// d. h. wie oft/lange eine Seite bedient wurde). Der Agent liest die Datei, bildet
// die Differenz und meldet sie ans Dashboard (Wiedergabe-Statistik).
const INTERACTIONS_FILE = path.join(os.homedir(), '.cache', 'kiosk-interactions.json');
const interactions = {};
function writeInteractions() {
  try {
    const tmp = INTERACTIONS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(interactions));
    fs.renameSync(tmp, INTERACTIONS_FILE);  // atomar, damit der Agent nie halb liest
  } catch (e) {}
}

// Raspberry Pi Performance + Touch
app.commandLine.appendSwitch('touch-events', 'enabled');
app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
app.commandLine.appendSwitch('enable-touch-drag-drop');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

let mainWindow;

function loadConfig() {
  const configPath = path.join(__dirname, 'sites.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    // Keine/ungueltige sites.json (z. B. vor dem ersten Agent-Sync): leere Liste,
    // der Renderer zeigt "Keine Seiten konfiguriert" statt zu crashen.
    return { rotationInterval: 15, idleTimeout: 5, sites: [] };
  }
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

// Aktuell angezeigte Seite protokollieren (vom Renderer bei jedem Seitenwechsel).
ipcMain.on('current-site', (_event, url) => {
  fs.writeFile(CURRENT_SITE_FILE, String(url || ''), () => {});
});

// Interaktion melden: jemand hat die angezeigte Seite bedient (Timer gestoppt).
// Zaehler + Dauer je Seite hochzaehlen.
ipcMain.on('interaction', (_event, data) => {
  const url = data && data.url;
  if (!url) return;
  const ms = Math.max(0, Math.round((data && data.ms) || 0));
  const it = interactions[url] || { count: 0, ms: 0 };
  it.count += 1;
  it.ms += ms;
  interactions[url] = it;
  writeInteractions();
});

// Notausstieg: Strg+Shift+Q beendet den Kiosk — egal ob der Fokus auf der Seite
// oder im Webview liegt. Damit sitzt man am Geraet nie ohne SSH fest.
app.on('web-contents-created', (event, contents) => {
  contents.on('before-input-event', (e, input) => {
    if (input.control && input.shift && (input.key === 'Q' || input.key === 'q')) {
      app.quit();
    }
  });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
