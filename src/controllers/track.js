import { trackEvent } from '../services/tracking.js';

// Events the client is allowed to emit through this route. Server-side
// product events (coach_query_sent, content_ideas_generated, etc.) call
// trackEvent() directly and must NEVER come through here — this endpoint
// exists only for events the browser is the source of truth for.
const CLIENT_EVENT_ALLOWLIST = new Set(['analytics_viewed', 'session_started']);

// Keep the properties payload small and PII-free. We only accept
// primitive scalars (IDs / enums / counts) — anything else (objects,
// arrays, functions, null) is dropped. Caps guard against a tampered
// client padding the row.
const MAX_PROPERTY_KEYS = 20;
const MAX_STRING_LEN = 200;

function sanitizeProperties(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const clean = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (count >= MAX_PROPERTY_KEYS) break;
    const t = typeof value;
    if (t === 'string') {
      clean[key] = value.slice(0, MAX_STRING_LEN);
      count++;
    } else if (t === 'number' && Number.isFinite(value)) {
      clean[key] = value;
      count++;
    } else if (t === 'boolean') {
      clean[key] = value;
      count++;
    }
    // Everything else (objects, arrays, null, undefined) is intentionally
    // stripped — properties are scalars only, never nested or PII.
  }
  return clean;
}

// POST /api/track — authenticated client-event sink.
export async function trackClientEvent(req, res) {
  try {
    // user_id ALWAYS comes from the verified session, never the body.
    // A client-sent user_id would let one user log events as another.
    const userId = req.user.id;
    const { event_name, properties } = req.body || {};

    if (!event_name || typeof event_name !== 'string' || !CLIENT_EVENT_ALLOWLIST.has(event_name)) {
      return res.status(400).json({ success: false, error: 'Invalid or disallowed event_name' });
    }

    const cleanProps = sanitizeProperties(properties);

    // Fire-and-forget — trackEvent never throws, so a failed insert still
    // returns 200 to the client. Analytics must not surface errors to the UI.
    await trackEvent(userId, event_name, cleanProps);

    res.json({ success: true });
  } catch (error) {
    console.error('Error in trackClientEvent:', error);
    res.status(500).json({ success: false, error: 'Failed to record event' });
  }
}
