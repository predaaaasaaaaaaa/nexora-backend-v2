import { Resend } from 'resend';
import { supabase } from './supabase.js';

// ============================================================
// NOTIFICATION SERVICE — Email reminders for scheduled posts
// ============================================================
// Setup:
// 1. npm install resend
// 2. Add RESEND_API_KEY to your .env
// 3. Add RESEND_FROM_EMAIL to your .env (e.g., "NEXORA <notifications@yourdomain.com>")
//    For testing, Resend gives you a free onboarding@resend.dev sender
// 4. Call startNotificationCron() in your server.js startup
// ============================================================

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'NEXORA <onboarding@resend.dev>';

// Check for posts that need reminders and send them
async function checkAndSendReminders() {
  try {
    const now = new Date();

    // Get all users with notification preferences enabled
    const { data: prefs, error: prefsError } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('enabled', true);

    if (prefsError || !prefs || prefs.length === 0) return;

    for (const pref of prefs) {
      // Calculate the window: posts scheduled within the next [reminder_minutes]
      const reminderWindow = new Date(now.getTime() + pref.reminder_minutes * 60 * 1000);

      // Find upcoming posts for this user that haven't had reminders sent
      const { data: posts, error: postsError } = await supabase
        .from('scheduled_posts')
        .select('*')
        .eq('user_id', pref.user_id)
        .eq('status', 'scheduled')
        .eq('reminder_sent', false)
        .gte('scheduled_at', now.toISOString())
        .lte('scheduled_at', reminderWindow.toISOString())
        .order('scheduled_at', { ascending: true });

      if (postsError || !posts || posts.length === 0) continue;

      // Send reminder email for each upcoming post
      for (const post of posts) {
        const sent = await sendReminderEmail(pref.notification_email, post, pref.reminder_minutes);

        if (sent) {
          // Mark reminder as sent
          await supabase
            .from('scheduled_posts')
            .update({ reminder_sent: true })
            .eq('id', post.id);

          console.log(`📧 Reminder sent for "${post.title}" to ${pref.notification_email}`);
        }
      }
    }

  } catch (error) {
    console.error('Error in notification cron:', error);
  }
}

// Escape any user-controlled string before embedding it in HTML.
// post.title and post.description are user input, so without this we'd
// be rendering arbitrary HTML/JS in the recipient's mailbox.
function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Strip CR/LF from anything we put in an email subject so user content
// can't inject extra headers (Bcc:, Subject:, etc.) on transports that
// don't sanitize for us.
function stripHeaderUnsafe(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

// Send a single reminder email
async function sendReminderEmail(email, post, reminderMinutes) {
  try {
    const scheduledDate = new Date(post.scheduled_at);
    const dateStr = scheduledDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const timeStr = scheduledDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const timeLabel = formatReminderTime(reminderMinutes);

    const platformEmoji = {
      youtube: '🎬',
      instagram: '📸',
      tiktok: '🎵',
      twitter: '🐦',
    };
    const emoji = platformEmoji[post.platform] || '📅';

    const safeTitle = escapeHtml(post.title);
    const safePlatform = escapeHtml(post.platform);
    const safeContentType = escapeHtml(post.content_type);
    const safeDescription = escapeHtml(post.description);
    const subjectTitle = stripHeaderUnsafe(post.title);

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `${emoji} Reminder: "${subjectTitle}" is scheduled ${timeLabel}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px 20px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="font-size: 24px; font-weight: 700; color: #111; margin: 0;">⏰ Content Reminder</h1>
          </div>

          <div style="background: #f8f9fa; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
            <p style="color: #666; font-size: 14px; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.5px;">
              ${timeLabel}
            </p>
            <h2 style="font-size: 20px; color: #111; margin: 0 0 16px 0;">
              ${emoji} ${safeTitle}
            </h2>

            <div style="display: flex; gap: 16px; flex-wrap: wrap;">
              <div>
                <span style="color: #888; font-size: 12px;">Platform</span><br/>
                <span style="font-weight: 600; color: #333; text-transform: capitalize;">${safePlatform}</span>
              </div>
              <div>
                <span style="color: #888; font-size: 12px;">Type</span><br/>
                <span style="font-weight: 600; color: #333; text-transform: capitalize;">${safeContentType}</span>
              </div>
              <div>
                <span style="color: #888; font-size: 12px;">Date</span><br/>
                <span style="font-weight: 600; color: #333;">${dateStr}</span>
              </div>
              <div>
                <span style="color: #888; font-size: 12px;">Time</span><br/>
                <span style="font-weight: 600; color: #333;">${timeStr}</span>
              </div>
            </div>

            ${post.description ? `
              <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e0e0e0;">
                <span style="color: #888; font-size: 12px;">Notes</span><br/>
                <span style="color: #333;">${safeDescription}</span>
              </div>
            ` : ''}
          </div>

          <p style="color: #999; font-size: 12px; text-align: center; margin: 0;">
            Sent by NEXORA • You can update notification settings in your dashboard
          </p>
        </div>
      `,
    });

    if (error) {
      console.error('Resend error:', error);
      return false;
    }

    return true;

  } catch (error) {
    console.error('Error sending reminder email:', error);
    return false;
  }
}

// Format reminder time for display
function formatReminderTime(minutes) {
  if (minutes < 60) return `in ${minutes} minutes`;
  if (minutes === 60) return 'in 1 hour';
  if (minutes < 1440) return `in ${minutes / 60} hours`;
  if (minutes === 1440) return 'tomorrow';
  return `in ${minutes / 1440} days`;
}

// Also mark past scheduled posts as 'missed' if they weren't published
async function markMissedPosts() {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    await supabase
      .from('scheduled_posts')
      .update({ status: 'missed' })
      .eq('status', 'scheduled')
      .lt('scheduled_at', oneHourAgo);

  } catch (error) {
    console.error('Error marking missed posts:', error);
  }
}

// Start the notification cron (runs every 5 minutes)
export function startNotificationCron() {
  console.log('🔔 Notification cron started — checking every 5 minutes');

  // Run immediately on startup
  checkAndSendReminders();
  markMissedPosts();

  // Then every 5 minutes
  setInterval(() => {
    checkAndSendReminders();
    markMissedPosts();
  }, 5 * 60 * 1000);
}