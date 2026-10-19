import { getJson, chunk, daysSince } from './util.mjs';

const GAMES_GENRE = 6014;
const COUNTRY = process.env.GAME_RADAR_COUNTRY || 'us';
// Apple's iTunes RSS charts, one per feed. `key` becomes the rank field on each game.
const FEEDS = [
  ['topfreeapplications', 'rank'],
  ['topgrossingapplications', 'grossingRank'],
  ['newfreeapplications', 'newRank'],
];

export async function collectIos() {
  const games = new Map();
  const sizes = {};

  for (const [feed, key] of FEEDS) {
    try {
      const d = await getJson(`https://itunes.apple.com/${COUNTRY}/rss/${feed}/limit=100/genre=${GAMES_GENRE}/json`);
      const entries = d.feed?.entry ?? [];
      sizes[key] = entries.length;
      entries.forEach((e, i) => {
        const id = e.id?.attributes?.['im:id'];
        if (!id) return;
        const g = games.get(id) ?? { id, platform: 'ios', name: e['im:name']?.label, url: e.id.label?.split('?')[0], developer: e['im:artist']?.label };
        g[key] = i + 1;
        games.set(id, g);
      });
    } catch (e) {
      console.warn(`[ios] chart ${feed} failed: ${e.message}`);
    }
  }
  if (!games.size) throw new Error('App Store charts returned no games');

  // Rating counts, release dates and descriptions come from the lookup API.
  for (const part of chunk([...games.keys()], 100)) {
    try {
      const d = await getJson(`https://itunes.apple.com/lookup?id=${part.join(',')}&country=${COUNTRY}`);
      for (const r of d.results ?? []) {
        const g = games.get(String(r.trackId));
        if (!g) continue;
        Object.assign(g, {
          name: r.trackName ?? g.name,
          url: r.trackViewUrl?.split('?')[0] ?? g.url,
          icon: r.artworkUrl512 ?? r.artworkUrl100,
          developer: r.sellerName ?? g.developer,
          genre: (r.genres ?? []).find((x) => x !== 'Games' && x !== 'Entertainment') ?? r.primaryGenreName ?? 'Games',
          ratingCount: r.userRatingCount ?? 0,
          ratingValue: r.averageUserRating ? Math.round(r.averageUserRating * 100) / 100 : null,
          released: r.releaseDate,
          updated: r.currentVersionReleaseDate,
          desc: (r.description ?? '').slice(0, 600),
        });
      }
    } catch (e) {
      console.warn(`[ios] lookup failed: ${e.message}`);
    }
  }

  const now = Date.now();
  return [...games.values()]
    .filter((g) => g.ratingCount != null)
    .map((g) => ({ ...g, chartSize: sizes, ageDays: g.released ? daysSince(g.released, now) : null }));
}
