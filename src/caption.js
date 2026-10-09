// Builds the LinkedIn post text. Images aren't clickable, so apply links go here,
// numbered to match the cards on the images. No bucket names (they're internal).
const config = require('../config');
const { formatDate } = require('./render');

const MAX = 2900; // LinkedIn allows 3000 characters

function shortLoc(loc) {
  return String(loc || '').split(',')[0].replace(/^Greater\s+/i, '').replace(/\s+Area$/i, '').trim();
}

function buildCaption(grouped, date = new Date()) {
  // Same order and numbering as the images
  const jobs = config.buckets.flatMap((b) => grouped[b.id] || []);
  const head = [
    `${jobs.length} fresh IT job openings across India, posted in the last 24 hours (${formatDate(date)})`,
    '',
    'Swipe through the images for each role. Apply links below, numbered to match.',
    '',
  ];
  const tail = ['', 'Know someone looking? Share this post with them.', '', config.brand.hashtags.join(' ')];

  let list = jobs.map((j, i) => `${i + 1}. ${j.position}, ${j.company} (${shortLoc(j.location)})\n${j.jobUrl}`);
  let text = [...head, list.join('\n\n'), ...tail].join('\n');
  // Over the limit: shorten titles first, then drop the blank lines between jobs
  if (text.length > MAX) {
    list = jobs.map((j, i) => `${i + 1}. ${j.position.slice(0, 40)}, ${j.company.slice(0, 28)}\n${j.jobUrl}`);
    text = [...head, list.join('\n'), ...tail].join('\n');
  }
  return text;
}

// Posts API "little text" format treats these characters as markup; escape them
// or LinkedIn silently truncates the post at the first one.
function escapeLittleText(text) {
  return text
    .replace(/[\\|{}@\[\]()<>#*_~]/g, (c) => '\\' + c)
    .replace(/\\#(\w+)/g, (_, tag) => `{hashtag|\\#|${tag}}`); // keep hashtags clickable
}

module.exports = { buildCaption, escapeLittleText };
