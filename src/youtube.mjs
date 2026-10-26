import { getText, pool } from './util.mjs';

// YouTube publishes a public Atom feed for every channel, with no key. Each feed holds the latest uploads
// and their current view counts. Discovery is limited to the channels listed here: there is no public
// trending feed to read. Add a channel by its ID (the UC... value in its page source or the feed URL).
export const YOUTUBE_CHANNELS = [
  { name: 'Roblox', id: 'UCjiPEaapiHbJMoAdi_L8fNA' },
  { name: 'PokiGames', id: 'UCEFmjrTywatyj4vZCCvjOdw' },
  { name: 'CrazyGames', id: 'UC9CLWvGbT56My3etOT4tSdw' },
  { name: 'Minecraft', id: 'UC1sELGmy5jp5fQUugmuYlXQ' },
  { name: 'Ninja', id: 'UCmyweyoqldy5yPGeHigEyzA' },
];

const MAX_AGE_DAYS = 14;
const GAME_TEXT = /\b(games?|gaming|gamers?|roblox|steam|nintendo|playstation|xbox|minecraft|fortnite|videogames?|let'?s play|speedrun)\b/i;

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"');
const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? '').trim();
const attr = (xml, name, attrName) => xml.match(new RegExp(`<${name}\\b[^>]*\\b${attrName}="([^"]*)"`))?.[1] ?? null;

// Parses one channel's Atom feed into video records. Views are the current count, so they grow over time.
export function parseFeed(xml, channel, now = Date.now()) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const published = tag(e, 'published');
    const ageDays = Math.max(0, (now - Date.parse(published)) / 86400000);
    const views = Number(attr(e, 'media:statistics', 'views') ?? 0);
    const title = tag(e, 'media:title') || tag(e, 'title');
    return {
      id: tag(e, 'yt:videoId'),
      title,
      url: attr(e, 'link', 'href'),
      thumbnail: attr(e, 'media:thumbnail', 'url'),
      channel: channel.name,
      published,
      ageDays: Math.round(ageDays * 10) / 10,
      views,
      viewsPerHour: Math.round((views / Math.max(ageDays * 24, 2)) * 10) / 10,
      game: GAME_TEXT.test(title),
    };
  });
}

// Latest uploads across the watched channels, newest-first within the window, ranked by views per hour.
export async function collectYouTube({ limit = 25, channels = YOUTUBE_CHANNELS } = {}) {
  const feeds = await pool(channels, 4, (c) => getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.id}`));
  const videos = feeds
    .flatMap((xml, i) => (xml ? parseFeed(xml, channels[i]) : []))
    .filter((v) => v.id && v.ageDays <= MAX_AGE_DAYS)
    .sort((a, b) => b.viewsPerHour - a.viewsPerHour);
  return {
    updatedAt: Date.now(),
    channels: channels.map((c, i) => ({ name: c.name, id: c.id, ok: !!feeds[i] })),
    videos: videos.slice(0, limit),
  };
}
