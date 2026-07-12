#!/usr/bin/env node
/* LBT i18n build — single template + per-locale JSON → static HTML per language.
   Also emits SEO/AI infra: JSON-LD schema (per page), sitemap.xml, llms.txt. */

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

// ── SEO helpers ───────────────────────────────────────────────
function stripHtml(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/\s+/g, ' ').trim();
}

// JSON-LD @graph for a locale — TravelAgency + WebSite + TouristTrip + FAQPage
function buildJsonLd(data, config, locale) {
  const b   = config.baseUrl;
  const url = b + (data.urlPath || '/');
  const c   = config.contact || {};
  const p   = config.prices  || {};
  const info = (data.modals && data.modals.info) || {};

  const faqs = [];
  for (let i = 1; i <= 25; i++) {
    const q = info['faq' + i + 'Q'], a = info['faq' + i + 'A'];
    if (q && a) faqs.push({
      '@type': 'Question',
      name: stripHtml(q),
      acceptedAnswer: { '@type': 'Answer', text: stripHtml(a) }
    });
  }

  const business = {
    '@type': ['TravelAgency', 'LocalBusiness'],
    '@id': b + '/#business',
    name: config.brand,
    url: b,
    image: config.ogImage,
    logo: config.ogImage,
    telephone: c.phoneRaw,
    email: c.email,
    priceRange: '€€',
    address: {
      '@type': 'PostalAddress',
      streetAddress: (config.pier && config.pier.address) || '',
      addressLocality: 'İstanbul',
      postalCode: '34112',
      addressCountry: 'TR'
    },
    areaServed: { '@type': 'City', name: 'Istanbul' }
  };
  if (config.pier && config.pier.lat != null) {
    business.geo = { '@type': 'GeoCoordinates', latitude: config.pier.lat, longitude: config.pier.lng };
  }
  if (config.tursab && config.tursab.number) {
    business.identifier = { '@type': 'PropertyValue', name: 'TÜRSAB', value: config.tursab.number };
  }

  const website = {
    '@type': 'WebSite',
    '@id': b + '/#website',
    url: b,
    name: config.brand,
    inLanguage: data.langCode || locale,
    publisher: { '@id': b + '/#business' }
  };

  const trip = {
    '@type': 'TouristTrip',
    '@id': b + '/#cruise',
    name: (data.meta && data.meta.ogTitle) || config.brand,
    description: (data.meta && (data.meta.ogDescription || data.meta.description)) || '',
    image: config.ogImage,
    url: url,
    inLanguage: data.langCode || locale,
    provider: { '@id': b + '/#business' },
    touristType: ['Couples', 'Families', 'Groups', 'Tourists'],
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: p.currency || 'EUR',
      lowPrice: p.standard && p.standard.now,
      highPrice: p.vip && p.vip.now,
      offerCount: 2,
      availability: 'https://schema.org/InStock',
      url: url
    }
  };

  const graph = [business, website, trip];
  if (faqs.length) graph.push({
    '@type': 'FAQPage',
    '@id': b + '/#faq',
    inLanguage: data.langCode || locale,
    mainEntity: faqs
  });

  return '<script type="application/ld+json">' +
    JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }) +
    '</script>';
}

// ── build each locale ─────────────────────────────────────────
let total = 0;
for (const locale of locales) {
  const data = JSON.parse(fs.readFileSync(path.join(LOCALES, `${locale}.json`), 'utf8'));
  const ctx  = { ...data, config, locale, jsonLd: '' };
  ctx.jsonLd = buildJsonLd(data, config, locale);
  const html = render(template, ctx);

  // Home locale renders to /index.html and /<locale>/index.html so the content
  // is served directly at / (HTTP 200, self-canonical) — no redirect stub, no
  // canonical loop. This keeps the sitemap/hreflang targets (/ and /tr/) valid.
  const outPath = locale === 'en'
    ? path.join(ROOT, 'index.html')
    : path.join(ROOT, locale, 'index.html');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  console.log(`built ${path.relative(ROOT, outPath)}`);
  total++;
}

// ── sitemap.xml ───────────────────────────────────────────────
const B = config.baseUrl;
const homeAlts = [
  { hreflang: 'en', href: B + '/' },
  { hreflang: 'tr', href: B + '/tr/' },
  { hreflang: 'x-default', href: B + '/' }
];
function urlEntry(loc, alts, priority) {
  let s = '  <url>\n    <loc>' + loc + '</loc>\n    <changefreq>daily</changefreq>\n';
  if (priority) s += '    <priority>' + priority + '</priority>\n';
  if (alts) for (const a of alts) s += '    <xhtml:link rel="alternate" hreflang="' + a.hreflang + '" href="' + a.href + '"/>\n';
  s += '  </url>\n';
  return s;
}
let sm = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';
sm += urlEntry(B + '/', homeAlts, '1.0');
sm += urlEntry(B + '/tr/', homeAlts, '0.9');
for (const dir of ['city-guide', 'blog']) {
  const dp = path.join(ROOT, dir);
  if (!fs.existsSync(dp)) continue;
  for (const f of fs.readdirSync(dp).filter(f => f.endsWith('.html')).sort()) {
    const loc = f === 'index.html' ? `${B}/${dir}/` : `${B}/${dir}/${f}`;
    sm += urlEntry(loc, null, f === 'index.html' ? '0.7' : '0.6');
  }
}
sm += '</urlset>\n';
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sm);
console.log('built sitemap.xml');

// ── llms.txt (AI crawler summary, kept in sync with config) ───
const p = config.prices || {}, c = config.contact || {}, d = config.departure || {};
function linksFor(dir, label) {
  const dp = path.join(ROOT, dir);
  if (!fs.existsSync(dp)) return '';
  const items = fs.readdirSync(dp).filter(f => f.endsWith('.html') && f !== 'index.html').sort()
    .map(f => {
      const title = f.replace(/\.html$/, '').replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
      return `- [${title}](${B}/${dir}/${f})`;
    });
  return items.length ? `\n## ${label}\n${items.join('\n')}\n` : '';
}
const llms = `# ${config.brand}

> Luxury evening Bosphorus dinner cruise in Istanbul, departing nightly at ${d.departure || '21:00'} from ${config.pier ? config.pier.address : 'Eminönü'}. A multi-course dinner with a live Turkish night show (whirling dervish, belly dance, folk dance, drums), DJ, and unlimited soft drinks aboard a three-deck vessel. Adults from ${p.currencySymbol || '€'}${p.standard && p.standard.now}, children (4–7) 50% off, babies (0–3) free. Optional hotel transfer and unlimited-alcohol packages. Same-day booking accepted up to one hour before departure via WhatsApp or Telegram — no prepayment required.

## Key facts
- Departure: nightly ${d.departure || '21:00'} (boarding from ${d.doorOpens || '20:00'}, returns ~${d.return || '23:45'}), ~3 hours
- Pier: ${config.pier ? config.pier.address : 'Eminönü, Istanbul'}
- Prices: Standard dinner from ${p.currencySymbol || '€'}${p.standard && p.standard.now}/person; VIP from ${p.currencySymbol || '€'}${p.vip && p.vip.now}/person; children 4–7 half price; babies 0–3 free
- Add-ons: hotel transfer ${p.currencySymbol || '€'}${p.transferPerPerson}/person; unlimited alcohol ${p.currencySymbol || '€'}${p.alcoholPerPerson}/person; romantic table ${p.currencySymbol || '€'}${p.tablePerTable}
- Booking: WhatsApp / Telegram, up to 1 hour before departure, no prepayment
- Contact: ${c.phone} · ${c.email}
- Languages: English, Türkçe

## Main pages
- [Home — English](${B}/): booking, menu, night show, route, prices, FAQ
- [Ana Sayfa — Türkçe](${B}/tr/): Turkish homepage
${linksFor('city-guide', 'City guide')}${linksFor('blog', 'Blog')}
## Contact
Reservations run on WhatsApp/Telegram. Phone: ${c.phone}. Email: ${c.email}. Website: ${B}
`;
fs.writeFileSync(path.join(ROOT, 'llms.txt'), llms);
console.log('built llms.txt');

console.log(`done — ${total} locale${total === 1 ? '' : 's'} + sitemap + llms`);
