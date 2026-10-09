# TalentBridge Jobs Pipeline

Every morning at 9 AM IST this builds a LinkedIn Company Page post of fresh IT jobs:

```
LinkedIn job search (last 24h, India)
   → sorted into 4 internal buckets (Freshers, Management, Dev/Test/Cloud, AI/ML/FDE)
   → job description, applicant count and posting time fetched for the best candidates
   → Claude writes a 2-line summary + key skills + a quality score (rule-based fallback if no key)
   → each bucket ranked, top 5 shortlisted (see "How jobs are ranked")
   → one 1080×1350 "Job Opportunities" image per bucket, cards numbered 1–20
   → caption with numbered apply links
   → preview to you (GitHub email + optional Telegram)
   → you approve → posted to your Company Page as a multi-image post
```

Jobs already posted are remembered in `data/posted.json` for 30 days, so nothing repeats.

## Run locally

```bash
npm install                 # also downloads Chromium for rendering
cp .env.example .env        # fill in keys (all optional for a dry run)
npm run generate            # builds out/YYYY-MM-DD/: 4 PNGs, caption.txt, draft.json
npm run render              # re-draw images after editing templates/post.html
npm run rerank              # re-rank today's candidates after changing weights (no re-fetch)
npm run post                # publish today's draft to LinkedIn
```

You can hand-edit `out/<date>/caption.txt` before `npm run post`; the edited caption is used.
`out/<date>/shortlist.md` shows the top 15 per bucket with scores and why each was picked or skipped.

## How jobs are ranked

Bucket names never appear on the images or caption; they only decide which jobs compete with each other.

1. **Search**: about 19 searches (4–5 per bucket) for India, last 24 hours, newest first, filtered by LinkedIn experience level. Typically 300–350 unique jobs.
2. **Pre-rank** each bucket from the search card alone (posting time, employer, title match, city) and fetch the full JD for the top 20 per bucket.
3. **Filter out**: already posted in the last 30 days, older than 24h, JD under 300 characters, non-IT roles, AI quality below 4/10, posts asking candidates to pay a fee.
4. **Score** each remaining job out of 100:

| Signal | Points | How it's measured |
| --- | --- | --- |
| Employer | 25 | Known employer list in `config.js` = full; real company with logo + page = 60%; staffing agency or confidential = 15–20% |
| Post quality | 20 | Claude rates 1–10 (clear role, real company, specific requirements). Without AI: JD length, skills found, experience/salary stated, red-flag phrases |
| Freshness | 15 | Posted 0h ago = full, 24h ago = 0 |
| Competition | 15 | ≤25 applicants = full, 50 = 80%, 100 = 60%, 200 = 35%, 200+ = 10% |
| Role fit | 15 | Job title clearly matches the bucket (not just the description) |
| Location | 10 | Major IT city or remote = full; "India" only = 60% |

5. **Shortlist** the 5 highest, with variety rules: one job per company, at most 2 with the same title, at most 3 from one city (relaxed if a bucket runs short).

## Schedule on GitHub Actions (free)

1. Push this folder to a **private** GitHub repo.
2. **Settings → Secrets and variables → Actions**
   - Secrets: `ANTHROPIC_API_KEY`, `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_ORG_URN`, optionally `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
   - Variables (optional): `BRAND_NAME`, `BRAND_HANDLE`, `BRAND_HASHTAGS`, `JOB_LOCATION`, `LINKEDIN_API_VERSION`
3. **Settings → Environments → New environment** named `linkedin`. Tick **Required reviewers** and add yourself.
4. Done. `.github/workflows/daily-jobs-post.yml` runs at 08:50 IST:
   - **Build today's draft** job creates the images (downloadable from the run page) and sends the Telegram preview.
   - **Publish to LinkedIn** waits for your approval. GitHub emails you; open the run, check the images, click **Approve and deploy**, and it posts.
   - Want it fully automatic? Remove the required reviewer from the `linkedin` environment.
   - Test any time with **Actions → Daily LinkedIn jobs post → Run workflow**.

## LinkedIn API setup (one-time)

Posting to a Company Page needs the official API:

1. Create an app at <https://www.linkedin.com/developers/apps> and link it to your Company Page (you must be a page admin; verify the app from the page).
2. Under **Products**, request **Community Management API**. LinkedIn reviews this; approval can take days to a few weeks.
3. Once approved, generate a token with the `w_organization_social` scope (Auth tab → OAuth 2.0 token generator, or the standard 3-legged OAuth flow).
4. Your org URN is `urn:li:organization:<id>`; the id is in your page admin URL (`linkedin.com/company/<id>/admin`).
5. Access tokens last **60 days**. Put a calendar reminder to refresh `LINKEDIN_ACCESS_TOKEN`.
6. `LINKEDIN_API_VERSION` is a `YYYYMM` string. LinkedIn retires versions after about a year; if posting fails with a version error, set it to a recent month.

Until the API is approved, keep the approval gate on and post manually: download the images + caption from the run (or Telegram) and post them yourself.

## Telegram preview (optional)

Message `@BotFather` → `/newbot` → copy the token. Send any message to your bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` to read your `chat.id`. You'll get the 4 images, the caption and the approval link every morning.

## Tuning

| What | Where |
| --- | --- |
| Search keywords and experience filter per bucket | `config.js → buckets[].queries` |
| Ranking weights, known employers, filters | `config.js → ranking` |
| Brand name, tagline, logo, text lines on the image | `.env` → `BRAND_*` |
| Hide summary or skills on cards | `SHOW_SUMMARY`, `SHOW_SKILLS` |
| Jobs per image (5 fits best) | `JOBS_PER_BUCKET` |
| Bucket rules when AI is off | `src/classify.js` |
| Scoring logic | `src/rank.js` |
| Summary prompt | `src/enrich.js → SYSTEM` |
| Image design | `templates/post.html` |
| Caption wording | `src/caption.js` |

## Notes

- **Job source**: the public LinkedIn guest job endpoints wrapped by the `linkedin-jobs-api` npm package. The pipeline calls them directly because that package doesn't return job descriptions and its current release has a pagination bug. This is unofficial scraping of public pages; LinkedIn can rate-limit or change it, and their terms restrict automated collection. Keep the request delay, and the volume (≈100 requests a day) modest.
- Images aren't clickable on LinkedIn, so apply links live in the caption (kept under the 3,000-character limit).
- If a run finds fewer than 5 jobs for a bucket, that image just shows fewer cards; empty buckets are skipped.
- The previous dark-band design is kept as `templates/post-classic.html`.
