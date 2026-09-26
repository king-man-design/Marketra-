# PHYLLO_SETUP.md — MARKETRA Social Account Connections

## What's confirmed vs. still unverified

Confirmed against InsightIQ's actual docs during setup:
- Base URL: `https://api.sandbox.insightiq.ai/v1`
- Endpoint paths: `/users`, `/sdk-tokens`, `/profiles/{accountId}`
- Webhook signature header: `Webhook-Signatures` (comma-separated list of
  candidate signatures — check each one)
- Webhook event types: `PROFILES.ADDED`, `PROFILES.UPDATED`

Still unverified — search `backend/phyllo.js` for `⚠️ STILL UNCONFIRMED`:
- The exact authentication mechanism (currently assumed to be HTTP Basic
  with `client_id:client_secret`)
- Request body field names for creating a user and requesting an SDK token
- Response field names (the user's id, the SDK token field, the profile
  analytics shape)
- The exact field InsightIQ uses for a unique webhook event id (assumed
  `event.id` or `event.event_id` for idempotency — confirm once you're
  receiving real webhook payloads)

## Architecture

```
Browser (Netlify)
   │  Authorization: Bearer <supabase access token>
   ▼
Render (Express backend)
   │ verifies token server-side (backend/authMiddleware.js)
   │ holds PHYLLO_CLIENT_SECRET (backend/phyllo.js)
   ▼
Phyllo/InsightIQ API  →  webhook  →  Render  →  Supabase (social_accounts)
```

Secrets live on **Render**, not Netlify — Netlify only serves static
frontend files, there's no server there to keep a secret secret.

## 1. Create an InsightIQ/Phyllo account

Sign up, use the **Sandbox** environment first.

## 2. Get your credentials

Client ID and Client Secret from their dashboard.

## 3. Add environment variables — on Render

| Key | Value |
|---|---|
| `PHYLLO_CLIENT_ID` | from dashboard |
| `PHYLLO_CLIENT_SECRET` | from dashboard (secret) |
| `PHYLLO_BASE_URL` | `https://api.sandbox.insightiq.ai/v1` |
| `PHYLLO_WEBHOOK_SECRET` | from their webhook configuration screen |
| `SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API → "anon public" |

## 4. Run the database schema

`database/schema.sql` includes `social_accounts` and `webhook_events`
tables with Row Level Security and idempotency support. Safe to re-run —
it now drops and recreates each policy so it doesn't error on a second run.

## 5. Configure the webhook in their dashboard

Point it to:
```
https://marketra-ai.onrender.com/api/phyllo/webhook
```
Signing secret matches `PHYLLO_WEBHOOK_SECRET`.

## 6. Testing the connect flow

1. Log into MARKETRA, go to Dashboard
2. Tap "📱 Connect Social Account"
3. `POST /api/phyllo/token` (authenticated) → backend creates/finds your
   Phyllo user → requests an SDK token → returns it
4. The Connect widget should open using that token
5. On success, MARKETRA polls `/api/phyllo/accounts`
6. Separately, their webhook should hit `/api/phyllo/webhook` and mark the
   connection `connected`

**Test this end-to-end** — a token being generated does not mean the whole
flow works.

## 7. Switching to Production

Change `PHYLLO_BASE_URL` and swap credentials for production values in
Render. Update `environment: "staging"` in `frontend/app.js`'s connect
handler to whatever InsightIQ's production value is — confirm against docs.

## Security (see also SECURITY.md)

- `PHYLLO_CLIENT_SECRET` never leaves the backend
- SDK tokens generated server-side only, after verifying the caller's
  Supabase session
- `social_accounts` rows scoped by Row Level Security
- Webhook verifies a signature (HMAC-SHA256 against each candidate in the
  `Webhook-Signatures` header) before processing anything
- Webhook events are deduplicated via the `webhook_events` table
- Rate limited: 5 connection attempts / 5 minutes / IP on the token
  endpoint, 60/minute on the webhook receiver

## Known limitations

- No disconnect-account UI yet (schema supports it via `connection_status`)
- `getProfileAnalytics` is fetchable via
  `GET /api/phyllo/analytics/:accountId` but not yet wired into the AI's
  context in `ai.js`
