function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null) ?? null;
}

function normalizeSocialResponse(response, platform, handle) {
  const data = response?.data || {};
  const author = data.author || data.channel || data.profile || data;
  const computed = data.computed || author.computed || {};
  const engagement = data.engagement || author.engagement || {};

  return {
    source: "SocialCrawl public data",
    platform: String(platform || response?.platform || "unknown").toLowerCase(),
    handle: firstDefined(author.username, author.handle, handle),
    display_name: firstDefined(author.display_name, author.full_name, author.name, author.title),
    bio: firstDefined(author.bio, author.description, author.about),
    profile_url: firstDefined(author.url, author.profile_url, author.channel_url),
    avatar_url: firstDefined(author.avatar_url, author.profile_pic_url, author.thumbnail_url),
    followers: firstDefined(author.followers, author.follower_count, author.subscribers, author.subscriber_count),
    following: firstDefined(author.following, author.following_count),
    posts_count: firstDefined(author.posts_count, author.post_count, author.video_count),
    verified: firstDefined(author.verified, author.is_verified),
    engagement_rate: firstDefined(computed.engagement_rate, engagement.engagement_rate),
    content_category: firstDefined(computed.content_category, author.content_category),
    language: firstDefined(computed.language, author.language),
    credits_used: firstDefined(response?.credits_used, null),
    credits_remaining: firstDefined(response?.credits_remaining, null),
    fetched_at: new Date().toISOString(),
  };
}

module.exports = { normalizeSocialResponse };
