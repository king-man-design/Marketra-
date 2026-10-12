# MARKETRA AI Admin Dashboard Setup

## What this adds
- `/admin` static admin dashboard page and `/api/admin/*` protected backend endpoints.
- Server-side admin authorization using the `ADMIN_USER_IDS` allowlist, in addition to Supabase token verification.
- Auth user list, verification/sign-up dates, last sign-in, safe user details, plan/subscription fields, and available aggregate counts.
- Additive subscription schema migration at `database/admin_subscriptions_migration.sql`.

## Required Render environment variables
- `SUPABASE_URL` (existing)
- `SUPABASE_ANON_KEY` (existing, used to verify user sessions)
- `SUPABASE_SERVICE_ROLE_KEY` (existing server-only privileged key; never add it to Netlify)
- `ADMIN_USER_IDS` = comma-separated Supabase Auth user UUIDs explicitly authorized as administrators.

To find the administrator UUID, use Supabase Dashboard → Authentication → Users. Copy the UUID for the account you control. Do not use an email address in `ADMIN_USER_IDS`.

## Deploy steps
1. Review `database/admin_subscriptions_migration.sql`, then run it in Supabase SQL Editor. It is additive and does not alter existing tables. It creates `user_subscriptions` with RLS enabled and no user-facing policies.
2. Add `ADMIN_USER_IDS` to Render. Keep all privileged keys on Render only.
3. Commit and push the project to GitHub. Netlify should publish `frontend/_redirects` and `frontend/admin.html`; open `https://marketraai.netlify.app/admin` after deployment.
4. Sign in to the existing MARKETRA frontend in the same browser first. The admin page reads the current Supabase session and sends its access token to the protected backend.
5. Test with an authorized admin, then a regular user. The regular user must receive an access-denied state and API 403.

## Data limitations
- AI usage per user is not tracked by the current schema and is shown as unavailable.
- MRR is shown only if active `user_subscriptions` rows contain valid `monthly_amount` values and no conflicting currencies. No payment provider is connected.
- A plan value is not proof of payment. The UI separates plan assignment from subscription status; payment verification needs a future trusted provider webhook.
- User list endpoints are paginated in the response. Supabase Auth currently exposes users through paged Admin API calls; very large installations may need a dedicated server-side reporting table maintained by a trusted process.
