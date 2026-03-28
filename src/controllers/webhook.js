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
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

// Find user by custom_data passed during checkout
async function findUser(payload) {
  // Check custom_data first (set during checkout)
  const customData = payload?.data?.custom_data;
  if (customData?.user_id) {
    return customData.user_id;
  }

  // Fallback: find by Paddle customer ID in profiles
  const paddleCustomerId = payload?.data?.customer_id;
  if (paddleCustomerId) {
    const { data } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('paddle_customer_id', String(paddleCustomerId))
      .single();
    if (data?.user_id) return data.user_id;
  }

  // Last resort: find by email
  const email = payload?.data?.customer?.email;
  if (email) {
    const { data } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('email', email)
      .single();
    return data?.user_id || null;
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

    // Paddle signs: ts:rawBody
    const rawBody = req.rawBody;
    if (!rawBody) {
      console.error('Webhook: Missing raw body');
      return res.status(400).json({ error: 'Missing body' });
    }

    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    const signedPayload = `${ts}:${rawBody}`;
    const hmac = crypto.createHmac('sha256', secret);
    const expectedSignature = hmac.update(signedPayload).digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(h1)
    );

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
      return res.status(200).json({ received: true, warning: 'User not found' });
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
