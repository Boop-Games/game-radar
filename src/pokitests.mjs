import { getText, getJson, pool, UA } from './util.mjs';
import { loadPokiTests, savePokiTests } from './store.mjs';

// Poki tests unreleased games in public. In a Web Fit Test a game sits on a few real category pages for
// ~10k players over 3-5 days, looking like a released game. What gives it away is the game record:
// released games carry a `release_date`, games in test don't (and are `no_index`).
// Poki's other test, the playtest "Mystery Tile", is served behind bot detection, so it is not tracked.
//
// Every run reads all category lists from Poki's own JSON API, then opens only the games it has not yet
// classified. Released games are remembered for good, so after the first run a crawl costs ~140 category
// requests plus a handful of game requests. Everything ever seen in test is kept in poki-tests.json.

const API = 'https://api.poki.com';
const QS = 'site=3&device=mobile&country=US'; // mobile lists are a superset of desktop ones
const RECHECK_ENDED = 30 * 86400e3; // keep watching a game for 30 days after its test ends, to catch a release

const apiJson = (p) => getJson(`${API}${p}${p.includes('?') ? '&' : '?'}${QS}`);

// One game record, or { missing: true } when Poki no longer has the game.
async function fetchGame(slug) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${API}/game/${encodeURIComponent(slug)}?${QS}`, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (r.status === 404) return { missing: true };
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null; // unknown: keep the previous state
}

const slugsFrom = (xml, re) => [...new Set([...xml.matchAll(re)].map((m) => decodeURIComponent(m[1])))];

export async function collectPokiTests(now = Date.now()) {
  const state = await loadPokiTests();
  const [catXml, gameXml] = await Promise.all([getText('https://poki.com/en/sitemaps/categories.xml'), getText('https://poki.com/en/sitemaps/games.xml')]);
  const cats = slugsFrom(catXml, /<loc>https:\/\/poki\.com\/en\/([a-z0-9-]+)<\/loc>/g);
  if (!cats.length) throw new Error('Poki category sitemap came back empty');
  if (!cats.includes('new')) cats.push('new');
  // The games sitemap only lists indexed (released) games, so anything in it can be skipped without a lookup.
  const indexed = new Set(slugsFrom(gameXml, /\/en\/g\/([^<"\s]+)</g));

  // slug -> tile, plus the categories it was seen on this run
  const tiles = new Map();
  const lists = await pool(cats, 6, (c) => apiJson(`/category/${c}?limit=300`));
  if (lists.every((l) => !l)) throw new Error('Every Poki category request failed');
  lists.forEach((list, i) => {
    for (const g of list?.games ?? []) {
      if (!g?.slug) continue;
      const t = tiles.get(g.slug) ?? tiles.set(g.slug, { ...g, cats: new Set() }).get(g.slug);
      t.cats.add(cats[i]);
    }
  });

  const tracked = state.games;
  const toCheck = new Set();
  for (const slug of tiles.keys()) if (!state.released[slug] && !indexed.has(slug)) toCheck.add(slug);
  for (const g of Object.values(tracked)) if (g.status === 'testing' || (g.status === 'ended' && now - g.lastSeen < RECHECK_ENDED)) toCheck.add(g.slug);

  const slugs = [...toCheck];
  const details = await pool(slugs, 6, fetchGame);
  let checked = 0;
  slugs.forEach((slug, i) => {
    const d = details[i];
    if (!d) return;
    checked++;
    const prev = tracked[slug];
    const tile = tiles.get(slug);
    if (d.missing) {
      if (prev && prev.status !== 'removed') Object.assign(prev, { status: 'removed', endedAt: prev.endedAt ?? now, lastChecked: now });
      return;
    }
    if (d.release_date) {
      state.released[slug] = d.release_date;
      if (prev && prev.status !== 'released') Object.assign(prev, { status: 'released', releasedAt: d.release_date, endedAt: prev.endedAt ?? now });
      if (prev) Object.assign(prev, ratingOf(d), { lastChecked: now });
      return;
    }
    // Unreleased: in test while it is listed on a category page, otherwise the test has ended.
    const live = !!tile;
    const g = (tracked[slug] ??= { slug, firstSeen: now, peakCategories: 0 });
    Object.assign(g, {
      id: slug,
      platform: 'poki',
      pokiId: d.id,
      gameId: d.pokifordevs_game_id ?? null,
      teamId: d.pokifordevs_team_id ?? null,
      developer: d.developer ?? tile?.developer ?? g.developer ?? 'Unknown',
      name: d.title ?? g.name ?? slug,
      url: `https://poki.com/en/g/${slug}`,
      icon: d.image?.path ? `https://img.poki-cdn.com/cdn-cgi/image/q=78,scq=50,width=94,height=94,fit=cover,f=auto/${d.image.path}` : g.icon,
      uploadedAt: d.video_upload_date ?? g.uploadedAt ?? null,
      mobile: d.mobile_available ?? null,
      desktop: d.desktop_available ?? null,
      lastChecked: now,
      ...ratingOf(d),
    });
    if (live) {
      g.categories = [...tile.cats].filter((c) => c !== 'new').sort();
      g.onNew = tile.cats.has('new');
      g.peakCategories = Math.max(g.peakCategories ?? 0, g.categories.length);
      g.lastSeen = now;
      if (g.status !== 'testing') delete g.endedAt;
      g.status = 'testing';
    } else {
      g.lastSeen ??= now;
      if (g.status !== 'ended') g.endedAt = now;
      g.status = 'ended';
    }
  });

  state.updatedAt = now;
  await savePokiTests(state);
  console.log(`[poki-tests] ${cats.length} categories, ${tiles.size} games listed, ${checked}/${slugs.length} checked, ${Object.values(tracked).filter((g) => g.status === 'testing').length} in test`);
  return { updatedAt: now, games: Object.values(tracked).sort((a, b) => (b.pokiId ?? 0) - (a.pokiId ?? 0)) };
}

function ratingOf(d) {
  const up = d.rating?.up_count ?? 0, down = d.rating?.down_count ?? 0;
  return { upCount: up, downCount: down, ratingCount: up + down, ratingValue: d.rating?.rating ?? null };
}
