const BASE_URL = (process.env.SOCIALCRAWL_BASE_URL || "https://www.socialcrawl.dev/v1").replace(/\/+$/, "");
const API_KEY = process.env.SOCIALCRAWL_API_KEY;

const PLATFORMS = {
  instagram: { profile: "instagram/profile", posts: "instagram/profile/posts", full: "instagram/profile/full", handleParam: "handle" },
  tiktok: { profile: "tiktok/profile", handleParam: "handle" },
  youtube: { profile: "youtube/channel", posts: "youtube/channel/videos", full: "youtube/profile/full", handleParam: "handle" },
  twitter: { profile: "twitter/profile", posts: "twitter/user/tweets", full: "twitter/profile/full", handleParam: "handle" },
};

function getPlatform(platform) {
  const key = String(platform || "").trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(PLATFORMS, key)) {
    const err = new Error("Unsupported platform. Choose Instagram, TikTok, YouTube, or X (Twitter).");
    err.status = 400;
    throw err;
  }
  return { key, ...PLATFORMS[key] };
}

function cleanHandle(value) {
  const handle = String(value || "").trim().replace(/^@/, "");
  if (!handle || handle.length > 200 || /[\r\n]/.test(handle)) {
    const err = new Error("Enter a valid public username or handle.");
    err.status = 400;
    throw err;
  }
  return handle;
}

async function requestSocialCrawl(platform, kind, handle, extra = {}) {
  if (!API_KEY) {
    const err = new Error("SocialCrawl is not configured. Add SOCIALCRAWL_API_KEY to Render environment variables.");
    err.status = 503;
    throw err;
  }
  const p = getPlatform(platform);
  const endpoint = p[kind];
  if (!endpoint) {
    const err = new Error(`${kind} data is not configured for ${p.key}.`);
    err.status = 400;
    throw err;
  }
  const url = new URL(`${BASE_URL}/${endpoint}`);
  url.searchParams.set(p.handleParam, cleanHandle(handle));
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method: "GET",
    headers: { "x-api-key": API_KEY, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const type = body?.error?.type || body?.error?.code || "SOCIALCRAWL_ERROR";
    const message = body?.error?.message || body?.message || `SocialCrawl request failed (${response.status}).`;
    const err = new Error(message);
    err.status = response.status === 401 ? 502 : response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
    err.providerType = type;
    err.creditsRemaining = body?.credits_remaining;
    throw err;
  }
  return body;
}

module.exports = { PLATFORMS, getPlatform, cleanHandle, requestSocialCrawl };
