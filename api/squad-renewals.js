// Daily Vercel job: charges due Squad subscriptions and verifies each result before extending access.
const crypto = require('crypto');
const lib = require('./_lib');
const squad = require('./_squad');

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'not_configured' });
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'unauthorized' });
  try { squad.key(); } catch (e) { return res.status(500).json({ error: 'squad_not_configured' }); }

  const now = new Date().toISOString();
  const staleClaim = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  let due;
  try {
    await lib.db('squad_subscriptions?status=eq.active&renewal_claimed_at=lt.' + encodeURIComponent(staleClaim), {
      method: 'PATCH', body: { renewal_claimed_at: null }
    });
    due = await lib.db('squad_subscriptions?status=eq.active&next_billing_at=lte.' + encodeURIComponent(now) + '&renewal_claimed_at=is.null&select=user_id,email,plan,squad_token_id,squad_auth_code,next_billing_at&limit=25');
  } catch (e) { return res.status(502).json({ error: 'db_error' }); }

  let renewed = 0, failed = 0, skipped = 0;
  for (const row of due || []) {
    const claimTime = new Date().toISOString();
    let claim;
    try {
      claim = await lib.db('squad_subscriptions?user_id=eq.' + row.user_id + '&status=eq.active&next_billing_at=lte.' + encodeURIComponent(now) + '&renewal_claimed_at=is.null', {
        method: 'PATCH', prefer: 'return=representation', body: { renewal_claimed_at: claimTime }
      });
    } catch (e) { skipped++; continue; }
    if (!claim || !claim.length) { skipped++; continue; }

    const token = row.squad_token_id;
    if (!token) {
      await lib.db('squad_subscriptions?user_id=eq.' + row.user_id, {
        method: 'PATCH', body: { status: 'past_due', next_billing_at: null, renewal_claimed_at: null, updated_at: new Date().toISOString() }
      });
      failed++; continue;
    }

    const reference = squad.newReference();
    const paymentRows = await lib.db('squad_payments', {
      method: 'POST', prefer: 'return=representation',
      body: { user_id: row.user_id, email: row.email, transaction_ref: reference, plan: row.plan, amount: squad.AMOUNTS[row.plan], currency: 'USD', status: 'pending' }
    }).catch(() => null);
    const payment = paymentRows && paymentRows[0];
    if (!payment) {
      await lib.db('squad_subscriptions?user_id=eq.' + row.user_id, { method: 'PATCH', body: { renewal_claimed_at: null } }).catch(() => null);
      skipped++; continue;
    }

    try {
      const charged = await squad.request('/transaction/charge_card', {
        method: 'POST', body: { amount: payment.amount, token_id: token, transaction_ref: reference }
      });
      if (charged.success !== true) throw new Error('squad_charge_failed');
      const verified = await squad.verifiedTransaction(reference);
      const details = squad.verifiedDetails(verified);
      if (!details) throw new Error('squad_verify_failed');
      const result = await squad.activatePayment(payment, details, charged);
      if (!result.ok) throw new Error('squad_payment_mismatch');
      renewed++;
    } catch (e) {
      await lib.db('squad_payments?transaction_ref=eq.' + encodeURIComponent(reference), { method: 'PATCH', body: { status: 'failed' } }).catch(() => null);
      await lib.db('squad_subscriptions?user_id=eq.' + row.user_id, {
        method: 'PATCH', body: { status: 'past_due', next_billing_at: null, renewal_claimed_at: null, updated_at: new Date().toISOString() }
      }).catch(() => null);
      failed++;
    }
  }
  return res.status(200).json({ checked: (due || []).length, renewed, failed, skipped });
};
