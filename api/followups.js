// Runs once a day by itself (Vercel cron). Sends ONE polite reminder for invoices still unpaid after 5 days.
const crypto = require('crypto');
const lib = require('./_lib');
const inv = require('./_invoice');

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'not_configured' });
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'unauthorized' });

  const cutoff = new Date(Date.now() - 5 * 86400000).toISOString();
  let rows = [];
  try {
    rows = await lib.db('invoices?status=eq.sent&sent_at=lt.' + encodeURIComponent(cutoff) + '&select=*&limit=50') || [];
  } catch (e) {
    return res.status(502).json({ error: 'db_error' });
  }
  let sent = 0, skipped = 0;
  const tokens = {};
  for (const row of rows) {
    try {
      if (!(row.user_id in tokens)) {
        const g = await lib.googleAccessToken(row.user_id);
        tokens[row.user_id] = g.token || null;
      }
      if (!tokens[row.user_id]) { skipped++; continue; }
      const prof = await inv.profileOf(row.user_id);
      const out = await inv.sendReminder(row, tokens[row.user_id], prof);
      if (out.ok) sent++; else skipped++;
    } catch (e) { skipped++; }
  }
  return res.status(200).json({ checked: rows.length, sent, skipped });
};
