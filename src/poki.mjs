import { getText, getJson, pool, daysSince } from './util.mjs';

const BASE = 'https://poki.com/en';
const DETAIL_TTL = 30 * 60 * 1000; // game pages are heavy (~400KB); the cheap list pages refresh every cycle

const detailCache = new Map(); // slug -> { t, game }

function tiles(html, list) {
  const re = /data-tile-url="\/en\/g\/([^"]+)" data-tile-index="\d+" data-tile-list="([^"]+)"/g;
  const out = [];
  for (const m of html.matchAll(re)) if (m[2] === list) out.push(m[1]);
  return [...new Set(out)];
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');

function parseGame(html, slug) {
  const num = (re) => {
    const m = html.match(re);
    return m ? Number(m[1]) : null;
  };
  const name = html.match(/"@type":\["VideoGame","WebApplication"\],"@id":"[^"]*","name":"([^"]+)"/)?.[1];
  const ratingCount = num(/"ratingCount":(\d+)/);
  if (!name || ratingCount == null) return null;
  const ratingValue = num(/"ratingValue":([\d.]+)/);
  const gameId = html.match(/pokifordevs_game_id\\+"[:]\\+"([0-9a-f-]{36})/)?.[1]; // first hit is the page's own game
  const trending = html.match(/trending_rank\\+"[:](\d+)/)?.[1];
  return {
    id: slug,
    platform: 'poki',
    gameId,
    trendingRank: trending ? Number(trending) : null,
    name: decode(name),
    url: `${BASE}/g/${slug}`,
    icon: html.match(/"primaryImageOfPage":\{"@id":"([^"]+)"/)?.[1],
    desc: decode(html.match(/"@type":\["VideoGame","WebApplication"\],"@id":"[^"]*","name":"[^"]+","description":"((?:[^"\\]|\\.)*)"/)?.[1] ?? '').slice(0, 600),
    category: html.match(/"@id":"https:\/\/poki\.com\/en\/[a-z0-9-]+","name":"([^"]+?) Games"/)?.[1] ?? 'Games',
    published: html.match(/"datePublished":"([^"]+)"/)?.[1],
    modified: html.match(/"dateModified":"([^"]+)"/)?.[1],
    ratingCount,
    ratingValue: ratingValue == null ? null : Math.round(ratingValue * 100) / 100,
  };
}

export async function collectPoki({ newDepth = 40 } = {}) {
  const [popularHtml, newHtml] = await Promise.all([getText(`${BASE}/popular`), getText(`${BASE}/new`)]);
  const popular = tiles(popularHtml, 'basic-game');
  const week = tiles(popularHtml, 'popularWeekGames');
  const fresh = tiles(newHtml, 'basic-game').slice(0, newDepth);
  if (!popular.length) throw new Error('Poki popular list came back empty (markup changed?)');

  const now = Date.now();
  const slugs = [...new Set([...popular, ...fresh, ...week])];
  const stale = slugs.filter((s) => !detailCache.has(s) || now - detailCache.get(s).t > DETAIL_TTL);
  const fetched = await pool(stale, 6, async (slug) => parseGame(await getText(`${BASE}/g/${slug}`), slug));
  stale.forEach((slug, i) => {
    if (fetched[i]) detailCache.set(slug, { t: now, game: fetched[i] });
  });
  if (stale.length) console.log(`[poki] refreshed ${fetched.filter(Boolean).length}/${stale.length} game pages`);

  const games = [];
  for (const slug of slugs) {
    const hit = detailCache.get(slug);
    if (!hit) continue;
    const g = { ...hit.game };
    g.rank = popular.indexOf(slug) + 1 || null;
    g.popularSize = popular.length;
    g.weekRank = week.indexOf(slug) + 1 || null;
    g.newRank = fresh.indexOf(slug) + 1 || null;
    g.ageDays = g.published ? daysSince(g.published, now) : null;
    games.push(g);
  }

  // Poki's own "live players" figure: rounded down to a bucket (1000, 2000, 5000 ...), coarse but real. Light JSON, fetched every cycle.
  const live = await pool(games, 8, async (g) => (g.gameId ? (await getJson(`https://realtime.poki.com/estimate/metrics?id=${g.gameId}`)).users : null));
  games.forEach((g, i) => (g.live = Number.isFinite(live[i]) ? live[i] : null));
  return games;
}
