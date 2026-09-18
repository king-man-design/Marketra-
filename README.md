# MARKETRA — AI Marketing Manager

A real AI marketing manager: a frontend that talks to a backend, which calls
an AI model with a strict marketing system prompt and (optionally) a
Supabase database that remembers each business.

## Architecture

```
Browser (frontend/)
   │  fetch("/api/marketing")
   ▼
Node.js + Express (backend/server.js)
   │
   ├── backend/ai.js          → calls Anthropic's Claude API with the
   │                             system prompt + business profile + history,
   │                             web search enabled for current market info
   ├── backend/business.js    → reads/writes the business profile and
   │                             conversation history in Supabase
   └── backend/routes/marketing.js → the /api/marketing and /api/business
                                       endpoints
```

The API key never touches the browser — it lives only in `.env` on the
server, read by `backend/ai.js`.

## Setup

1. **Install dependencies**
   ```
   npm install
   ```

2. **Environment variables** — copy `.env.example` to `.env` and fill in:
   - `ANTHROPIC_API_KEY` — from console.anthropic.com
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — optional; without these,
     MARKETRA still works but won't remember businesses between sessions
     (the frontend falls back to sending the profile inline each request).

3. **Database (optional but recommended)** — in your Supabase project's SQL
   editor, run `database/schema.sql`.

4. **Run it**
   ```
   npm start
   ```
   Then open `http://localhost:3001` — the Express server also serves the
   frontend from `/frontend`.

## What's implemented (Phase 1 + 2 from the plan)

- Real backend, no API key in the browser
- Real marketing system prompt (`backend/marketing-system.txt`) enforcing
  diagnosis → priority → actions → assets → metrics → decision rule
- Structured JSON responses, rendered as a plan card in the UI
- Business memory schema (Supabase/Postgres) and profile form
- Web search tool enabled so the model can pull current market info instead
  of inventing it

## Not yet implemented (Phases 4-6 from the plan — deliberately out of scope for v1)

- **Live analytics integrations** (Shopify/Meta/GA/WhatsApp) — `analytics`
  table exists in the schema but nothing writes to it yet; that requires
  each platform's own OAuth + webhook setup.
- **Execution layer** (auto-publishing campaigns/content) — not built. Per
  the original plan, this should always sit behind an explicit human
  approval step before anything spends money or goes live; wiring that up
  safely is its own project once Phases 1-3 are proven out.
- Auth — `users` table exists but there's no login flow yet; `businessId`
  is currently just stored in `localStorage`.

## Notes

- `frontend/app.js` degrades gracefully if Supabase isn't configured: it
  keeps the business profile in memory for the session and sends it with
  every chat request instead of persisting it.
- To switch to OpenAI instead of Claude, only `backend/ai.js` needs to
  change — the route, schema, and frontend are provider-agnostic.
