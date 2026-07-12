#!/usr/bin/env node
/* Generate favicon PNGs + favicon.ico from favicon.svg (uses sharp). */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SVG = path.join(ROOT, 'favicon.svg');
const BG = '#0f0f0f';

async function png(size, out) {
  await sharp(SVG, { density: 512 })
    .resize(size, size)
    .flatten({ background: BG })   // full-bleed dark square (good for apple-touch + maskable)
    .png()
    .toFile(path.join(ROOT, out));
  console.log('  ✓', out, `${size}x${size}`);
}

async function ico() {
  const size = 32;
  const buf = await sharp(SVG, { density: 512 }).resize(size, size).flatten({ background: BG }).png().toBuffer();
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);   // reserved
  header.writeUInt16LE(1, 2);   // type: icon
  header.writeUInt16LE(1, 4);   // count
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size, 0);    // width
  entry.writeUInt8(size, 1);    // height
  entry.writeUInt8(0, 2);       // color count
  entry.writeUInt8(0, 3);       // reserved
  entry.writeUInt16LE(1, 4);    // planes
  entry.writeUInt16LE(32, 6);   // bit count
  entry.writeUInt32LE(buf.length, 8);  // size of image data
  entry.writeUInt32LE(22, 12);  // offset (6 + 16)
  fs.writeFileSync(path.join(ROOT, 'favicon.ico'), Buffer.concat([header, entry, buf]));
  console.log('  ✓ favicon.ico 32x32 (PNG-embedded)');
}

(async () => {
  await png(180, 'apple-touch-icon.png');
  await png(192, 'icon-192.png');
  await png(512, 'icon-512.png');
  await png(512, 'icon-512-maskable.png');
  await png(32, 'favicon-32.png');
  await ico();
  console.log('icons done');
})().catch(e => { console.error(e); process.exit(1); });
