# MARKETRA AI — AI Marketing Manager

MARKETRA is a marketing system with Supabase authentication and storage, a Gemini-powered marketing engine, and SocialCrawl public social-profile data.

## Architecture

```text
Browser (frontend/)
  ├─ Supabase Auth and Row Level Security
  └─ authenticated API requests
       ↓
Node.js + Express (backend/server.js)
  ├─ backend/authMiddleware.js       verifies Supabase access tokens
  ├─ backend/routes/marketing.js     POST /api/marketing
  ├─ backend/routes/social.js        GET /api/social/accounts
  │                                  POST /api/social/profile
  │                                  POST /api/social/posts
  │                                  POST /api/social/analyze
  ├─ backend/providers/socialcrawl.js SocialCrawl API client
  ├─ backend/services/socialNormalizer.js normalizes provider responses
  ├─ backend/ai.js                   Gemini marketing analysis
  └─ backend/business.js             business/chat data helpers
```

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` for local development and configure the values.
3. Run `database/schema.sql` in the Supabase SQL editor. The script is intended to be re-runnable and migrates `social_accounts` to the SocialCrawl snapshot format.
4. Start the backend with `npm start`.

## Environment variables

- `GEMINI_API_KEY` — server-side Gemini key.
- `AI_MODEL` and `AI_FALLBACK_MODEL` — optional model names.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` — database/auth configuration. The service-role key stays on the backend.
- `SOCIALCRAWL_API_KEY` — private SocialCrawl key; server-side only.
- `SOCIALCRAWL_BASE_URL` — normally `https://www.socialcrawl.dev/v1`.
- `CORS_ORIGIN` — your frontend origin, e.g. `https://marketraai.netlify.app`.

## SocialCrawl integration

The dashboard's **Add Social Profile** action accepts a public handle on Instagram, TikTok, YouTube, or X/Twitter. MARKETRA requests public profile data from SocialCrawl and stores a snapshot scoped to the logged-in user. The marketing endpoint uses the saved snapshot rather than spending API credits on every chat turn.

This is public-data lookup, not OAuth. It does not access private account analytics or grant permission to publish posts. See `SOCIALCRAWL_SETUP.md` for endpoints, credit notes, environment variables, and verification steps.

## Security notes

- Social routes require a valid Supabase bearer token and are rate-limited.
- SocialCrawl credentials never enter the browser bundle.
- Keep `.env` out of Git; only `.env.example` belongs in the repository.
- Supabase Row Level Security scopes user-owned records.
- The marketing endpoint validates message and record IDs and verifies business/session ownership.
- Helmet and a restricted CORS origin are enabled by the Express server.

## Current limitations

- SocialCrawl returns public profile/content data only; OAuth, private analytics, and publishing are not part of this integration.
- The profile snapshot is refreshed when the user adds the profile again.
- Posting, campaign execution, and external conversion analytics are not implemented.
