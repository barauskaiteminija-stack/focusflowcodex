// api/subscribe-reminder.js
// Called from the app when user enters email for daily reminders
// Saves to Supabase taskbit_reminders table

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://znppdwkvnphbaduytccs.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APP_URL = 'https://taskbitapp.vercel.app';
const FROM_EMAIL = 'onboarding@resend.dev';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', APP_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { email, goal, tasks, startDate, totalDays } = req.body || {};

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }
  if (!goal || !tasks || !startDate) {
    return res.status(400).json({ error: 'Missing project data.' });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Upsert — if they resubscribe it updates their data
  const { error } = await sb.from('taskbit_reminders').upsert({
    email: email.toLowerCase().trim(),
    goal,
    tasks_json: JSON.stringify(tasks),
    start_date: startDate,
    total_days: totalDays,
    active: true,
    subscribed_at: new Date().toISOString()
  }, { onConflict: 'email' });

  if (error) {
    console.error('Supabase error:', error);
    return res.status(500).json({ error: 'Could not save your reminder. Please try again.' });
  }

  // Send confirmation email
  try {
    const todayTask = tasks[0];
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: `Taskbit <${FROM_EMAIL}>`,
        to: email,
        subject: `Daily reminders set for "${goal}"`,
        html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:40px 20px;background:#111113;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;">
  <table width="100%" style="max-width:520px;margin:0 auto;" cellpadding="0" cellspacing="0">
    <tr><td>
      <div style="font-size:13px;color:#52525C;margin-bottom:24px;">
        <strong style="color:#6C63FF;">Taskbit</strong>
      </div>
      <h1 style="font-size:22px;font-weight:700;color:#EEEEF0;margin:0 0 8px;">
        Daily reminders set. ✓
      </h1>
      <p style="font-size:15px;color:#8E8E99;margin:0 0 24px;line-height:1.6;">
        Every morning at 8am you will get an email with your task for the day.<br>
        Your goal: <strong style="color:#EEEEF0;">${goal}</strong>
      </p>
      ${todayTask ? `
      <div style="background:#1C1C20;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:20px;margin-bottom:24px;">
        <div style="font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#6C63FF;margin-bottom:8px;">Today's task</div>
        <div style="font-size:17px;font-weight:600;color:#EEEEF0;line-height:1.4;">${todayTask.text}</div>
      </div>` : ''}
      <a href="${APP_URL}" style="display:inline-block;background:#6C63FF;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:9px;">
        Open Taskbit now →
      </a>
      <p style="font-size:11px;color:#52525C;margin-top:32px;line-height:1.6;">
        To stop reminders, reply to any email or 
        <a href="${APP_URL}/api/unsubscribe?email=${encodeURIComponent(email)}" style="color:#52525C;">click here to unsubscribe</a>.
      </p>
    </td></tr>
  </table>
</body>
</html>`
      })
    });
  } catch (e) {
    // Confirmation email failed but subscription saved — not critical
    console.warn('Confirmation email failed:', e);
  }

  return res.status(200).json({ ok: true });
}
