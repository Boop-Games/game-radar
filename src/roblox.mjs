import { randomUUID } from 'node:crypto';
import { getJson, chunk, daysSince } from './util.mjs';

const SORTS = {
  'top-playing-now': 'topPlaying',
  'top-trending': 'trending',
  'up-and-coming': 'upAndComing',
  'top-revisited': 'revisited',
  'fun-with-friends': 'friends',
};

export async function collectRoblox() {
  const session = randomUUID();
  const games = new Map();

  for (const [sortId, key] of Object.entries(SORTS)) {
    try {
      const d = await getJson(
        `https://apis.roblox.com/explore-api/v1/get-sort-content?sessionId=${session}&sortId=${sortId}&device=computer&country=all&cpuCores=8`,
      );
      const list = (d.games ?? []).filter((g) => !g.isSponsored);
      list.forEach((g, i) => {
        const cur = games.get(g.universeId) ?? {
          id: String(g.universeId),
          platform: 'roblox',
          name: g.name,
          placeId: g.rootPlaceId,
          playing: 0,
          upVotes: 0,
          downVotes: 0,
          sorts: {},
          sortSizes: {},
        };
        cur.sorts[key] = i + 1;
        cur.sortSizes[key] = list.length;
        cur.playing = Math.max(cur.playing, g.playerCount ?? 0);
        cur.upVotes = Math.max(cur.upVotes, g.totalUpVotes ?? 0);
        cur.downVotes = Math.max(cur.downVotes, g.totalDownVotes ?? 0);
        games.set(g.universeId, cur);
      });
    } catch (e) {
      console.warn(`[roblox] sort ${sortId} failed: ${e.message}`);
    }
  }
  if (!games.size) throw new Error('Roblox returned no games');

  const ids = [...games.keys()];
  for (const part of chunk(ids, 50)) {
    try {
      const d = await getJson('https://games.roblox.com/v1/games?universeIds=' + part.join(','));
      for (const x of d.data ?? []) {
        const g = games.get(x.id);
        if (!g) continue;
        Object.assign(g, {
          playing: x.playing ?? g.playing,
          visits: x.visits ?? 0,
          favorites: x.favoritedCount ?? 0,
          created: x.created,
          updated: x.updated,
          genre: x.genre_l1 || x.genre || 'All',
          creator: x.creator?.name ?? '',
          desc: (x.description ?? '').slice(0, 600),
          maxPlayers: x.maxPlayers,
        });
      }
    } catch (e) {
      console.warn(`[roblox] details failed: ${e.message}`);
    }
  }

  for (const part of chunk(ids, 100)) {
    try {
      const d = await getJson(
        `https://thumbnails.roblox.com/v1/games/icons?universeIds=${part.join(',')}&size=256x256&format=Png&isCircular=false`,
      );
      for (const t of d.data ?? []) if (games.get(t.targetId)) games.get(t.targetId).icon = t.imageUrl;
    } catch (e) {
      console.warn(`[roblox] icons failed: ${e.message}`);
    }
  }

  const now = Date.now();
  return [...games.values()].map((g) => {
    const total = g.upVotes + g.downVotes;
    return {
      ...g,
      url: `https://www.roblox.com/games/${g.placeId}`,
      likeRatio: total > 20 ? g.upVotes / total : null,
      ageDays: g.created ? daysSince(g.created, now) : null,
    };
  });
}
