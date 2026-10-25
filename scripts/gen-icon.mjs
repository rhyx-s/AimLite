// Draws AimLite's original icon (a target ring with a centre dot on a dark rounded tile) into
// src-tauri/icons/app-icon.png. `npm run tauri icon src-tauri/icons/app-icon.png` makes the rest.
import fs from 'node:fs';
import zlib from 'node:zlib';

const N = 1024;
const px = Buffer.alloc(N * N * 4);
const S = 4; // supersampling per axis

function sample(x, y) {
  // returns [r,g,b,a] for a point in 0..N
  const cx = N / 2, cy = N / 2;
  const m = 64, rad = 200; // tile margin and corner radius
  const qx = Math.max(m + rad - x, 0, x - (N - m - rad));
  const qy = Math.max(m + rad - y, 0, y - (N - m - rad));
  if (Math.hypot(qx, qy) > rad) return [0, 0, 0, 0];
  const d = Math.hypot(x - cx, y - cy);
  // violet → pink sweep around the ring, deep violet tile with a top-right glow
  const ang = (Math.atan2(y - cy, x - cx) + Math.PI) / (2 * Math.PI);
  const mix = (p, q, k) => p.map((v, i) => Math.round(v + (q[i] - v) * k));
  const ringCol = mix([109, 93, 252], [232, 121, 249], 0.5 + 0.5 * Math.sin(ang * 2 * Math.PI)).concat(255);
  const light = [244, 236, 255, 255];
  const t = y / N;
  const glow = Math.max(0, 1 - Math.hypot(x - N * 0.85, y - N * 0.1) / (N * 0.75));
  let c = [Math.round(16 - 6 * t + 70 * glow * glow), Math.round(12 - 4 * t + 40 * glow * glow), Math.round(30 - 8 * t + 120 * glow * glow), 255];
  if (d > 296 && d < 356) c = ringCol;
  if (d > 192 && d < 226) c = mix([180, 140, 255], [240, 171, 252], 0.3).concat(255);
  if (d < 72) c = light;
  const onV = Math.abs(x - cx) < 14 && ((y > 120 && y < 260) || (y > N - 260 && y < N - 120));
  const onH = Math.abs(y - cy) < 14 && ((x > 120 && x < 260) || (x > N - 260 && x < N - 120));
  if (onV || onH) c = light;
  return c;
}

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const c = sample(x + (sx + 0.5) / S, y + (sy + 0.5) / S);
      r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
    }
    const i = (y * N + x) * 4;
    px[i] = a ? Math.round(r / a) : 0;
    px[i + 1] = a ? Math.round(g / a) : 0;
    px[i + 2] = a ? Math.round(b / a) : 0;
    px[i + 3] = Math.round(a / (S * S));
  }
}

const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
}
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
fs.mkdirSync('src-tauri/icons', { recursive: true });
fs.writeFileSync('src-tauri/icons/app-icon.png', png);
console.log('wrote src-tauri/icons/app-icon.png', png.length, 'bytes');
