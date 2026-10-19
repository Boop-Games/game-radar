#!/usr/bin/env node
import { readFile, access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { topGames, risingGames, PLATFORMS, LABELS } from '../src/rank.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appData = process.env.APPDATA ? path.join(process.env.APPDATA, 'Game Radar', 'data') : null;
async function dataDir(flag) {
  const candidates = [flag, process.env.GAME_RADAR_DATA, appData, path.join(root, 'data')].filter(Boolean);
  for (const d of candidates) try { await access(path.join(d, 'latest.json')); return d; } catch {}
  return candidates.at(-1);
}
const usage = `Game Radar CLI
Usage: game-radar <status|top|rising|list|game|search|keywords|report|refresh|help> [options]
Platforms: Roblox uses live players; Poki live is bucketed and ties use Popular rank; iOS/Android have no player counts and use Top Free chart rank; Android uses an unofficial Play scraper; all data is US by default.
JSON fields: position is the platform ordering, risingScore is 0-100, reasons explains the score, hist is raw history with [time, primary, chart rank, extra].
Options: --data DIR --format json|table|md --json --full --fields a,b,c -n N --limit N`;
const fail = (msg, code = 1) => { if (wantJson) console.log(JSON.stringify({ error: msg, hint: 'Run game-radar help for usage.' })); else console.error(msg); process.exitCode = code; };
let wantJson = false;
const argv = process.argv.slice(2), command = argv[0] || 'help', platformArg = argv[1];
let opts;
try { opts = parseArgs({ args: argv.slice(1), options: { data: { type: 'string' }, format: { type: 'string' }, json: { type: 'boolean', short: 'j' }, full: { type: 'boolean' }, fields: { type: 'string' }, limit: { type: 'string', short: 'n' }, sort: { type: 'string' }, asc: { type: 'boolean' }, genre: { type: 'string' }, 'max-age-days': { type: 'string' }, search: { type: 'string' }, 'no-phrases': { type: 'boolean' }, wait: { type: 'boolean' }, platform: { type: 'string' } }, allowPositionals: true }).values; } catch (e) { fail(e.message); process.exit(); }
wantJson = opts.json || opts.format === 'json' || !process.stdout.isTTY;
const format = opts.format || (process.stdout.isTTY ? 'table' : 'json');
if (command === 'help' || opts.help) { console.log(usage); process.exit(0); }
const dir = await dataDir(opts.data);
process.env.GAME_RADAR_DATA = dir;
let snapshot; try { snapshot = JSON.parse(await readFile(path.join(dir, 'latest.json'), 'utf8')); } catch { fail(`No snapshot found in ${dir}`, 2); process.exit(); }
const snapshotTime = snapshot.updatedAt ? (typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : Date.parse(snapshot.updatedAt)) : NaN;
const age = Number.isFinite(snapshotTime) ? Math.max(0, (Date.now() - snapshotTime) / 60000) : Infinity;
const envelope = (items, platform = platformArg) => ({ command, platform: platform || 'all', updatedAt: snapshot.updatedAt ? new Date(snapshot.updatedAt).toISOString() : null, dataAgeMinutes: Math.round(age), stale: age > 20, count: items.length, items });
const compact = (g, position) => ({ position, id: g.id, name: g.name, url: g.url, risingScore: g.risingScore, reasons: g.reasons || [], ageDays: g.ageDays, released: g.released || g.created || g.published, ...(g.platform === 'roblox' ? { playing: g.playing, deltaPct: g.deltaPct, likeRatio: g.likeRatio, visits: g.visits, genre: g.genre } : {}), ...(g.platform === 'poki' ? { live: g.live, trendingRank: g.trendingRank, popularRank: g.rank, votes: g.ratingCount, rating: g.ratingValue, category: g.category } : {}), ...(g.platform === 'ios' || g.platform === 'android' ? { rank: g.rank, grossingRank: g.grossingRank, ratings: g.ratingCount, rating: g.ratingValue, ratingsPerDay: g.votesPerDay, genre: g.genre, developer: g.developer, ...(g.platform === 'ios' ? { newRank: g.newRank } : { installs: g.installs, installsLabel: g.installsLabel }) } : {}) });
const emit = (env) => { let out = env.items; if (opts.fields) out = out.map(x => Object.fromEntries(opts.fields.split(',').filter(k => k in x).map(k => [k, x[k]]))); if (opts.full) out = env.items; env.items = out; if (format === 'json' || wantJson) console.log(JSON.stringify(env, null, 2)); else if (format === 'md') { console.log(`| Position | Name | Score |\n|---:|---|---:|`); out.forEach(x => console.log(`| ${x.position ?? ''} | ${x.name} | ${x.risingScore ?? ''} |`)); } else { console.log(`Game Radar · ${env.platform} · ${env.count} items${env.stale ? ' · STALE' : ''}`); out.forEach(x => console.log(`${String(x.position ?? '').padStart(3)}  ${x.name}  ${x.risingScore ?? ''}`)); } };
const selected = platformArg === 'all' || !platformArg ? PLATFORMS : [platformArg];
if (command === 'status') { const items = PLATFORMS.map(p => ({ platform: p, games: snapshot[p]?.games?.length || 0, updatedAt: snapshot[p]?.updatedAt || null, error: snapshot.errors?.[p] || null })); emit(envelope(items, 'all')); }
else if (command === 'top' || command === 'rising') { const all = selected.flatMap(p => (snapshot[p]?.games || []).map(g => ({ ...g, platform: p }))); const items = selected.flatMap(p => { const gs = (snapshot[p]?.games || []).map(g => ({ ...g, platform: p })); return (command === 'top' ? topGames(p, gs, Number(opts.limit || 10)) : risingGames(p, gs, Number(opts.limit || 10))).map((g, i) => compact(g, i + 1)); }); emit(envelope(items, platformArg)); }
else if (command === 'list') { if (!PLATFORMS.includes(platformArg)) fail('list requires a platform', 1); else { let gs = (snapshot[platformArg]?.games || []).map(g => ({ ...g, platform: platformArg })); if (opts.genre) gs = gs.filter(g => (g.genre || g.category) === opts.genre); if (opts.search) gs = gs.filter(g => g.name.toLowerCase().includes(opts.search.toLowerCase())); if (opts['max-age-days']) gs = gs.filter(g => g.ageDays <= Number(opts['max-age-days'])); const key = opts.sort; if (key) gs.sort((a,b) => (typeof a[key] === 'string' ? String(a[key]).localeCompare(String(b[key])) : (a[key] ?? -Infinity) - (b[key] ?? -Infinity)) * (opts.asc ? 1 : -1)); emit(envelope(gs.slice(0, Number(opts.limit || gs.length)).map((g,i) => opts.full ? { position: i+1, ...g } : compact(g,i+1)), platformArg)); } }
else if (command === 'search') { const q = platformArg?.toLowerCase() || ''; emit(envelope(PLATFORMS.flatMap(p => (snapshot[p]?.games || []).filter(g => g.name.toLowerCase().includes(q)).map((g,i) => compact({ ...g, platform:p }, i+1))), 'all')); }
else if (command === 'game') { const p = platformArg, q = argv[2]?.toLowerCase(); const gs = snapshot[p]?.games || []; const hits = gs.filter(g => g.id === q || g.name.toLowerCase().includes(q || '')); if (hits.length !== 1) { fail(hits.length ? `Ambiguous match: ${hits.map(g=>g.name).join(', ')}` : 'Game not found', 2); } else emit(envelope([opts.full ? hits[0] : compact({ ...hits[0], platform:p }, 1)], p)); }
else if (command === 'keywords') { const ps = selected; const items = ps.flatMap(p => (snapshot[p]?.terms || []).filter(t => opts['no-phrases'] ? !t.phrase : true).slice(0, Number(opts.limit || 25)).map(t => ({ platform:p, ...t }))); emit(envelope(items, platformArg)); }
else if (command === 'report') {
  const kind = platformArg || 'popular-not-on-poki';
  if (kind !== 'popular-not-on-poki') { fail(`Unknown report: ${kind}`, 1); }
  else {
    const poki = new Set((snapshot.poki?.games || []).map(g => g.name.toLowerCase().replace(/[^a-z0-9]/g, '')));
    const sources = ['roblox', 'ios', 'android'];
    const matches = sources.flatMap(p => (snapshot[p]?.games || []).map(g => ({ ...g, platform: p })).filter(g => !poki.has(g.name.toLowerCase().replace(/[^a-z0-9]/g, ''))).map((g, i) => compact(g, i + 1))).sort((a, b) => (b.playing ?? b.ratings ?? 0) - (a.playing ?? a.ratings ?? 0)).slice(0, Number(opts.limit || 50));
    const slug = `popular-not-on-poki-${Date.now()}`;
    const title = 'Popular games not yet on Poki';
    const lines = [`# ${title}`, '', `Generated ${new Date().toISOString()} from the current Game Radar snapshot.`, '', `Compared ${sources.map(p => LABELS[p]).join(', ')} against ${snapshot.poki?.games?.length || 0} Poki games using normalized exact title matching.`, '', '| Platform | Game | Signal | Link |', '|---|---|---:|---|', ...matches.map(g => `| ${g.platform} | ${g.name.replaceAll('|', '\\|')} | ${g.playing ?? g.rank ?? g.ratings ?? ''} | [Open](${g.url}) |`), '', `**${matches.length} candidates found.** Names may differ across platforms, so review this as a research shortlist.`];
    const page = { slug, title, kind, createdAt: new Date().toISOString(), snapshotUpdatedAt: snapshot.updatedAt, summary: `${matches.length} popular games found outside Poki`, markdown: lines.join('\n'), items: matches };
    await mkdir(path.join(dir, 'pages'), { recursive: true });
    await writeFile(path.join(dir, 'pages', `${slug}.json`), JSON.stringify(page, null, 2));
    emit(envelope([{ slug, title, createdAt: page.createdAt, summary: page.summary, items: matches }], 'all'));
  }
}
else if (command === 'refresh') { const { runCollection } = await import('../src/collect.mjs'); const only = opts.platform?.split(','); const result = await runCollection({ only }); emit(envelope(PLATFORMS.flatMap(p => [{ platform:p, games: result[p]?.games?.length || 0 }]), 'all')); }
else fail(`Unknown command: ${command}`, 1);
