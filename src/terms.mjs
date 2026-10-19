import { baselineFor } from './scoring.mjs';

// Words that carry no theme. Platform/boilerplate words are listed too.
const STOP = new Set(
  `the and for with you your are this that from into out its our not but all can has have was will just more most one two new now get got play plays played playing free online game games gamer roblox poki update upd updated updates code codes beta alpha version best top fun cool super mega ultra how what when who why where then than them they their there here were been being also very much many some any each other over under only own same too out off per via use used using make makes made let lets way ways may might must shall should would could about above after again against because before below between both during further once until while does did done doing`.split(/\s+/),
);

const tokenize = (text) =>
  (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [])
    .map((w) => w.replace(/'s$/, '').replace(/'/g, ''))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));

const useful = (w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w);

// Unigrams and bigrams for one text (bigrams only across adjacent non-stop words in the original order).
function grams(text) {
  const toks = tokenize(text);
  const out = new Set();
  for (let i = 0; i < toks.length; i++) {
    if (!useful(toks[i])) continue;
    out.add(toks[i]);
    if (i + 1 < toks.length && useful(toks[i + 1]) && toks[i] !== toks[i + 1]) out.add(`${toks[i]} ${toks[i + 1]}`);
  }
  return out;
}

// How much "popularity" a game carries: live players on both platforms (Poki's figure is a rounded estimate).
const weight = (g) => (g.platform === 'roblox' ? g.playing : g.live ?? 0);

export function computeTerms(platform, games, history, now) {
  const total = games.reduce((s, g) => s + weight(g), 0) || 1;
  const map = new Map();
  for (const g of games) {
    const inTitle = grams(g.name);
    const inDesc = grams(g.desc ?? '');
    for (const t of new Set([...inTitle, ...inDesc])) {
      const e = map.get(t) ?? { term: t, titleGames: 0, descGames: 0, weight: 0, games: [] };
      if (inTitle.has(t)) {
        e.titleGames++;
        e.weight += weight(g);
        e.games.push(g);
      } else e.descGames++;
      map.set(t, e);
    }
  }

  // Titles define themes ("egg", "brainrot"); descriptions are generic, so they only add a mention count.
  const kept = [...map.values()]
    .filter((e) => e.titleGames >= 2)
    .sort((a, b) => b.weight - a.weight || b.games.length - a.games.length)
    .slice(0, 150);

  const out = [];
  for (const e of kept) {
    const share = e.weight / total;
    const key = `term:${platform}:${e.term}`;
    (history[key] ??= []).push([now, share]);
    const base = baselineFor(history[key], now);
    e.games.sort((a, b) => weight(b) - weight(a));
    out.push({
      term: e.term,
      phrase: e.term.includes(' '),
      count: e.titleGames,
      mentions: e.descGames,
      share,
      shareDelta: base && base.v > 0 ? (share - base.v) / base.v : null,
      windowHours: base?.hours ?? null,
      avgRising: Math.round((e.games.reduce((s, g) => s + (g.risingScore ?? 0), 0) / e.games.length) * 10) / 10,
      games: e.games.slice(0, 12).map((g) => ({ id: g.id, name: g.name })),
    });
  }
  return out;
}
