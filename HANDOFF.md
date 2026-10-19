# Handoff: finish mobile (iOS/Android) support and build the CLI

Delete this file when the work is done. Owner: Boop Games (in-house tool, private repo `Boop-Games/game-radar`).

Game Radar is an Electron tray app (plus a headless `npm start` server) that tracks the top 10 and fastest-rising games on Roblox and Poki, with a dashboard, keyword catalogue and top-10 notifications. v1.0.0 is released. This branch adds **iOS and Android** data and an **agent-facing CLI**. The backend for mobile is done and tested; the dashboard is half done; the CLI is not started.

## Hard rules

- Windows 11. Match the surrounding code style and comment density. No new dependencies beyond `google-play-scraper` (already added) and `node:util` `parseArgs`.
- Do NOT `git push`, publish a release, or create a PR. Commit locally and tell the user; they decide when to publish.
- Do not kill node processes broadly. Other unrelated node/vite processes run on this machine. Only stop processes whose command line contains `poki-roblox-data`.
- `npm install` blocks install scripts. If `node_modules/electron/dist/electron.exe` is missing run `node node_modules/electron/install.js`.
- `dist/` can be locked by Windows; installer output goes to `release/` (already configured, git-ignored).
- Never use real credentials; nothing here needs any.

## Architecture (read these first)

- `src/roblox.mjs`, `src/poki.mjs`, `src/ios.mjs`, `src/android.mjs`: collectors returning arrays of game objects.
- `src/collect.mjs`: `runCollection({ only })` fetches due platforms (Roblox/Poki every cycle, mobile every 30 min via `MOBILE_REFRESH_MINUTES`), scores, appends history, builds keyword terms, writes `latest.json` and `history.json`.
- `src/scoring.mjs`: `scoreRoblox`, `scorePoki`, `scoreMobile`; each game gets `risingScore` (0-100), `components`, `reasons`, `hist`.
- `src/rank.mjs`: shared `PLATFORMS`, `LABELS`, `topGames`, `risingGames` (single source of truth for "top"/"rising" ordering; `public/app.js` mirrors it).
- `src/store.mjs`: data dir = `GAME_RADAR_DATA` env, else `./data`. The installed Electron app uses `%APPDATA%\Game Radar\data`.
- `src/server.mjs`: `startServer()` HTTP API (`/api/status`, `/api/data`, `POST /api/refresh`) + refresh loop. `src/main.mjs`: Electron window/tray/notifications.
- `public/`: dashboard, vanilla JS, no build step. Snapshot shape: `{ updatedAt, errors, roblox|poki|ios|android: { updatedAt, games[], terms[] } }`.

Platform semantics (important for the CLI and UI text):
- Roblox: real live players (`playing`). Top = most playing.
- Poki: bucketed live estimate (`live`), `trendingRank`, Popular rank `rank`. Top = live desc, ties by `rank`.
- iOS (US App Store, iTunes RSS + lookup) and Android (US Google Play via unofficial `google-play-scraper`): NO player counts exist. Top = Top Free chart `rank`, then `grossingRank`. iOS also has `newRank`. Android has `installs`/`installsLabel` (bucket). Both have `ratingCount`, `ratingValue`, `votesPerDay` (= ratings/day since release), `released`, `ageDays`, `genre`, `developer`.
- History samples are `[t, primary, chartRank, extra]` (extra = Poki live or Android installs).

## Status

Done and verified (`node src/collect.mjs ios android` returned 269 iOS and 174 Android games with sensible rising lists): `src/ios.mjs`, `src/android.mjs`, `scoreMobile`, `src/rank.mjs`, `src/alerts.mjs` (4 platforms), `src/collect.mjs` (per-platform cadence), `src/store.mjs`/`src/terms.mjs` mobile support, `/api/data` returns all 4 platforms.

Partly done in `public/app.js`: `PLATFORMS`/`NAMES`/`COLORS` maps, `ORDER`/`topList`/`topMax`/`barValue`, `topRow`/`riseCard` for mobile, `overview()` rewritten to loop over platforms, keyword view loops over platforms, `sparkVals` for mobile.

## Task 1: finish the dashboard for iOS and Android

1. `public/index.html`: add `iOS` (`data-tab="ios"`) and `Android` (`data-tab="android"`) tab buttons before Keywords.
2. `public/style.css`: add `--ios` and `--android` colour vars (pick distinct from roblox coral / poki blue), `.pill.ios` / `.pill.android` (copy the `.pill.roblox` pattern with matching tinted background), and change `.kpis` to `grid-template-columns: repeat(auto-fit, minmax(190px, 1fr))` (overview now has up to 6 KPI tiles). Check the 560px and 980px breakpoints still work.
3. `public/app.js`:
   - Add `COLS.ios` and `COLS.android` (currently undefined, so those tabs would break `platformView`/`drawTable`). Columns: `rank` (#, Top Free), `name`, `genre`, `grossingRank` (Grossing #), iOS only `newRank` (New #), `ratingCount` (Ratings), `ratingValue` (Rating), `votesPerDay` (Ratings / day), Android only `installs` (Installs, show `installsLabel`), `rankDelta` (Change), `released`, `risingScore`. Follow the existing column tuple format `[key, label, sortGetter, cellRenderer, rightAligned]`. Default sort for both is `['rank', 1]` (already in `state.sort`).
   - `platformView(p)`: use `TOP_SUB[p]` / `RISE_SUB[p]` for card subtitles, add blurbs for ios/android explaining there are no player counts and that rank = Top Free chart position, "Change" = movement in Top Free since the earlier snapshot, and for Android that "new" is by release date (Google Play has no New chart). Category dropdown label should say genres for mobile.
   - `drawer(key)`: add a mobile branch for stats (Free rank, Grossing rank, iOS New rank, Ratings, Rating, Ratings/day, Android Installs, Released) and for the chart (chart-position history from `hist[2]`, inverted, like the Poki fallback; heading "Top Free position over time"). The "Open on ..." link text already uses `NAMES[p]`.
   - Keyword UI: the share tooltip and the note under the keyword view say "share of all live players"; for mobile "share" is chart weight. Adjust wording (e.g. "for iOS and Android, weighted by Top Free chart position").
   - Check the top-10 notification wording and empty states when a platform has no data yet (e.g. first run before mobile has been fetched): overview and tabs must not crash.
4. Verify with headless Chrome screenshots (Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`, `--headless=new --window-size=1400,1200 --virtual-time-budget=8000 --screenshot=<path> http://localhost:4173/#ios`) for `#overview`, `#ios`, `#android`, `#keywords`, and the drawer. Start the server with `node src/server.mjs` (port 4173; first stop any old copy that was started from this folder). Also run a quick headless check that there are no console errors if you can.

## Task 2: build the agent CLI

Goal: other AI agents (and people) on this machine can read the data from a terminal. Create `bin/game-radar.mjs`, add `"bin": { "game-radar": "bin/game-radar.mjs" }` to `package.json`, and use `node:util` `parseArgs` (no new deps).

Data source: read `latest.json` directly (do not require the app to be running). Data dir resolution order: `--data <dir>` flag, `GAME_RADAR_DATA` env, `%APPDATA%\Game Radar\data` if `latest.json` exists there (the installed app), else `<repo>/data`. Set `process.env.GAME_RADAR_DATA` before importing `src/store.mjs`/`src/collect.mjs`. Reuse `src/rank.mjs`; do not duplicate ranking logic.

Commands (all accept `--format json|table|md`; default `table` when stdout is a TTY, otherwise `json`; `--json` shortcut; `-n/--limit`):
- `status`: data dir, snapshot age, per-platform game count / last updated / errors, stale warning.
- `top <platform|all> [-n 10]`: Top N using `topGames`.
- `rising <platform|all> [-n 10]`: using `risingGames`, include `risingScore` and `reasons`.
- `list <platform> [--sort <field>] [--asc] [--limit N] [--genre G] [--max-age-days D] [--search TEXT]`: full table, sortable by any numeric/string field (`playing`, `live`, `rank`, `ratingCount`, `ageDays`, `risingScore`, `released`, ...).
- `game <platform> <id-or-name-substring>`: the complete record including `components`, `reasons`, `hist`; exit 2 with candidates if ambiguous.
- `search <text>`: match names across all platforms.
- `keywords [platform|all] [-n 25] [--sort count|share|trend|rising] [--no-phrases]`: from the snapshot `terms`, include the games that use each term.
- `refresh [--platform a,b] [--wait]`: runs `runCollection({ only })` in-process and prints a summary. Note in help that the app already refreshes every 5 minutes, so this is rarely needed.
- `help` / `--help`: usage, the platform semantics above in 5 lines, and JSON field notes.

Output contract (agents depend on it): JSON envelope `{ "command", "platform", "updatedAt" (ISO), "dataAgeMinutes", "stale" (true if > 20 min), "count", "items": [...] }`. Items use a compact, stable projection per platform (always include `position`, `id`, `name`, `url`, `risingScore`, `reasons`, `ageDays`, `released`; Roblox adds `playing`, `deltaPct`, `likeRatio`, `visits`, `genre`; Poki adds `live`, `trendingRank`, `popularRank`, `votes`, `rating`, `category`; mobile adds `rank`, `grossingRank`, `ratings`, `rating`, `ratingsPerDay`, `genre`, `developer`, and `installs`/`newRank` where they exist). Support `--full` for raw records and `--fields a,b,c` to project. Exit codes: 0 ok, 1 usage error, 2 no data / not found. Errors in json mode print `{ "error": "...", "hint": "..." }` to stdout. No colour codes when not a TTY.

Also write `AGENTS.md` at the repo root documenting the CLI for agents: when to use it, each command with a real example and short sample output, the output contract, the platform semantics caveats (no mobile player counts, Poki live is bucketed, unofficial Play scraper), and the data dir behaviour. Add a short CLI section to `README.md`.

Test the CLI against the real snapshot in `%APPDATA%\Game Radar\data` or `./data` (run `node src/collect.mjs` first if empty): every command in json and table form, plus the not-found, ambiguous and missing-data paths.

## Task 3: integration, packaging, commit

- Run the app: `npm run app`, confirm it starts, all four platforms load, and closing the window leaves it in the tray (process still alive). Then quit it (`Get-Process electron` filtered to this folder).
- Bump `package.json` version to `1.1.0`. Run `npm run dist` and confirm `google-play-scraper` is bundled (installer builds; if the packaged app cannot resolve it, fix the `build.files` / dependencies config) and `release/Game-Radar-Setup-1.1.0.exe` exists. Check the installer size is sane (~110 MB).
- Update `README.md` (four platforms, mobile caveats, CLI, `MOBILE_REFRESH_MINUTES`, `GAME_RADAR_COUNTRY` default `us`).
- Run `node --check` on every `src/*.mjs`, `bin/*.mjs` and `public/app.js`.
- Delete `HANDOFF.md`, then commit locally in logical commits with message trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` replaced by your own agent attribution if your tool adds one. Do not push or release. Report what you did, what you verified, and anything you could not verify.
