// Ranks jobs inside each bucket and picks the top N.
//
// Score = weighted sum of 6 signals, each 0..1 (weights in config.ranking.weights, total 100):
//   employer 25 · quality 20 · freshness 15 · competition 15 · roleFit 15 · location 10
//   freshness    newer posts first (0h = 1.0, 24h = 0.0)
//   competition  fewer applicants = better odds for our followers
//   employer     known employer > real company with a page > staffing agency / confidential
//   roleFit      title clearly matches the bucket (not just the JD)
//   quality      clear, specific, genuine job post (AI score, or rule-based if no AI)
//   location     IT hubs and remote rank above unspecified
// Hard filters drop: already posted, older than 24h, very short JDs, non-IT roles.
// Diversity rules: 1 job per company, max 2 of the same title, max 3 per city in a bucket.
const config = require('../config');
const { RX } = require('./classify');

const clamp = (x) => Math.max(0, Math.min(1, x));
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const HUBS = /\b(bengaluru|bangalore|chennai|hyderabad|pune|mumbai|navi mumbai|thane|gurugram|gurgaon|noida|delhi|new delhi|kolkata|kochi|cochin|coimbatore|ahmedabad|thiruvananthapuram|trivandrum|chandigarh|mohali|indore|jaipur|bhubaneswar|nagpur|mysuru|mysore|vizag|visakhapatnam)\b/i;
const AGENCY = /\b(consultan(cy|ts?)|staffing|recruit\w*|placements?|manpower|outsourcing|hr (services|solutions)|hiring|careers?|jobs?|talent\s?(solutions|acquisition|hub)?)\b|^talent/i;
// Training-program mills, fee-based "internships", unpaid roles
const RED_FLAGS = /\b(registration fee|training fee|program fee|security deposit|refundable deposit|pay(ing)? (a|the) fee|unpaid|no stipend|training program(me)?|certificate of completion|internship certificate|placement guarantee|guaranteed placement)\b/i;
const CONFIDENTIAL = /\b(confidential|stealth|undisclosed|leading (mnc|company|client)|reputed)\b/i;

function hoursAgo(text) {
  const t = String(text || '').toLowerCase();
  const m = t.match(/(\d+)\s*(minute|hour|day|week|month)/);
  if (!m) return /just now|moments/.test(t) ? 0 : null;
  const n = Number(m[1]);
  return { minute: n / 60, hour: n, day: n * 24, week: n * 168, month: n * 720 }[m[2]];
}

function applicantCount(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  if (/first\s+\d+/.test(t)) return 10; // "Be among the first 25 applicants"
  const m = t.match(/(\d[\d,]*)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return /over/.test(t) ? n + 50 : n;
}

function employerTier(job) {
  const name = norm(job.company);
  const top = config.ranking.topEmployers.some((e) => {
    const k = norm(e);
    return name === k || name.startsWith(k + ' ') || name.includes(' ' + k + ' ') || name.endsWith(' ' + k);
  });
  if (top) return { score: 1, label: 'known employer' };
  if (CONFIDENTIAL.test(job.company) || !job.company) return { score: 0.15, label: 'confidential' };
  if (AGENCY.test(job.company)) return { score: 0.2, label: 'agency/staffing' };
  const hasLogo = job.companyLogo && !/static\.licdn\.com\/aero/.test(job.companyLogo);
  return { score: hasLogo && job.companyUrl ? 0.6 : hasLogo ? 0.5 : 0.35, label: 'company' };
}

function ruleQuality(job) {
  const len = (job.description || '').length;
  let q = 0;
  q += len > 2500 ? 0.35 : len > 1200 ? 0.28 : len > 600 ? 0.15 : 0.05;
  q += (job.skills || []).length >= 3 ? 0.25 : 0.1;
  q += job.experience ? 0.15 : 0;
  q += job.salary ? 0.15 : 0;
  q += /responsibilit|what you.?ll do|requirements|qualifications/i.test(job.description || '') ? 0.1 : 0;
  if (RED_FLAGS.test(job.description || '') || RED_FLAGS.test(job.position || '')) q -= 0.45;
  return clamp(q);
}

/** Cheap score from the search card only — used to decide which JDs to fetch. */
function preScore(job, bucketId) {
  const w = config.ranking.weights;
  const h = hoursAgo(job.agoTime);
  const s = {
    freshness: h == null ? 0.5 : clamp(1 - h / 24),
    competition: 0.5,
    employer: employerTier(job).score,
    roleFit: titleFit(job, bucketId),
    quality: 0.5,
    location: locationScore(job),
  };
  return total(s, w);
}

function titleFit(job, bucketId) {
  const t = job.position || '';
  const rx = { freshers: RX.freshersTitle, management: RX.management, ai: RX.ai, dev: RX.dev }[bucketId];
  if (rx && rx.test(t)) return 1;
  if (bucketId === 'freshers' && /entry level|internship/i.test(job.seniority || '')) return 1;
  return 0.5;
}

function locationScore(job) {
  const l = job.location || '';
  if (/remote/i.test(l)) return 1;
  if (HUBS.test(l)) return 1;
  if (/^\s*india\s*$/i.test(l)) return 0.6;
  return 0.5;
}

function total(s, w) {
  return Math.round(Object.keys(w).reduce((sum, k) => sum + (s[k] ?? 0) * w[k], 0) * 10) / 10;
}

/** Full score after the JD is fetched and enriched. Adds .score and .scoreBreakdown. */
function scoreJob(job) {
  const w = config.ranking.weights;
  const h = hoursAgo(job.postedAgo || job.agoTime);
  const apps = applicantCount(job.applicants);
  const emp = employerTier(job);
  const s = {
    freshness: h == null ? 0.5 : clamp(1 - h / 24),
    competition: apps == null ? 0.5 : apps <= 25 ? 1 : apps <= 50 ? 0.8 : apps <= 100 ? 0.6 : apps <= 200 ? 0.35 : 0.1,
    employer: emp.score,
    roleFit: titleFit(job, job.bucket),
    quality: typeof job.aiQuality === 'number' ? clamp(job.aiQuality / 10) : ruleQuality(job),
    location: locationScore(job),
  };
  return {
    ...job,
    hoursAgo: h,
    applicantCount: apps,
    employerTier: emp.label,
    score: total(s, w),
    scoreBreakdown: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Math.round(v * w[k] * 10) / 10])),
  };
}

function passesFilters(job) {
  if (!job.bucket) return 'not IT / no bucket';
  if ((job.description || '').length < config.ranking.minDescriptionChars) return 'JD too short';
  const h = hoursAgo(job.postedAgo || job.agoTime);
  if (h != null && h > 24) return 'older than 24h';
  if (typeof job.aiQuality === 'number' && job.aiQuality < config.ranking.minAiQuality) return 'low quality post';
  if (/\b(registration|training|program|joining) fee\b|security deposit/i.test(job.description || '')) return 'asks candidates to pay';
  return null;
}

/** Highest score first, with diversity rules. Returns { picked, ranked } */
function shortlist(jobs, n) {
  const ranked = jobs.map(scoreJob).sort((a, b) => b.score - a.score);
  const picked = [];
  const companies = new Set();
  const titles = {};
  const cities = {};
  for (const j of ranked) {
    const company = norm(j.company);
    const title = norm(j.position).replace(/\b(sr|senior|jr|junior|lead|i{1,3}|\d)\b/g, '').trim();
    const city = norm((j.location || '').split(',')[0]);
    let why = '';
    if (config.onePerCompany && companies.has(company)) why = 'same company already picked';
    else if ((titles[title] || 0) >= 2) why = 'same title twice already';
    else if ((cities[city] || 0) >= config.ranking.maxPerCity) why = 'city limit reached';
    else if (picked.length >= n) why = 'below top ' + n;
    j.skippedBecause = why || undefined;
    if (why) continue;
    picked.push(j);
    companies.add(company);
    titles[title] = (titles[title] || 0) + 1;
    cities[city] = (cities[city] || 0) + 1;
  }
  // Not enough after diversity rules? Relax the title/city limits (never the company rule).
  for (const j of ranked) {
    if (picked.length >= n) break;
    if (picked.includes(j) || !/city limit|same title/.test(j.skippedBecause || '')) continue;
    if (config.onePerCompany && companies.has(norm(j.company))) continue;
    picked.push(j);
    companies.add(norm(j.company));
    j.skippedBecause = undefined;
  }
  picked.sort((a, b) => b.score - a.score);
  return { picked, ranked };
}

module.exports = { preScore, scoreJob, passesFilters, shortlist, hoursAgo, applicantCount };
