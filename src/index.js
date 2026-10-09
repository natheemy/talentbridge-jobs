#!/usr/bin/env node
// Daily pipeline:  fetch -> bucket -> enrich (AI) -> rank & shortlist -> render images -> caption -> preview -> publish
//
//   node src/index.js generate        build today's draft in out/YYYY-MM-DD/
//   node src/index.js publish [dir]   publish a draft (defaults to today's) to LinkedIn
//   node src/index.js render [dir]    re-draw images/caption from a saved draft
//   node src/index.js rerank [dir]    re-rank saved candidates (after changing weights) and re-render
//   node src/index.js run             generate, then publish if AUTO_PUBLISH=true
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { searchJobs, fetchJobDetail, sleep } = require('./source-linkedin');
const { bucketFor } = require('./classify');
const { preScore, passesFilters, shortlist } = require('./rank');
const { enrichAll, usingAI } = require('./enrich');
const { renderAll } = require('./render');
const { buildCaption } = require('./caption');
const { sendTelegramPreview } = require('./notify');
const { publishPost } = require('./publish-linkedin');

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: config.timezone }); // YYYY-MM-DD

// ---------- state: jobs already posted (so we never repeat a job) ----------
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(config.stateFile, 'utf8'));
  } catch {
    return { posted: {} };
  }
}
function saveState(state) {
  const cutoff = Date.now() - 30 * 864e5; // forget after 30 days
  for (const [id, ts] of Object.entries(state.posted)) if (Date.parse(ts) < cutoff) delete state.posted[id];
  fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
  fs.writeFileSync(config.stateFile, JSON.stringify(state, null, 2));
}

// Human-readable ranking report: why each job was picked or skipped
function writeShortlistReport(outDir, results) {
  const lines = ['# Shortlist report', '', 'Score = freshness + competition + employer + roleFit + quality + location (max 100).', ''];
  for (const bucket of config.buckets) {
    const r = results[bucket.id];
    if (!r) continue;
    lines.push(`## ${bucket.title} (internal bucket)`, '');
    lines.push('| # | Score | Picked | Job | Company | Location | Posted | Applicants | Breakdown | Note |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    r.ranked.slice(0, 15).forEach((j, i) => {
      const b = j.scoreBreakdown;
      const bd = `F${b.freshness} C${b.competition} E${b.employer} R${b.roleFit} Q${b.quality} L${b.location}`;
      const cell = (x) => String(x ?? '').replace(/\|/g, '/');
      lines.push(`| ${i + 1} | ${j.score} | ${r.picked.includes(j) ? 'yes' : ''} | [${cell(j.position)}](${j.jobUrl}) | ${cell(j.company)} (${j.employerTier}) | ${cell(j.location)} | ${cell(j.postedAgo || j.agoTime)} | ${cell(j.applicants)} | ${bd} | ${cell(j.skippedBecause || '')} |`);
    });
    if (r.dropped.length) lines.push('', `Filtered out: ${r.dropped.map((d) => `${d.position} (${d.reason})`).join('; ')}`);
    lines.push('');
  }
  fs.writeFileSync(path.join(outDir, 'shortlist.md'), lines.join('\n'));
}

// Rank each bucket, write shortlist.md, render images, write caption + draft.json
async function shortlistAndRender(outDir, enriched, date) {
  const N = config.jobsPerBucket;
  const grouped = {};
  const results = {};
  for (const bucket of config.buckets) {
    const inBucket = enriched.filter((j) => j.bucket === bucket.id);
    const dropped = [];
    const eligible = inBucket.filter((j) => {
      const reason = passesFilters(j);
      if (reason) dropped.push({ position: j.position, reason });
      return !reason;
    });
    const { picked, ranked } = shortlist(eligible, N);
    grouped[bucket.id] = picked;
    results[bucket.id] = { picked, ranked, dropped };
    console.log(`  ${bucket.title}: ${picked.length} picked from ${eligible.length} (scores ${picked.map((j) => j.score).join(', ')})`);
  }
  writeShortlistReport(outDir, results);

  console.log('[4/5] Rendering post images…');
  const images = await renderAll(grouped, outDir);
  const caption = buildCaption(grouped);
  fs.writeFileSync(path.join(outDir, 'caption.txt'), caption);
  const draft = { date, createdAt: new Date().toISOString(), caption, images, jobs: grouped };
  fs.writeFileSync(path.join(outDir, 'draft.json'), JSON.stringify(draft, null, 2));
  return { images, caption };
}

// Re-run ranking on today's saved candidates (after changing weights) without re-fetching
async function rerank(dir) {
  dir = dir || path.join(config.outDir, today());
  const enriched = JSON.parse(fs.readFileSync(path.join(dir, 'candidates.json'), 'utf8'));
  await shortlistAndRender(dir, enriched, path.basename(dir));
  console.log(`Re-ranked and re-rendered in ${dir} (see shortlist.md)`);
}

async function generate() {
  const date = today();
  const outDir = path.join(config.outDir, date);
  fs.mkdirSync(outDir, { recursive: true });
  const state = loadState();
  const N = config.jobsPerBucket;

  // 1. Search every bucket's queries (last 24h)
  console.log(`[1/5] Searching LinkedIn jobs (${config.search.location}, last 24h)…`);
  const byId = new Map();
  for (const bucket of config.buckets) {
    for (const q of bucket.queries) {
      const found = await searchJobs(q);
      console.log(`  ${bucket.id.padEnd(10)} "${q.keyword}": ${found.length}`);
      for (const j of found) if (!byId.has(j.id)) byId.set(j.id, { ...j, searchBucket: bucket.id });
      await sleep(config.search.requestDelayMs);
    }
  }
  let jobs = [...byId.values()].filter((j) => !state.posted[j.id]);
  console.log(`  ${byId.size} unique jobs, ${jobs.length} not posted before`);

  // 2. Pre-rank from the search card (cheap signals) so we only fetch JDs worth reading
  const candidates = {};
  for (const j of jobs) {
    const b = bucketFor(j) || j.searchBucket;
    (candidates[b] ||= []).push({ ...j, pre: preScore(j, b) });
  }
  const seenCo = new Set();
  const toFetch = Object.values(candidates).flatMap((list) =>
    list
      .sort((a, b) => b.pre - a.pre)
      .filter((j) => {
        const k = (j.company || '').toLowerCase();
        if (seenCo.has(k + j.searchBucket)) return false;
        seenCo.add(k + j.searchBucket);
        return true;
      })
      .slice(0, config.ranking.candidatesPerBucket)
  );

  // 3. Fetch job descriptions (+ applicants, exact posting time)
  console.log(`[2/5] Fetching ${toFetch.length} job descriptions…`);
  const detailed = [];
  for (const j of toFetch) {
    try {
      detailed.push({ ...j, ...(await fetchJobDetail(j.id)) });
    } catch (e) {
      console.warn(`  ! JD fetch failed for ${j.id}: ${e.message}`);
    }
    await sleep(config.search.requestDelayMs);
  }

  // 4. Summaries, key skills, quality score, final bucket
  console.log(`[3/5] Summarising with ${usingAI() ? `Claude (${config.ai.model})` : 'rule-based fallback (set ANTHROPIC_API_KEY for AI summaries)'}…`);
  const enriched = await enrichAll(detailed);

  fs.writeFileSync(path.join(outDir, 'candidates.json'), JSON.stringify(enriched, null, 2));
  const { images, caption } = await shortlistAndRender(outDir, enriched, date);

  console.log('[5/5] Sending preview…');
  const sent = await sendTelegramPreview(images, caption, process.env.APPROVE_URL || '');
  console.log(sent ? '  Telegram preview sent' : '  Telegram not configured, skipped');

  console.log(`\nDraft ready: ${outDir} (${images.length} images, ${caption.length} caption chars)`);
  return outDir;
}

async function publish(dir) {
  dir = dir || path.join(config.outDir, today());
  const draft = JSON.parse(fs.readFileSync(path.join(dir, 'draft.json'), 'utf8'));
  if (draft.publishedUrn) {
    console.log(`Already published: ${draft.publishedUrn}`);
    return;
  }
  // caption.txt may have been hand-edited after generation
  const captionFile = path.join(dir, 'caption.txt');
  const caption = fs.existsSync(captionFile) ? fs.readFileSync(captionFile, 'utf8') : draft.caption;
  const images = draft.images.map((i) => ({ ...i, png: path.isAbsolute(i.png) ? i.png : path.resolve(i.png) }));

  console.log(`Publishing ${images.length} images to ${config.linkedin.organizationUrn}…`);
  const urn = await publishPost(caption, images);
  console.log(`Published: ${urn}  https://www.linkedin.com/feed/update/${urn}`);

  draft.publishedUrn = urn;
  draft.publishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'draft.json'), JSON.stringify(draft, null, 2));

  const state = loadState();
  for (const list of Object.values(draft.jobs)) for (const j of list) state.posted[j.id] = draft.publishedAt;
  saveState(state);
}

// Re-draw images + caption from a saved draft (after editing the template or jobs)
async function rerender(dir) {
  dir = dir || path.join(config.outDir, today());
  const draft = JSON.parse(fs.readFileSync(path.join(dir, 'draft.json'), 'utf8'));
  draft.images = await renderAll(draft.jobs, dir);
  draft.caption = buildCaption(draft.jobs, new Date(draft.createdAt));
  fs.writeFileSync(path.join(dir, 'caption.txt'), draft.caption);
  fs.writeFileSync(path.join(dir, 'draft.json'), JSON.stringify(draft, null, 2));
  console.log(`Re-rendered ${draft.images.length} images in ${dir}`);
}

(async () => {
  const [cmd = 'generate', arg] = process.argv.slice(2);
  try {
    if (cmd === 'generate') await generate();
    else if (cmd === 'publish') await publish(arg);
    else if (cmd === 'render') await rerender(arg);
    else if (cmd === 'rerank') await rerank(arg);
    else if (cmd === 'run') {
      const dir = await generate();
      if (process.env.AUTO_PUBLISH === 'true') await publish(dir);
      else console.log('AUTO_PUBLISH is not "true": draft only. Run `npm run post` after review.');
    } else {
      console.log('Usage: node src/index.js [generate|publish [dir]|render [dir]|rerank [dir]|run]');
      process.exit(1);
    }
  } catch (e) {
    console.error('Pipeline failed:', e.message);
    process.exit(1);
  }
})();
