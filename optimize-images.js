// Resize + WebP convert all images in data/ subfolders.
// Each .jpg/.JPG → max 1920px wide, WebP quality 78, replaces original as .webp.
// Also keeps a .jpg fallback at 1600px / quality 80 (smaller than original).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, 'data');
const MAX_WIDTH = 1920;
const WEBP_QUALITY = 78;
const JPG_QUALITY = 80;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(jpe?g)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

(async () => {
  const files = walk(ROOT);
  console.log(`Processing ${files.length} files...`);
  let totalIn = 0, totalOut = 0, done = 0;
  for (const file of files) {
    const stat = fs.statSync(file);
    totalIn += stat.size;
    const dir = path.dirname(file);
    const base = path.basename(file).replace(/\.(jpe?g)$/i, '');
    const webpOut = path.join(dir, base + '.webp');
    const jpgOut = path.join(dir, base + '.jpg');
    try {
      const img = sharp(file).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true });
      // Write webp
      await img.clone().webp({ quality: WEBP_QUALITY }).toFile(webpOut);
      // Write smaller jpg (overwrite original)
      const tmpJpg = jpgOut + '.tmp';
      await img.clone().jpeg({ quality: JPG_QUALITY, mozjpeg: true }).toFile(tmpJpg);
      // Replace original
      fs.unlinkSync(file);
      fs.renameSync(tmpJpg, jpgOut);
      const newStat = fs.statSync(jpgOut);
      totalOut += newStat.size + fs.statSync(webpOut).size;
      done++;
      if (done % 20 === 0) console.log(`  ${done}/${files.length}`);
    } catch (e) {
      console.error('FAIL', file, e.message);
    }
  }
  console.log(`Done. ${done}/${files.length}`);
  console.log(`Input:  ${(totalIn/1024/1024).toFixed(1)} MB`);
  console.log(`Output: ${(totalOut/1024/1024).toFixed(1)} MB (webp + jpg combined)`);
})();
