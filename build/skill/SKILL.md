---
name: game-radar
description: Read Game Radar's game data (Roblox, Poki, CrazyGames, iOS, Android top and rising games) and publish research reports to its Pages tab. Use when the user asks about Game Radar, popular or rising games across those platforms, or wants a research write-up shown in the Game Radar dashboard.
---

# Game Radar

Game Radar is the installed desktop app that tracks top and fastest-rising games. This skill gives you its command-line tool through the launcher `game-radar.cmd`, which sits in this skill's folder (`%USERPROFILE%\.claude\skills\game-radar\`). Run it from the shell like this:

```
"%USERPROFILE%\.claude\skills\game-radar\game-radar.cmd" <command> [options]
```

Output is JSON when piped. Add `--format table` for a readable table.

## Reading data

- `status`: data age and game counts per platform.
- `top <platform> -n 10`: top games. Platforms: `roblox`, `poki`, `crazygames`, `ios`, `android`, or `all`.
- `rising <platform> -n 10`: fastest-rising games with a 0–100 score and the reasons for it.
- `list <platform> --sort <field>`: every tracked game on one platform.
- `game <platform> "<name>" --full`: one game's full record.
- `search <text>`: find a title on any platform.
- `keywords all`: title-word themes and their momentum.

JSON results include `stale`, which is true when the data is more than 20 minutes old. Call `refresh --platform <name> --wait` to update one platform, or `refresh` for all.

Roblox uses live player counts. Poki's live figure is a rounded estimate. CrazyGames and mobile platforms have no player counts, so their order comes from chart or Hot-list position.

## Publishing a research report to the Pages tab

Any markdown document works. The only requirement is a non-empty body. Structure is up to you, but a useful shape is:

1. A `#` title that says what the report answers.
2. A short summary paragraph with the answer first.
3. `##` sections such as Question, Findings, Sources and Next steps.

Save the markdown to a file, then run:

```
"%USERPROFILE%\.claude\skills\game-radar\game-radar.cmd" report submit --file report.md --title "Short title" --summary "One line"
```

`--title` and `--summary` are optional. They fall back to front matter (`title:`, `summary:`, `kind:` between `---` lines), then the first `#` heading and first paragraph. You can also pipe markdown on stdin instead of `--file`.

Supported markdown: headings, paragraphs, bullet and numbered lists, tables, links, bold, inline code, fenced code blocks, quotes and horizontal rules. Images and HTML are not rendered. Keep a report under 512 KB.

The command prints JSON with the saved `slug` and `file`. The report appears in the Pages tab the next time the dashboard checks, usually within a few seconds, with no restart needed.

## Rules

- Cite sources as markdown links in a Sources section. Do not invent game data; take numbers from the commands above or from the cited sources.
- When a question concerns a game, run `game` or `search` first so the report uses the current snapshot.
- If `report submit` fails with "Report is empty" or "larger than 512 KB", fix the file and run it again. Do not split it into several reports unless the user asks.
