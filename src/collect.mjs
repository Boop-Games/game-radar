import { fileURLToPath } from 'node:url';
import { collectRoblox } from './roblox.mjs';
import { collectPoki } from './poki.mjs';
import { scoreRoblox, scorePoki } from './scoring.mjs';
import { computeTerms } from './terms.mjs';
import { loadHistory, saveHistory, loadLatest, saveLatest, appendHistory } from './store.mjs';

// Fetch both platforms, score them against stored history and persist a new snapshot.
// If one platform fails, its previous data is kept and flagged so the dashboard still works.
export async function runCollection() {
  const now = Date.now();
  const [prev, history] = await Promise.all([loadLatest(), loadHistory()]);
  const [rb, pk] = await Promise.allSettled([collectRoblox(), collectPoki()]);

  const snap = { updatedAt: now, errors: {}, roblox: prev?.roblox ?? null, poki: prev?.poki ?? null };

  for (const [name, res, score] of [
    ['roblox', rb, scoreRoblox],
    ['poki', pk, scorePoki],
  ]) {
    if (res.status === 'fulfilled') {
      appendHistory(history, name, res.value, now);
      score(res.value, history, now);
      const terms = computeTerms(name, res.value, history, now);
      appendHistory(history, `term:${name}`, [], now); // prune old term samples
      for (const g of res.value) delete g.desc; // only needed for the keyword pass
      snap[name] = { updatedAt: now, games: res.value, terms };
    } else {
      snap.errors[name] = res.reason?.message ?? String(res.reason);
      console.warn(`[${name}] collection failed: ${snap.errors[name]}`);
    }
  }
  if (!snap.roblox && !snap.poki) throw new Error('Both sources failed: ' + JSON.stringify(snap.errors));

  await Promise.all([saveHistory(history), saveLatest(snap)]);
  return snap;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await runCollection();
  console.log(`roblox: ${s.roblox?.games.length ?? 0} games, poki: ${s.poki?.games.length ?? 0} games`);
}
