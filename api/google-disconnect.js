// "Disconnect Google": tells Google to cancel the connection, then deletes it from our database.
const lib = require('./_lib');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const user = await lib.authUser(req);
  if (!user) return res.status(401).json({ error: 'not_logged_in' });
  try {
    const rows = await lib.db('google_connections?user_id=eq.' + user.id + '&select=refresh_token');
    if (rows && rows.length) {
      try {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: rows[0].refresh_token }).toString()
        });
      } catch (e) { /* even if Google is slow, we still delete our copy */ }
    }
    await lib.db('google_connections?user_id=eq.' + user.id, { method: 'DELETE' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: 'disconnect_failed' });
  }
};
