import { fileURLToPath } from 'node:url';
import { collectRoblox } from './roblox.mjs';
import { collectPoki } from './poki.mjs';
import { collectCrazyGames } from './crazygames.mjs';
import { collectIos } from './ios.mjs';
import { collectAndroid } from './android.mjs';
import { scoreRoblox, scorePoki, scoreCrazyGames, scoreMobile } from './scoring.mjs';
import { computeTerms } from './terms.mjs';
import { collectSocial } from './social.mjs';
import { loadHistory, saveHistory, loadLatest, saveLatest, saveSnapshot, appendHistory } from './store.mjs';

const MOBILE_EVERY = (Number(process.env.MOBILE_REFRESH_MINUTES) || 30) * 60e3;
const SOCIAL_EVERY = (Number(process.env.SOCIAL_REFRESH_MINUTES) || 15) * 60e3;

// `every` is how often a platform is re-fetched. Mobile needs one request per app on Google Play and
// its charts move slowly, so it refreshes less often than Roblox and Poki.
const SOURCES = [
  { name: 'roblox', collect: collectRoblox, score: scoreRoblox, every: 0 },
  { name: 'poki', collect: collectPoki, score: scorePoki, every: 0 },
  { name: 'crazygames', collect: collectCrazyGames, score: scoreCrazyGames, every: 0 },
  { name: 'ios', collect: collectIos, score: scoreMobile, every: MOBILE_EVERY },
  { name: 'android', collect: collectAndroid, score: scoreMobile, every: MOBILE_EVERY },
];

// Fetch the platforms that are due, score them against stored history and persist a new snapshot.
// If one platform fails, its previous data is kept and flagged so the dashboard still works.
// `only` limits the run to some platforms and ignores the schedule (used by the CLI).
export async function runCollection({ only } = {}) {
  const now = Date.now();
  const [prev, history] = await Promise.all([loadLatest(), loadHistory()]);
  const due = SOURCES.filter((s) => (only ? only.includes(s.name) : !prev?.[s.name] || now - prev[s.name].updatedAt >= s.every - 5000));

  const socialDue = only ? only.includes('social') : !prev?.social || now - prev.social.updatedAt >= SOCIAL_EVERY - 5000;

  const results = await Promise.allSettled(due.map((s) => s.collect()));
  const snap = { updatedAt: now, errors: {} };
  for (const s of SOURCES) snap[s.name] = prev?.[s.name] ?? null;
  // Social trends are separate from the game platforms: not scored, not in the Top 10 alerts.
  snap.social = prev?.social ?? null;
  if (socialDue) {
    try {
      snap.social = await collectSocial();
    } catch (e) {
      snap.errors.social = e.message;
      console.warn(`[social] collection failed: ${e.message}`);
    }
  }

  due.forEach((s, i) => {
    const res = results[i];
    if (res.status === 'fulfilled') {
      appendHistory(history, s.name, res.value, now);
      s.score(res.value, history, now);
      const terms = computeTerms(s.name, res.value, history, now);
      appendHistory(history, `term:${s.name}`, [], now); // prune old term samples
      for (const g of res.value) delete g.desc; // only needed for the keyword pass
      snap[s.name] = { updatedAt: now, games: res.value, terms };
    } else {
      snap.errors[s.name] = res.reason?.message ?? String(res.reason);
      console.warn(`[${s.name}] collection failed: ${snap.errors[s.name]}`);
    }
  });
  if (due.length && SOURCES.every((s) => !snap[s.name])) throw new Error('All sources failed: ' + JSON.stringify(snap.errors));

  await Promise.all([saveHistory(history), saveLatest(snap), saveSnapshot(snap, now)]);
  return snap;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await runCollection({ only: process.argv.slice(2).length ? process.argv.slice(2) : undefined });
  console.log(SOURCES.map((x) => `${x.name}: ${s[x.name]?.games.length ?? 0}`).join(', '));
}
