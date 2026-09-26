# MARKETRA — AI Marketing Manager

A real AI marketing manager: a frontend with real user accounts, talking to
a backend that calls an AI model with a strict marketing system prompt, and
a Supabase database that remembers each business, its chat history, and
(optionally) connected social accounts via Phyllo/InsightIQ.

## Architecture

```
Browser (frontend/) — real login via Supabase Auth
   │  fetch("/api/marketing")      Authorization: Bearer <supabase token>
   ▼
Node.js + Express (backend/server.js)
   │
   ├── backend/authMiddleware.js  → verifies the caller's Supabase session
   │                                 server-side before anything else runs
   ├── backend/ai.js              → calls Google's Gemini API with the
   │                                 system prompt + business profile + history.
   │                                 Web search grounding is OFF by default
   │                                 (it has its own, much tighter free-tier
   │                                 quota) — pass allowWebSearch: true to
   │                                 askMarketra() to enable it per call.
   ├── backend/business.js        → reads the business profile and
   │                                 conversation history from Supabase
   ├── backend/phyllo.js          → Phyllo/InsightIQ API wrapper (social
   │                                 account connections)
   └── backend/routes/
         marketing.js  → POST /api/marketing (the only endpoint that needs
                          GEMINI_API_KEY, hence the only one behind the
                          backend at all)
         phyllo.js     → POST /api/phyllo/token, GET /api/phyllo/accounts,
                          POST /api/phyllo/webhook, GET /api/phyllo/analytics/:id
```

Business profile, chat session, and history CRUD now happen **directly
from the frontend to Supabase** (protected by Row Level Security) — the
backend is only involved where a secret must stay a secret (the Gemini
call, the Phyllo client secret) or where server-side authorization is
required.

No secret — `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`PHYLLO_CLIENT_SECRET`, `PHYLLO_WEBHOOK_SECRET` — ever touches the browser.
They live only in Render's environment variables.

## Setup

1. **Install dependencies**
   ```
   npm install
   ```

2. **Environment variables** — copy `.env.example` to `.env` and fill in:
   - `GEMINI_API_KEY` — from aistudio.google.com/apikey
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` —
     **required**, not optional: real user login, business profiles, and
     chat history all depend on Supabase now.
   - `PHYLLO_CLIENT_ID` / `PHYLLO_CLIENT_SECRET` / `PHYLLO_BASE_URL` /
     `PHYLLO_WEBHOOK_SECRET` — only needed if you're using the social
     account connection feature.

3. **Database** — in your Supabase project's SQL editor, run
   `database/schema.sql`. It's written to be safely re-runnable.

4. **Run it**
   ```
   npm start
   ```

## What's implemented

- Real user accounts via Supabase Auth (email/password login & signup)
- Business profiles, chat sessions with full history, and a settings page
  — all scoped per-user via Row Level Security
- Real marketing system prompt (`backend/marketing-system.txt`) enforcing
  diagnosis → priority → actions → assets → creative ideas → metrics →
  decision rule, with figures expressed in ₹ by default
- Phyllo/InsightIQ integration for connecting social accounts (sandbox) —
  see `PHYLLO_SETUP.md`
- Server-side authorization on every endpoint: a request's business/session
  ID is always verified against the authenticated caller, never trusted
  just because the browser sent it (see `SECURITY.md`)
- Rate limiting, input validation, and security headers (see `SECURITY.md`)

## Not yet implemented

- **Live analytics integrations** (Shopify/Meta/GA/WhatsApp) beyond the
  Phyllo social-account connection — the `analytics` table exists in the
  schema but nothing writes to it yet.
- **Execution layer** (auto-publishing campaigns/content) — not built.
  This should always sit behind an explicit human approval step before
  anything spends money or goes live.
- Phyllo's data isn't yet fed into the AI's context — `getProfileAnalytics`
  is fetchable but not wired into `askMarketra()`.

## Notes

- To switch to OpenAI instead of Gemini, only `backend/ai.js` needs to
  change — the routes, schema, and frontend are provider-agnostic.
- See `PHYLLO_SETUP.md` for the social-account connection setup, and
  `SECURITY.md` for the full security audit and what's still manual
  (Supabase dashboard settings, dependency auditing).
