# Game Radar CLI

Use `node bin/game-radar.mjs` to read the latest snapshot without starting Electron. Piped output defaults to JSON; use `--format table` or `--format md` for humans.

Examples: `game-radar status`, `game-radar top ios -n 3`, `game-radar rising all --json`, `game-radar list android --sort ratingCount`, `game-radar game roblox "adopt me" --full`, `game-radar search simulator`, `game-radar keywords all`, and `game-radar refresh --platform ios --wait`.

JSON results use `{command, platform, updatedAt, dataAgeMinutes, stale, count, items}`. Compact items include position, id, name, url, risingScore, reasons, ageDays and released; `--full` returns source records. Data resolution is `--data`, then `GAME_RADAR_DATA`, installed `%APPDATA%\Game Radar\data`, then repository `data`.

Roblox uses live players. Poki live is a rounded estimate and ties use Popular rank. Mobile has no player counts: position is the US Top Free chart; Android uses the unofficial Play scraper and release date for “new”.
