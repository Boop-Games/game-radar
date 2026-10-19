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
const clean = (s) => String(s ?? '').replace(/[|\r\n]/g, ' ').trim();
export async function createNewsletter(slot = new Date(), scheduledTime = null) {
  const snapshot = await readJson('latest.json', null); if (!snapshot) return null;
  const time = scheduledTime || slot.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const slug = slotKey(slot, time);
  const groups = PLATFORMS.map((p) => {
    const games = (snapshot[p]?.games || []).map((g) => ({ ...g, platform: p }));
    return { platform: p, newGames: games.filter((g) => g.ageDays != null && g.ageDays <= 7).sort((a, b) => (b.playing ?? b.ratingCount ?? 0) - (a.playing ?? a.ratingCount ?? 0)).slice(0, 5), rising: risingGames(p, games, 5) };
  });
  const lines = [`# Game Radar Newsletter — ${slot.toLocaleDateString('en-US')} ${time}`, '', `Generated for the ${time} local-time edition.`, '', '## New games', ...groups.flatMap(({ platform, newGames }) => [`### ${LABELS[platform]}`, ...(newGames.length ? newGames.map((g) => `- **${clean(g.name)}** — ${clean(g.genre || g.category)} ([open](${g.url}))`) : ['- No recent additions in this snapshot.'])]), '', '## Rising now', ...groups.flatMap(({ platform, rising }) => [`### ${LABELS[platform]}`, ...(rising.length ? rising.map((g) => `- **${clean(g.name)}** — rising score ${Math.round(g.risingScore)}; ${clean((g.reasons || []).slice(0, 2).join(', '))} ([open](${g.url}))`) : ['- No rising games yet.'])])];
  const items = groups.flatMap(({ platform, newGames, rising }) => [...newGames, ...rising].map((g) => ({ platform, id: g.id, name: g.name, url: g.url, risingScore: g.risingScore, playing: g.playing, rank: g.rank, ratings: g.ratingCount })));
  const page = { slug, title: `Newsletter — ${slot.toLocaleDateString('en-US')} ${time}`, kind: 'newsletter', createdAt: new Date().toISOString(), scheduledFor: `${slot.toISOString().slice(0, 10)}T${time}`, summary: 'New and rising games across all tracked platforms', markdown: lines.join('\n'), items };
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
