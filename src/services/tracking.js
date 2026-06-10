import { supabase } from './supabase.js';

// Product-event logging. One row per call into public.product_events.
//
// FIRE-AND-FORGET by design: analytics must never break a product
// feature. Every failure is swallowed (logged, not thrown), and callers
// are NOT required to await — `trackEvent(...)` without `await` is fine.
// If you do await it, it still never rejects.
//
// product_events has RLS enabled with no client policies, so writes only
// succeed through the service-role client in services/supabase.js. Never
// route client-supplied user_id here without verifying it server-side
// first (see controllers/track.js for the authenticated client path).
export async function trackEvent(userId, eventName, properties = {}) {
  try {
    if (!userId || !eventName) {
      console.error('trackEvent: missing userId or eventName', { userId, eventName });
      return;
    }

    const { error } = await supabase
      .from('product_events')
      .insert({
        user_id: userId,
        event_name: eventName,
        properties: properties || {},
      });

    if (error) {
      console.error('trackEvent: insert failed', eventName, error.message);
    }
  } catch (err) {
    // Catch-all so a thrown client error, network blip, or bad payload
    // can never bubble into the product feature that emitted the event.
    console.error('trackEvent: unexpected error', eventName, err?.message || err);
  }
}
