# SocialCrawl setup for MARKETRA AI

MARKETRA now uses SocialCrawl for public social profile/content data. This replaces the old Phyllo/InsightIQ SDK, token, account, and webhook integration. SocialCrawl is not OAuth and does not grant private account analytics or posting permissions.

## Render environment variables

Set these on the `marketra-ai` Render service:

- `SOCIALCRAWL_API_KEY`: your private key from SocialCrawl Dashboard → API Keys.
- `SOCIALCRAWL_BASE_URL`: `https://www.socialcrawl.dev/v1`

Never place the API key in `frontend/app.js`, HTML, or GitHub. Remove old `PHYLLO_CLIENT_ID`, `PHYLLO_CLIENT_SECRET`, `PHYLLO_BASE_URL`, and `PHYLLO_WEBHOOK_SECRET` variables from Render after deploying this version.

## Supported public profile platforms

- Instagram: `instagram/profile`
- TikTok: `tiktok/profile`
- YouTube: `youtube/channel`
- X/Twitter: `twitter/profile`

The dashboard's **Add Social Profile** button asks for a platform and public handle. This is a public-profile lookup, not an OAuth login.

## API routes

All routes require a valid MARKETRA Supabase bearer token:

- `GET /api/social/accounts` — list saved profile snapshots for the logged-in user.
- `POST /api/social/profile` — body: `{ "platform": "instagram", "handle": "username" }`; fetch and save a profile snapshot.
- `POST /api/social/posts` — body: `{ "platform": "instagram", "handle": "username", "limit": 10 }`; fetch a page of public content where supported.
- `POST /api/social/analyze` — fetch a provider profile+content composite where supported; Instagram, YouTube, and X/Twitter use their full-profile endpoints, TikTok uses its profile endpoint.
- `DELETE /api/social/accounts/:id` — delete a saved profile owned by the current user.

The marketing endpoint uses saved snapshots and does not spend SocialCrawl credits on every chat message. Refresh a profile intentionally to fetch new data. Most standard profile/post calls cost 1 credit; composite endpoints can cost more.

## Supabase schema migration

Run the updated `database/schema.sql` in the Supabase SQL editor. It updates `social_accounts` to store `platform`, `handle`, `profile_data`, and `last_sync_at`, removes the old Phyllo identifier columns and drops the Phyllo webhook-event table. The migration does not delete users, businesses, chats, or marketing recommendations.

## Verification

1. Add the two SocialCrawl variables in Render and redeploy.
2. Run `GET https://marketra-ai.onrender.com/api/health` and confirm `{ "status": "ok" }`.
3. Log in to MARKETRA and choose **Add Social Profile**.
4. Start with one public profile to verify the response and credit balance before adding more profiles.
