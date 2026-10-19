'use strict';

const $ = (s) => document.querySelector(s);
const PLATFORMS = ['roblox', 'poki', 'ios', 'android'];
const COLORS = { roblox: 'var(--roblox)', poki: 'var(--poki)', ios: 'var(--ios)', android: 'var(--android)' };
const NAMES = { roblox: 'Roblox', poki: 'Poki', ios: 'iOS', android: 'Android' };
const isMobile = (p) => p === 'ios' || p === 'android';
const perPlatform = (v) => Object.fromEntries(PLATFORMS.map((p) => [p, typeof v === 'function' ? v(p) : v]));

const state = {
  data: null,
  status: null,
  tab: location.hash.slice(1) || 'overview',
  q: perPlatform(''),
  cat: perPlatform(''),
  sort: { roblox: ['playing', -1], poki: ['live', -1], ios: ['rank', 1], android: ['rank', 1] },
  limit: perPlatform(50),
  open: null,
  kw: { q: '', sort: 'count', phrases: true, open: new Set(), limit: perPlatform(40) },
  pages: [],
  newsletters: [],
  newsletterSettings: { times: ['09:00', '13:00', '17:00'], enabled: true },
  overviewPlatforms: new Set(PLATFORMS),
};

// ---------- formatting ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const compact = (n) => (n == null ? '–' : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: n >= 1e5 ? 1 : 2 }).format(n));
const full = (n) => (n == null ? '–' : Math.round(n).toLocaleString('en-US'));
const pct = (x, d = 0) => (x == null ? '–' : `${(x * 100).toFixed(d)}%`);
const ageStr = (d) => (d == null ? '–' : d < 1 ? 'today' : d < 60 ? `${Math.round(d)}d` : d < 730 ? `${Math.round(d / 30)}mo` : `${(d / 365).toFixed(1)}y`);
const hrsStr = (h) => (h < 1.5 ? `${Math.round(h * 60)}m` : h < 36 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);
const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};
const icon = (g) => `<img class="ic" src="${esc(g.icon || '')}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;

// ---------- derived lists ----------
const games = (p) => state.data?.[p]?.games ?? [];
// Same ordering as src/rank.mjs. Poki's live figure is bucketed, so ties fall back to its Popular order;
// mobile has no player counts, so it ranks by Top Free chart position.
const nl = (v) => v ?? 1e9;
const ORDER = {
  roblox: (a, b) => b.playing - a.playing,
  poki: (a, b) => (b.live ?? 0) - (a.live ?? 0) || nl(a.rank) - nl(b.rank),
  ios: (a, b) => nl(a.rank) - nl(b.rank) || nl(a.grossingRank) - nl(b.grossingRank),
  android: (a, b) => nl(a.rank) - nl(b.rank) || nl(a.grossingRank) - nl(b.grossingRank),
};
const topList = (p, n = 10) => [...games(p)].sort(ORDER[p]).slice(0, n);
// What the bar under each Top 10 row is scaled against.
const barValue = (g) => (g.platform === 'roblox' ? g.playing : g.platform === 'poki' ? g.live ?? 0 : g.ratingCount ?? 0);
const topMax = (p, list) => Math.max(...list.map(barValue), 1);
const risers = (p, n = 10) => games(p).filter((g) => g.risingScore != null).sort((a, b) => b.risingScore - a.risingScore).slice(0, n);

// ---------- small svg charts ----------
function sparkVals(g) {
  const h = g.hist ?? [];
  let v;
  if (g.platform === 'roblox') v = h.map((p) => p[1]);
  else if (isMobile(g.platform)) v = h.filter((p) => p[2]).map((p) => -p[2]); // chart position, up = better
  else {
    v = h.filter((p) => p[3] != null).map((p) => p[3]);
    if (new Set(v).size < 2) v = h.filter((p) => p[2]).map((p) => -p[2]); // live buckets flat: show Popular-list movement instead
  }
  return v.length > 1 ? v : null;
}
function spark(vals, color, w = 70, h = 24) {
  if (!vals) return '<span></span>';
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function chart(points, color, fmt, invert = false) {
  if (points.length < 2) return '<p class="note">Not enough history yet. A trend line builds up as the app keeps running.</p>';
  const W = 440, H = 150, pl = 8, pb = 20;
  const ys = points.map((p) => p[1]);
  const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
  const t0 = points[0][0], t1 = points[points.length - 1][0];
  const x = (t) => pl + ((t - t0) / (t1 - t0 || 1)) * (W - pl * 2);
  const y = (v) => 8 + (1 - (v - min) / span) * (H - pb - 16);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const area = `${line}L${x(t1).toFixed(1)},${H - pb}L${x(t0).toFixed(1)},${H - pb}Z`;
  const lo = invert ? max : min, hi = invert ? min : max;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="history chart">
    <path d="${area}" fill="${color}" opacity=".12"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    <text x="${pl}" y="14" fill="#8b94ab" font-size="11">${fmt(hi)}</text><text x="${pl}" y="${H - pb - 4}" fill="#8b94ab" font-size="11">${fmt(lo)}</text>
    <text x="${pl}" y="${H - 4}" fill="#8b94ab" font-size="11">${hrsStr((t1 - t0) / 3.6e6)} ago</text><text x="${W - pl}" y="${H - 4}" text-anchor="end" fill="#8b94ab" font-size="11">now</text></svg>`;
}

// ---------- building blocks ----------
function deltaChip(g) {
  if (g.platform === 'roblox') {
    if (g.deltaPct == null || Math.abs(g.deltaPct) < 0.01) return '';
    return `<span class="chip ${g.deltaPct > 0 ? 'up' : 'dn'}" title="vs ${hrsStr(g.windowHours)} ago">${g.deltaPct > 0 ? '▲' : '▼'} ${Math.abs(Math.round(g.deltaPct * 100))}%</span>`;
  }
  if (!g.rankDelta) return '';
  return `<span class="chip ${g.rankDelta > 0 ? 'up' : 'dn'}" title="vs ${hrsStr(g.windowHours)} ago">${g.rankDelta > 0 ? '▲' : '▼'} ${Math.abs(g.rankDelta)}</span>`;
}

function topRow(g, i, max) {
  const p = g.platform;
  const val = p === 'roblox' ? full(g.playing) : p === 'poki' ? (g.live != null ? `${full(g.live)}+` : '–') : compact(g.ratingCount);
  const small = p === 'roblox' ? 'playing now' : p === 'poki' ? 'live (estimate)' : 'ratings';
  const w = barValue(g) / max;
  const extra =
    p === 'roblox' ? '' :
    p === 'poki' ? `${g.rank ? ` · Popular #${g.rank}` : ''}${g.trendingRank ? ` · Trending #${g.trendingRank}` : ''}` :
    `${g.rank ? ` · Free #${g.rank}` : ''}${g.grossingRank ? ` · Grossing #${g.grossingRank}` : ''}${g.installsLabel ? ` · ${esc(g.installsLabel)}` : ''}`;
  return `<div class="row" data-open="${p}:${esc(g.id)}">
    <div class="rk">${i + 1}</div>${icon(g)}
    <div><div class="nm">${esc(g.name)} ${deltaChip(g)}</div><div class="meta">${esc(g.genre ?? g.category)} · ${ageStr(g.ageDays)} old${extra}</div>
    <div class="bar"><i style="width:${Math.max(3, w * 100).toFixed(1)}%;background:${COLORS[g.platform]}"></i></div></div>
    <div class="val num">${val}<small>${small}</small></div>${spark(sparkVals(g), COLORS[g.platform])}</div>`;
}

function legacyTopRow(g, i, max) {
  const p = g.platform;
  const val = p === 'roblox' ? full(g.playing) : p === 'poki' ? (g.live != null ? `${full(g.live)}+` : '–') : compact(g.ratingCount);
  const small = p === 'roblox' ? 'playing now' : p === 'poki' ? 'live (estimate)' : 'ratings';
  const extra = p === 'poki' ? `${g.rank ? ` · Popular #${g.rank}` : ''}${g.trendingRank ? ` · Trending #${g.trendingRank}` : ''}` : p === 'roblox' ? '' : `${g.rank ? ` · Free #${g.rank}` : ''}${g.grossingRank ? ` · Grossing #${g.grossingRank}` : ''}`;
  return `<div class="row" data-open="${p}:${esc(g.id)}"><div class="rk">${i + 1}</div><div class="ov-name nm">${esc(g.name)} ${deltaChip(g)}</div>${icon(g)}<div class="ov-meta meta">${esc(g.genre ?? g.category)} · ${ageStr(g.ageDays)}</div><div class="bar"><i style="width:${Math.max(3, barValue(g) / max * 100).toFixed(1)}%;background:${COLORS[p]}"></i></div><div class="val num">${val}<small>${small}</small></div>${spark(sparkVals(g), COLORS[p])}</div>`;
}

function riseRow(g, i) {
  return `<div class="row" data-open="${g.platform}:${esc(g.id)}">
    <div class="rk">${i + 1}</div>${icon(g)}
    <div><div class="nm">${esc(g.name)} ${deltaChip(g)}</div><div class="meta">${esc(g.reasons.slice(0, 2).join(' · ') || (g.genre ?? g.category))}</div>
    <div class="bar"><i style="width:${g.risingScore}%;background:var(--rise)"></i></div></div>
    <div class="val num" style="color:var(--rise)">${g.risingScore.toFixed(0)}<small>rising score</small></div>${spark(sparkVals(g), 'var(--rise)')}</div>`;
}

function riseCard(g) {
  return `<div class="rcard" data-open="${g.platform}:${esc(g.id)}">
    <div class="hd">${icon(g)}<div style="min-width:0"><div class="nm">${esc(g.name)}</div><div class="meta">${g.platform === 'roblox' ? `${full(g.playing)} playing` : `${compact(g.ratingCount)} ${g.platform === 'poki' ? 'votes' : 'ratings'}`} · ${esc(g.genre ?? g.category)}</div></div>
    <div class="score"><b>${g.risingScore.toFixed(0)}</b><small>score</small></div></div>
    <div class="tags">${g.reasons.slice(0, 4).map((r) => `<span class="tag">${esc(r)}</span>`).join('') || '<span class="tag">New to the charts</span>'}</div></div>`;
}

const card = (title, sub, pill, body) => `<section class="card"><h2>${title} ${pill}</h2><p class="sub">${sub}</p>${body}</section>`;
const pill = (p) => `<span class="pill ${p}">${NAMES[p]}</span>`;

// ---------- views ----------
const TOP_SUB = {
  roblox: 'By players online right now',
  poki: "By Poki's live player estimate (rounded, ties by Popular rank)",
  ios: 'Top Free chart, US App Store',
  android: 'Top Free chart, US Google Play',
};
const RISE_SUB = {
  roblox: 'Growth, chart placement and freshness combined',
  poki: "Poki's trending rank, vote velocity and freshness",
  ios: 'Ratings velocity, chart climb and the New chart',
  android: 'Ratings velocity, chart climb and install steps',
};

function overview() {
  const ps = PLATFORMS.filter((p) => games(p).length);
  const visible = ps.filter((p) => state.overviewPlatforms.has(p));
  const top = Object.fromEntries(ps.map((p) => [p, topList(p)]));
  const best = ps.map((p) => risers(p, 1)[0]).filter(Boolean).sort((a, b) => b.risingScore - a.risingScore)[0];
  const totalPlaying = games('roblox').reduce((s, g) => s + g.playing, 0);
  const sub = { roblox: (g) => `${full(g.playing)} playing now`, poki: (g) => (g.live != null ? `${full(g.live)}+ live players (est.)` : `${compact(g.ratingCount)} votes`), ios: (g) => `${compact(g.ratingCount)} ratings · ★ ${g.ratingValue ?? '–'}`, android: (g) => `${g.installsLabel ?? ''} installs · ★ ${g.ratingValue ?? '–'}` };
  const block = (title, subFor, bodyFor) => `<div class="overview-platforms">${visible.map((p) => card(title, subFor(p), pill(p), bodyFor(p))).join('') || '<p class="note">Select at least one platform.</p>'}</div>`;
  return `
  ${globalGraph()}
  ${genreGraph()}
  <div class="overview-filter"><span class="muted">Platforms</span>${ps.map((p) => `<button class="platform-toggle ${state.overviewPlatforms.has(p) ? 'on' : ''}" data-overview-platform="${p}">${NAMES[p]}</button>`).join('')}</div>
  <div class="kpis">
    ${games('roblox').length ? `<div class="kpi"><div class="l">Roblox players (tracked)</div><div class="v num">${compact(totalPlaying)}</div><div class="s">${games('roblox').length} games across the Top / Trending / Up-and-Coming charts</div></div>` : ''}
    ${ps.map((p) => `<div class="kpi"><div class="l">#1 on ${NAMES[p]}</div><div class="v t">${esc(top[p][0]?.name ?? '–')}</div><div class="s">${top[p][0] ? sub[p](top[p][0]) : ''}</div></div>`).join('')}
    <div class="kpi"><div class="l">Hottest riser</div><div class="v t" style="color:var(--rise)">${esc(best?.name ?? '–')}</div><div class="s">${best ? `${NAMES[best.platform]} · score ${best.risingScore.toFixed(0)}` : ''}</div></div>
  </div>
  ${block('Top 10', (p) => TOP_SUB[p], (p) => top[p].map((g, i) => topRow(g, i, topMax(p, top[p]))).join(''))}
  ${block('Rising fast', (p) => RISE_SUB[p], (p) => risers(p, 8).map(riseRow).join('') || '<p class="note">No data yet.</p>')}
  ${block('Common title words', () => 'The most repeated themes in game titles', (p) => `<div class="cloud">${hotWords(p)}</div>`)}
  `;
}

function globalGraph() {
  const rows = PLATFORMS.flatMap((p) => risers(p, 3).map((g) => ({ ...g, platform: p }))).sort((a, b) => b.risingScore - a.risingScore);
  return `<section class="card global-graph"><h2>Global rising signal</h2><p class="sub">Top rising games across every tracked platform, on the same 0–100 score scale.</p>${rows.length ? rows.map((g) => `<div class="global-row" data-open="${g.platform}:${esc(g.id)}"><span class="global-name">${icon(g)}<b class="pill ${g.platform}">${NAMES[g.platform]}</b><span class="global-title">${esc(g.name)}</span></span><div class="global-track"><i style="width:${Math.max(3, g.risingScore)}%;background:${COLORS[g.platform]}"></i></div><strong>${Math.round(g.risingScore)}</strong></div>`).join('') : '<p class="note">No rising data yet.</p>'}</section>`;
}

const relTs = (g) => Date.parse(g.created || g.published || g.released) || null;
const relCell = (g) => {
  const t = relTs(g);
  return t ? `${new Date(t).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })} <span class="muted">· ${ageStr(g.ageDays)}</span>` : '–';
};
const TEXT_COLS = new Set(['name', 'rank', 'trendingRank', 'grossingRank', 'newRank', 'genre', 'category']); // sort A→Z / 1→N first; everything else biggest/newest first
const dirLabel = (key, dir) => (key === 'released' ? (dir < 0 ? 'Newest first' : 'Oldest first') : TEXT_COLS.has(key) ? (dir > 0 ? 'A → Z / 1st first' : 'Z → A / last first') : dir < 0 ? 'High → Low' : 'Low → High');

// ---------- keyword catalogue ----------
const KW_SORTS = {
  count: ['Most games', (t) => t.count],
  share: ['Most popular (share / chart weight)', (t) => t.share],
  trend: ['Trending up', (t) => t.shareDelta],
  rising: ['Highest avg rising score', (t) => t.avgRising],
};

function kwList(p) {
  const k = state.kw;
  let t = [...(state.data[p]?.terms ?? [])];
  if (!k.phrases) t = t.filter((x) => !x.phrase);
  const q = k.q.trim().toLowerCase();
  if (q) t = t.filter((x) => x.term.includes(q) || x.games.some((g) => g.name.toLowerCase().includes(q)));
  const key = KW_SORTS[k.sort][1];
  return t.sort((a, b) => (key(b) ?? -Infinity) - (key(a) ?? -Infinity) || b.count - a.count || b.share - a.share);
}

function kwChip(t) {
  if (t.shareDelta == null || Math.abs(t.shareDelta) < 0.05) return '';
  return `<span class="chip ${t.shareDelta > 0 ? 'up' : 'dn'}" title="share of popularity vs ${hrsStr(t.windowHours)} ago">${t.shareDelta > 0 ? '▲' : '▼'} ${Math.abs(Math.round(t.shareDelta * 100))}%</span>`;
}

function kwCard(p) {
  const all = kwList(p);
  const shown = all.slice(0, state.kw.limit[p]);
  const maxShare = Math.max(...shown.map((t) => t.share), 0.0001);
  const maxCount = Math.max(...shown.map((t) => t.count), 1);
  const cloud = all.slice(0, 28).map((t) => `<button class="w" data-kw="${p}|${esc(t.term)}" style="font-size:${(12 + (t.count / maxCount) * 12).toFixed(1)}px;border-color:${state.kw.open.has(p + '|' + t.term) ? COLORS[p] : 'transparent'}">${esc(t.term)}<sup>${t.count}</sup></button>`).join('');
  const rows = shown.map((t) => {
    const key = `${p}|${t.term}`;
    const open = state.kw.open.has(key);
    return `<div class="kw${open ? ' open' : ''}">
      <div class="kwh" data-kw="${esc(key)}">
        <div><b>${esc(t.term)}</b> ${kwChip(t)}<div class="meta">${t.count} games${t.mentions ? ` · +${t.mentions} mention it in descriptions` : ''}</div></div>
        <div class="kwbar" title="${isMobile(p) ? 'share weighted by Top Free chart position' : 'share of all live players'} on ${NAMES[p]}"><i style="width:${Math.max(3, (t.share / maxShare) * 100)}%;background:${COLORS[p]}"></i></div>
        <div class="val num">${(t.share * 100).toFixed(1)}%<small>share</small></div>
        <div class="val num" style="color:var(--rise)">${t.avgRising.toFixed(0)}<small>avg rising</small></div>
      </div>
      ${open ? `<div class="kwg">${t.games.map((g) => `<button class="tag" data-open="${p}:${esc(g.id)}">${esc(g.name)}</button>`).join('')}${t.count > t.games.length ? `<span class="meta">+${t.count - t.games.length} more</span>` : ''}</div>` : ''}
    </div>`;
  }).join('');
  return card('Keywords', `${all.length} words and phrases that appear in 2+ game titles`, pill(p),
    `<div class="cloud">${cloud || '<span class="muted">Nothing matches.</span>'}</div>${rows}${all.length > shown.length ? `<button class="more" data-more="${p}">Show more (${all.length - shown.length} left)</button>` : ''}`);
}

function kwView() {
  const k = state.kw;
  return `
  <div class="tools">
    <input id="kwq" type="search" placeholder="Search a word or game…" value="${esc(k.q)}">
    <span class="muted">Sort by</span>
    <select id="kwsort">${Object.entries(KW_SORTS).map(([v, [l]]) => `<option value="${v}" ${k.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label class="muted"><input type="checkbox" id="kwph" ${k.phrases ? 'checked' : ''}> Include 2-word phrases</label>
  </div>
  <div class="cols" id="kwbody">${kwBody()}</div>
  <p class="note">Words come from game titles (a word has to appear in 2+ titles). "Share" is the portion of all live players (Poki's figure is a rounded estimate) held by games with that word; for iOS and Android it is weighted by Top Free chart position. A single mega-hit can dominate share, so also sort by "Most games". "Trending up" compares share with ~24h ago and fills in as history builds.</p>`;
}
const inlineReport = (s) => esc(s).replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1 ↗</a>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
function renderReport(source) {
  const lines = source.split(/\r?\n/), out = []; let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim(); if (!line) { i++; continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)/); if (heading) { out.push(`<h${heading[1].length}>${inlineReport(heading[2])}</h${heading[1].length}>`); i++; continue; }
    if (line.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-+:?/.test(lines[i + 1])) { const cells = (x, tag = 'td') => x.split('|').slice(1, -1).map((c) => `<${tag}>${inlineReport(c.trim())}</${tag}>`).join(''); out.push(`<div class="report-table"><table><thead><tr>${cells(line, 'th')}</tr></thead><tbody>`); i += 2; while (i < lines.length && lines[i].trim().startsWith('|')) out.push(`<tr>${cells(lines[i++].trim())}</tr>`); out.push('</tbody></table></div>'); continue; }
    if (line.startsWith('- ')) { const items = []; while (i < lines.length && lines[i].trim().startsWith('- ')) items.push(`<li>${inlineReport(lines[i++].trim().slice(2))}</li>`); out.push(`<ul>${items.join('')}</ul>`); continue; }
    const paragraph = []; while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s|^- |^\|/.test(lines[i].trim())) paragraph.push(lines[i++].trim()); out.push(`<p>${inlineReport(paragraph.join(' '))}</p>`);
  } return `<div class="report-content">${out.join('')}</div>`;
}
function reportGraph(page) { const values = (page.items || []).map((g) => ({ name: g.name, value: g.risingScore ?? g.playing ?? g.rank ?? g.ratings ?? 0 })).slice(0, 10); if (!values.length) return ''; const max = Math.max(...values.map((g) => g.value), 1); return `<section class="report-graph"><h2>Signal overview</h2>${values.map((g) => `<div class="graph-row"><span title="${esc(g.name)}">${esc(g.name)}</span><i style="width:${Math.max(3, g.value / max * 100)}%"></i><b>${Math.round(g.value)}</b></div>`).join('')}</section>`; }
function genreGraph() {
  const groups = new Map();
  PLATFORMS.forEach((p) => games(p).forEach((g) => { const genre = g.genre || g.category || 'Uncategorized'; const x = groups.get(genre) || { genre, count: 0, scores: [] }; x.count++; if (g.risingScore != null) x.scores.push(g.risingScore); groups.set(genre, x); }));
  const rows = [...groups.values()].map((x) => ({ ...x, score: x.scores.length ? x.scores.reduce((a, b) => a + b, 0) / x.scores.length : 0 })).sort((a, b) => b.score - a.score || b.count - a.count).slice(0, 10);
  if (!rows.length) return '';
  const max = Math.max(...rows.map((x) => x.score), 1);
  return `<section class="card genre-graph"><h2>Best-performing genres</h2><p class="sub">Ranked by average rising score across all tracked games.</p><div class="genre-cloud">${rows.map((x) => `<span class="genre-chip" title="Average rising score ${Math.round(x.score)}"><b>${esc(x.genre)}</b><small>${Math.round(x.score)} score · ${x.count} games</small></span>`).join('')}</div></section>`;
}
function pagesView() {
  const pages = state.pages;
  if (!pages.length) return `<div class="card"><h2>Research Pages</h2><p class="sub">Reports created by agents through the CLI appear here.</p><p class="note">Example: <code>node bin/game-radar.mjs report popular-not-on-poki</code></p></div>`;
  const selected = pages.find((p) => p.slug === state.page) || pages[0];
  return `<div class="pages"><aside class="card page-list"><h2>Research Pages</h2>${pages.map((p) => `<button class="page-link ${p.slug === selected.slug ? 'on' : ''}" data-page="${esc(p.slug)}"><b>${esc(p.title)}</b><span>${esc(p.summary || '')}</span><small>${new Date(p.createdAt).toLocaleString()}</small></button>`).join('')}</aside><article class="card page-body"><h1>${esc(selected.title)}</h1><p class="sub">${esc(selected.summary || '')} · ${new Date(selected.createdAt).toLocaleString()}</p>${genreGraph()}${reportGraph(selected)}${renderReport(selected.markdown || '')}</article></div>`;
}
function newsletterView() {
  const editions = state.newsletters;
  const selected = editions.find((p) => p.slug === state.newsletter) || editions[0];
  return `<div class="tools"><button class="btn" id="run-newsletter">Create report now</button><label class="muted"><input type="checkbox" id="newsletter-enabled" ${state.newsletterSettings.enabled ? 'checked' : ''}> Scheduled reports</label><span class="muted">Runs at local time; opening later catches up the latest missed slot.</span></div><div class="card schedule"><b>Report times</b><div>${state.newsletterSettings.times.map((t) => `<button class="tag schedule-time" data-time="${t}">${t} ×</button>`).join('')}<input id="new-newsletter-time" type="time"><button class="btn2" id="add-newsletter-time">Add time</button></div></div>${selected ? `<div class="card page-body"><h1>${esc(selected.title)}</h1><p class="sub">${esc(selected.summary || '')} · ${new Date(selected.createdAt).toLocaleString()}</p>${genreGraph()}${reportGraph(selected)}${renderReport(selected.markdown || '')}</div>` : '<div class="card"><h2>No newsletter editions yet</h2><p class="note">Create one now or wait for the next scheduled time.</p></div>'}<div class="card"><h2>Previous editions</h2>${editions.map((p) => `<button class="page-link ${p.slug === selected?.slug ? 'on' : ''}" data-newsletter="${esc(p.slug)}"><b>${esc(p.title)}</b><small>${new Date(p.createdAt).toLocaleString()}</small></button>`).join('')}</div>`;
}
const kwBody = () => PLATFORMS.filter((p) => state.data[p]).map(kwCard).join('');
const drawKw = () => {
  const b = $('#kwbody');
  if (b) b.innerHTML = kwBody();
};

const hotWords = (p) =>
  [...(state.data[p]?.terms ?? [])]
    .filter((t) => !t.phrase)
    .sort((a, b) => b.count - a.count || b.share - a.share)
    .slice(0, 16)
    .map((t) => `<button class="w" data-kw="${p}|${esc(t.term)}" data-goto="1">${esc(t.term)}<sup>${t.count}</sup></button>`)
    .join('');

const COLS = {
  roblox: [
    ['rank', '#', (g) => g.rank, (g) => g.rank],
    ['name', 'Game', (g) => g.name, (g) => `<div class="g">${icon(g)}<span>${esc(g.name)}</span></div>`],
    ['genre', 'Genre', (g) => g.genre, (g) => esc(g.genre)],
    ['playing', 'Playing', (g) => g.playing, (g) => full(g.playing), 1],
    ['deltaPct', 'Change', (g) => g.deltaPct, (g) => deltaChip(g) || '<span class="muted">–</span>', 1],
    ['likeRatio', 'Liked', (g) => g.likeRatio, (g) => pct(g.likeRatio), 1],
    ['visits', 'Visits', (g) => g.visits, (g) => compact(g.visits), 1],
    ['released', 'Released', relTs, relCell, 1],
    ['risingScore', 'Rising', (g) => g.risingScore, (g) => (g.risingScore == null ? '<span class="muted">–</span>' : `<b style="color:var(--rise)">${g.risingScore.toFixed(0)}</b>`), 1],
  ],
  poki: [
    ['rank', '#', (g) => g.rank, (g) => g.rank ?? '<span class="muted">–</span>'],
    ['name', 'Game', (g) => g.name, (g) => `<div class="g">${icon(g)}<span>${esc(g.name)}</span></div>`],
    ['category', 'Category', (g) => g.category, (g) => esc(g.category)],
    ['live', 'Live now (est.)', (g) => g.live, (g) => (g.live != null ? `${full(g.live)}+` : '–'), 1],
    ['trendingRank', 'Trending #', (g) => g.trendingRank, (g) => g.trendingRank ?? '<span class="muted">–</span>', 1],
    ['ratingCount', 'Votes', (g) => g.ratingCount, (g) => full(g.ratingCount), 1],
    ['ratingValue', 'Rating', (g) => g.ratingValue, (g) => (g.ratingValue ? `★ ${g.ratingValue}` : '–'), 1],
    ['votesPerDay', 'Votes / day', (g) => g.votesPerDay, (g) => full(g.votesPerDay), 1],
    ['rankDelta', 'Change', (g) => g.rankDelta, (g) => deltaChip(g) || '<span class="muted">–</span>', 1],
    ['released', 'Released', relTs, relCell, 1],
    ['risingScore', 'Rising', (g) => g.risingScore, (g) => `<b style="color:var(--rise)">${g.risingScore.toFixed(0)}</b>`, 1],
  ],
  ios: [['rank', '# Top Free', g => g.rank, g => g.rank ?? '–'], ['name', 'Game', g => g.name, g => `<div class="g">${icon(g)}<span>${esc(g.name)}</span></div>`], ['genre', 'Genre', g => g.genre, g => esc(g.genre)], ['grossingRank', 'Grossing #', g => g.grossingRank, g => g.grossingRank ?? '–', 1], ['newRank', 'New #', g => g.newRank, g => g.newRank ?? '–', 1], ['ratingCount', 'Ratings', g => g.ratingCount, g => full(g.ratingCount), 1], ['ratingValue', 'Rating', g => g.ratingValue, g => g.ratingValue ? `★ ${g.ratingValue}` : '–', 1], ['votesPerDay', 'Ratings / day', g => g.votesPerDay, g => full(g.votesPerDay), 1], ['rankDelta', 'Change', g => g.rankDelta, g => deltaChip(g) || '–', 1], ['released', 'Released', relTs, relCell, 1], ['risingScore', 'Rising', g => g.risingScore, g => g.risingScore == null ? '–' : `<b style="color:var(--rise)">${g.risingScore.toFixed(0)}</b>`, 1]],
  android: [['rank', '# Top Free', g => g.rank, g => g.rank ?? '–'], ['name', 'Game', g => g.name, g => `<div class="g">${icon(g)}<span>${esc(g.name)}</span></div>`], ['genre', 'Genre', g => g.genre, g => esc(g.genre)], ['grossingRank', 'Grossing #', g => g.grossingRank, g => g.grossingRank ?? '–', 1], ['ratingCount', 'Ratings', g => g.ratingCount, g => full(g.ratingCount), 1], ['ratingValue', 'Rating', g => g.ratingValue, g => g.ratingValue ? `★ ${g.ratingValue}` : '–', 1], ['votesPerDay', 'Ratings / day', g => g.votesPerDay, g => full(g.votesPerDay), 1], ['installs', 'Installs', g => g.installs, g => esc(g.installsLabel ?? full(g.installs)), 1], ['rankDelta', 'Change', g => g.rankDelta, g => deltaChip(g) || '–', 1], ['released', 'Released', relTs, relCell, 1], ['risingScore', 'Rising', g => g.risingScore, g => g.risingScore == null ? '–' : `<b style="color:var(--rise)">${g.risingScore.toFixed(0)}</b>`, 1]],
};

function platformView(p) {
  const rr = risers(p, 12), top = topList(p);
  const max = topMax(p, top);
  const cats = [...new Set(games(p).map((g) => g.genre ?? g.category))].filter(Boolean).sort();
  const blurb =
    p === 'roblox'
      ? 'Live player counts from Roblox. "Change" compares players with the same point ~24h ago (or the oldest snapshot while history builds).'
      : p === 'poki' ? 'Poki shows a rounded "live players" estimate (1,000+, 5,000+, 10,000+ …), so many games tie; Popular rank breaks ties. "Trending #" is Poki\'s own trending position. "Change" is movement in the Popular list since the earlier snapshot.' : `There are no player counts for ${NAMES[p]}. Rank is Top Free chart position; "Change" is movement since the earlier snapshot. ${p === 'android' ? 'New is by release date because Google Play has no New chart.' : 'iOS New rank is the App Store New chart.'}`;
  return `
  <div class="cols">
    ${card('Top 10', p === 'roblox' ? 'By players online right now' : 'By live player estimate, ties by Popular rank', pill(p), top.map((g, i) => topRow(g, i, max)).join(''))}
    ${card('Rising fast', 'Highest rising score', pill(p), rr.slice(0, 6).map(riseRow).join(''))}
  </div>
  <h3 class="section">More risers to watch</h3>
  <div class="grid">${rr.slice(6, 12).map(riseCard).join('')}</div>
  <h3 class="section">All ${NAMES[p]} games <span class="muted" style="font-weight:400;font-size:13px">(${games(p).length})</span></h3>
  <div class="tools">
    <input id="q" type="search" placeholder="Search games…" value="${esc(state.q[p])}">
    <select id="cat"><option value="">All ${p === 'roblox' ? 'genres' : 'categories'}</option>${cats.map((c) => `<option ${state.cat[p] === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <span class="muted">Sort by</span>
    <select id="sortsel">${COLS[p].map((c) => `<option value="${c[0]}">${c[0] === 'rank' ? 'Rank' : c[1]}</option>`).join('')}</select>
    <button id="sortdir" class="btn2"></button>
  </div>
  <div class="tablewrap" id="tablebox"></div>
  <p class="note">${blurb}</p>`;
}

function drawTable() {
  const p = state.tab;
  const box = $('#tablebox');
  if (!box || !COLS[p]) return;
  const cols = COLS[p];
  const [sk, dir] = state.sort[p];
  const col = cols.find((c) => c[0] === sk) ?? cols[0];
  const q = state.q[p].toLowerCase();
  let rows = games(p).filter((g) => (!q || g.name.toLowerCase().includes(q)) && (!state.cat[p] || (g.genre ?? g.category) === state.cat[p]));
  rows.sort((a, b) => {
    const x = col[2](a), y = col[2](b);
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
  });
  $('#sortsel').value = col[0];
  $('#sortdir').textContent = dirLabel(col[0], dir);
  const shown = rows.slice(0, state.limit[p]);
  box.innerHTML = `<table><thead><tr>${cols.map((c) => `<th data-sort="${c[0]}" class="${c[4] ? 'r' : ''} ${c[0] === sk ? 'on' : ''}">${c[1]}${c[0] === sk ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
  <tbody>${shown.map((g) => `<tr data-open="${p}:${esc(g.id)}">${cols.map((c) => `<td class="${c[4] ? 'r num' : ''}">${c[3](g)}</td>`).join('')}</tr>`).join('')}</tbody></table>
  ${rows.length > shown.length ? `<button class="more" id="more">Show more (${rows.length - shown.length} left)</button>` : ''}
  ${rows.length ? '' : '<p class="note" style="padding:14px">No games match.</p>'}`;
}

function drawer(key) {
  const [p, ...rest] = key.split(':');
  const g = games(p).find((x) => x.id === rest.join(':'));
  if (!g) return closeDrawer();
  const roblox = p === 'roblox';
  const stats = roblox
    ? [['Playing now', full(g.playing)], ['Visits', compact(g.visits)], ['Favorites', compact(g.favorites)], ['Liked', pct(g.likeRatio)], ['Age', ageStr(g.ageDays)], ['Creator', esc(g.creator || '–')]]
    : [['Live now (est.)', g.live != null ? full(g.live) + '+' : '–'], ['Trending rank', g.trendingRank ? '#' + g.trendingRank : '–'], ['Popular rank', g.rank ? '#' + g.rank : '–'], ['Votes', compact(g.ratingCount)], ['Rating', g.ratingValue ? '★ ' + g.ratingValue : '–'], ['Votes / day', full(g.votesPerDay)]];
  const h = g.hist ?? [];
  const liveHist = h.filter((x) => x[3] != null).map((x) => [x[0], x[3]]);
  const useLive = !roblox && new Set(liveHist.map((x) => x[1])).size > 1;
  const trend = roblox
    ? chart(h.map((x) => [x[0], x[1]]), '#ff6b57', full)
    : useLive
      ? chart(liveHist, '#4aa3ff', (v) => full(v) + '+')
      : chart(h.filter((x) => x[2]).map((x) => [x[0], x[2]]), '#4aa3ff', (v) => '#' + Math.round(v), true);
  $('#drawer').innerHTML = `
    <div class="hd">${icon(g)}<div><h2>${esc(g.name)}</h2><div class="meta">${pill(p)}</div></div><button class="x" id="close" aria-label="Close">✕</button></div>
    <div class="tags">${g.reasons.map((r) => `<span class="tag">${esc(r)}</span>`).join('')}</div>
    <div class="stats">${stats.map(([l, v]) => `<div class="stat"><div class="l">${l}</div><div class="v num">${v}</div></div>`).join('')}</div>
    <h4>${roblox ? 'Players over time' : useLive ? 'Live players (estimate) over time' : 'Popular-list position over time'}</h4>${trend}
    ${g.risingScore != null ? `<h4>Why the rising score is ${g.risingScore.toFixed(0)}/100</h4>${g.components.map((c) => `<div class="comp"><span>${esc(c.label)}</span><span class="num muted" style="text-align:right">${c.value == null ? 'n/a' : Math.round(c.value * 100)}</span><div class="bar"><i style="width:${(c.value ?? 0) * 100}%;background:${c.value == null ? 'transparent' : 'var(--rise)'}"></i></div></div>`).join('')}<p class="note">Components marked n/a (e.g. growth before a day of history exists) are left out and the rest re-weighted.</p>` : ''}
    <a class="btn open" href="${esc(g.url)}" target="_blank" rel="noopener">Open on ${NAMES[p]} ↗</a>`;
  $('#drawer').hidden = $('#scrim').hidden = false;
  state.open = key;
}
function closeDrawer() {
  $('#drawer').hidden = $('#scrim').hidden = true;
  state.open = null;
}

// ---------- render / refresh plumbing ----------
function render() {
  const y = window.scrollY;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  const d = state.data;
  let html = '';
  if (!d?.updatedAt || (!d.roblox && !d.poki)) {
    html = '<div class="loading">Collecting the first snapshot… this takes a few seconds.</div>';
  } else {
    const errs = Object.entries(d.errors ?? {});
    if (errs.length) html += `<div class="banner">Couldn't update ${errs.map(([k, v]) => `${NAMES[k]} (${esc(v)})`).join(', ')}. Showing the last good data for ${errs.length > 1 ? 'those' : 'it'}.</div>`;
    html += state.tab === 'keywords' ? kwView() : state.tab === 'pages' ? pagesView() : state.tab === 'newsletter' ? newsletterView() : state.tab === 'overview' || !d[state.tab] ? overview() : platformView(state.tab);
  }
  $('#app').innerHTML = html;
  drawTable();
  if (state.open) drawer(state.open);
  window.scrollTo(0, y);
}

function paintStatus() {
  const s = state.status;
  const btn = $('#refresh');
  if (!s) return;
  btn.disabled = s.refreshing;
  btn.classList.toggle('spin', s.refreshing);
  btn.textContent = s.refreshing ? 'Refreshing' : 'Refresh now';
  $('#status').innerHTML = s.refreshing
    ? '<span class="dot busy"></span>Fetching latest data…'
    : `<span class="dot"></span>${s.updatedAt ? `Updated ${ago(s.updatedAt)}` : 'No data yet'} · next in ${mmss(s.nextRefreshAt - Date.now())}`;
}

async function loadData() {
  const r = await fetch('/api/data');
  state.data = await r.json();
  state.status = state.data;
  render();
  paintStatus();
}
async function loadPages() { try { state.pages = await (await fetch('/api/pages')).json(); state.newsletters = await (await fetch('/api/newsletters')).json(); state.newsletterSettings = await (await fetch('/api/newsletter-settings')).json(); } catch { state.pages = []; state.newsletters = []; } }

async function poll() {
  try {
    const s = await (await fetch('/api/status')).json();
    const changed = !state.data || s.updatedAt !== state.data.updatedAt;
    state.status = s;
    if (changed) await loadData();
    if ((state.tab === 'pages' && !state.pages.length) || (state.tab === 'newsletter' && !state.newsletters.length)) { await loadPages(); render(); }
    else paintStatus();
  } catch {
    $('#status').innerHTML = '<span class="dot busy"></span>Server unreachable, retrying…';
  }
  setTimeout(poll, state.status?.refreshing ? 1000 : 5000);
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const t = e.target;
  const tab = t.closest('[data-tab]');
  if (tab) {
    state.tab = tab.dataset.tab;
    location.hash = state.tab;
    closeDrawer();
    return render();
  }
  const overviewPlatform = t.closest('[data-overview-platform]');
  if (overviewPlatform) {
    const p = overviewPlatform.dataset.overviewPlatform;
    if (state.overviewPlatforms.has(p) && state.overviewPlatforms.size > 1) state.overviewPlatforms.delete(p);
    else state.overviewPlatforms.add(p);
    return render();
  }
  const page = t.closest('[data-page]');
  if (page) { state.page = page.dataset.page; return render(); }
  const newsletter = t.closest('[data-newsletter]');
  if (newsletter) { state.newsletter = newsletter.dataset.newsletter; return render(); }
  if (t.id === 'run-newsletter') { await fetch('/api/newsletter', { method: 'POST' }); await loadPages(); return render(); }
  if (t.id === 'add-newsletter-time') { const input = $('#new-newsletter-time'); if (input.value) { state.newsletterSettings.times = [...new Set([...state.newsletterSettings.times, input.value])].sort(); await saveNewsletterSettings(); return render(); } }
  if (t.classList.contains('schedule-time')) { state.newsletterSettings.times = state.newsletterSettings.times.filter((x) => x !== t.dataset.time); await saveNewsletterSettings(); return render(); }
  const open = t.closest('[data-open]');
  if (open) return drawer(open.dataset.open);
  const more = t.closest('[data-more]');
  if (more) {
    state.kw.limit[more.dataset.more] += 40;
    return drawKw();
  }
  const kw = t.closest('[data-kw]');
  if (kw) {
    const key = kw.dataset.kw;
    if (kw.dataset.goto) {
      // From the Overview cloud: jump to the Keywords tab filtered to this word.
      state.kw.q = key.split('|')[1];
      state.kw.open = new Set([key]);
      state.tab = 'keywords';
      location.hash = 'keywords';
      return render();
    }
    state.kw.open.has(key) ? state.kw.open.delete(key) : state.kw.open.add(key);
    return drawKw();
  }
  const th = t.closest('th[data-sort]');
  if (th) {
    const [k, d] = state.sort[state.tab];
    state.sort[state.tab] = [th.dataset.sort, k === th.dataset.sort ? -d : TEXT_COLS.has(th.dataset.sort) ? 1 : -1];
    return drawTable();
  }
  if (t.id === 'sortdir') {
    const [k, d] = state.sort[state.tab];
    state.sort[state.tab] = [k, -d];
    return drawTable();
  }
  if (t.id === 'more') {
    state.limit[state.tab] += 50;
    return drawTable();
  }
  if (t.id === 'close' || t.id === 'scrim') return closeDrawer();
  if (t.id === 'refresh') {
    t.disabled = true;
    state.status = await (await fetch('/api/refresh', { method: 'POST' })).json();
    paintStatus();
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'kwq') {
    state.kw.q = e.target.value;
    drawKw();
  }
  if (e.target.id === 'kwph') {
    state.kw.phrases = e.target.checked;
    drawKw();
  }
  if (e.target.id === 'q') {
    state.q[state.tab] = e.target.value;
    state.limit[state.tab] = 50;
    drawTable();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'newsletter-enabled') { state.newsletterSettings.enabled = e.target.checked; saveNewsletterSettings(); }
  if (e.target.id === 'kwsort') {
    state.kw.sort = e.target.value;
    drawKw();
  }
  if (e.target.id === 'sortsel') {
    state.sort[state.tab] = [e.target.value, TEXT_COLS.has(e.target.value) ? 1 : -1];
    drawTable();
  }
  if (e.target.id === 'cat') {
    state.cat[state.tab] = e.target.value;
    state.limit[state.tab] = 50;
    drawTable();
  }
});
async function saveNewsletterSettings() { await fetch('/api/newsletter-settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state.newsletterSettings) }); }
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());
window.addEventListener('hashchange', () => {
  state.tab = location.hash.slice(1) || 'overview';
  render();
});

setInterval(paintStatus, 1000);
poll();
