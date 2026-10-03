// Private Squad sandbox helpers. The secret key must only be used by server functions.
const lib = require('./_lib');

const BASE_URL = 'https://sandbox-api-d.squadco.com';
const CURRENCY = 'NGN';
const AMOUNTS = { starter: 3000000, pro: 6000000 };

function key() {
  const value = process.env.SQUAD_SECRET_KEY || '';
  if (!value.startsWith('sandbox_sk_')) throw new Error('squad_not_configured');
  return value;
}

async function request(path, options) {
  options = options || {};
  const response = await fetch(BASE_URL + path, {
    method: options.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + key(),
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  const bodyStatus = Number(data && data.status);
  if (!response.ok || (Number.isFinite(bodyStatus) && bodyStatus >= 400) || data.success === false) {
    const status = response.ok && Number.isFinite(bodyStatus) && bodyStatus >= 400 ? bodyStatus : response.status;
    const message = typeof data.message === 'string' && data.message ? data.message : 'No error message returned';
    console.error('Squad API request failed', { endpoint: path.split('?')[0], status, message });
    const error = new Error('squad_request_failed');
    error.status = status;
    throw error;
  }
  return data;
}

function nextMonth(from) {
  let date = new Date(from || Date.now());
  const now = Date.now();
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2020 || date.getTime() > now + 86400000) date = new Date(now);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

function newReference() {
  return 'LOOPIN2' + Date.now() + require('crypto').randomBytes(6).toString('hex').toUpperCase();
}

async function verifiedTransaction(reference) {
  return request('/transaction/verify/' + encodeURIComponent(reference));
}

function verifiedDetails(response) {
  const details = response && response.data;
  if (!response || response.success !== true || !details) return null;
  return details;
}

async function activatePayment(payment, details, webhookBody) {
  const amount = Number(details.transaction_amount);
  const currency = String(details.transaction_currency_id || details.currency || '').toUpperCase();
  const status = String(details.transaction_status || '').toLowerCase();
  const reference = String(details.transaction_ref || '');
  const email = String(details.email || details.customer_email || '').toLowerCase();
  if (status !== 'success' || reference !== payment.transaction_ref || amount !== payment.amount || currency !== CURRENCY || payment.currency !== CURRENCY || email !== String(payment.email || '').toLowerCase()) {
    return { ok: false, reason: 'payment_mismatch' };
  }

  const detailsToken = details.payment_information || {};
  const eventBody = webhookBody && webhookBody.Body ? webhookBody.Body : {};
  const eventToken = eventBody.payment_information || {};
  const tokenId = detailsToken.token_id || eventToken.token_id || null;
  const authCode = detailsToken.auth_code || eventToken.auth_code || tokenId;
  const alreadyPaid = payment.status === 'paid';

  const subscription = {
    user_id: payment.user_id,
    email: payment.email,
    plan: payment.plan,
    status: 'active',
    next_billing_at: nextMonth(details.created_at || Date.now()),
    last_transaction_ref: payment.transaction_ref,
    updated_at: new Date().toISOString(),
    renewal_claimed_at: null
  };
  if (tokenId) subscription.squad_token_id = tokenId;
  if (authCode) subscription.squad_auth_code = authCode;
  await lib.db('squad_subscriptions?on_conflict=user_id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: subscription
  });
  await lib.db('profiles?id=eq.' + payment.user_id, { method: 'PATCH', body: { plan: payment.plan } });
  if (!alreadyPaid) {
    await lib.db('squad_payments?transaction_ref=eq.' + encodeURIComponent(payment.transaction_ref) + '&status=in.(pending,failed)', {
      method: 'PATCH', body: { status: 'paid', verified_at: new Date().toISOString() }
    });
  }
  return { ok: true, alreadyPaid };
}

module.exports = { CURRENCY, AMOUNTS, key, request, nextMonth, newReference, verifiedTransaction, verifiedDetails, activatePayment };
