import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runCollection } from './collect.mjs';
import { loadLatest } from './store.mjs';
import { findAlerts } from './alerts.mjs';
import { PLATFORMS } from './rank.mjs';
import { lookupTag } from './social.mjs';
import { loadNewsletterSettings, saveNewsletterSettings, listNewsletters, createNewsletter, runNewsletterSchedule } from './newsletter.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const pagesDir = () => path.join(process.env.GAME_RADAR_DATA || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data'), 'pages');
const snapshotsDir = () => path.join(process.env.GAME_RADAR_DATA || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data'), 'snapshots');

// Starts the dashboard server and the background refresh loop.
// `onAlerts(alerts)` is called when games enter a Top 10; port 0 picks a free port.
export async function startServer({ port = 4173, host = '127.0.0.1', intervalMs = 5 * 60e3, onAlerts } = {}) {
  let latest = await loadLatest();
  let refreshing = null;
  let lastError = null;
  let nextRefreshAt = Date.now() + intervalMs;
  let newsletterTimer;
  const notified = new Map(); // alert key -> time, so a game bouncing around #10 only alerts once per 6h

  function refresh() {
    refreshing ??= runCollection()
      .then((snap) => {
        const alerts = findAlerts(latest, snap).filter((a) => Date.now() - (notified.get(a.key) ?? 0) > 6 * 3600e3);
        alerts.forEach((a) => notified.set(a.key, Date.now()));
        latest = snap;
        lastError = null;
        if (alerts.length) onAlerts?.(alerts);
      })
      .catch((e) => {
        lastError = e.message;
        console.error('[refresh] failed:', e.message);
      })
      .finally(() => {
        refreshing = null;
        nextRefreshAt = Date.now() + intervalMs;
      });
    return refreshing;
  }

  const status = () => ({ updatedAt: latest?.updatedAt ?? null, refreshing: !!refreshing, nextRefreshAt, intervalMs, error: lastError });

  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/status') return send(res, 200, status());
    if (url.pathname === '/api/data') return send(res, 200, { ...status(), errors: latest?.errors ?? {}, social: latest?.social ?? null, pokiTests: latest?.pokiTests ?? null, ...Object.fromEntries(PLATFORMS.map((p) => [p, latest?.[p]])) });
    if (url.pathname.startsWith('/api/social/tag/') && req.method === 'GET') {
      const tag = await lookupTag(decodeURIComponent(url.pathname.slice('/api/social/tag/'.length)));
      return tag ? send(res, 200, tag) : send(res, 404, { error: 'Tag not found on the instance' });
    }
    if (url.pathname === '/api/snapshots' && req.method === 'GET') {
      try { return send(res, 200, (await readdir(snapshotsDir())).filter((n) => n.endsWith('.json')).sort().reverse().map((n) => ({ file: n, capturedAt: new Date(Number(n.slice(0, -5))).toISOString() }))); } catch { return send(res, 200, []); }
    }
    if (url.pathname === '/api/pages' && req.method === 'GET') {
      try {
        const names = (await readdir(pagesDir())).filter((n) => n.endsWith('.json'));
        const pages = await Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(pagesDir(), name), 'utf8'))));
        return send(res, 200, pages.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
      } catch { return send(res, 200, []); }
    }
    if (url.pathname === '/api/newsletters' && req.method === 'GET') return send(res, 200, await listNewsletters());
    if (url.pathname === '/api/newsletter-settings' && req.method === 'GET') return send(res, 200, await loadNewsletterSettings());
    if (url.pathname === '/api/newsletter-settings' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      try { const next = JSON.parse(body); return send(res, 200, await saveNewsletterSettings({ times: [...new Set((next.times || []).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))].sort(), enabled: next.enabled !== false })); } catch { return send(res, 400, { error: 'Invalid newsletter settings' }); }
    }
    if (url.pathname === '/api/newsletter' && req.method === 'POST') return send(res, 201, await createNewsletter(new Date(), new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })));
    if (url.pathname.startsWith('/api/pages/') && req.method === 'GET') {
      const slug = url.pathname.slice('/api/pages/'.length).replace(/[^a-z0-9_-]/gi, '');
      try { return send(res, 200, JSON.parse(await readFile(path.join(pagesDir(), `${slug}.json`), 'utf8'))); } catch { return send(res, 404, { error: 'Page not found' }); }
    }
    if (url.pathname === '/api/refresh' && req.method === 'POST') {
      refresh();
      return send(res, 202, status());
    }
    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
    try {
      send(res, 200, await readFile(file), TYPES[path.extname(file)] ?? 'application/octet-stream');
    } catch {
      send(res, 404, 'Not found', 'text/plain');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  if (!latest || Date.now() - latest.updatedAt > intervalMs) refresh();
  else nextRefreshAt = latest.updatedAt + intervalMs;
  const timer = setInterval(refresh, intervalMs);
  await runNewsletterSchedule();
  newsletterTimer = setInterval(() => runNewsletterSchedule().catch((e) => console.error('[newsletter] failed:', e.message)), 60e3);

  return {
    port: server.address().port,
    refresh,
    status,
    close: () => {
      clearInterval(timer); clearInterval(newsletterTimer);
      server.close();
    },
  };
}

// `npm start` / start.bat: run headless in a terminal.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const minutes = Number(process.env.REFRESH_MINUTES) || 5;
  const app = await startServer({ port: Number(process.env.PORT) || 4173, intervalMs: minutes * 60e3 });
  console.log(`Game Radar running at http://localhost:${app.port}  (auto-refresh every ${minutes} min)`);
}
