import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The Electron app points this at %APPDATA%; plain `npm start` keeps data next to the project.
const DIR = () => process.env.GAME_RADAR_DATA || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const HIST_KEEP = 7 * 86400e3; // forget anything older than a week
const FULL_RES = 6 * 3600e3; // keep every sample for 6h, then thin to one per 30 min
const THIN_GAP = 30 * 60e3;

async function readJson(name, fallback) {
  try {
    return JSON.parse(await readFile(path.join(DIR(), name), 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(name, value) {
  await mkdir(DIR(), { recursive: true });
  const tmp = path.join(DIR(), name + '.tmp');
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, path.join(DIR(), name));
}

export const loadHistory = () => readJson('history.json', {});
export const saveHistory = (h) => writeJson('history.json', h);
export const loadLatest = () => readJson('latest.json', null);
export const saveLatest = (s) => writeJson('latest.json', s);

// Append a sample [t, value, rank] for each game, then prune old / dense points.
export function appendHistory(history, platform, games, now) {
  for (const g of games) {
    const key = `${platform}:${g.id}`;
    const pts = (history[key] ??= []);
    const v = platform === 'roblox' ? g.playing : g.ratingCount;
    pts.push([now, v, platform === 'poki' ? g.rank : null, platform === 'poki' ? g.live : null]);
  }
  for (const key of Object.keys(history)) {
    if (!key.startsWith(platform + ':')) continue;
    const kept = [];
    for (const p of history[key]) {
      if (now - p[0] > HIST_KEEP) continue;
      const last = kept[kept.length - 1];
      if (last && now - p[0] > FULL_RES && p[0] - last[0] < THIN_GAP) continue;
      kept.push(p);
    }
    if (kept.length && now - kept[kept.length - 1][0] > HIST_KEEP / 2) delete history[key];
    else history[key] = kept;
  }
}
