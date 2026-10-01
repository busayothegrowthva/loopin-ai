// Squad webhook receiver. Each notification is verified against Squad before billing state changes.
const lib = require('./_lib');
const squad = require('./_squad');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    squad.key();
    const body = lib.readBody(req);
    if (String(body.Event || '').toLowerCase() !== 'charge_successful') return res.status(200).json({ received: true });
    const reference = String(body.TransactionRef || (body.Body && body.Body.transaction_ref) || '').trim();
    if (!/^LOOPIN2\d{13}[A-F0-9]{12}$/.test(reference)) return res.status(200).json({ received: true });

    const rows = await lib.db('squad_payments?transaction_ref=eq.' + encodeURIComponent(reference) + '&select=user_id,email,transaction_ref,plan,amount,currency,status');
    const payment = rows && rows[0];
    if (!payment) return res.status(200).json({ received: true });
    const verified = await squad.verifiedTransaction(reference);
    const details = squad.verifiedDetails(verified);
    if (!details) return res.status(200).json({ received: true });
    const result = await squad.activatePayment(payment, details, body);
    if (!result.ok) return res.status(200).json({ received: true });
    return res.status(200).json({ received: true });
  } catch (e) {
    if (e.message === 'squad_not_configured') return res.status(500).json({ error: 'not_configured' });
    return res.status(500).json({ error: 'webhook_processing_failed' });
  }
};
