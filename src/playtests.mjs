import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Poki does not publish which games are in playtest (they reach players as Mystery tiles), so the
// Poki half of the Launches tab is filled by hand in data/playtests.json:
// [{ "name": "Game name", "url": "https://poki.com/en/g/...", "startedOn": "2026-10-20", "note": "optional" }]
const dataDir = () => process.env.GAME_RADAR_DATA || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

// Playtest candidates found by scanning the Poki homepage (see src/discover.mjs). Kept across scans.
const CANDIDATES = 'playtest-candidates.json';
export async function loadCandidates() {
  try {
    return JSON.parse(await readFile(path.join(dataDir(), CANDIDATES), 'utf8'));
  } catch {
    return { scannedAt: null, found: 0, items: [] };
  }
}

// Merges this scan's tiles into the stored list. `firstSeen` is kept from the first time a tile appeared.
export async function recordCandidates(seen, now = Date.now()) {
  const prev = await loadCandidates();
  const stamp = new Date(now).toISOString();
  const byKey = new Map(prev.items.map((i) => [i.key, i]));
  for (const s of seen) {
    const key = s.gameId || s.url || s.name;
    byKey.set(key, { ...s, key, source: 'poki-homepage', firstSeen: byKey.get(key)?.firstSeen ?? stamp, lastSeen: stamp });
  }
  const out = { scannedAt: stamp, found: seen.length, items: [...byKey.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)) };
  await mkdir(dataDir(), { recursive: true });
  await writeFile(path.join(dataDir(), CANDIDATES), JSON.stringify(out, null, 2));
  return out;
}

export async function loadPlaytests() {
  try {
    const list = JSON.parse(await readFile(path.join(dataDir(), 'playtests.json'), 'utf8'));
    if (!Array.isArray(list)) return [];
    return list
      .filter((p) => p && typeof p.name === 'string' && p.name.trim())
      .map((p) => ({ name: p.name.trim(), url: typeof p.url === 'string' ? p.url : null, startedOn: typeof p.startedOn === 'string' ? p.startedOn : null, note: typeof p.note === 'string' ? p.note : '' }));
  } catch {
    return [];
  }
}
