// Accuracy Watch: compares a pasted customer-facing answer against the founder's saved business facts.
// It refuses to check if the founder has not switched this on for that chat.
const lib = require('./_lib');

const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

function clean(v, max) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  return String(v).trim().slice(0, max);
}

function parseModel(text) {
  if (!text) return null;
  const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
}

async function askGroq(key, messages) {
  const body = { model: MODEL, messages, temperature: 0.1, max_completion_tokens: 1500 };
  if (MODEL.indexOf('openai/gpt-oss') === 0) { body.reasoning_effort = 'low'; body.include_reasoning = false; }
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const e = new Error('groq_' + r.status); e.status = r.status; throw e; }
  const data = await r.json();
  return data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
}

function sanitize(out) {
  const summary = clean(out && out.summary, 220) || 'This matches your Business facts.';
  const issues = [];
  const rawList = Array.isArray(out && out.issues) ? out.issues : [];
  for (const item of rawList.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue;
    const claim = clean(item.claim, 180) || 'Customer-facing claim';
    const mismatch = clean(item.mismatch, 220) || 'This answer does not match your Business facts.';
    const correction = clean(item.correction, 220);
    issues.push({ claim, mismatch, correction });
  }
  return { summary, issues };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const key = process.env.GROQ_API_KEY;
  if (!key || !process.env.SUPABASE_SECRET_KEY) return res.status(500).json({ error: 'not_configured' });

  const user = await lib.authUser(req);
  if (!user) return res.status(401).json({ error: 'not_logged_in' });

  const body = lib.readBody(req);
  const chatId = String(body.chat_id || '');
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 6000) : '';
  if (!lib.UUID.test(chatId) || text.length < 5) return res.status(400).json({ error: 'bad_request' });

  let chat;
  try {
    const rows = await lib.db('client_chats?id=eq.' + chatId + '&user_id=eq.' + user.id + '&select=id,name,accuracy_watch');
    chat = rows && rows[0];
  } catch (e) {
    return res.status(502).json({ error: 'db_error' });
  }
  if (!chat) return res.status(404).json({ error: 'chat_not_found' });
  if (chat.accuracy_watch !== true) return res.status(403).json({ error: 'not_allowed' });

  let profile;
  try {
    const rows = await lib.db('profiles?id=eq.' + user.id + '&select=business_facts');
    profile = rows && rows[0];
  } catch (e) {
    return res.status(502).json({ error: 'db_error' });
  }
  const facts = profile && typeof profile.business_facts === 'string' ? profile.business_facts.trim() : '';
  if (!facts) return res.status(400).json({ error: 'business_facts_missing' });

  const prompt = `You are Loopin's Accuracy Watch. Compare one customer-facing reply against the founder's real business facts. Your job is to catch mismatches, not to rewrite everything.

Business facts:
${facts}

Customer-facing reply to compare:
${text}

Return ONE JSON object and nothing else.
{"summary": "one short sentence", "issues": [{"claim": "what the customer was told", "mismatch": "what is wrong", "correction": "a better wording to send the customer"}] }

Rules:
- Only flag real mismatches against the business facts.
- If it matches, return an empty issues array and say so in the summary.
- Keep the summary short and plain English.
- Use the same facts the founder wrote. Do not invent extra policies.
- Use the correction field only when there is a mismatch.
- If you cannot compare a point because the facts are missing, ignore it and do not invent facts.
- Do not output markdown, code fences, or extra text.`;

  try {
    let parsed = null;
    const messages = [{ role: 'system', content: prompt }];
    for (let i = 0; i < 2 && !parsed; i++) {
      const out = await askGroq(key, messages.concat([{ role: 'user', content: 'Compare the reply against the business facts and return the JSON object only.' }]));
      parsed = parseModel(out);
    }
    if (!parsed) return res.status(502).json({ error: 'bad_model_reply' });
    return res.status(200).json(sanitize(parsed));
  } catch (e) {
    if (e.status === 429) return res.status(429).json({ error: 'busy' });
    return res.status(502).json({ error: 'ai_unavailable' });
  }
};
