// Voice Sync: turns a recorded voice note into text, using Groq's free Whisper speech model.
const lib = require('./_lib');
const billing = require('./_billing');

const MODEL = 'whisper-large-v3-turbo';
const MIMES = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a' };

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(500).json({ error: 'not_configured' });

  const user = await lib.authUser(req);
  if (!user) return res.status(401).json({ error: 'not_logged_in' });
  let entitlement;
  try { entitlement = await billing.requireAccess(user.id); }
  catch (e) { return res.status(502).json({ error: 'billing_check_failed' }); }
  if (!entitlement.ok) return billing.deny(res, entitlement);

  const body = lib.readBody(req);
  const mime = String(body.mime || '').split(';')[0].trim().toLowerCase();
  const ext = MIMES[mime];
  const b64 = typeof body.audio === 'string' ? body.audio : '';
  if (!ext || !/^[A-Za-z0-9+/=]+$/.test(b64)) return res.status(400).json({ error: 'bad_audio' });
  if (b64.length > 4000000) return res.status(413).json({ error: 'too_long' });

  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 1000) return res.status(400).json({ error: 'too_short' });

  try {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: mime }), 'voice.' + ext);
    fd.append('model', MODEL);
    fd.append('response_format', 'json');
    fd.append('temperature', '0');
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key },
      body: fd
    });
    if (r.status === 429) return res.status(429).json({ error: 'busy' });
    if (!r.ok) return res.status(502).json({ error: 'transcribe_failed' });
    const data = await r.json().catch(() => ({}));
    const text = typeof data.text === 'string' ? data.text.trim().slice(0, 1000) : '';
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: 'transcribe_failed' });
  }
};
