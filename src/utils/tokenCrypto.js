// AES-256-GCM envelope for storing third-party OAuth tokens at rest.
//
// Without this, a Supabase compromise (or any service-key leak) would hand
// every connected user's Google account to the attacker, and Google refresh
// tokens are long-lived. Encrypting at rest means the DB row alone isn't
// enough — the attacker would also need TOKEN_ENCRYPTION_KEY from the runtime.
//
// Format: "v1:<iv-b64>:<tag-b64>:<ciphertext-b64>" — versioned so we can
// rotate algorithms without a migration. Plaintext tokens stored from
// before this change still load (decryptToken returns them as-is when no
// version prefix is present).
//
// ─── Key rotation playbook ───────────────────────────────────────
//
// Rotating TOKEN_ENCRYPTION_KEY without coordination is destructive —
// every existing connected_platforms row was encrypted with the old
// key, and decrypt will return null after rotation, locking users
// out of their YouTube data until they reconnect.
//
// Two-phase rotation (zero-downtime):
//   1. Add TOKEN_ENCRYPTION_KEY_NEXT alongside TOKEN_ENCRYPTION_KEY.
//      decryptToken tries the current key first, falls back to
//      _NEXT (and any older listed via TOKEN_ENCRYPTION_KEYS_OLD).
//      encryptToken keeps using TOKEN_ENCRYPTION_KEY.
//   2. Once you're confident in the new key (deploy successful),
//      flip: TOKEN_ENCRYPTION_KEY = the new key,
//      TOKEN_ENCRYPTION_KEYS_OLD = the previous key. encryptToken
//      now uses the new key. Background-rewrite existing rows to
//      re-encrypt with the new key by reading + re-saving via
//      handleCallback's upsert path (or a one-off script).
//   3. After all rows are rewritten, drop TOKEN_ENCRYPTION_KEYS_OLD.
//
// Format-version bump (v1 → v2 someday): bump VERSION below.
// decryptToken checks the prefix, so old v1 ciphertexts still
// decrypt correctly with the v1 path; new writes use v2.
//
// The fallback-key plumbing isn't implemented yet — when you need it,
// extend getKey() to return an array of keys and try each in order
// inside decryptToken. Don't change encryptToken's behavior.

import crypto from 'crypto';

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function getKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY is not set');
  // Accept hex (64 chars) or base64 (44 chars) keys; reject anything that
  // doesn't decode to exactly 32 bytes so we never silently weaken AES-256.
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes (AES-256)');
  }
  return key;
}

export function encryptToken(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ct.toString('base64'),
  ].join(':');
}

export function decryptToken(value) {
  if (value == null) return null;
  // Backwards compatibility: tokens stored before this change have no
  // version prefix. Return them as-is so existing connections keep working
  // until the user reconnects (which will re-store them encrypted).
  if (typeof value !== 'string' || !value.startsWith(`${VERSION}:`)) {
    return value;
  }
  const parts = value.split(':');
  if (parts.length !== 4) return null;
  const [, ivB64, tagB64, ctB64] = parts;
  try {
    const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    // Wrong key, tampered ciphertext, or corrupt row.
    return null;
  }
}
