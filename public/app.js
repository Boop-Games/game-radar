'use strict';

const $ = (s) => document.querySelector(s);
const COLORS = { roblox: 'var(--roblox)', poki: 'var(--poki)' };
const NAMES = { roblox: 'Roblox', poki: 'Poki' };

const state = {
  data: null,
  status: null,
  tab: location.hash.slice(1) || 'overview',
  q: { roblox: '', poki: '' },
  cat: { roblox: '', poki: '' },
  sort: { roblox: ['playing', -1], poki: ['live', -1] },
  limit: { roblox: 50, poki: 50 },
  open: null,
  kw: { q: '', sort: 'count', phrases: true, open: new Set(), limit: { roblox: 40, poki: 40 } },
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
const topList = (p, n = 10) =>
  p === 'roblox'
    ? [...games(p)].sort((a, b) => b.playing - a.playing).slice(0, n)
    : [...games(p)].sort((a, b) => (b.live ?? 0) - (a.live ?? 0) || (a.rank ?? 1e9) - (b.rank ?? 1e9)).slice(0, n); // Poki's live figure is bucketed, so ties fall back to its Popular order
const topMax = (p, list) => (p === 'roblox' ? list[0]?.playing : Math.max(...list.map((g) => g.live ?? 0))) || 1;
const risers = (p, n = 10) => games(p).filter((g) => g.risingScore != null).sort((a, b) => b.risingScore - a.risingScore).slice(0, n);

// ---------- small svg charts ----------
function sparkVals(g) {
  const h = g.hist ?? [];
  let v;
  if (g.platform === 'roblox') v = h.map((p) => p[1]);
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
  const roblox = g.platform === 'roblox';
  const val = roblox ? full(g.playing) : g.live != null ? `${full(g.live)}+` : '–';
  const small = roblox ? 'playing now' : 'live (estimate)';
  const w = (roblox ? g.playing : g.live ?? 0) / max;
  const extra = roblox ? '' : `${g.rank ? ` · Popular #${g.rank}` : ''}${g.trendingRank ? ` · Trending #${g.trendingRank}` : ''}`;
  return `<div class="row" data-open="${g.platform}:${esc(g.id)}">
    <div class="rk">${i + 1}</div>${icon(g)}
    <div><div class="nm">${esc(g.name)} ${deltaChip(g)}</div><div class="meta">${esc(roblox ? g.genre : g.category)} · ${ageStr(g.ageDays)} old${extra}</div>
    <div class="bar"><i style="width:${Math.max(3, w * 100).toFixed(1)}%;background:${COLORS[g.platform]}"></i></div></div>
    <div class="val num">${val}<small>${small}</small></div>${spark(sparkVals(g), COLORS[g.platform])}</div>`;
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
    <div class="hd">${icon(g)}<div style="min-width:0"><div class="nm">${esc(g.name)}</div><div class="meta">${g.platform === 'roblox' ? `${full(g.playing)} playing` : `${compact(g.ratingCount)} votes`} · ${esc(g.genre ?? g.category)}</div></div>
    <div class="score"><b>${g.risingScore.toFixed(0)}</b><small>score</small></div></div>
    <div class="tags">${g.reasons.slice(0, 4).map((r) => `<span class="tag">${esc(r)}</span>`).join('') || '<span class="tag">New to the charts</span>'}</div></div>`;
}

const card = (title, sub, pill, body) => `<section class="card"><h2>${title} ${pill}</h2><p class="sub">${sub}</p>${body}</section>`;
const pill = (p) => `<span class="pill ${p}">${NAMES[p]}</span>`;

// ---------- views ----------
function overview() {
  const rb = topList('roblox'), pk = topList('poki');
  const rr = risers('roblox'), pr = risers('poki');
  const best = [...rr.slice(0, 1), ...pr.slice(0, 1)].sort((a, b) => b.risingScore - a.risingScore)[0];
  const rbMax = topMax('roblox', rb), pkMax = topMax('poki', pk);
  const totalPlaying = games('roblox').reduce((s, g) => s + g.playing, 0);
  return `
  <div class="kpis">
    <div class="kpi"><div class="l">Roblox players (tracked games)</div><div class="v num">${compact(totalPlaying)}</div><div class="s">${games('roblox').length} games across the Top / Trending / Up-and-Coming charts</div></div>
    <div class="kpi"><div class="l">#1 on Roblox</div><div class="v t">${esc(rb[0]?.name ?? '–')}</div><div class="s">${full(rb[0]?.playing)} playing now</div></div>
    <div class="kpi"><div class="l">#1 on Poki</div><div class="v t">${esc(pk[0]?.name ?? '–')}</div><div class="s">${pk[0]?.live != null ? full(pk[0].live) + '+ live players (est.)' : compact(pk[0]?.ratingCount) + ' votes'}</div></div>
    <div class="kpi"><div class="l">Hottest riser</div><div class="v t" style="color:var(--rise)">${esc(best?.name ?? '–')}</div><div class="s">${best ? `${NAMES[best.platform]} · score ${best.risingScore.toFixed(0)}` : ''}</div></div>
  </div>
  <div class="cols">
    ${card('Top 10', 'By players online right now', pill('roblox'), rb.map((g, i) => topRow(g, i, rbMax)).join(''))}
    ${card('Top 10', "By Poki's live player estimate (rounded, ties by Popular rank)", pill('poki'), pk.map((g, i) => topRow(g, i, pkMax)).join(''))}
  </div>
  <div class="cols">
    ${card('Common title words', 'Most repeated themes in the games above and below', pill('roblox'), `<div class="cloud">${hotWords('roblox')}</div>`)}
    ${card('Common title words', 'Most repeated themes in the games above and below', pill('poki'), `<div class="cloud">${hotWords('poki')}</div>`)}
  </div>
  <div class="cols">
    ${card('Rising fast', 'Growth, chart placement and freshness combined', pill('roblox'), rr.slice(0, 8).map(riseRow).join('') || '<p class="note">No data yet.</p>')}
    ${card('Rising fast', 'Vote velocity, freshness and climb in Popular', pill('poki'), pr.slice(0, 8).map(riseRow).join('') || '<p class="note">No data yet.</p>')}
  </div>`;
}

const relTs = (g) => Date.parse(g.created || g.published) || null;
const relCell = (g) => {
  const t = relTs(g);
  return t ? `${new Date(t).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })} <span class="muted">· ${ageStr(g.ageDays)}</span>` : '–';
};
const TEXT_COLS = new Set(['name', 'rank', 'trendingRank', 'genre', 'category']); // sort A→Z / 1→N first; everything else biggest/newest first
const dirLabel = (key, dir) => (key === 'released' ? (dir < 0 ? 'Newest first' : 'Oldest first') : TEXT_COLS.has(key) ? (dir > 0 ? 'A → Z / 1st first' : 'Z → A / last first') : dir < 0 ? 'High → Low' : 'Low → High');

// ---------- keyword catalogue ----------
const KW_SORTS = {
  count: ['Most games', (t) => t.count],
  share: ['Most popular (share of live players)', (t) => t.share],
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
        <div class="kwbar" title="share of all live players on ${NAMES[p]}"><i style="width:${Math.max(3, (t.share / maxShare) * 100)}%;background:${COLORS[p]}"></i></div>
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
  <p class="note">Words come from game titles (a word has to appear in 2+ titles). "Share" is the portion of all live players (Poki's figure is a rounded estimate) held by games with that word. A single mega-hit can dominate share, so also sort by "Most games". "Trending up" compares share with ~24h ago and fills in as history builds.</p>`;
}
const kwBody = () => ['roblox', 'poki'].filter((p) => state.data[p]).map(kwCard).join('');
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
};

function platformView(p) {
  const rr = risers(p, 12), top = topList(p);
  const max = topMax(p, top);
  const cats = [...new Set(games(p).map((g) => g.genre ?? g.category))].filter(Boolean).sort();
  const blurb =
    p === 'roblox'
      ? 'Live player counts from Roblox. "Change" compares players with the same point ~24h ago (or the oldest snapshot while history builds).'
      : 'Poki shows a rounded "live players" estimate (1,000+, 5,000+, 10,000+ …), so many games tie; Popular rank breaks ties. "Trending #" is Poki\'s own trending position. "Change" is movement in the Popular list since the earlier snapshot.';
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
    html += state.tab === 'keywords' ? kwView() : state.tab === 'overview' || !d[state.tab] ? overview() : platformView(state.tab);
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

async function poll() {
  try {
    const s = await (await fetch('/api/status')).json();
    const changed = !state.data || s.updatedAt !== state.data.updatedAt;
    state.status = s;
    if (changed) await loadData();
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
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());
window.addEventListener('hashchange', () => {
  state.tab = location.hash.slice(1) || 'overview';
  render();
});

setInterval(paintStatus, 1000);
poll();
