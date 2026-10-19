import { clamp } from './util.mjs';

const MIN = 60e3;
const HOUR = 3600e3;

// Point from history closest to 24h ago (same time-of-day avoids day/night player swings),
// or the oldest point when we have less than a day. Must be at least 30 min old.
export function baselineFor(points, now) {
  const old = (points ?? []).filter((p) => now - p[0] >= 30 * MIN);
  if (!old.length) return null;
  const target = now - 24 * HOUR;
  const best = old.reduce((a, b) => (Math.abs(a[0] - target) <= Math.abs(b[0] - target) ? a : b));
  return { t: best[0], v: best[1], rank: best[2], live: best[3], hours: (now - best[0]) / HOUR };
}

// Weighted mean over the components that are available, scaled to 0-100.
function combine(components) {
  const live = components.filter((c) => c.value != null);
  const w = live.reduce((s, c) => s + c.weight, 0);
  const score = w ? (live.reduce((s, c) => s + c.weight * c.value, 0) / w) * 100 : 0;
  return { score: Math.round(score * 10) / 10, components: components.map((c) => ({ ...c, value: c.value == null ? null : Math.round(c.value * 100) / 100 })) };
}

// Downsample a history to at most n points for the client.
export function thin(points, n = 60) {
  if (!points || points.length <= n) return points ?? [];
  const step = (points.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => points[Math.round(i * step)]);
}

const pct = (x) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
const hrs = (h) => (h < 1.5 ? `${Math.round(h * 60)}m` : h < 36 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);

export function scoreRoblox(games, history, now) {
  const maxLog = Math.log10(Math.max(...games.map((g) => g.playing), 10));
  const ranked = [...games].sort((a, b) => b.playing - a.playing);
  ranked.forEach((g, i) => (g.rank = i + 1));

  for (const g of games) {
    const hist = history[`roblox:${g.id}`];
    const base = baselineFor(hist, now);
    if (base && base.v >= 100) {
      g.windowHours = base.hours;
      g.delta = g.playing - base.v;
      g.deltaPct = g.delta / base.v;
    }
    const place = (key, k) => (g.sorts[key] ? k * (1 - (g.sorts[key] - 1) / g.sortSizes[key]) : 0);
    const placement = Math.max(place('upAndComing', 1), place('trending', 0.8));
    const { score, components } = combine([
      { label: 'Player growth', weight: 0.35, value: g.deltaPct == null ? null : clamp(g.deltaPct / 0.75) },
      { label: 'Up-and-Coming / Trending placement', weight: 0.25, value: placement },
      { label: 'Freshness', weight: 0.15, value: g.ageDays == null ? null : Math.exp(-g.ageDays / 150) },
      { label: 'Player approval', weight: 0.1, value: g.likeRatio == null ? null : clamp((g.likeRatio - 0.6) / 0.4) },
      { label: 'Scale', weight: 0.15, value: clamp((Math.log10(Math.max(g.playing, 1)) - 3) / Math.max(maxLog - 3, 0.5)) },
    ]);
    g.risingScore = g.playing >= 1000 ? score : null;
    g.components = components;

    const why = [];
    if (g.deltaPct != null && g.deltaPct >= 0.05) why.push(`${pct(g.deltaPct)} players vs ${hrs(g.windowHours)} ago`);
    if (g.sorts.upAndComing) why.push(`Up-and-Coming #${g.sorts.upAndComing}`);
    if (g.sorts.trending) why.push(`Trending #${g.sorts.trending}`);
    if (g.ageDays != null && g.ageDays < 45) why.push(`Launched ${Math.max(1, Math.round(g.ageDays))}d ago`);
    if (g.likeRatio != null && g.likeRatio >= 0.9) why.push(`${Math.round(g.likeRatio * 100)}% liked`);
    g.reasons = why;
    g.hist = thin((hist ?? []).map((p) => [p[0], p[1]]));
  }
}

export function scorePoki(games, history, now) {
  const vpd = (g) => (g.ageDays == null ? null : g.ratingCount / Math.max(g.ageDays, 7));
  const maxVpd = Math.max(...games.map((g) => vpd(g) ?? 0), 1);

  for (const g of games) {
    const hist = history[`poki:${g.id}`];
    const base = baselineFor(hist, now);
    const life = vpd(g);
    g.votesPerDay = life;

    let accel = null;
    if (base && base.hours >= 3 && life) {
      g.windowHours = base.hours;
      g.deltaVotes = g.ratingCount - base.v;
      accel = g.deltaVotes / (base.hours / 24) / life; // recent votes/day vs lifetime average
      g.accel = accel;
    }
    let climb = null;
    if (base) {
      g.windowHours = g.windowHours ?? base.hours;
      if (g.rank && base.rank) g.rankDelta = base.rank - g.rank; // positive = moved up
      else if (g.rank && !base.rank) g.rankDelta = null, (climb = 0.7);
      if (g.rankDelta != null) climb = clamp(g.rankDelta / 20);
    }

    let liveGrowth = null;
    if (base?.live > 0 && g.live > 0) {
      g.liveDelta = (g.live - base.live) / base.live;
      liveGrowth = clamp(g.liveDelta / 0.5);
    }

    const { score, components } = combine([
      { label: "Poki's own Trending rank", weight: 0.25, value: g.trendingRank ? clamp(1 - (g.trendingRank - 1) / 50) : 0 },
      { label: 'Votes per day since launch', weight: 0.2, value: life == null ? null : clamp(Math.log10(life + 1) / Math.log10(maxVpd + 1)) },
      { label: 'Freshness', weight: 0.15, value: g.ageDays == null ? null : Math.exp(-g.ageDays / 200) },
      { label: 'Position in Popular list', weight: 0.15, value: g.rank ? 1 - (g.rank - 1) / g.popularSize : 0 },
      { label: 'Live player growth (estimate)', weight: 0.1, value: liveGrowth },
      { label: 'Vote acceleration', weight: 0.1, value: accel == null ? null : clamp((accel - 1) / 2) },
      { label: 'Climb in Popular list', weight: 0.05, value: climb },
    ]);
    g.risingScore = score;
    g.components = components;

    const why = [];
    if (g.trendingRank && g.trendingRank <= 20) why.push(`Poki Trending #${g.trendingRank}`);
    if (g.liveDelta >= 0.2) why.push(`Live players ${pct(g.liveDelta)} vs ${hrs(g.windowHours)} ago`);
    if (g.rankDelta >= 3) why.push(`Up ${g.rankDelta} spots in Popular`);
    if (accel != null && accel >= 1.3) why.push(`Votes ${accel.toFixed(1)}x faster than average`);
    if (g.ageDays != null && g.ageDays < 60) why.push(`Published ${Math.max(1, Math.round(g.ageDays))}d ago`);
    if (life && g.ageDays != null && g.ageDays < 365) why.push(`${Math.round(life).toLocaleString('en-US')} votes/day`);
    if (g.weekRank) why.push(`Popular this week #${g.weekRank}`);
    g.reasons = why;
    g.hist = thin((hist ?? []).map((p) => [p[0], p[1], p[2], p[3]]));
  }
}
