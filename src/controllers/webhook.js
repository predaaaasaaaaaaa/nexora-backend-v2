// ═══════════════════════════════════════════════════════
// NEXORA — Lemon Squeezy Webhook Controller
// Receives webhook events, updates user subscription
// ═══════════════════════════════════════════════════════

import crypto from 'crypto';
import { supabase } from '../services/supabase.js';
import {
  getPlanFromVariant,
  updateSubscription,
  logSubscriptionEvent,
} from '../services/subscription.js';

// Verify webhook signature from Lemon Squeezy
function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('Missing LEMONSQUEEZY_WEBHOOK_SECRET');
    return false;
  }

  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

// Find user by custom data (user_id passed during checkout)
async function findUserByCustomData(payload) {
  const customData = payload?.meta?.custom_data;
  if (customData?.user_id) {
    return customData.user_id;
  }

  // Fallback: find by email from Lemon Squeezy customer
  const email = payload?.data?.attributes?.user_email;
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

// ─── Main Webhook Handler ─────────────────────────────

export async function handleWebhook(req, res) {
  try {
    // Verify signature
    const signature = req.headers['x-signature'];
    if (!signature) {
      console.error('Webhook: Missing signature');
      return res.status(401).json({ error: 'Missing signature' });
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      console.error('Webhook: Missing raw body');
      return res.status(400).json({ error: 'Missing body' });
    }

    const isValid = verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      console.error('Webhook: Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = req.body;
    const eventName = payload?.meta?.event_name;

    console.log(`🔔 Webhook received: ${eventName}`);

    // Find the user
    const userId = await findUserByCustomData(payload);

    if (!userId) {
      console.error('Webhook: Could not find user for event:', eventName);
      // Still log the event for debugging
      await logSubscriptionEvent(eventName, payload, null, null);
      return res.status(200).json({ received: true, warning: 'User not found' });
    }

    // Get subscription details from payload
    const attrs = payload?.data?.attributes || {};
    const variantId = attrs.variant_id || attrs.first_subscription_item?.variant_id;
    const plan = getPlanFromVariant(variantId);

    // Handle each event type
    switch (eventName) {
      case 'subscription_created': {
        const status = attrs.status; // active, on_trial, paused, cancelled
        await updateSubscription(userId, {
          plan,
          subscription_status: status === 'on_trial' ? 'trialing' : 'active',
          ls_subscription_id: String(payload.data.id),
          ls_customer_id: String(attrs.customer_id),
          ls_variant_id: String(variantId),
          trial_ends_at: attrs.trial_ends_at || null,
          plan_activated_at: new Date().toISOString(),
        });
        console.log(`✅ User ${userId} subscribed to ${plan} (${status})`);
        break;
      }

      case 'subscription_updated': {
        const status = attrs.status;

        // Check if plan changed (upgrade/downgrade)
        const newPlan = getPlanFromVariant(variantId);

        const updates = {
          plan: newPlan,
          ls_variant_id: String(variantId),
          subscription_status: status === 'on_trial' ? 'trialing'
            : status === 'active' ? 'active'
            : status === 'past_due' ? 'past_due'
            : status === 'cancelled' ? 'cancelled'
            : status,
          subscription_ends_at: attrs.ends_at || null,
          trial_ends_at: attrs.trial_ends_at || null,
        };

        // If cancelled, keep access until end of billing period
        if (status === 'cancelled' && attrs.ends_at) {
          updates.subscription_ends_at = attrs.ends_at;
          // Don't change plan yet — they keep access until ends_at
        }

        await updateSubscription(userId, updates);
        console.log(`🔄 User ${userId} subscription updated: ${newPlan} (${status})`);
        break;
      }

      case 'subscription_cancelled': {
        // User cancelled — they keep access until end of billing period
        await updateSubscription(userId, {
          subscription_status: 'cancelled',
          subscription_ends_at: attrs.ends_at || null,
        });
        console.log(`❌ User ${userId} cancelled — access until ${attrs.ends_at}`);
        break;
      }

      case 'subscription_expired': {
        // Billing period ended after cancellation — downgrade to free
        await updateSubscription(userId, {
          plan: 'free',
          subscription_status: 'inactive',
          ls_subscription_id: null,
          ls_variant_id: null,
          subscription_ends_at: null,
          trial_ends_at: null,
        });
        console.log(`⏰ User ${userId} subscription expired — downgraded to free`);
        break;
      }

      case 'subscription_payment_success': {
        // Payment went through — ensure plan is active
        await updateSubscription(userId, {
          subscription_status: 'active',
        });
        console.log(`💰 User ${userId} payment successful`);
        break;
      }

      case 'subscription_payment_failed': {
        await updateSubscription(userId, {
          subscription_status: 'past_due',
        });
        console.log(`⚠️ User ${userId} payment failed — past_due`);
        break;
      }

      default:
        console.log(`ℹ️ Unhandled webhook event: ${eventName}`);
    }

    // Log every event for audit trail
    await logSubscriptionEvent(eventName, payload, userId, plan);

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}