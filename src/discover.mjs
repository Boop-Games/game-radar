import { getText } from './util.mjs';
import { recordCandidates } from './playtests.mjs';

// Poki shows playtest games as "mystery tiles": a tile carries data-mystery-game-id, data-mystery-path and
// data-mystery-url. The homepage is scanned on every refresh and each tile seen is remembered in
// data/playtest-candidates.json, so a playtest that shows up on the homepage is kept even after it goes.
// Anonymous visitors may get no tiles at all; the scan still runs and reports how many it found.
const POKI_HOME = 'https://poki.com/en';

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
const titleFromPath = (p) => {
  const slug = p?.split('/').filter(Boolean).pop();
  return slug ? slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : null;
};

// Pulls every mystery tile out of a page's HTML. Exported so the parser can be tested without the network.
export function parseMysteryTiles(html) {
  const seen = [];
  for (const [tag] of html.matchAll(/<[a-z][^>]*\sdata-mystery-tile[^>]*>/gi)) {
    const gameId = attr(tag, 'data-mystery-game-id');
    const path = attr(tag, 'data-mystery-path');
    const url = attr(tag, 'data-mystery-url');
    if (!gameId && !path && !url) continue;
    const name = attr(tag, 'aria-label') ?? attr(tag, 'title') ?? titleFromPath(url ?? path) ?? 'Unknown game';
    seen.push({ name, gameId, path, url: url ? new URL(url, POKI_HOME).href : null });
  }
  return seen;
}

// Fetches the Poki homepage, records any mystery tiles and returns the scan summary. Never throws:
// a failed scan is logged and the previous list is kept.
export async function scanPokiHomepage(now = Date.now()) {
  try {
    const html = await getText(POKI_HOME);
    return await recordCandidates(parseMysteryTiles(html), now);
  } catch (e) {
    console.warn(`[playtests] homepage scan failed: ${e.message}`);
    return null;
  }
}
