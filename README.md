# Game Radar

A Windows tray app that tracks the top 10 and the fastest-rising games on **Roblox** and **Poki**, with a dashboard, keyword trends and top-10 notifications.

## Install

Download `Game-Radar-Setup-<version>.exe` from the [Releases](../../releases) page and run it. The app:

- refreshes every 5 minutes, or on demand with **Refresh now**
- keeps running in the system tray when you close the window (right-click the tray icon for Open / Refresh / Start with Windows / Top 10 notifications / Quit)
- starts with Windows (can be turned off from the tray menu)
- notifies you when a game enters the Roblox or Poki top 10
- stores its history in `%APPDATA%\Game Radar`

The installer is unsigned, so Windows SmartScreen may show a warning: choose **More info > Run anyway**.

## Where the data comes from

- **Roblox:** the public explore and games APIs (live players, votes, Up-and-Coming and Trending lists).
- **Poki:** the Popular and New lists, per-game vote counts, Poki's own Trending rank and its rounded "live players" estimate (1,000+, 5,000+ ...). Poki has no public API, so this reads its public pages and may break if the site changes.
- **Rising score (0-100):** growth, chart placement, freshness, approval and scale. Growth and trend arrows compare against ~24h ago, so they fill in after the app has run for a day.
- **Keywords:** common words and phrases across game titles, weighted by live players.

## Develop

Needs Node 20+.

```bash
npm install
npm run app      # run the Electron app
npm start        # headless server at http://localhost:4173, no Electron (or double-click start.bat)
npm run icon     # regenerate build/icon.png and public/icon.png
npm run dist     # build the Windows installer into release/
```

Environment for `npm start`: `PORT` (default 4173), `REFRESH_MINUTES` (default 5).

## Layout

- `src/roblox.mjs`, `src/poki.mjs`: collectors
- `src/scoring.mjs`, `src/terms.mjs`, `src/alerts.mjs`: rising score, keyword catalogue, top-10 change detection
- `src/server.mjs`: local API and background refresh loop; `src/main.mjs`: Electron window, tray and notifications
- `public/`: dashboard UI (no build step)
