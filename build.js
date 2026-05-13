#!/usr/bin/env node
/* LBT i18n build — single template + per-locale JSON → static HTML per language */

const fs = require('fs');
const path = require('path');

const ROOT     = __dirname;
const TEMPLATE = path.join(ROOT, 'src', 'template.html');
const CONFIG   = path.join(ROOT, 'content', 'config.json');
const LOCALES  = path.join(ROOT, 'content', 'locales');

const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const template = fs.readFileSync(TEMPLATE, 'utf8');

const locales = fs.readdirSync(LOCALES)
  .filter(f => f.endsWith('.json'))
  .map(f => f.replace(/\.json$/, ''));

if (locales.length === 0) {
  console.error('No locales found in', LOCALES);
  process.exit(1);
}

const lookup = (ctx, p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), ctx);

function render(tpl, ctx) {
  // Block: {{#each list}} ... {{/each}}  — body is repeated for each item, with `this` and item.* available
  let out = tpl.replace(/\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, p, body) => {
    const list = lookup(ctx, p);
    if (!Array.isArray(list)) {
      console.warn('  each: list not found:', p);
      return '';
    }
    return list.map(item => {
      const itemCtx = (typeof item === 'object') ? { ...ctx, this: item, ...item } : { ...ctx, this: item };
      return render(body, itemCtx);
    }).join('');
  });

  // Inline: {{key.path}}  — single substitution
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, p) => {
    const v = lookup(ctx, p);
    if (v == null) {
      console.warn('  missing key:', p);
      return m;
    }
    return String(v);
  });

  return out;
}

let total = 0;
for (const locale of locales) {
  const data = JSON.parse(fs.readFileSync(path.join(LOCALES, `${locale}.json`), 'utf8'));
  const ctx  = { ...data, config, locale };
  const html = render(template, ctx);

  const outPath = locale === 'en'
    ? path.join(ROOT, 'preview.html')
    : path.join(ROOT, locale, 'preview.html');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  console.log(`built ${path.relative(ROOT, outPath)}`);
  total++;
}
console.log(`done — ${total} locale${total === 1 ? '' : 's'}`);
