// Shared definitions of "top" and "rising" per platform. Used by notifications and the CLI;
// the dashboard (public/app.js) applies the same ordering.
export const PLATFORMS = ['roblox', 'poki', 'crazygames', 'ios', 'android'];
export const LABELS = { roblox: 'Roblox', poki: 'Poki', crazygames: 'CrazyGames', ios: 'iOS', android: 'Android' };

const nullsLast = (v) => v ?? 1e9;

const ORDER = {
  // Real concurrent players.
  roblox: (a, b) => b.playing - a.playing,
  // Poki's live estimate is bucketed (1,000 / 5,000 ...), so ties fall back to its Popular order.
  poki: (a, b) => (b.live ?? 0) - (a.live ?? 0) || nullsLast(a.rank) - nullsLast(b.rank),
  // CrazyGames has no player counts: position in its Hot list, then the New list.
  crazygames: (a, b) => nullsLast(a.rank) - nullsLast(b.rank) || nullsLast(a.newRank) - nullsLast(b.newRank),
  // Mobile: position in the Top Free chart, then Top Grossing.
  ios: (a, b) => nullsLast(a.rank) - nullsLast(b.rank) || nullsLast(a.grossingRank) - nullsLast(b.grossingRank),
  android: (a, b) => nullsLast(a.rank) - nullsLast(b.rank) || nullsLast(a.grossingRank) - nullsLast(b.grossingRank),
};

export const topGames = (platform, games, n = 10) => [...games].sort(ORDER[platform]).slice(0, n);

export const risingGames = (platform, games, n = 10) =>
  games
    .filter((g) => g.risingScore != null)
    .sort((a, b) => b.risingScore - a.risingScore)
    .slice(0, n);
