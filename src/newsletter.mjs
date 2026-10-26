import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { topGames, risingGames, PLATFORMS, LABELS } from './rank.mjs';

const dataDir = () => process.env.GAME_RADAR_DATA || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const dir = () => path.join(dataDir(), 'newsletters');
const readJson = async (name, fallback) => { try { return JSON.parse(await readFile(path.join(dataDir(), name), 'utf8')); } catch { return fallback; } };
export const loadNewsletterSettings = () => readJson('newsletter-settings.json', { times: ['09:00', '13:00', '17:00'], enabled: true });
export async function saveNewsletterSettings(settings) { await mkdir(dataDir(), { recursive: true }); await writeFile(path.join(dataDir(), 'newsletter-settings.json'), JSON.stringify(settings, null, 2)); return settings; }
const slotKey = (date, time) => `${date.toISOString().slice(0, 10)}-${time.replace(':', '')}`;
// Table cells and list items must stay on one line and cannot contain pipes.
const clean = (s) => String(s ?? '').replace(/[|\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
const trend = (x) => (x == null ? '–' : `${x > 0 ? '▲' : x < 0 ? '▼' : '•'} ${Math.abs(Math.round(x * 100))}%`);
// Brackets in the alt text would end the markdown image early, so they are dropped.
const thumb = (g) => (g.icon ? `![${clean(g.name).replace(/[[\]]/g, '')}](${g.icon}) ` : '');
const num = (n) => (n == null ? '–' : Math.round(n).toLocaleString('en-US'));

// Pieces of the newsletter that are written as markdown; kept separate so each section reads on its own.
function glanceTable(groups) {
  return ['| Platform | Top game | Top riser |', '|---|---|---|', ...groups.map(({ platform, top, rising }) => `| ${LABELS[platform]} | ${top ? `${thumb(top)}${clean(top.name)}` : '–'} | ${rising ? `${thumb(rising)}${clean(rising.name)} (${Math.round(rising.risingScore)})` : '–'} |`)];
}

function gameRows(games, detail) {
  return games.length ? games.map((g) => `- ${thumb(g)}**${clean(g.name)}** — ${detail(g)} ([open](${g.url}))`) : ['- Nothing to show in this edition.'];
}

function socialSection(social) {
  if (!social) return ['_Social trends were not collected for this edition._'];
  const tags = (social.tags ?? []).slice(0, 8);
  const posts = (social.posts ?? []).slice(0, 5);
  const emerging = (social.emerging ?? []).slice(0, 8);
  return [
    '### Emerging topics',
    emerging.length
      ? ['| Topic | Uses today | Accounts | Was | Status |', '|---|---:|---:|---:|---|', ...emerging.map((t) => `| #${clean(t.name)} | ${num(t.uses)} | ${num(t.accounts)} | ${num(t.baseline)}/day | ${t.new ? 'New' : 'Rising'} |`)].join('\n')
      : '_Nothing emerging in this edition._',
    '',
    '### Hashtags on the server today',
    '| Hashtag | Uses | Accounts | Change | Kind |',
    '|---|---:|---:|---:|---|',
    ...tags.map((t) => `| #${clean(t.name)} | ${num(t.uses)} | ${num(t.accounts)} | ${trend(t.growth)} | ${t.game ? 'Game' : 'Other'} |`),
    '',
    '### Posts getting attention',
    ...(posts.length ? posts.map((p) => `- **@${clean(p.account)}**: ${clean(p.text).slice(0, 160)} (♥ ${num(p.likes)} · ↻ ${num(p.boosts)}) ([open](${p.url}))`) : ['- No trending posts in this edition.']),
  ];
}

export async function createNewsletter(slot = new Date(), scheduledTime = null) {
  const snapshot = await readJson('latest.json', null); if (!snapshot) return null;
  const time = scheduledTime || slot.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const slug = slotKey(slot, time);
  const groups = PLATFORMS.map((p) => {
    const games = (snapshot[p]?.games || []).map((g) => ({ ...g, platform: p }));
    return {
      platform: p,
      newGames: games.filter((g) => g.ageDays != null && g.ageDays <= 7).sort((a, b) => (b.playing ?? b.ratingCount ?? 0) - (a.playing ?? a.ratingCount ?? 0)).slice(0, 5),
      rising: risingGames(p, games, 5),
      top: topGames(p, games, 1)[0],
      topRising: risingGames(p, games, 1)[0],
    };
  });

  const newCount = groups.reduce((s, g) => s + g.newGames.length, 0);
  const risingCount = groups.reduce((s, g) => s + g.rising.length, 0);
  const social = snapshot.social ?? null;
  const hotTag = social?.tags?.[0];
  const callout = `> **${newCount} new games** and **${risingCount} rising picks** across ${groups.filter((g) => g.top).length} platforms${hotTag ? `. Hottest hashtag on the server: **#${clean(hotTag.name)}** with ${num(hotTag.uses)} uses today.` : '.'}`;

  const lines = [
    `# Game Radar Newsletter — ${slot.toLocaleDateString('en-US')} ${time}`,
    '',
    callout,
    '',
    '## At a glance',
    ...glanceTable(groups.map((g) => ({ platform: g.platform, top: g.top, rising: g.topRising }))),
    '',
    ...groups.flatMap(({ platform, rising }) => [
      `## Rising on ${LABELS[platform]}`,
      ...gameRows(rising, (g) => `score ${Math.round(g.risingScore)}; ${clean((g.reasons || []).slice(0, 2).join(', ')) || 'steady growth'}`),
      '',
    ]),
    '## New this week',
    ...groups.flatMap(({ platform, newGames }) => newGames.length ? [`### ${LABELS[platform]}`, ...gameRows(newGames, (g) => clean(g.genre || g.category || 'New release')), ''] : []),
    '## Trending on social',
    ...socialSection(social),
    '',
    '---',
    `_Generated ${slot.toLocaleString('en-US')}. Game data from the snapshot at ${snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleString('en-US') : 'an unknown time'}._`,
  ];

  const items = groups.flatMap(({ platform, newGames, rising }) => [...newGames, ...rising].map((g) => ({ platform, id: g.id, name: g.name, url: g.url, icon: g.icon, risingScore: g.risingScore, playing: g.playing, rank: g.rank, ratings: g.ratingCount })));
  const page = { slug, title: `Newsletter — ${slot.toLocaleDateString('en-US')} ${time}`, kind: 'newsletter', createdAt: new Date().toISOString(), scheduledFor: `${slot.toISOString().slice(0, 10)}T${time}`, summary: `${newCount} new games, ${risingCount} rising picks and social trends`, markdown: lines.join('\n'), items };
  await mkdir(dir(), { recursive: true }); await writeFile(path.join(dir(), `${slug}.json`), JSON.stringify(page, null, 2)); return page;
}
export async function listNewsletters() { try { const names = (await readdir(dir())).filter((n) => n.endsWith('.json')); return (await Promise.all(names.map((n) => readFile(path.join(dir(), n), 'utf8').then(JSON.parse)))).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)); } catch { return []; } }
export async function runNewsletterSchedule(now = new Date()) {
  const settings = await loadNewsletterSettings(); if (settings.enabled === false) return null;
  const times = (settings.times || []).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).sort();
  const current = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const due = times.filter((t) => t <= current).at(-1); if (!due) return null;
  const slug = slotKey(now, due); if ((await listNewsletters()).some((p) => p.slug === slug)) return null;
  return createNewsletter(now, due);
}
