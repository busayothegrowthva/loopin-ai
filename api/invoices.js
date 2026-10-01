// "Send reminder" button: sends the polite reminder for one open invoice right now.
const lib = require('./_lib');
const inv = require('./_invoice');
const billing = require('./_billing');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const user = await lib.authUser(req);
  if (!user) return res.status(401).json({ error: 'not_logged_in' });
  let entitlement;
  try { entitlement = await billing.requireAccess(user.id, 'pro'); }
  catch (e) { return res.status(502).json({ error: 'billing_check_failed' }); }
  if (!entitlement.ok) return billing.deny(res, entitlement);
  const body = lib.readBody(req);
  const id = String(body.invoice_id || '');
  if (!lib.UUID.test(id) || body.action !== 'remind') return res.status(400).json({ error: 'bad_request' });
  try {
    const rows = await lib.db('invoices?id=eq.' + id + '&user_id=eq.' + user.id + '&select=*');
    const row = rows && rows[0];
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (row.status === 'paid') return res.status(409).json({ error: 'already_paid' });
    const g = await lib.googleAccessToken(user.id);
    if (g.error) return res.status(409).json({ error: g.error });
    const prof = await inv.profileOf(user.id);
    const out = await inv.sendReminder(row, g.token, prof);
    return res.status(out.ok ? 200 : 502).json(out.ok ? { message: out.message } : { error: 'send_failed', message: out.message });
  } catch (e) {
    return res.status(502).json({ error: 'failed' });
  }
};
