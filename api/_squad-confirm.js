// Confirms a Squad payment after redirect. A browser return never grants access without server verification.
const lib = require('./_lib');
const squad = require('./_squad');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const user = await lib.authUser(req);
  if (!user) return res.status(401).json({ error: 'not_logged_in' });
  const body = lib.readBody(req);
  const reference = typeof body.transaction_ref === 'string' ? body.transaction_ref.trim() : '';
  if (!/^LOOPIN2\d{13}[A-F0-9]{12}$/.test(reference)) return res.status(400).json({ error: 'bad_reference' });

  try {
    const rows = await lib.db('squad_payments?transaction_ref=eq.' + encodeURIComponent(reference) + '&user_id=eq.' + user.id + '&select=user_id,email,transaction_ref,plan,amount,currency,status');
    const payment = rows && rows[0];
    if (!payment) return res.status(404).json({ error: 'payment_not_found' });

    const verified = await squad.verifiedTransaction(reference);
    const details = squad.verifiedDetails(verified);
    if (!details) return res.status(409).json({ error: 'payment_not_complete' });
    const result = await squad.activatePayment(payment, details);
    if (!result.ok) return res.status(409).json({ error: result.reason || 'payment_not_verified' });
    return res.status(200).json({ status: 'paid', plan: payment.plan });
  } catch (e) {
    if (e.message === 'squad_not_configured') return res.status(500).json({ error: 'squad_not_configured' });
    return res.status(502).json({ error: 'verification_unavailable' });
  }
};
