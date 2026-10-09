// Job source: LinkedIn public guest job endpoints — the same endpoints wrapped by
// the `linkedin-jobs-api` npm package (github.com/VishwaGauravIn/linkedin-jobs-api).
// We call them directly because the package (a) does not return the job
// description and (b) has a pagination bug (start=NaN) in its current release.
const cheerio = require('cheerio');
const config = require('../config');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, attempt = 1) {
  const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 4) throw new Error(`HTTP ${res.status} after ${attempt} attempts: ${url}`);
    await sleep(3000 * attempt);
    return get(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

function cleanJobUrl(href, id) {
  return id ? `https://www.linkedin.com/jobs/view/${id}` : (href || '').split('?')[0];
}

/** Search one keyword. Returns basic job cards. */
async function searchJobs({ keyword, experience }) {
  const jobs = [];
  for (let page = 0; page < config.search.pagesPerQuery; page++) {
    const params = new URLSearchParams({
      keywords: keyword,
      location: config.search.location,
      f_TPR: config.search.timeRange,
      sortBy: 'DD',
      start: String(page * 10),
    });
    if (experience) params.set('f_E', experience);
    const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params}`;
    let html;
    try {
      html = await get(url);
    } catch (e) {
      console.warn(`  ! search failed (${keyword}, page ${page}): ${e.message}`);
      break;
    }
    const $ = cheerio.load(html);
    const cards = $('li');
    if (!cards.length) break;
    cards.each((_, el) => {
      const card = $(el);
      const urn = card.find('[data-entity-urn]').attr('data-entity-urn') || '';
      const id = urn.split(':').pop();
      const position = card.find('.base-search-card__title').text().trim();
      if (!id || !position) return;
      jobs.push({
        id,
        position,
        company: card.find('.base-search-card__subtitle').text().trim(),
        companyLogo: card.find('.artdeco-entity-image').attr('data-delayed-url') || '',
        location: card.find('.job-search-card__location').text().trim(),
        date: card.find('time').attr('datetime') || '',
        agoTime: card.find('time').text().trim(),
        salary: card.find('.job-search-card__salary-info').text().trim().replace(/\s+/g, ' '),
        jobUrl: cleanJobUrl(card.find('.base-card__full-link').attr('href'), id),
        query: keyword,
      });
    });
    if (cards.length < 10) break;
    await sleep(config.search.requestDelayMs);
  }
  return jobs;
}

/** Fetch the full job description + criteria for one job id. */
async function fetchJobDetail(id) {
  const html = await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`);
  const $ = cheerio.load(html);
  const markup = $('.show-more-less-html__markup');
  markup.find('br').replaceWith('\n');
  markup.find('li').each((_, li) => $(li).prepend('\n• '));
  markup.find('p, div, ul, ol, h1, h2, h3, h4, strong').each((_, n) => $(n).append('\n'));
  const description = markup
    .text()
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  const criteria = {};
  $('.description__job-criteria-item').each((_, el) => {
    const k = $(el).find('h3').text().trim();
    const v = $(el).find('span').text().trim();
    if (k) criteria[k] = v;
  });
  return {
    description,
    postedAgo: $('.posted-time-ago__text').first().text().trim(),
    applicants: $('.num-applicants__caption').first().text().trim(),
    companyUrl: ($('a.topcard__org-name-link').attr('href') || '').split('?')[0],
    seniority: criteria['Seniority level'] || '',
    employmentType: criteria['Employment type'] || '',
    jobFunction: criteria['Job function'] || '',
    industries: criteria['Industries'] || '',
  };
}

module.exports = { searchJobs, fetchJobDetail, sleep };
