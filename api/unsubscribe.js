// api/unsubscribe.js
// Handles unsubscribe link from emails

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://znppdwkvnphbaduytccs.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  const email = req.query.email;

  if (!email) {
    return res.status(400).send('Missing email parameter.');
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  await sb.from('taskbit_reminders').update({ active: false }).eq('email', email.toLowerCase());

  // Redirect to app with a message
  res.setHeader('Location', 'https://taskbitapp.vercel.app?unsubscribed=1');
  return res.status(302).end();
}
