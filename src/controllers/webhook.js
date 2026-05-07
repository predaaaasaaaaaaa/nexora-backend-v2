// ═══════════════════════════════════════════════════════
// NEXORA — Paddle Webhook Controller
// Receives webhook events, updates user subscription
// ═══════════════════════════════════════════════════════

import crypto from 'crypto';
import { supabase } from '../services/supabase.js';
import {
  getPlanFromPriceId,
  updateSubscription,
  logSubscriptionEvent,
} from '../services/subscription.js';

// Verify Paddle webhook signature
function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('Missing PADDLE_WEBHOOK_SECRET');
    return false;
  }

  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(rawBody).digest('hex');

  try {
    const a = Buffer.from(digest);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Verify the HMAC-signed user_id we minted server-side at checkout time.
// custom_data is round-tripped by Paddle, so without a signature the field
// is fully attacker-controlled.
function verifySignedUserId(signed) {
  if (typeof signed !== 'string' || !signed.includes('.')) return null;
  const secret = process.env.CHECKOUT_USER_ID_SECRET;
  if (!secret || secret.length < 32) return null;

  const [b64, sig] = signed.split('.');
  if (!b64 || !sig) return null;

  const expected = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload?.userId || !payload?.exp || Date.now() > payload.exp) return null;
  return payload.userId;
}

// Find user from a Paddle webhook payload.
//
// Trust order:
//   1. custom_data.user_id_signed — only accepted if the HMAC verifies.
//   2. paddle_customer_id already linked to a profile (set by us on
//      subscription.created).
//
// We deliberately do NOT fall back to email lookup. Email matching lets
// any Paddle customer who owns the same email upgrade an arbitrary
// nexora account, and combined with email-mutation bugs becomes a
// straight account takeover of subscriptions.
async function findUser(payload) {
  const customData = payload?.data?.custom_data;
  if (customData?.user_id_signed) {
    const verified = verifySignedUserId(customData.user_id_signed);
    if (verified) return verified;
  }

  const paddleCustomerId = payload?.data?.customer_id;
  if (paddleCustomerId) {
    const { data } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('paddle_customer_id', String(paddleCustomerId))
      .single();
    if (data?.user_id) return data.user_id;
  }

  return null;
}

// Extract price ID from subscription items
function getPriceId(payload) {
  const items = payload?.data?.items;
  if (items && items.length > 0) {
    return items[0].price?.id || items[0].price_id || null;
  }
  return null;
}

// ─── Main Webhook Handler ─────────────────────────────

export async function handleWebhook(req, res) {
  try {
    // Verify signature
    const signature = req.headers['paddle-signature'];
    if (!signature) {
      console.error('Webhook: Missing paddle-signature header');
      return res.status(401).json({ error: 'Missing signature' });
    }

    // Extract h1 hash from Paddle signature format: ts=xxx;h1=xxx
    const parts = signature.split(';');
    const h1Part = parts.find(p => p.startsWith('h1='));
    const tsPart = parts.find(p => p.startsWith('ts='));

    if (!h1Part || !tsPart) {
      console.error('Webhook: Invalid signature format');
      return res.status(401).json({ error: 'Invalid signature format' });
    }

    const ts = tsPart.replace('ts=', '');
    const h1 = h1Part.replace('h1=', '');

    // Reject stale signatures so a captured webhook can't be replayed
    // hours/days later. Paddle uses Unix seconds; we allow ±5 minutes
    // of clock skew. Tighter than that breaks on clock drift; looser
    // gives an attacker too much replay window if a payload leaks.
    const tsNum = parseInt(ts, 10);
    if (!tsNum || Math.abs(Date.now() / 1000 - tsNum) > 5 * 60) {
      console.error('Webhook: ts outside freshness window', { ts });
      return res.status(401).json({ error: 'Stale webhook' });
    }

    // Paddle signs: ts:rawBody
    const rawBody = req.rawBody;
    if (!rawBody) {
      console.error('Webhook: Missing raw body');
      return res.status(400).json({ error: 'Missing body' });
    }

    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    if (!secret) {
      console.error('Webhook: PADDLE_WEBHOOK_SECRET not configured');
      return res.status(500).json({ error: 'Webhook misconfigured' });
    }
    const signedPayload = `${ts}:${rawBody}`;
    const hmac = crypto.createHmac('sha256', secret);
    const expectedSignature = hmac.update(signedPayload).digest('hex');

    // Length-guard before timingSafeEqual — passing buffers of different
    // sizes throws RangeError, which would have crashed the request handler
    // and let an attacker DoS the webhook with malformed h1 values.
    const expectedBuf = Buffer.from(expectedSignature);
    const providedBuf = Buffer.from(h1);
    const isValid =
      expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf);

    if (!isValid) {
      console.error('Webhook: Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = req.body;
    const eventType = payload?.event_type;

    console.log(`🔔 Paddle webhook: ${eventType}`);

    // Find the user
    const userId = await findUser(payload);

    if (!userId) {
      console.error('Webhook: Could not find user for event:', eventType);
      await logSubscriptionEvent(eventType, payload, null, null);
      // Reply 4xx so Paddle retries. Returning 200 here used to make
      // Paddle treat the event as delivered, silently dropping plan
      // changes on the floor when the user mapping was temporarily
      // unavailable (e.g. a brand-new subscription with custom_data
      // racing the row insert).
      return res.status(409).json({ error: 'User mapping not found yet' });
    }

    const priceId = getPriceId(payload);
    const plan = priceId ? getPlanFromPriceId(priceId) : null;

    switch (eventType) {
      case 'subscription.created': {
        const status = payload.data.status;
        await updateSubscription(userId, {
          plan,
          subscription_status: status === 'trialing' ? 'trialing' : 'active',
          paddle_subscription_id: String(payload.data.id),
          paddle_customer_id: String(payload.data.customer_id),
          plan_activated_at: new Date().toISOString(),
        });
        console.log(`✅ User ${userId} subscribed to ${plan} (${status})`);
        break;
      }

      case 'subscription.updated': {
        const status = payload.data.status;
        const newPlan = priceId ? getPlanFromPriceId(priceId) : plan;

        const updates = {
          plan: newPlan,
          subscription_status: status === 'trialing' ? 'trialing'
            : status === 'active' ? 'active'
            : status === 'past_due' ? 'past_due'
            : status === 'canceled' ? 'cancelled'
            : status,
        };

        if (status === 'canceled' && payload.data.current_billing_period?.ends_at) {
          updates.subscription_ends_at = payload.data.current_billing_period.ends_at;
        }

        await updateSubscription(userId, updates);
        console.log(`🔄 User ${userId} subscription updated: ${newPlan} (${status})`);
        break;
      }

      case 'subscription.canceled': {
        const endsAt = payload.data.current_billing_period?.ends_at || null;
        await updateSubscription(userId, {
          subscription_status: 'cancelled',
          subscription_ends_at: endsAt,
        });
        console.log(`❌ User ${userId} cancelled — access until ${endsAt}`);
        break;
      }

      case 'subscription.past_due': {
        await updateSubscription(userId, {
          subscription_status: 'past_due',
        });
        console.log(`⚠️ User ${userId} payment past due`);
        break;
      }

      case 'transaction.completed': {
        // Payment succeeded — ensure active
        await updateSubscription(userId, {
          subscription_status: 'active',
        });
        console.log(`💰 User ${userId} payment successful`);
        break;
      }

      case 'transaction.payment_failed': {
        await updateSubscription(userId, {
          subscription_status: 'past_due',
        });
        console.log(`⚠️ User ${userId} payment failed`);
        break;
      }

      default:
        console.log(`ℹ️ Unhandled Paddle event: ${eventType}`);
    }

    await logSubscriptionEvent(eventType, payload, userId, plan);
    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
