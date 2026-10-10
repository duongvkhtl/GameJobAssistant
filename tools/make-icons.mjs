// Tạo icon PNG (không cần thư viện ngoài): nền xanh ngọc, hình khiên + chấm (an toàn/môi trường) đơn giản.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      let rgb = [15, 118, 110]; // nền
      const dx = (x - cx) / size, dy = (y - cx) / size;
      // khiên: thân hình thang cong
      const shield = dy > -0.3 && dy < 0.32 && Math.abs(dx) < 0.28 * (1 - Math.max(0, dy) * 1.3);
      if (shield) rgb = [255, 255, 255];
      // lá/chấm ở giữa khiên
      if (Math.hypot(dx, dy + 0.02) < 0.12) rgb = [15, 118, 110];
      raw[i] = rgb[0]; raw[i + 1] = rgb[1]; raw[i + 2] = rgb[2]; raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'icons');
mkdirSync(out, { recursive: true });
for (const s of [192, 512]) writeFileSync(path.join(out, `icon-${s}.png`), png(s));
console.log('Đã tạo icon');
