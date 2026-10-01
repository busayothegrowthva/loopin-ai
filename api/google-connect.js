// Finishes "Connect Google": swaps Google's one-time code for a lasting connection and saves it safely.
const lib = require('./_lib');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret || !process.env.SUPABASE_SECRET_KEY) return res.status(500).json({ error: 'not_configured' });

  const user = await lib.authUser(req);
  if (!user) return res.status(401).json({ error: 'not_logged_in' });

  const body = lib.readBody(req);
  const code = typeof body.code === 'string' ? body.code.slice(0, 2000) : '';
  if (!code) return res.status(400).json({ error: 'bad_request' });

  try {
    const t = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: lib.GOOGLE_CLIENT_ID,
        client_secret: secret,
        redirect_uri: lib.REDIRECT_URIS[0],
        grant_type: 'authorization_code'
      }).toString()
    });
    const tok = await t.json().catch(() => ({}));
    if (!t.ok || !tok.access_token) return res.status(400).json({ error: 'google_rejected' });
    if (!tok.refresh_token) return res.status(400).json({ error: 'no_refresh_token' });

    let email = '';
    try {
      const u = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: 'Bearer ' + tok.access_token }
      });
      const info = await u.json().catch(() => ({}));
      email = typeof info.email === 'string' ? info.email.slice(0, 200) : '';
    } catch (e) { /* email is a nice-to-have */ }

    const granted = String(tok.scope || '');
    const missing = lib.REQUIRED_SCOPES.filter((s) => granted.split(' ').indexOf(s) < 0);

    await lib.db('google_connections?on_conflict=user_id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: { user_id: user.id, google_email: email, refresh_token: tok.refresh_token, scopes: granted, connected_at: new Date().toISOString() }
    });

    return res.status(200).json({ email, missing });
  } catch (e) {
    return res.status(502).json({ error: 'connect_failed' });
  }
};
