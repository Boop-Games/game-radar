import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
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
// Every Poki game ever seen in test, kept for good (history.json forgets after a week).
// `released` maps slugs already known to be released to their release date, so they are never re-checked.
export const loadPokiTests = async () => ({ games: {}, released: {}, ...(await readJson('poki-tests.json', {})) });
export const savePokiTests = (s) => writeJson('poki-tests.json', s);

// Keep complete point-in-time snapshots separately from latest.json. This preserves every
// collected field for multi-day analysis while pruning old captures to a bounded window.
export async function saveSnapshot(s, now = Date.now()) {
  const dir = path.join(DIR(), 'snapshots');
  await mkdir(dir, { recursive: true });
  const d = new Date(now);
  const stamp = `${now}`;
  await writeFile(path.join(dir, `${stamp}.json`), JSON.stringify(s));
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  const cutoff = now - 30 * 86400e3;
  await Promise.all(names.map(async (name) => {
    const time = Number(name.slice(0, -5));
    if (Number.isFinite(time) && time < cutoff) await unlink(path.join(dir, name)).catch(() => {});
  }));
}

// Append a sample [t, value, rank] for each game, then prune old / dense points.
export function appendHistory(history, platform, games, now) {
  for (const g of games) {
    const key = `${platform}:${g.id}`;
    const pts = (history[key] ??= []);
    const v = platform === 'roblox' ? g.playing : g.ratingCount;
    // Samples are [time, primary, chart rank, extra]. Extra is Poki's live estimate or Android's install bucket.
    pts.push([now, v, platform === 'roblox' ? null : g.rank ?? null, g.live ?? g.installs ?? null]);
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
