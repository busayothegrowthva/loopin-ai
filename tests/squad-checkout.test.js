const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const originalFetch = global.fetch;
const originalSecret = process.env.SUPABASE_SECRET_KEY;
const originalSquadKey = process.env.SQUAD_SECRET_KEY;

test('Pro checkout uses Squad sandbox, correct cents, and stores a pending attempt', async () => {
  process.env.SUPABASE_SECRET_KEY = 'test-supabase-secret';
  process.env.SQUAD_SECRET_KEY = 'sandbox_sk_test';
  const calls = [];
  global.fetch = async (url, options) => {
    const target = String(url);
    calls.push({ target, options });
    if (target.endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', email: 'founder@example.com' }), { status: 200 });
    }
    if (target.includes('/rest/v1/profiles?')) {
      return new Response(JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111', full_name: 'Loopin Founder' }]), { status: 200 });
    }
    if (target.includes('/rest/v1/squad_subscriptions?')) return new Response('[]', { status: 200 });
    if (target.includes('/rest/v1/squad_payments?') && options.method === 'PATCH') return new Response('[]', { status: 200 });
    if (target.includes('/rest/v1/squad_payments?') && options.method === 'GET') return new Response('[]', { status: 200 });
    if (target.endsWith('/rest/v1/squad_payments')) {
      const payment = JSON.parse(options.body);
      return new Response(JSON.stringify([{ ...payment, id: '22222222-2222-4222-8222-222222222222' }]), { status: 201 });
    }
    if (target === 'https://sandbox-api-d.squadco.com/transaction/initiate') {
      assert.equal(options.headers.Authorization, 'Bearer sandbox_sk_test');
      const body = JSON.parse(options.body);
      assert.equal(body.amount, 3900);
      assert.equal(body.currency, 'USD');
      assert.equal(body.is_recurring, true);
      return new Response(JSON.stringify({ status: 200, data: { checkout_url: 'https://sandbox-pay.squadco.com/LOOPINTEST' } }), { status: 200 });
    }
    throw new Error('Unexpected request: ' + target);
  };

  try {
    delete require.cache[require.resolve('../api/squad')];
    const handler = require('../api/squad');
    const result = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'POST', query: { action: 'checkout' }, headers: { authorization: 'Bearer test-user-token' }, body: { plan: 'pro' } }, result);
    assert.equal(result.statusCode, 200, JSON.stringify({ body: result.body, requests: calls.map((call) => call.target) }));
    assert.equal(result.body.checkout_url, 'https://sandbox-pay.squadco.com/LOOPINTEST');
    const storedAttempt = calls.find((call) => call.target.endsWith('/rest/v1/squad_payments'));
    assert.equal(JSON.parse(storedAttempt.options.body).email, 'founder@example.com');
    const savedCheckout = calls.find((call) => call.target.includes('/rest/v1/squad_payments?transaction_ref=') && call.options.method === 'PATCH');
    assert.equal(JSON.parse(savedCheckout.options.body).checkout_url, result.body.checkout_url);
  } finally {
    global.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSecret;
    if (originalSquadKey === undefined) delete process.env.SQUAD_SECRET_KEY;
    else process.env.SQUAD_SECRET_KEY = originalSquadKey;
  }
});

test('confirmed payment activates the plan only after Squad verifies the transaction', async () => {
  process.env.SUPABASE_SECRET_KEY = 'test-supabase-secret';
  process.env.SQUAD_SECRET_KEY = 'sandbox_sk_test';
  const reference = 'LOOPIN1760000000000ABCDEF123456';
  const calls = [];
  global.fetch = async (url, options) => {
    const target = String(url);
    calls.push({ target, options });
    if (target.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', email: 'founder@example.com' }), { status: 200 });
    if (target.includes('/rest/v1/squad_payments?transaction_ref=')) {
      return new Response(JSON.stringify([{ user_id: '11111111-1111-4111-8111-111111111111', email: 'founder@example.com', transaction_ref: reference, plan: 'pro', amount: 3900, currency: 'USD', status: 'pending' }]), { status: 200 });
    }
    if (target === 'https://sandbox-api-d.squadco.com/transaction/verify/' + reference) {
      return new Response(JSON.stringify({ success: true, data: { transaction_status: 'Success', transaction_ref: reference, transaction_amount: 3900, transaction_currency_id: 'USD', email: 'founder@example.com', created_at: '2026-10-01T10:00:00Z', payment_information: { token_id: 'squad-test-token' } } }), { status: 200 });
    }
    if (target.includes('/rest/v1/squad_subscriptions?on_conflict=')) return new Response(null, { status: 204 });
    if (target.includes('/rest/v1/profiles?id=eq.')) return new Response(null, { status: 204 });
    if (target.includes('/rest/v1/squad_payments?') && options.method === 'PATCH') return new Response(null, { status: 204 });
    throw new Error('Unexpected request: ' + target);
  };

  try {
    delete require.cache[require.resolve('../api/squad')];
    const handler = require('../api/squad');
    const result = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'POST', query: { action: 'confirm' }, headers: { authorization: 'Bearer test-user-token' }, body: { transaction_ref: reference } }, result);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.status, 'paid');
    const subscription = calls.find((call) => call.target.includes('/rest/v1/squad_subscriptions?on_conflict='));
    assert.equal(JSON.parse(subscription.options.body).plan, 'pro');
    assert.equal(JSON.parse(subscription.options.body).squad_token_id, 'squad-test-token');
    const profileUpdate = calls.find((call) => call.target.includes('/rest/v1/profiles?id=eq.'));
    assert.equal(JSON.parse(profileUpdate.options.body).plan, 'pro');
  } finally {
    global.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSecret;
    if (originalSquadKey === undefined) delete process.env.SQUAD_SECRET_KEY;
    else process.env.SQUAD_SECRET_KEY = originalSquadKey;
  }
});

test('Vercel stays within Hobby function limit and preserves registered Squad URLs', () => {
  const apiDir = path.join(__dirname, '..', 'api');
  const publicFunctions = fs.readdirSync(apiDir).filter((file) => file.endsWith('.js') && !file.startsWith('_'));
  assert.ok(publicFunctions.length <= 12, 'Expected at most 12 public functions, found ' + publicFunctions.length);

  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const rewrites = new Map(config.rewrites.map((route) => [route.source, route.destination]));
  for (const action of ['cancel', 'checkout', 'confirm', 'renewals', 'status', 'webhook']) {
    assert.equal(rewrites.get('/api/squad-' + action), '/api/squad?action=' + action);
  }
});
