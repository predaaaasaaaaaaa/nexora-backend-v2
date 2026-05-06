// Helper function to validate email
export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Allowlist of platform identifiers we accept anywhere in the API.
// Centralizing this prevents a typo or stray "<script>" string from being
// passed into Supabase rows that later get rendered or fed to the AI.
export const SUPPORTED_PLATFORMS = ['instagram', 'youtube', 'tiktok', 'twitter'];

export function isSupportedPlatform(p) {
  return typeof p === 'string' && SUPPORTED_PLATFORMS.includes(p);
}

// Restricted set of content types accepted on scheduled_posts.
export const SUPPORTED_CONTENT_TYPES = ['video', 'short', 'reel', 'post', 'story', 'tweet', 'thread'];

export function isSupportedContentType(t) {
  return typeof t === 'string' && SUPPORTED_CONTENT_TYPES.includes(t);
}















