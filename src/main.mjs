import { app, BrowserWindow, Tray, Menu, Notification, nativeImage, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ICON = path.join(here, '..', 'build', 'icon.png');

app.setName('Game Radar');
app.setAppUserModelId('com.boopgames.gameradar'); // needed for Windows notifications

if (!app.requestSingleInstanceLock()) app.quit();

// Data lives in %APPDATA%\Game Radar so it survives updates and reinstalls.
process.env.GAME_RADAR_DATA = path.join(app.getPath('userData'), 'data');
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
const loadSettings = () => {
  try {
    return JSON.parse(readFileSync(settingsFile, 'utf8'));
  } catch {
    return {};
  }
};
const saveSettings = (s) => {
  mkdirSync(path.dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(s));
};

let win = null;
let tray = null;
let backend = null;
let quitting = false;
let told = false;
const settings = loadSettings();

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(port) {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#0b0e14',
    title: 'Game Radar',
    icon: ICON,
    autoHideMenuBar: true,
    show: false,
  });
  win.setMenuBarVisibility(false);
  win.loadURL(`http://127.0.0.1:${port}/`);
  if (!process.argv.includes('--hidden')) win.once('ready-to-show', () => win.show());

  // Closing hides to the tray; the background refresh keeps running.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!told) {
      told = true;
      new Notification({ title: 'Game Radar is still running', body: 'It keeps refreshing in the tray. Right-click the icon to quit.', icon: ICON }).show();
    }
  });
  // Links to Roblox / Poki open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open Game Radar', click: showWindow },
    { label: 'Refresh now', click: () => backend?.refresh() },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
        saveSettings({ ...settings, autoStartChosen: true });
      },
    },
    {
      label: 'Top 10 notifications',
      type: 'checkbox',
      checked: settings.notify !== false,
      click: (item) => {
        settings.notify = item.checked;
        saveSettings(settings);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 32, height: 32 }));
  tray.setToolTip('Game Radar');
  tray.on('click', showWindow);
  tray.on('right-click', () => tray.setContextMenu(buildMenu())); // rebuild so checkboxes reflect current state
  tray.setContextMenu(buildMenu());
}

app.on('second-instance', showWindow);

app.whenReady().then(async () => {
  // First run: start with Windows is on by default; the tray menu lets the user turn it off.
  if (!settings.autoStartChosen && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
    settings.autoStartChosen = true;
    saveSettings(settings);
  }

  const { startServer } = await import('./server.mjs');
  backend = await startServer({
    port: 0,
    onAlerts: (alerts) => {
      if (settings.notify === false || !Notification.isSupported()) return;
      for (const a of alerts.slice(0, 3)) {
        const n = new Notification({ title: a.title, body: a.body, icon: ICON });
        n.on('click', showWindow);
        n.show();
      }
      if (alerts.length > 3) new Notification({ title: `+${alerts.length - 3} more games entered a Top 10`, body: 'Open Game Radar to see them.', icon: ICON }).show();
    },
  });
  createWindow(backend.port);
  createTray();
});

// Keep running in the tray when every window is closed.
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  quitting = true;
  backend?.close();
});
