// Returns the signed-in user's plan state without exposing payment tokens or provider records.
const lib = require('./_lib');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const user = await lib.authUser(req);
  if (!user) return res.status(401).json({ error: 'not_logged_in' });
  try {
    const profiles = await lib.db('profiles?id=eq.' + user.id + '&select=plan,trial_ends_at');
    if (!profiles || !profiles.length) return res.status(404).json({ error: 'profile_not_found' });
    const subscriptions = await lib.db('squad_subscriptions?user_id=eq.' + user.id + '&select=plan,status,next_billing_at');
    const profile = profiles[0];
    const subscription = subscriptions && subscriptions[0] ? subscriptions[0] : null;
    const trialActive = Boolean(profile.trial_ends_at && Date.parse(profile.trial_ends_at) > Date.now());
    const subscriptionEnd = subscription && subscription.next_billing_at ? Date.parse(subscription.next_billing_at) : 0;
    const paidActive = Boolean(subscription && (subscription.status === 'active' || (subscription.status === 'canceled' && subscriptionEnd > Date.now())));
    return res.status(200).json({
      plan: paidActive ? subscription.plan : profile.plan,
      status: subscription && subscription.status === 'canceled' ? 'canceled' : paidActive ? 'active' : trialActive ? 'trialing' : 'expired',
      active: paidActive || trialActive,
      trial_ends_at: profile.trial_ends_at,
      next_billing_at: paidActive ? subscription.next_billing_at : null
    });
  } catch (e) {
    return res.status(502).json({ error: 'db_error' });
  }
};
