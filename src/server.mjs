import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runCollection } from './collect.mjs';
import { loadLatest } from './store.mjs';
import { findAlerts } from './alerts.mjs';
import { PLATFORMS } from './rank.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

// Starts the dashboard server and the background refresh loop.
// `onAlerts(alerts)` is called when games enter a Top 10; port 0 picks a free port.
export async function startServer({ port = 4173, host = '127.0.0.1', intervalMs = 5 * 60e3, onAlerts } = {}) {
  let latest = await loadLatest();
  let refreshing = null;
  let lastError = null;
  let nextRefreshAt = Date.now() + intervalMs;
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
    if (url.pathname === '/api/data') return send(res, 200, { ...status(), errors: latest?.errors ?? {}, ...Object.fromEntries(PLATFORMS.map((p) => [p, latest?.[p]])) });
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

  return {
    port: server.address().port,
    refresh,
    status,
    close: () => {
      clearInterval(timer);
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
