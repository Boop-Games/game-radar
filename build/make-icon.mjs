// Generates build/icon.png (the Game Radar "pixel radar" logo) with no dependencies.
// Geometry is defined in a 256x256 space and rendered at 512px with supersampling.
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const N = 512;
const SS = 3;
const K = N / 256;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const TILE_TOP = hex('#16213d'), TILE_BOT = hex('#090c13'), BORDER = hex('#232c42');
const RING = hex('#3b86f0'), LIGHT = hex('#9bd3ff'), WHITE = [255, 255, 255];

// Signed distance to a rounded square centred at (c, c) with half-size h and corner radius r.
const roundRect = (x, y, c, h, r) => {
  const qx = Math.abs(x - c) - (h - r), qy = Math.abs(y - c) - (h - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

// The 11x11 pixel radar: ring, sweep wedge, faint inner ring, centre and blip.
const GRID = 11, CELL = 20, ORIGIN = 18, MID = 5;
function cellStyle(x, y) {
  const dx = x - MID, dy = y - MID, d = Math.hypot(dx, dy), a = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (x === MID && y === MID) return { gradient: false, color: WHITE, alpha: 1 };
  if (x === 8 && y === 2) return { gradient: false, color: WHITE, alpha: 1 };
  if (d >= 4.2 && d <= 5.3) return { gradient: false, color: RING, alpha: 0.95 };
  if (d < 4.2 && a > -85 && a < -8) return { gradient: true, alpha: 0.25 + 0.75 * ((a + 85) / 77) };
  if (d > 1.5 && d < 2.5) return { gradient: false, color: RING, alpha: 0.25 };
  return null;
}

function sample(px, py) {
  const x = px / K, y = py / K;
  const d = roundRect(x, y, 128, 122, 60);
  if (d > 1.5) return null; // outside the tile
  let col = d > -1.5 ? BORDER : lerp(TILE_TOP, TILE_BOT, Math.min(1, Math.max(0, (y - 6) / 244)));

  const gx = Math.floor((x - ORIGIN) / CELL), gy = Math.floor((y - ORIGIN) / CELL);
  if (gx >= 0 && gy >= 0 && gx < GRID && gy < GRID) {
    const s = cellStyle(gx, gy);
    const lx = x - (ORIGIN + gx * CELL), ly = y - (ORIGIN + gy * CELL);
    if (s && roundRect(lx, ly, CELL / 2, CELL / 2 - 1.5, 3) <= 0) {
      const c = s.gradient ? lerp(LIGHT, RING, ly / CELL) : s.color;
      col = lerp(col, c, s.alpha);
    }
  }
  return col;
}

const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        if (c) (r += c[0]), (g += c[1]), (b += c[2]), a++;
      }
    const o = y * (N * 4 + 1) + 1 + x * 4;
    if (a) [raw[o], raw[o + 1], raw[o + 2]] = [r / a, g / a, b / a];
    raw[o + 3] = Math.round((a / (SS * SS)) * 255);
  }
}

const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
const here = path.dirname(fileURLToPath(import.meta.url));
writeFileSync(path.join(here, 'icon.png'), png);
writeFileSync(path.join(here, '..', 'public', 'icon.png'), png); // dashboard header + favicon
console.log('wrote build/icon.png and public/icon.png', png.length, 'bytes');
