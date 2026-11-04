import pkg from 'electron-updater';
import { app, Notification } from 'electron';

const { autoUpdater } = pkg;

// Checks GitHub Releases (the `publish` block in package.json) for a newer installer.
// The first check runs shortly after launch, then every 5 minutes. Downloads happen in the background
// and the update is applied the next time the app restarts, or immediately from the tray menu.
const FIRST_CHECK_MS = 30e3;
const CHECK_EVERY_MS = 5 * 60e3;

// status: dev | idle | checking | downloading | ready | current | error
export function initUpdater({ icon, onChange = () => {} } = {}) {
  let state = { status: 'idle', version: null, error: null };
  const set = (patch) => {
    state = { ...state, ...patch };
    onChange(state);
  };

  const updater = {
    get state() {
      return state;
    },
    check() {
      if (state.status === 'dev') return;
      autoUpdater.checkForUpdates().catch(() => {}); // failures are reported through the 'error' event
    },
    // Caller must set its own quitting flag first so the window does not hide instead of closing.
    install() {
      if (state.status === 'ready') autoUpdater.quitAndInstall();
    },
  };

  // Updates only exist for the installed app; `npm run app` from source has nothing to update.
  if (!app.isPackaged) {
    set({ status: 'dev' });
    return updater;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version }));
  autoUpdater.on('update-not-available', () => set({ status: 'current', version: null }));
  autoUpdater.on('update-downloaded', (info) => {
    // electron-updater can fire this again on later checks; only announce each version once.
    const isNew = state.version !== info.version || state.status !== 'ready';
    set({ status: 'ready', version: info.version });
    if (isNew && Notification.isSupported()) {
      new Notification({ title: 'Game Radar update ready', body: `Version ${info.version} installs the next time you restart.`, icon }).show();
    }
  });
  autoUpdater.on('error', (e) => set({ status: 'error', error: e?.message ?? String(e) }));

  setTimeout(updater.check, FIRST_CHECK_MS);
  setInterval(updater.check, CHECK_EVERY_MS);
  return updater;
}
