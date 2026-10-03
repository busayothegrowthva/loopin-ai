// Starts an immediate monthly subscription through Squad's hosted sandbox checkout.
const lib = require('./_lib');
const squad = require('./_squad');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const user = await lib.authUser(req);
  if (!user) return res.status(401).json({ error: 'not_logged_in' });
  const body = lib.readBody(req);
  const plan = body.plan;
  if (plan !== 'starter' && plan !== 'pro') return res.status(400).json({ error: 'bad_plan' });
  if (!user.email) return res.status(400).json({ error: 'email_required' });

  let payment;
  try {
    squad.key();
    const profile = await lib.db('profiles?id=eq.' + user.id + '&select=id,full_name');
    if (!profile || !profile.length) return res.status(404).json({ error: 'profile_not_found' });
    const subscriptions = await lib.db('squad_subscriptions?user_id=eq.' + user.id + '&status=in.(active,canceled)&next_billing_at=gt.' + encodeURIComponent(new Date().toISOString()) + '&select=user_id');
    if (subscriptions && subscriptions.length) return res.status(409).json({ error: 'already_subscribed' });
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await lib.db('squad_payments?user_id=eq.' + user.id + '&status=eq.pending&created_at=lt.' + encodeURIComponent(cutoff), {
      method: 'PATCH', body: { status: 'failed' }
    });
    const pending = await lib.db('squad_payments?user_id=eq.' + user.id + '&status=eq.pending&select=plan,transaction_ref,checkout_url');
    if (pending && pending.length) {
      const existing = pending[0];
      const currentVersion = existing.transaction_ref.startsWith('LOOPIN2');
      if (existing.plan === plan && currentVersion && existing.checkout_url && new URL(existing.checkout_url).hostname === 'sandbox-pay.squadco.com') {
        return res.status(200).json({ checkout_url: existing.checkout_url, transaction_ref: existing.transaction_ref });
      }
      if (existing.plan !== plan || !currentVersion) {
        await lib.db('squad_payments?transaction_ref=eq.' + encodeURIComponent(existing.transaction_ref) + '&status=eq.pending', {
          method: 'PATCH', body: { status: 'failed' }
        });
      } else {
        return res.status(409).json({ error: 'checkout_in_progress' });
      }
    }
    const transactionRef = squad.newReference();
    const rows = await lib.db('squad_payments', {
      method: 'POST', prefer: 'return=representation',
      body: {
        user_id: user.id,
        email: user.email.toLowerCase(),
        transaction_ref: transactionRef,
        plan,
        amount: squad.AMOUNTS[plan],
        currency: squad.CURRENCY,
        status: 'pending'
      }
    });
    payment = rows && rows[0];
    if (!payment) return res.status(502).json({ error: 'payment_record_failed' });

    const appUrl = (process.env.APP_URL || 'https://loopin-ai.vercel.app').replace(/\/$/, '');
    const callback = appUrl + '/billing-return?ref=' + encodeURIComponent(transactionRef);
    const response = await squad.request('/transaction/initiate', {
      method: 'POST',
      body: {
        email: user.email,
        customer_name: profile[0].full_name || '',
        amount: squad.AMOUNTS[plan],
        currency: squad.CURRENCY,
        initiate_type: 'inline',
        transaction_ref: transactionRef,
        callback_url: callback,
        payment_channels: ['card', 'transfer', 'ussd', 'bank'],
        is_recurring: true,
        metadata: { source: 'loopin_subscription', user_id: user.id, plan }
      }
    });
    const checkoutUrl = response && response.data && response.data.checkout_url;
    if (response.status !== 200 || typeof checkoutUrl !== 'string' || new URL(checkoutUrl).hostname !== 'sandbox-pay.squadco.com') {
      throw new Error('squad_checkout_unavailable');
    }
    await lib.db('squad_payments?transaction_ref=eq.' + encodeURIComponent(transactionRef), {
      method: 'PATCH', body: { checkout_url: checkoutUrl }
    });
    return res.status(200).json({ checkout_url: checkoutUrl, transaction_ref: transactionRef });
  } catch (e) {
    if (payment && payment.transaction_ref) {
      try {
        await lib.db('squad_payments?transaction_ref=eq.' + encodeURIComponent(payment.transaction_ref), {
          method: 'PATCH', body: { status: 'failed' }
        });
      } catch (ignored) {}
    }
    if (e.message === 'squad_not_configured') return res.status(500).json({ error: 'squad_not_configured' });
    if (e.message === 'db_409') return res.status(409).json({ error: 'checkout_already_started' });
    if (e.message === 'not_configured') return res.status(500).json({ error: 'not_configured' });
    return res.status(502).json({ error: 'checkout_unavailable' });
  }
};
