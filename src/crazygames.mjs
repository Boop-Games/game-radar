import { getText, pool, daysSince } from './util.mjs';

const BASE = 'https://www.crazygames.com';
const IMG = 'https://imgs.crazygames.com';
const DETAIL_TTL = 30 * 60 * 1000; // game pages are heavy (~150KB); the list pages refresh every cycle

const detailCache = new Map(); // slug -> { t, game }

// Every CrazyGames page ships its data as Next.js JSON.
function pageProps(html) {
  const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s)?.[1];
  return raw ? JSON.parse(raw).props?.pageProps : null;
}

const strip = (html) => (html ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

function parseGame(html, slug) {
  const g = pageProps(html)?.game;
  if (!g?.name) return null;
  const up = g.upvotes ?? 0;
  const down = g.downvotes ?? 0;
  const cover = g.covers?.['1x1'];
  return {
    id: slug,
    platform: 'crazygames',
    name: g.name,
    url: `${BASE}/game/${slug}`,
    icon: cover ? `${IMG}/${cover}?format=auto&width=128` : undefined,
    desc: strip(`${g.metaDescription ?? ''} ${g.tags?.map((t) => t.name).join(' ') ?? ''}`).slice(0, 600),
    category: g.category?.name ?? 'Games',
    developer: g.developer,
    published: g.basicLaunchOn || g.addedOn, // addedOn is when the page was last (re)added, so prefer the launch date
    ratingCount: up + down,
    ratingValue: g.rating == null ? null : Math.round(g.rating * 100) / 100, // out of 10
    likeRatio: up + down ? up / (up + down) : null,
  };
}

export async function collectCrazyGames({ newDepth = 40 } = {}) {
  const [hotProps, newProps] = (await Promise.all([getText(`${BASE}/hot`), getText(`${BASE}/new`)])).map(pageProps);
  const hot = (hotProps?.games?.items ?? []).map((x) => x.slug);
  const fresh = (newProps?.games?.items ?? []).map((x) => x.slug).slice(0, newDepth);
  if (!hot.length) throw new Error('CrazyGames hot list came back empty (markup changed?)');
  const plays = new Map([...(hotProps.games.items ?? []), ...(newProps?.games?.items ?? [])].map((x) => [x.slug, x.totalPlays]));

  const now = Date.now();
  const slugs = [...new Set([...hot, ...fresh])];
  const stale = slugs.filter((s) => !detailCache.has(s) || now - detailCache.get(s).t > DETAIL_TTL);
  const fetched = await pool(stale, 6, async (slug) => parseGame(await getText(`${BASE}/game/${slug}`), slug));
  stale.forEach((slug, i) => {
    if (fetched[i]) detailCache.set(slug, { t: now, game: fetched[i] });
  });
  if (stale.length) console.log(`[crazygames] refreshed ${fetched.filter(Boolean).length}/${stale.length} game pages`);

  const games = [];
  for (const slug of slugs) {
    const hit = detailCache.get(slug);
    if (!hit) continue;
    const g = { ...hit.game };
    g.rank = hot.indexOf(slug) + 1 || null;
    g.newRank = fresh.indexOf(slug) + 1 || null;
    g.chartSize = { rank: hot.length, newRank: fresh.length };
    g.plays = plays.get(slug) ?? null;
    g.ageDays = g.published ? daysSince(g.published, now) : null;
    games.push(g);
  }
  return games;
}
