# Game Radar CLI

Use `node bin/game-radar.mjs` to read the latest snapshot without starting Electron. Piped output defaults to JSON; use `--format table` or `--format md` for humans.

Examples: `game-radar status`, `game-radar top ios -n 3`, `game-radar rising all --json`, `game-radar list android --sort ratingCount`, `game-radar game roblox "adopt me" --full`, `game-radar search simulator`, `game-radar keywords all`, `game-radar report popular-not-on-poki --limit 50`, and `game-radar refresh --platform ios --wait`.

JSON results use `{command, platform, updatedAt, dataAgeMinutes, stale, count, items}`. Compact items include position, id, name, url, risingScore, reasons, ageDays and released; `--full` returns source records. Data resolution is `--data`, then `GAME_RADAR_DATA`, installed `%APPDATA%\Game Radar\data`, then repository `data`.

Publishing a report to the dashboard's Pages tab (works with the installed app, which is not required to be running): write any markdown document and run `game-radar report submit --file report.md --title "..."` (or pipe the markdown on stdin). Only the body is required. Title and summary come from `--title`/`--summary`, then optional front matter (`---` with `title:`, `summary:`, `kind:` lines), then the first `#` heading and first paragraph. Structure is up to you; a useful shape is a `#` title, a short summary paragraph, then `##` sections such as Question, Findings, Sources and Next steps. Supported markdown: headings, paragraphs, lists (bullet and numbered), tables, links, bold, inline code, fenced code, quotes and rules. Output is JSON with the saved slug and file path. The data folder is `%APPDATA%\Game Radar\data` for the installed app; use `--data` to target another folder.

Poki tests: `game-radar playtests` lists unreleased games seen in Poki's Web Fit Tests; `playtests companies` ranks companies; `playtests "<company or team id>" --status testing|ended|released|removed` shows one company. Crawled hourly (`POKI_TESTS_REFRESH_MINUTES`); force with `refresh --platform pokiTests`.

Roblox uses live players. Poki live is a rounded estimate and ties use Popular rank. Mobile has no player counts: position is the US Top Free chart; Android uses the unofficial Play scraper and release date for “new”.
