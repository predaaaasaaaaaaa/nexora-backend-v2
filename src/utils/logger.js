// Tiny logger wrapper with sensitive-key redaction.
//
// We were calling console.error all over with the raw error object —
// often containing req.body, JWTs, refresh_tokens, encrypted-token
// strings or Supabase auth payloads. In Vercel logs those become
// searchable. This wrapper deep-clones the args, replaces any field
// whose key looks sensitive with '[REDACTED]', and passes through.
//
// Use it like console:
//   import { log } from '../utils/logger.js';
//   log.error('Update profile error:', error);
//
// Existing console.error calls keep working unchanged — switch them
// over opportunistically.

const SENSITIVE_KEY_RE = /(token|secret|password|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|jwt|cookie|session)/i;
const SENSITIVE_VALUE_RE = /^(Bearer\s+|sk_|pk_|eyJ|sb-)/; // common token prefixes

function redact(value, depth = 0) {
  if (depth > 6) return '[depth-limit]';
  if (value == null) return value;
  if (typeof value === 'string') {
    return SENSITIVE_VALUE_RE.test(value) ? '[REDACTED]' : value;
  }
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map(v => redact(v, depth + 1));
  }

  // Don't deep-walk Errors — keep their message + stack, redact the rest.
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      // Some Supabase errors have extra fields; redact anything sensitive.
      ...Object.fromEntries(
        Object.entries(value)
          .filter(([k]) => !SENSITIVE_KEY_RE.test(k))
          .map(([k, v]) => [k, redact(v, depth + 1)])
      ),
    };
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(k)) out[k] = '[REDACTED]';
    else out[k] = redact(v, depth + 1);
  }
  return out;
}

function wrap(method) {
  return (...args) => {
    try {
      method(...args.map(a => redact(a)));
    } catch {
      // Never let the logger throw — fall back to raw.
      method(...args);
    }
  };
}

export const log = {
  info: wrap(console.log.bind(console)),
  warn: wrap(console.warn.bind(console)),
  error: wrap(console.error.bind(console)),
  debug: wrap(console.debug.bind(console)),
};

// Also export the redactor for one-off use.
export { redact };
