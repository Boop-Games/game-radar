import { PLATFORMS, LABELS, topGames } from './rank.mjs';

const STALE = 6 * 3600e3; // after a long gap everything looks "new", so don't alert

const detail = (platform, g) => {
  if (platform === 'roblox') return `${g.playing.toLocaleString('en-US')} playing`;
  if (platform === 'poki') return g.live != null ? `${g.live.toLocaleString('en-US')}+ live` : 'now popular';
  if (platform === 'crazygames') return `Hot #${g.rank}`;
  return `Top Free #${g.rank}`;
};

// Games that entered a Top 10 since the previous snapshot.
export function findAlerts(prev, next) {
  if (!prev || next.updatedAt - prev.updatedAt > STALE) return [];
  const out = [];
  for (const platform of PLATFORMS) {
    const before = prev[platform]?.games;
    const after = next[platform]?.games;
    // Skip platforms that failed this round or weren't refreshed (mobile refreshes less often).
    if (!before || !after || next.errors?.[platform] || prev[platform].updatedAt === next[platform].updatedAt) continue;
    const seen = new Set(topGames(platform, before).map((g) => g.id));
    topGames(platform, after).forEach((g, i) => {
      if (seen.has(g.id)) return;
      out.push({ key: `${platform}:${g.id}`, title: `${g.name} entered the ${LABELS[platform]} Top 10`, body: `#${i + 1} · ${detail(platform, g)}` });
    });
  }
  return out;
}
