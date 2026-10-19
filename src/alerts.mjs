const TOP = 10;
const STALE = 6 * 3600e3; // after a long gap everything looks "new", so don't alert

// Same ordering as the dashboard's Top 10.
const topRoblox = (games) => [...games].sort((a, b) => b.playing - a.playing).slice(0, TOP);
const topPoki = (games) =>
  [...games].sort((a, b) => (b.live ?? 0) - (a.live ?? 0) || (a.rank ?? 1e9) - (b.rank ?? 1e9)).slice(0, TOP);

// Games that entered a Top 10 since the previous snapshot.
export function findAlerts(prev, next) {
  if (!prev || next.updatedAt - prev.updatedAt > STALE) return [];
  const out = [];
  for (const [platform, label, top] of [
    ['roblox', 'Roblox', topRoblox],
    ['poki', 'Poki', topPoki],
  ]) {
    if (!prev[platform] || !next[platform] || next.errors?.[platform]) continue;
    const before = new Set(top(prev[platform].games).map((g) => g.id));
    top(next[platform].games).forEach((g, i) => {
      if (before.has(g.id)) return;
      const detail = platform === 'roblox' ? `${g.playing.toLocaleString('en-US')} playing` : g.live != null ? `${g.live.toLocaleString('en-US')}+ live` : 'now popular';
      out.push({ key: `${platform}:${g.id}`, title: `${g.name} entered the ${label} Top 10`, body: `#${i + 1} · ${detail}` });
    });
  }
  return out;
}
