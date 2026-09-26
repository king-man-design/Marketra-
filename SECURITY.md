# SECURITY.md — MARKETRA Security Audit

## 1. Input validation & injection

- **SQL injection**: not directly possible — all database access goes
  through `supabase-js`'s query builder (`.eq()`, `.select()`, etc.),
  which parameterizes values; there is no raw SQL string concatenation
  anywhere in the codebase.
- **Command injection**: not applicable — no shell/`exec` calls exist
  anywhere in the backend.
- **File uploads**: none exist in the app — nothing to validate here yet.
  If a file-upload feature is added later, this section needs revisiting.
- **Script injection (XSS)**: fixed. `frontend/app.js` was inserting
  AI-generated and Phyllo-returned text into the page via `innerHTML`
  without escaping. Since business-profile fields (typed by users) feed
  the AI prompt and can be echoed back in a response, this was a real
  stored-XSS path. Added `escapeHtml()` and applied it everywhere
  user/AI/third-party-derived text is inserted via `innerHTML`
  (`renderPlan`, `renderSessionList`, `loadConnectedAccounts`).
- **Type/length validation**: added `backend/validate.js` —
  `isValidMessage()` caps chat messages at 4000 characters and rejects
  non-strings; `isValidUuid()` rejects malformed IDs before they reach a
  database query. Applied to `/api/marketing` and
  `/api/phyllo/analytics/:accountId`.
- **Known gap**: the business-profile form (name, industry, budget, etc.)
  is saved directly from the frontend to Supabase, not through our
  Express backend — so there's no server-side validation layer for those
  fields beyond Postgres's own column types and Row Level Security. A
  malicious value there can't reach SQL injection (RLS + parameterized
  queries prevent that) but could still contain junk data. Locking this
  down further would mean routing profile writes through a backend
  endpoint instead of direct-to-Supabase, which is a real architecture
  change, not a quick fix.

## 2. Secrets

Scanned every file in `frontend/` — confirmed the only Supabase values
present there are `SUPABASE_URL` and the **anon public key**, which are
meant to be public (protection comes from Row Level Security, not
secrecy). No service-role key, Gemini key, or Phyllo secret appears
anywhere in frontend code or in this repo — all of those live only in
Render's environment variables and are read via `process.env` on the
server.

## 3. Rate limiting / abuse protection

Added `express-rate-limit` to:
- `POST /api/marketing` — 10 requests/minute/IP (this is the expensive,
  quota-limited AI call)
- `POST /api/phyllo/token` — 5 requests/5 minutes/IP (account-connection
  attempts)
- `POST /api/phyllo/webhook` — 60 requests/minute (generous, just stops a
  runaway sender)

**Known gap**: login/signup rate limiting is NOT implemented in our code
because auth requests never touch our Express backend — the frontend
calls Supabase Auth directly. Supabase has its own built-in rate limiting
on auth endpoints; check Supabase Dashboard → Authentication → Rate
Limits if you want to tune it further.

## 4. Secure deployment

- **HTTPS**: already enforced automatically by both Render and Netlify —
  nothing to configure.
- **Restricting direct DB access**: Supabase's Postgres is not reachable
  without a connection string + password already; if you want to further
  restrict which IPs can connect directly to the database (as opposed to
  through Supabase's API), that's a manual setting at Supabase Dashboard
  → Settings → Database → Network Restrictions. Not something a code
  change can do.
- **Logging**: added `console.warn` logging for failed/invalid auth
  attempts (`backend/authMiddleware.js`), ownership-check failures
  (`backend/routes/marketing.js`, `backend/routes/phyllo.js`), and
  invalid webhook signatures. All of this is visible in Render's Logs
  tab. This is basic visibility, not a full monitoring/alerting system —
  there's no automated alert if suspicious patterns spike.

## 5. IDOR (insecure direct object reference)

- `/api/marketing`: verifies both `businessId` and `sessionId` belong to
  the authenticated user. **A second, more subtle gap was found and fixed
  after further review**: even with both individually verified, a valid
  user could combine their own Session (belonging to Business A) with
  their own but *unrelated* Business B's ID in the same request — the two
  checks passed independently but the data could still get mixed. Fixed
  by deriving the business from the session record itself
  (`chat_sessions.business_id`) whenever a session is present, rather
  than trusting a separately-supplied businessId to be the same one.
- `/api/phyllo/accounts`: already scoped to `req.userId` — no client-
  supplied ID involved.
- `/api/phyllo/analytics/:accountId`: already checks the account belongs
  to the caller; UUID format validated on the param as well.
- `/api/phyllo/token`: uses only the server-verified `req.userId`.
- `/api/phyllo/webhook`: not user-authenticated (Phyllo calls it
  directly), but `phylloUserId` from the event can only ever match a row
  this backend itself created via `getOrCreatePhylloUser`.

## 6. HTTP hardening

- Added **Helmet** (`app.use(helmet({ contentSecurityPolicy: false }))`)
  — sets `X-Content-Type-Options`, `X-Frame-Options`, HSTS, and other
  standard protective headers. CSP is deliberately off here since this
  server is a JSON API — the real frontend is on Netlify.
- **CORS default changed**: previously fell back to `*` (any origin) if
  `CORS_ORIGIN` was unset on Render. Now falls back to this app's own
  known Netlify URL instead, and logs a warning if the env var is
  missing. Still strongly recommended to set `CORS_ORIGIN` explicitly in
  Render regardless.

## 7. Database hardening

Added `ALTER TABLE ... ADD CONSTRAINT` statements (appended to
`schema.sql`, safe to re-run on an existing database):
- `monthly_marketing_budget` can't be negative
- `business_name` can't be blank
- `connection_status` must be one of `pending`/`connected`/`failed`/`disconnected`
- Chat session titles capped at 200 characters
- Stored chat messages capped at 4000 characters (matches the API's own limit)

## 8. Webhook idempotency

Added a `webhook_events` table and an idempotency check in
`backend/routes/phyllo.js` — before processing an event, it tries to
insert the event's id into that table; a duplicate-key failure means
it's already been processed, so it's acknowledged without reprocessing.
⚠️ The exact field InsightIQ uses for a unique event id
(`event.id` vs `event.event_id`) is assumed, not verified — check this
against a real webhook payload once you're receiving them.

## What still needs manual attention

- Supabase Dashboard → Database → Network Restrictions (if you want to
  lock down direct DB access beyond the API/RLS layer)
- Consider Supabase's own auth rate-limit settings if bot signups become
  an issue
- No automated alerting exists yet — Render's log tab is where you'd
  currently go to notice a spike in the `console.warn` lines added above
- **Dependency audit**: run `npm audit` after `npm install` picks up the
  new `express-rate-limit` and `helmet` packages, and address anything it
  flags. This wasn't run as part of this pass since it requires an actual
  `npm install` step, which happens on Render's build, not here.
- IP-based rate limiting has a known real-world limitation: users behind
  shared NAT (office wifi, mobile carriers, campus networks) share a
  rate-limit bucket. A per-authenticated-user limit (in addition to
  per-IP) would be a stronger follow-up if abuse becomes a real problem.
