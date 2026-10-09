// Optional: sends the morning draft (images + caption) to Telegram so you can
// review it on your phone before approving. Skipped if not configured.
const fs = require('fs');
const path = require('path');
const config = require('../config');

async function sendTelegramPreview(images, caption, approveUrl = '') {
  const { botToken, chatId } = config.telegram;
  if (!botToken || !chatId) return false;
  const base = `https://api.telegram.org/bot${botToken}`;

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append(
    'media',
    JSON.stringify(images.slice(0, 10).map((img, i) => ({ type: 'photo', media: `attach://p${i}`, caption: i === 0 ? 'Today\'s LinkedIn jobs draft' : undefined })))
  );
  images.slice(0, 10).forEach((img, i) =>
    form.append(`p${i}`, new Blob([fs.readFileSync(img.png)], { type: 'image/png' }), path.basename(img.png))
  );
  const r1 = await fetch(`${base}/sendMediaGroup`, { method: 'POST', body: form });
  if (!r1.ok) console.warn('  ! Telegram images failed:', await r1.text());

  const text = (approveUrl ? `Approve to publish: ${approveUrl}\n\n` : '') + caption;
  const r2 = await fetch(`${base}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
  });
  if (!r2.ok) console.warn('  ! Telegram caption failed:', await r2.text());
  return r1.ok && r2.ok;
}

module.exports = { sendTelegramPreview };
