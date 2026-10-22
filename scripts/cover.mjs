// -----------------------------------------------------------------------------
// Generates cover.png (800×534, the store size): a dark home-cinema gradient,
// a slim movie player with its light strip at the bottom, and a large screen
// showing a play symbol over a film strip. Plain Node (zlib), no dependency.
// Run: npm run cover
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WIDTH = 800;
const HEIGHT = 534;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
/** Antialiased coverage of a signed distance (negative inside). */
const inside = (distance) => Math.min(1, Math.max(0, 0.5 - distance));

/** Signed distance to a rounded rectangle centred on (cx, cy). */
function roundRect(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - halfW + radius;
  const qy = Math.abs(y - cy) - halfH + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Signed distance (approximate) to a triangle pointing right, centred on (cx, cy). */
function playTriangle(x, y, cx, cy, size) {
  const px = x - cx + size * 0.3;
  const py = Math.abs(y - cy);
  const edge = (px * 0.866 + py * 1.0 - size * 0.75) / 1.32;
  return Math.max(-px - size * 0.05, edge);
}

const DARK = [6, 7, 12];
const NIGHT = [30, 22, 48];
const SCREEN = [18, 20, 32];
const SCREEN_GLOW = [70, 52, 120];
const FRAME = [40, 40, 52];
const FILM = [12, 12, 16];
const HOLE = [120, 110, 150];
const PLAY = [245, 240, 255];
const BODY = [26, 27, 34];
const BODY_LIGHT = [62, 64, 78];
const STRIP = [120, 170, 255];

const SCR = { cx: 400, cy: 200, w: 260, h: 140 };
const BOX = { cx: 400, cy: 440, w: 220, h: 26, r: 8 };

function pixel(x, y) {
  let color = mix(DARK, NIGHT, (1 - y / HEIGHT) * 0.6 + (x / WIDTH) * 0.2);
  // The screen frame, then the screen with a soft glow.
  color = mix(color, FRAME, inside(roundRect(x, y, SCR.cx, SCR.cy, SCR.w + 8, SCR.h + 8, 6)));
  const glow = Math.max(0, 1 - Math.hypot((x - SCR.cx) / SCR.w, (y - SCR.cy) / SCR.h));
  color = mix(
    color,
    mix(SCREEN, SCREEN_GLOW, glow * 0.9),
    inside(roundRect(x, y, SCR.cx, SCR.cy, SCR.w, SCR.h, 4)),
  );
  // A film strip across the screen, with its perforations.
  const film = roundRect(x, y, SCR.cx, SCR.cy, SCR.w - 20, 52, 4);
  color = mix(color, FILM, inside(film) * 0.85);
  for (const row of [SCR.cy - 40, SCR.cy + 40]) {
    const cell = ((x - SCR.cx + 1000) % 34) - 17;
    if (Math.abs(x - SCR.cx) < SCR.w - 30) {
      color = mix(color, HOLE, inside(roundRect(cell, y, 0, row, 7, 5, 2)) * 0.8);
    }
  }
  // The play symbol in a ring.
  const d = Math.hypot(x - SCR.cx, y - SCR.cy);
  color = mix(color, PLAY, inside(Math.abs(d - 30) - 2.5) * 0.9);
  color = mix(color, PLAY, inside(playTriangle(x, y, SCR.cx + 4, SCR.cy, 26)));
  // Floor shadow, the player body lit from above, its light strip.
  const shadow = Math.hypot((x - BOX.cx) / 280, (y - 478) / 10);
  color = mix(color, [0, 0, 0], (1 - shadow) * 0.8);
  const body = roundRect(x, y, BOX.cx, BOX.cy, BOX.w, BOX.h, BOX.r);
  color = mix(color, mix(BODY_LIGHT, BODY, (y - BOX.cy + BOX.h) / (2 * BOX.h)), inside(body));
  color = mix(color, STRIP, inside(roundRect(x, y, BOX.cx, BOX.cy + 12, 120, 2, 2)));
  const halo = Math.hypot((x - BOX.cx) / 170, (y - BOX.cy - 12) / 10);
  color = mix(color, STRIP, Math.max(0, 1 - halo) * 0.25);
  return color;
}

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = pixel(x, y);
    raw.set([r, g, b], row + 1 + x * 3);
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../cover.png', import.meta.url), png);
console.log(`cover.png: ${WIDTH}×${HEIGHT}, ${png.length} bytes`);
