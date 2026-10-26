import { getJson, pool } from './util.mjs';
import { collectYouTube } from './youtube.mjs';

// Social trends come from a Mastodon instance's public API: no account or API key is needed.
// Bluesky and Reddit now need credentials for search, so they are not used here.
export const SOCIAL_INSTANCE = process.env.SOCIAL_INSTANCE || 'https://mastodon.social';

// Hashtags that mark game-related chatter. Checked against every tag, so the list only needs the common ones.
export const GAME_TAGS = [
  'gaming', 'games', 'indiegame', 'indiegames', 'indiedev', 'gamedev', 'videogames', 'retrogaming',
  'roblox', 'steam', 'nintendo', 'playstation', 'xbox', 'mobilegaming', 'gamer', 'pcgaming', 'vrgaming', 'minecraft', 'fortnite',
];
const GAME_TEXT = /\b(games?|gaming|gamers?|roblox|steam|nintendo|playstation|xbox|minecraft|fortnite|videogames?)\b/i;
const isGameTag = (name) => GAME_TAGS.includes(name.toLowerCase()) || GAME_TEXT.test(name);

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"');
const plain = (html) => decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Mastodon tag history is newest-first, with daily uses and distinct accounts as strings.
// Growth compares the latest day with the average of the days before it.
function summarizeTag(tag) {
  const hist = (tag.history ?? []).map((d) => ({ uses: Number(d.uses), accounts: Number(d.accounts) }));
  const latest = hist[0] ?? { uses: 0, accounts: 0 };
  const before = hist.slice(1);
  const avg = before.length ? before.reduce((s, d) => s + d.uses, 0) / before.length : null;
  return {
    name: tag.name,
    url: tag.url,
    uses: latest.uses,
    accounts: latest.accounts,
    baseline: avg ?? 0, // average daily uses before today
    growth: avg && avg > 0 ? (latest.uses - avg) / avg : null,
    game: isGameTag(tag.name),
  };
}

// A topic is emerging when today's uses are well above its own recent baseline and many different
// accounts use it. Growth alone favours one-account campaigns, so the account count is a required floor
// and also scales the score. This is a heuristic: a celebrity or brand with a broad fan base can still pass.
const MIN_EMERGING_ACCOUNTS = 5;
const MIN_EMERGING_RATIO = 2;
export function emergingScore(t) {
  if (t.accounts < MIN_EMERGING_ACCOUNTS) return null;
  const ratio = (t.uses + 1) / (t.baseline + 5); // +1 and +5 smooth out tiny numbers
  if (ratio < MIN_EMERGING_RATIO) return null;
  return { ...t, new: t.baseline <= 10, score: Math.round(ratio * Math.log10(t.accounts + 1) * 100) / 100 };
}

const toPost = (s) => ({
  id: s.id,
  url: s.url,
  account: s.account?.acct ?? null,
  text: plain(s.content).slice(0, 280),
  likes: s.favourites_count ?? 0,
  boosts: s.reblogs_count ?? 0,
  replies: s.replies_count ?? 0,
  created: s.created_at,
  game: GAME_TEXT.test(plain(s.content)) || (s.tags ?? []).some((t) => isGameTag(t.name)),
});

// Everything trending on the instance, game-related or not. Items carry a `game` flag so the UI can filter.
// Mastodon caps each trends page at 20, so paging with offset gives a wider pool to find emerging topics in.
const TREND_PAGE_OFFSETS = [0, 20, 40, 60];

export async function collectSocial({ posts = 10 } = {}) {
  const base = SOCIAL_INSTANCE.replace(/\/$/, '');
  const [trendingPages, trendingStatuses, gameTagDetails, youtube] = await Promise.all([
    Promise.all(TREND_PAGE_OFFSETS.map((offset) => getJson(`${base}/api/v1/trends/tags?limit=20&offset=${offset}`).catch(() => []))),
    getJson(`${base}/api/v1/trends/statuses?limit=20`),
    pool(GAME_TAGS, 4, (name) => getJson(`${base}/api/v1/tags/${name}`)),
    collectYouTube().catch(() => null),
  ]);

  const pooled = [...new Map(trendingPages.flat().map((t) => [t.name.toLowerCase(), summarizeTag(t)])).values()];
  const headlines = (await getJson(`${base}/api/v1/trends/links?limit=10`).catch(() => [])).map((l) => `${l.title ?? ''} ${l.description ?? ''}`.toLowerCase());

  // A tag whose name appears in a trending headline is news-driven (people, places, events in the news).
  // Those are listed separately so the emerging list is about community topics.
  const ranked = pooled.map(emergingScore).filter(Boolean).sort((a, b) => b.score - a.score);
  const inNews = (t) => headlines.some((h) => new RegExp(`\\b${t.name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')}\\b`, 'u').test(h));
  const withNews = ranked.map((t) => ({ ...t, news: inNews(t) }));

  return {
    instance: base,
    updatedAt: Date.now(),
    tags: pooled.slice(0, 20), // the server's own trending order, for context
    emerging: withNews.filter((t) => !t.news).slice(0, 15),
    inNews: withNews.filter((t) => t.news).slice(0, 10),
    gameTags: gameTagDetails.filter(Boolean).map(summarizeTag).sort((a, b) => b.uses - a.uses),
    posts: trendingStatuses.slice(0, posts).map(toPost),
    youtube,
  };
}

// Looks up any hashtag, trending or not (e.g. "clickies"). Returns null when the instance doesn't know the tag.
export async function lookupTag(name) {
  const clean = String(name).replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '');
  if (!clean) return null;
  const base = SOCIAL_INSTANCE.replace(/\/$/, '');
  const tag = await getJson(`${base}/api/v1/tags/${encodeURIComponent(clean)}`).catch(() => null);
  return tag ? { ...summarizeTag(tag), instance: base } : null;
}
