import { UA, pool } from './util.mjs';

// The key goes in a header, not the URL, so a failed request cannot print it in an error message.
async function apiJson(path, key, params) {
  const r = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { headers: { 'user-agent': UA, 'x-goog-api-key': key, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`YouTube API ${r.status} on ${path}`);
  return r.json();
}

// Finds topics that are starting to spread across YouTube, without needing a keyword first.
// It looks at recent, popular uploads in several categories, breaks their titles into words and
// two-word phrases, and keeps the phrases used by many different channels. Needs YOUTUBE_API_KEY.
const API = 'https://www.googleapis.com/youtube/v3';
const CATEGORIES = { 1: 'Film', 10: 'Music', 20: 'Gaming', 22: 'People & Blogs', 23: 'Comedy', 24: 'Entertainment' };
const WINDOW_HOURS = 48;
const MIN_CHANNELS = 3;

// Common English words plus YouTube format and platform tags, which would otherwise top every sweep.
const STOP = new Set(('a an the and or of to in on for with is are was were be been it its this that these those at by from into about than then '
  + 'i you he she we they me my your his her our their us them not no has have had do does did will would can could should just so if as up out all '
  + 'one two new video videos official full part episode ep vs how why what when who where which get got make made day best top watch live '
  + 'shorts short fyp viral trending subscribe youtube youtubeshorts ytshorts yt reels tiktok 2024 2025 2026').split(' '));

const words = (title) => title.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));

// Unigrams and bigrams from one title. Each phrase counts once per video.
export function phrasesOf(title) {
  const w = words(title);
  const out = new Set(w);
  for (let i = 0; i < w.length - 1; i++) out.add(`${w[i]} ${w[i + 1]}`);
  return [...out];
}

// Pure aggregation, so it can be tested without the API. Keeps phrases used by at least MIN_CHANNELS channels.
export function aggregate(videos, previous = {}) {
  const byPhrase = new Map();
  for (const v of videos) {
    for (const p of phrasesOf(v.title)) {
      const e = byPhrase.get(p) ?? { phrase: p, videos: 0, channels: new Set(), views: 0 };
      e.videos++;
      e.channels.add(v.channelId);
      e.views += v.views;
      byPhrase.set(p, e);
    }
  }
  return [...byPhrase.values()]
    .filter((e) => e.channels.size >= MIN_CHANNELS)
    .map((e) => {
      const before = previous[e.phrase] ?? 0;
      return {
        phrase: e.phrase,
        videos: e.videos,
        channels: e.channels.size,
        views: e.views,
        // New phrases (not seen last sweep) rank above phrases already common.
        new: before === 0,
        score: Math.round((e.channels.size * Math.log10(e.views + 10)) / (1 + before) * 100) / 100,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
}

// Recent uploads in one category, most-viewed first. Search costs 100 quota units per call.
async function recentInCategory(id, key) {
  const after = new Date(Date.now() - WINDOW_HOURS * 3600e3).toISOString();
  const j = await apiJson('search', key, { part: 'snippet', type: 'video', order: 'viewCount', maxResults: 25, publishedAfter: after, videoCategoryId: id, regionCode: 'US' });
  return (j.items ?? []).map((i) => ({ id: i.id.videoId, title: i.snippet.title, channelId: i.snippet.channelId, category: CATEGORIES[id] }));
}

// Adds view counts and the made-for-kids flag. videos.list costs 1 unit per call of up to 50 ids.
async function withStats(videos, key) {
  const stats = new Map();
  for (let i = 0; i < videos.length; i += 50) {
    const ids = videos.slice(i, i + 50).map((v) => v.id).join(',');
    const j = await apiJson('videos', key, { part: 'statistics,status', id: ids });
    for (const it of j.items ?? []) stats.set(it.id, { views: Number(it.statistics?.viewCount ?? 0), madeForKids: !!it.status?.madeForKids });
  }
  return videos.map((v) => ({ ...v, ...(stats.get(v.id) ?? { views: 0, madeForKids: false }) })).filter((v) => stats.has(v.id));
}

// Runs one sweep. `previous` is the phrase -> video count map from the last sweep, used to spot new phrases.
export async function collectSweep({ key = process.env.YOUTUBE_API_KEY, previous = {} } = {}) {
  if (!key) return null;
  const lists = await pool(Object.keys(CATEGORIES), 3, (id) => recentInCategory(id, key));
  const seen = new Map();
  for (const v of lists.flat()) if (v?.id) seen.set(v.id, v);
  const videos = await withStats([...seen.values()], key);
  return {
    updatedAt: Date.now(),
    windowHours: WINDOW_HOURS,
    categories: Object.values(CATEGORIES),
    videoCount: videos.length,
    topics: aggregate(videos, previous),
    phraseCounts: Object.fromEntries(aggregate(videos).map((t) => [t.phrase, t.videos])),
  };
}
