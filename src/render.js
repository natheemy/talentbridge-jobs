// Fills templates/post.html with one image's jobs and screenshots it to a PNG
// (1080x1350, LinkedIn's portrait size). Bucket names are internal only: every
// image is headed "Job Opportunities" and cards are numbered across the whole post,
// matching the numbered apply links in the caption.
const fs = require('fs');
const path = require('path');
const config = require('../config');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'post.html');

// Card colour sets, cycled 1..5: [card tint, circle/rule tint, accent]
const TINTS = [
  ['#EAF1FD', '#D3E2FB', '#1A4FBF'], // blue
  ['#FDEFE7', '#FAD8C5', '#C2410C'], // peach
  ['#E9F6EE', '#CBEBD7', '#15803D'], // green
  ['#F1ECFD', '#DCD2FA', '#6D28D9'], // lavender
  ['#FDF6E3', '#F7E3A9', '#A16207'], // amber
];

const PIN = (color) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="${color}" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.6A2.6 2.6 0 1 1 12 6.4a2.6 2.6 0 0 1 0 5.2Z"/></svg>`;

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lines = (arr) => arr.map(esc).join('<br>');

// "Talent Bridge" -> Talent<em>Bridge</em> (last word in blue); single word stays navy
function wordmark(name) {
  const parts = String(name).trim().split(/\s+/);
  if (parts.length < 2) return esc(name);
  const last = parts.pop();
  return `${esc(parts.join(''))}<em>${esc(last)}</em>`;
}

function brandBlock() {
  const { logo, name, tagline } = config.brand;
  if (logo && fs.existsSync(logo)) {
    const ext = path.extname(logo).slice(1).replace('jpg', 'jpeg').replace('svg', 'svg+xml');
    return `<img src="data:image/${ext};base64,${fs.readFileSync(logo).toString('base64')}" alt="${esc(name)}">`;
  }
  return `<div class="word">${wordmark(name)}</div>${tagline ? `<div class="tag">${esc(tagline)}</div>` : ''}`;
}

function shortLocation(loc) {
  return String(loc || '').replace(/,\s*India$/i, '').replace(/\s+Area$/i, '').replace(/^Greater\s+/i, '');
}

// "FULLSTACK WEB DEVELOPMENT INTERN" -> "Fullstack Web Development Intern" (keeps short acronyms like QA, AI, SAP)
function tidyTitle(t) {
  t = String(t || '').trim();
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/\b([a-z])([a-z]*)/g, (w, a, rest) => (w.length <= 3 && /^(qa|ai|ml|sap|aws|ui|ux|it|hr|sde|gcp|bi|api|ios|sre)$/.test(w) ? w.toUpperCase() : a.toUpperCase() + rest));
}

function card(job, number, i) {
  const [tint, tint2, accent] = TINTS[i % TINTS.length];
  const skills = (job.skills || []).slice(0, 5).map((s) => `<span>${esc(s)}</span>`).join('');
  return `<article class="card" style="--tint:${tint};--tint2:${tint2};--accent:${accent}">
      <div class="num">${number}</div>
      <div class="rule"></div>
      <div class="body">
        <h2 class="title">${esc(tidyTitle(job.position))}</h2>
        <div class="meta">
          <span class="co">${esc(job.company)}</span>
          <span class="loc">${PIN(accent)}<span>${esc(shortLocation(job.location))}</span></span>
          ${job.experience ? `<span class="exp">${esc(job.experience)}</span>` : ''}
        </div>
        ${config.render.showSummary && job.summary ? `<p class="summary">${esc(job.summary)}</p>` : ''}
        ${config.render.showSkills && skills ? `<div class="skills">${skills}</div>` : ''}
      </div>
    </article>`;
}

function formatDate(d = new Date()) {
  return d.toLocaleDateString('en-IN', { timeZone: config.timezone, day: 'numeric', month: 'short', year: 'numeric' });
}

function buildHTML(jobs, startNumber = 1) {
  const n = jobs.length;
  const fill = {
    BRAND_BLOCK: brandBlock(),
    BRAND_WORD: wordmark(config.brand.name),
    VALUES: lines(config.brand.valuesLines),
    SCRIPT: lines(config.brand.scriptLines),
    FOOT_LEFT: lines(config.brand.footerLines),
    EXPLORE: esc(`Explore ${n} new ${n === 1 ? 'role' : 'roles'}`),
    JOBS: jobs.map((j, i) => card(j, startNumber + i, i)).join('\n'),
  };
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in fill ? fill[k] : ''));
}

/** Order the buckets will appear in the post (each becomes one image). */
function orderedGroups(grouped) {
  return config.buckets.map((b) => ({ bucket: b, jobs: grouped[b.id] || [] })).filter((g) => g.jobs.length);
}

/** Render one image per non-empty bucket. Returns [{bucket, html, png, count, from, to}]. */
async function renderAll(grouped, outDir) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  const results = [];
  let number = 1;
  try {
    for (const { bucket, jobs } of orderedGroups(grouped)) {
      const html = buildHTML(jobs, number);
      const name = `jobs-${results.length + 1}`;
      const htmlPath = path.join(outDir, `${name}.html`);
      const pngPath = path.join(outDir, `${name}.png`);
      fs.writeFileSync(htmlPath, html);
      await page.setContent(html, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await page.evaluate(() => document.fonts && document.fonts.ready);
      // Auto-fit: shrink the card list until nothing overflows the 1350px canvas
      await page.evaluate(() => {
        const list = document.querySelector('.list');
        const fits = () =>
          list.scrollHeight <= list.clientHeight + 1 &&
          [...document.querySelectorAll('.card')].every((c) => c.getBoundingClientRect().bottom <= list.getBoundingClientRect().bottom + 1);
        for (let s = 1; s >= 0.72 && !fits(); s -= 0.02) document.documentElement.style.setProperty('--s', s.toFixed(2));
      });
      await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: 1080, height: 1350 } });
      results.push({ bucket: bucket.id, html: htmlPath, png: pngPath, count: jobs.length, from: number, to: number + jobs.length - 1 });
      number += jobs.length;
    }
  } finally {
    await browser.close();
  }
  return results;
}

module.exports = { buildHTML, renderAll, orderedGroups, formatDate };
