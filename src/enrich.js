// Turns a raw job description into a 2-line summary + key skills (+ bucket check)
// using Claude. Falls back to rule-based extraction when no API key is configured
// or a call fails, so the pipeline never stops for lack of a summary.
const config = require('../config');
const { bucketFor, extractSkills, fallbackSummary, fallbackExperience } = require('./classify');

let client = null;
if (config.ai.apiKey) {
  const Anthropic = require('@anthropic-ai/sdk');
  client = new Anthropic({ apiKey: config.ai.apiKey });
}

const SYSTEM = `You summarise IT job descriptions for a LinkedIn jobs page in India.
Return ONLY a JSON object, no prose, with these keys:
- "summary": exactly 2 short sentences (max 200 characters total) on what the person will do and the stack/domain. Plain words, no hype, do not repeat the company name or job title.
- "skills": array of 4-5 key skills/technologies, each 1-3 words, most important first.
- "experience": required experience like "3-5 yrs", "0-1 yrs", "8+ yrs", or "" if not stated.
- "quality": integer 1-10 rating how good this post is for a job seeker: 9-10 clear real role at a real company with specific responsibilities and requirements; 5-6 generic or thin; 1-3 vague, agency spam, unpaid, MLM, or not really a job.
- "bucket": one of "freshers" (entry-level/intern/0-2 yrs), "management" (people/project/product/delivery management or leadership), "ai" (AI, ML, data science, LLM/GenAI, forward deployed engineer), "dev" (software development, testing/QA, cloud, DevOps, other engineering), or "none" if it is not an IT/software job.`;

function parseJSON(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON in model output');
  return JSON.parse(m[0]);
}

async function enrichWithAI(job) {
  const jd = (job.description || '').slice(0, 6000);
  const msg = await client.messages.create({
    model: config.ai.model,
    max_tokens: 400,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Title: ${job.position}\nCompany: ${job.company}\nLocation: ${job.location}\nSeniority: ${job.seniority}\n\nJob description:\n${jd}`,
      },
    ],
  });
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const out = parseJSON(text);
  return {
    summary: String(out.summary || '').trim(),
    skills: Array.isArray(out.skills) ? out.skills.map(String).slice(0, 5) : [],
    experience: String(out.experience || '').trim(),
    quality: Number.isFinite(Number(out.quality)) ? Number(out.quality) : undefined,
    bucket: ['freshers', 'management', 'ai', 'dev', 'none'].includes(out.bucket) ? out.bucket : null,
    source: 'ai',
  };
}

function enrichWithRules(job) {
  return {
    summary: fallbackSummary(job),
    skills: extractSkills(job.description || '', 5, job.position),
    experience: fallbackExperience(job),
    bucket: bucketFor(job),
    source: 'rules',
  };
}

async function enrichJob(job) {
  let result;
  if (client) {
    try {
      result = await enrichWithAI(job);
    } catch (e) {
      console.warn(`  ! AI enrich failed for ${job.id} (${e.message}); using rules`);
    }
  }
  if (!result) result = enrichWithRules(job);
  if (!result.skills.length) result.skills = extractSkills(job.description || '', 5, job.position);
  // AI bucket wins, except a rules-based "freshers" signal from LinkedIn's own seniority field
  const ruleBucket = bucketFor(job);
  let bucket = result.bucket === 'none' ? null : result.bucket || ruleBucket;
  if (ruleBucket === 'freshers' && /entry level|internship/i.test(job.seniority || '')) bucket = 'freshers';
  return { ...job, summary: result.summary, skills: result.skills, experience: result.experience, aiQuality: result.quality, bucket, enrichedBy: result.source };
}

/** Enrich many jobs with bounded concurrency. */
async function enrichAll(jobs) {
  const out = new Array(jobs.length);
  let i = 0;
  const workers = Array.from({ length: client ? config.ai.concurrency : 1 }, async () => {
    while (i < jobs.length) {
      const idx = i++;
      out[idx] = await enrichJob(jobs[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

module.exports = { enrichAll, usingAI: () => !!client };
