// Server-side subscription checks shared by Loopin API handlers.
const lib = require('./_lib');

async function accessFor(userId) {
  const profiles = await lib.db('profiles?id=eq.' + userId + '&select=plan,trial_ends_at');
  if (!profiles || !profiles.length) throw new Error('profile_not_found');
  const subscriptions = await lib.db('squad_subscriptions?user_id=eq.' + userId + '&select=plan,status,next_billing_at');
  const profile = profiles[0];
  const subscription = subscriptions && subscriptions[0] ? subscriptions[0] : null;
  const trialActive = Boolean(profile.trial_ends_at && Date.parse(profile.trial_ends_at) > Date.now());
  const subscriptionEnd = subscription && subscription.next_billing_at ? Date.parse(subscription.next_billing_at) : 0;
  const paidActive = Boolean(subscription && (subscription.status === 'active' || (subscription.status === 'canceled' && subscriptionEnd > Date.now())));
  return {
    active: trialActive || paidActive,
    plan: paidActive ? subscription.plan : profile.plan,
    status: subscription && subscription.status === 'canceled' ? 'canceled' : paidActive ? 'active' : trialActive ? 'trialing' : 'expired',
    trial_ends_at: profile.trial_ends_at,
    next_billing_at: paidActive ? subscription.next_billing_at : null
  };
}

async function requireAccess(userId, minimumPlan) {
  const access = await accessFor(userId);
  if (!access.active) return { ok: false, reason: 'plan_required', access };
  if (minimumPlan === 'pro' && access.plan !== 'pro') return { ok: false, reason: 'pro_required', access };
  return { ok: true, access };
}

function deny(res, result) {
  return res.status(result.reason === 'plan_required' ? 402 : 403).json({ error: result.reason });
}

module.exports = { accessFor, requireAccess, deny };
