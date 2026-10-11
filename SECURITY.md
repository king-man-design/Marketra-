# MARKETRA AI Security Notes

## Authentication and ownership

- Backend routes use `backend/authMiddleware.js` to verify Supabase bearer tokens server-side.
- `/api/marketing` validates message and UUID inputs and checks business/session ownership before reading or writing conversation data.
- `/api/social/*` endpoints require authentication; saved social profile records are scoped to the authenticated user.
- Supabase Row Level Security protects browser-side access to user-owned data.

## Secrets

- `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SOCIALCRAWL_API_KEY` must remain in Render environment variables (or local `.env` for development).
- Do not place any of these secrets in frontend JavaScript, HTML, or GitHub. The Supabase anon key is intended to be public and relies on RLS for access control.

## Input handling and rate limits

- API requests use `express.json` with a 1 MB body limit.
- `/api/marketing` is rate-limited because it invokes Gemini.
- SocialCrawl profile/content endpoints are rate-limited because they can consume API credits.
- User/AI/provider-derived text rendered into HTML should pass through `escapeHtml()`.

## HTTP hardening

- Helmet security headers are enabled; CSP is disabled because the backend primarily serves JSON and the frontend is hosted separately.
- CORS uses `CORS_ORIGIN`, with the Netlify app as a fallback. Set the exact deployed frontend origin in Render.
- Render and Netlify provide HTTPS for deployed endpoints.

## SocialCrawl-specific notes

- The API key is sent only from the backend in the `x-api-key` header.
- SocialCrawl is used for public-data retrieval. It does not provide OAuth, private-account access, or publishing permissions.
- MARKETRA saves public profile snapshots and passes them to Gemini as source data; the model is instructed not to invent unavailable metrics.

## Manual checks still recommended

- Review Supabase Authentication settings and rate limits.
- Consider Supabase database network restrictions if appropriate for your deployment.
- Run `npm audit` periodically and review Render logs for repeated authorization or provider failures.
