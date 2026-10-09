// Publishes a multi-image post to a LinkedIn Company Page via the Posts + Images APIs.
// Requires an access token with the w_organization_social scope for a page you admin
// (LinkedIn "Community Management API" product on your developer app).
const fs = require('fs');
const config = require('../config');
const { escapeLittleText } = require('./caption');

const API = 'https://api.linkedin.com/rest';

function headers(extra = {}) {
  return {
    Authorization: `Bearer ${config.linkedin.accessToken}`,
    'LinkedIn-Version': config.linkedin.apiVersion,
    'X-Restli-Protocol-Version': '2.0.0',
    ...extra,
  };
}

async function check(res, what) {
  if (res.ok) return res;
  const body = await res.text().catch(() => '');
  throw new Error(`${what} failed: HTTP ${res.status} ${body.slice(0, 500)}`);
}

async function uploadImage(pngPath) {
  const init = await check(
    await fetch(`${API}/images?action=initializeUpload`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ initializeUploadRequest: { owner: config.linkedin.organizationUrn } }),
    }),
    'Image initializeUpload'
  );
  const { value } = await init.json();
  await check(
    await fetch(value.uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${config.linkedin.accessToken}`, 'Content-Type': 'image/png' },
      body: fs.readFileSync(pngPath),
    }),
    'Image upload'
  );
  return value.image; // urn:li:image:...
}

/**
 * @param {string} caption plain text
 * @param {{png:string,title:string}[]} images
 * @returns {Promise<string>} post URN
 */
async function publishPost(caption, images) {
  const { accessToken, organizationUrn } = config.linkedin;
  if (!accessToken || !organizationUrn) throw new Error('LINKEDIN_ACCESS_TOKEN and LINKEDIN_ORG_URN must be set');
  if (!images.length) throw new Error('No images to post');

  const uploaded = [];
  for (const img of images) {
    uploaded.push({ id: await uploadImage(img.png), altText: `IT job opportunities ${img.from}-${img.to}: roles, companies and locations` });
  }

  const content =
    uploaded.length === 1
      ? { media: { id: uploaded[0].id, altText: uploaded[0].altText } }
      : { multiImage: { images: uploaded } };

  const res = await check(
    await fetch(`${API}/posts`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        author: organizationUrn,
        commentary: escapeLittleText(caption),
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        content,
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
    }),
    'Create post'
  );
  return res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id') || '';
}

module.exports = { publishPost };
