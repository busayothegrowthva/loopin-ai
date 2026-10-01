// Shared helpers for Loopin's server functions. (The underscore keeps this file private.)

const SUPABASE_URL = 'https://fdtsivknoiholycsgkjt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_nZ6Cw044uFyrDc0kQ6Tz4A_bQELiKy9'; // public key, safe here
const GOOGLE_CLIENT_ID = '779572024169-mpi6ae10cr1gaksn0q5f5epfi3ckop42.apps.googleusercontent.com';
const REDIRECT_URIS = ['https://loopin-ai.vercel.app/google-callback'];
const SCOPE = 'https://www.googleapis.com/auth/';
const REQUIRED_SCOPES = ['gmail.send', 'gmail.readonly', 'calendar.events', 'tasks', 'documents', 'spreadsheets', 'drive.file']
  .map((s) => SCOPE + s);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Who is asking? Returns { id, email } or null.
async function authUser(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { Authorization: 'Bearer ' + token, apikey: SUPABASE_KEY }
    });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u || !UUID.test(u.id || '')) return null;
    return { id: u.id, email: u.email || '' };
  } catch (e) {
    return null;
  }
}

// Talk to our database with the private server key (never reaches the browser).
async function db(path, opts) {
  opts = opts || {};
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('not_configured');
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.indexOf('sb_secret_') !== 0) headers.Authorization = 'Bearer ' + key; // older key style
  if (opts.prefer) headers.Prefer = opts.prefer;
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!r.ok) {
    const e = new Error('db_' + r.status);
    e.status = r.status;
    throw e;
  }
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// Swap the saved refresh token for a short-lived Google access token.
async function googleAccessToken(userId) {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) return { error: 'not_configured' };
  let rows;
  try {
    rows = await db('google_connections?user_id=eq.' + userId + '&select=refresh_token,scopes');
  } catch (e) {
    return { error: e.message === 'not_configured' ? 'not_configured' : 'db_error' };
  }
  if (!rows || !rows.length) return { error: 'not_connected' };
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: secret,
        refresh_token: rows[0].refresh_token,
        grant_type: 'refresh_token'
      }).toString()
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) return { error: d.error === 'invalid_grant' ? 'expired' : 'google_error' };
    return { token: d.access_token, scopes: rows[0].scopes || '' };
  } catch (e) {
    return { error: 'google_error' };
  }
}

// Call a Google API.
async function gfetch(token, url, opts) {
  opts = opts || {};
  const r = await fetch(url, {
    method: opts.method || 'GET',
    headers: Object.assign({ Authorization: 'Bearer ' + token }, opts.body ? { 'Content-Type': 'application/json' } : {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  return b || {};
}

module.exports = {
  SUPABASE_URL, SUPABASE_KEY, GOOGLE_CLIENT_ID, REDIRECT_URIS, REQUIRED_SCOPES, UUID,
  authUser, db, googleAccessToken, gfetch, readBody
};
