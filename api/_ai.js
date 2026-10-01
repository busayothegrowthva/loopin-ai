// Shared AI helpers for newer functions. (The underscore keeps this file private.)
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

function clean(v, max) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  return String(v).trim().slice(0, max);
}

function nowText(tz) {
  try {
    const d = new Date();
    const long = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    const iso = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    return { long, iso, tz };
  } catch (e) {
    if (tz === 'UTC') throw e;
    return nowText('UTC');
  }
}

function parseModel(text) {
  if (!text) return null;
  const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
}

async function askGroq(key, messages, maxTokens) {
  const body = { model: MODEL, messages, temperature: 0.1, max_completion_tokens: maxTokens || 2500 };
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

async function askParsed(key, messages) {
  for (let i = 0; i < 2; i++) {
    const p = parseModel(await askGroq(key, i === 0 ? messages : messages.concat([{ role: 'user', content: 'Reply again with the JSON object only.' }])));
    if (p) return p;
  }
  return null;
}

module.exports = { clean, nowText, parseModel, askGroq, askParsed };
