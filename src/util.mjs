export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

export const daysSince = (iso, now = Date.now()) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, (now - t) / 86400000) : null;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url, headers, read, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await read(r);
    } catch (e) {
      err = e;
      await sleep(800 * (i + 1));
    }
  }
  throw err;
}

export const getJson = (url) => fetchRetry(url, { accept: 'application/json' }, (r) => r.json());
export const getText = (url) => fetchRetry(url, { 'accept-language': 'en' }, (r) => r.text());

// Run `fn` over `items` with at most `limit` in flight; failures resolve to null.
export async function pool(items, limit, fn) {
  const out = new Array(items.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        try {
          out[i] = await fn(items[i], i);
        } catch {
          out[i] = null;
        }
      }
    }),
  );
  return out;
}

export const chunk = (arr, n) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
