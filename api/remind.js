// api/remind.js
// Runs every day at 8am UTC via Vercel cron
// Reads all reminder subscribers from Supabase
// Sends each user today's task via Resend

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://znppdwkvnphbaduytccs.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // set in Vercel env vars
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APP_URL = 'https://taskbitapp.vercel.app';
const FROM_EMAIL = 'onboarding@resend.dev'; // replace with your domain once you have one

export default async function handler(req, res) {
  // Only allow Vercel cron calls (or manual GET for testing)
  if (req.method !== 'GET') return res.status(405).end();

  // Security: verify cron secret header
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SUPABASE_SERVICE_KEY || !RESEND_API_KEY) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  // Use service key to bypass RLS and read all subscribers
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Get all users who have reminder emails set
  const { data: subscribers, error } = await sb
    .from('taskbit_reminders')
    .select('*')
    .eq('active', true);

  if (error) {
    console.error('Supabase error:', error);
    return res.status(500).json({ error: error.message });
  }

  if (!subscribers || subscribers.length === 0) {
    return res.status(200).json({ sent: 0, message: 'No subscribers' });
  }

  const today = new Date();
  let sent = 0;
  let skipped = 0;
  const errors = [];

  for (const sub of subscribers) {
    try {
      // Calculate which day they are on
      const start = new Date(sub.start_date + 'T00:00:00');
      const dayIndex = Math.floor((today - start) / 86400000);

      if (dayIndex < 0) { skipped++; continue; } // not started yet

      const tasks = JSON.parse(sub.tasks_json || '[]');

      if (dayIndex >= tasks.length) {
        // Plan finished — send completion email and deactivate
        await sb.from('taskbit_reminders').update({ active: false }).eq('id', sub.id);
        await sendEmail(sub.email, {
          subject: `You finished "${sub.goal}" 🏆`,
          html: finishedEmail(sub.goal, APP_URL)
        });
        sent++;
        continue;
      }

      const task = tasks[dayIndex];
      const dayNum = dayIndex + 1;
      const totalDays = tasks.length;
      const daysLeft = totalDays - dayNum;

      await sendEmail(sub.email, {
        subject: `Day ${dayNum}: ${task.text.slice(0, 55)}${task.text.length > 55 ? '…' : ''}`,
        html: reminderEmail({
          goal: sub.goal,
          taskText: task.text,
          phase: task.phase,
          estimate: task.estimate,
          dayNum,
          totalDays,
          daysLeft,
          appUrl: APP_URL,
          email: sub.email
        })
      });
      sent++;
    } catch (e) {
      console.error(`Failed for ${sub.email}:`, e);
      errors.push(sub.email);
    }
  }

  return res.status(200).json({ sent, skipped, errors });
}

async function sendEmail(to, { subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `Taskbit <${FROM_EMAIL}>`,
      to,
      subject,
      html
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }
  return res.json();
}

function reminderEmail({ goal, taskText, phase, estimate, dayNum, totalDays, daysLeft, appUrl, email }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Day ${dayNum} — ${goal}</title>
</head>
<body style="margin:0;padding:0;background:#111113;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#111113;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">

        <!-- Logo -->
        <tr><td style="padding-bottom:32px;">
          <div style="display:inline-flex;align-items:center;gap:10px;">
            <div style="width:32px;height:32px;background:#6C63FF;border-radius:8px;display:inline-block;line-height:32px;text-align:center;font-size:16px;font-weight:700;color:#fff;">T</div>
            <span style="font-size:16px;font-weight:700;color:#EEEEF0;">Taskbit</span>
          </div>
        </td></tr>

        <!-- Day label -->
        <tr><td style="padding-bottom:8px;">
          <span style="font-size:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#52525C;">
            Day ${dayNum} of ${totalDays} &nbsp;·&nbsp; ${goal}
          </span>
        </td></tr>

        <!-- Task card -->
        <tr><td style="background:#1C1C20;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:24px;margin-bottom:24px;">
          <div style="font-size:12px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:#6C63FF;margin-bottom:10px;">${phase || 'Today'}</div>
          <div style="font-size:20px;font-weight:600;color:#EEEEF0;line-height:1.4;margin-bottom:${estimate ? '12px' : '0'};">${taskText}</div>
          ${estimate ? `<div style="font-size:13px;color:#52525C;">⏱ ${estimate}</div>` : ''}
        </td></tr>

        <!-- CTA -->
        <tr><td style="padding:24px 0;">
          <a href="${appUrl}" style="display:inline-block;background:#6C63FF;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 32px;border-radius:10px;letter-spacing:-.1px;">
            Open Taskbit and mark it done →
          </a>
        </td></tr>

        <!-- Days left -->
        ${daysLeft > 0 ? `
        <tr><td style="padding-bottom:32px;">
          <span style="font-size:13px;color:#52525C;">${daysLeft} day${daysLeft === 1 ? '' : 's'} left on your plan. Keep going.</span>
        </td></tr>` : `
        <tr><td style="padding-bottom:32px;">
          <span style="font-size:13px;color:#6C63FF;font-weight:600;">This is the final day. Finish strong.</span>
        </td></tr>`}

        <!-- Footer -->
        <tr><td style="border-top:1px solid rgba(255,255,255,.06);padding-top:24px;">
          <p style="font-size:11px;color:#52525C;margin:0;line-height:1.6;">
            You're getting this because you signed up for daily reminders on Taskbit.<br>
            <a href="${appUrl}/api/unsubscribe?email=${encodeURIComponent(email)}" style="color:#52525C;">Unsubscribe</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function finishedEmail(goal, appUrl) {
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:40px 20px;background:#111113;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;">
  <table width="100%" style="max-width:520px;margin:0 auto;" cellpadding="0" cellspacing="0">
    <tr><td style="text-align:center;padding-bottom:32px;">
      <div style="font-size:48px;margin-bottom:16px;">🏆</div>
      <h1 style="font-size:24px;font-weight:700;color:#EEEEF0;margin:0 0 8px;">"${goal}" is done.</h1>
      <p style="font-size:15px;color:#8E8E99;margin:0 0 32px;">You finished what you started. That puts you in rare company.</p>
      <a href="${appUrl}" style="display:inline-block;background:#6C63FF;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 32px;border-radius:10px;">
        Start your next project →
      </a>
    </td></tr>
  </table>
</body>
</html>`;
}
