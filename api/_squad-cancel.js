// Cancels future Squad card charges for the signed-in user.
const lib = require('./_lib');
const squad = require('./_squad');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const user = await lib.authUser(req);
  if (!user) return res.status(401).json({ error: 'not_logged_in' });
  try {
    const rows = await lib.db('squad_subscriptions?user_id=eq.' + user.id + '&select=status,squad_auth_code,squad_token_id,next_billing_at');
    const subscription = rows && rows[0];
    if (!subscription || subscription.status !== 'active') return res.status(404).json({ error: 'active_subscription_not_found' });
    const authCode = subscription.squad_auth_code || subscription.squad_token_id;
    if (authCode) {
      const response = await squad.request('/transaction/cancel/recurring', {
        method: 'PATCH', body: { auth_code: [authCode] }
      });
      if (response.success !== true) return res.status(502).json({ error: 'cancel_failed' });
    }
    await lib.db('squad_subscriptions?user_id=eq.' + user.id, {
      method: 'PATCH', body: { status: 'canceled', renewal_claimed_at: null, updated_at: new Date().toISOString() }
    });
    return res.status(200).json({ status: 'canceled' });
  } catch (e) {
    if (e.message === 'squad_not_configured') return res.status(500).json({ error: 'squad_not_configured' });
    return res.status(502).json({ error: 'cancel_failed' });
  }
};
