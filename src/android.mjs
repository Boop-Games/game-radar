import gplayModule from 'google-play-scraper';
import { pool, daysSince } from './util.mjs';

// google-play-scraper is an unofficial scraper of Google Play. It can break when Google changes the site.
const gplay = gplayModule.default ?? gplayModule;
const COUNTRY = process.env.GAME_RADAR_COUNTRY || 'us';
const DETAIL_TTL = 2 * 3600e3; // install buckets and ratings move slowly; cap the per-app requests
const CHARTS = [
  [gplay.collection.TOP_FREE, 'rank'],
  [gplay.collection.GROSSING, 'grossingRank'],
];

const detailCache = new Map(); // appId -> { t, detail }

export async function collectAndroid() {
  const games = new Map();
  const sizes = {};

  for (const [collection, key] of CHARTS) {
    try {
      const list = await gplay.list({ collection, category: gplay.category.GAME, num: 100, country: COUNTRY, lang: 'en' });
      sizes[key] = list.length;
      list.forEach((a, i) => {
        const g = games.get(a.appId) ?? { id: a.appId, platform: 'android', name: a.title, url: a.url, icon: a.icon, developer: a.developer };
        g[key] = i + 1;
        games.set(a.appId, g);
      });
    } catch (e) {
      console.warn(`[android] chart ${key} failed: ${e.message}`);
    }
  }
  if (!games.size) throw new Error('Google Play charts returned no games');

  const now = Date.now();
  const ids = [...games.keys()];
  const stale = ids.filter((id) => !detailCache.has(id) || now - detailCache.get(id).t > DETAIL_TTL);
  const fetched = await pool(stale, 5, (id) => gplay.app({ appId: id, country: COUNTRY, lang: 'en' }));
  stale.forEach((id, i) => {
    if (fetched[i]) detailCache.set(id, { t: now, detail: fetched[i] });
  });
  if (stale.length) console.log(`[android] refreshed ${fetched.filter(Boolean).length}/${stale.length} app pages`);

  const out = [];
  for (const g of games.values()) {
    const d = detailCache.get(g.id)?.detail;
    if (!d) continue;
    const released = d.released ? new Date(d.released) : null;
    out.push({
      ...g,
      name: d.title ?? g.name,
      icon: d.icon ?? g.icon,
      developer: d.developer ?? g.developer,
      genre: d.genre ?? 'Games',
      ratingCount: d.ratings ?? 0,
      ratingValue: d.score ? Math.round(d.score * 100) / 100 : null,
      installs: d.minInstalls ?? null,
      installsLabel: d.installs ?? null,
      released: released && !Number.isNaN(+released) ? released.toISOString() : null,
      updated: d.updated ? new Date(d.updated).toISOString() : null,
      desc: (d.description ?? '').slice(0, 600),
      chartSize: sizes,
      ageDays: released && !Number.isNaN(+released) ? daysSince(released.toISOString(), now) : null,
    });
  }
  return out;
}
