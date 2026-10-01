// Revenue Sync helpers: builds and sends invoices and reminders. (The underscore keeps this file private.)
const lib = require('./_lib');

const EMAIL_RE = /[^\s,;<>"']+@[^\s,;<>"']+\.[^\s,;<>"']+/;
const SYMBOLS = { '$': 'USD', '€': 'EUR', '£': 'GBP', '₦': 'NGN' };
const WORDS = { naira: 'NGN', dollars: 'USD', dollar: 'USD', euros: 'EUR', euro: 'EUR', pounds: 'GBP', pound: 'GBP' };
const GREET = {
  professional: (n) => 'Hello ' + n + ',',
  formal: (n) => 'Dear ' + n + ',',
  friendly: (n) => 'Hi ' + n + '!',
  casual: (n) => 'Hey ' + n + ','
};

function str(v, max) { return v === null || v === undefined ? '' : String(v).trim().slice(0, max); }

function parseMoney(rawAmount, rawCurrency) {
  const a = str(rawAmount, 40);
  const num = parseFloat(a.replace(/[^0-9.]/g, ''));
  if (!isFinite(num) || num <= 0 || num >= 1e9) return null;
  let cur = str(rawCurrency, 20);
  let code = '';
  if (/^[A-Za-z]{3}$/.test(cur)) code = cur.toUpperCase();
  else if (SYMBOLS[cur]) code = SYMBOLS[cur];
  else if (WORDS[cur.toLowerCase()]) code = WORDS[cur.toLowerCase()];
  else { for (const s in SYMBOLS) { if (a.indexOf(s) >= 0) { code = SYMBOLS[s]; break; } } }
  if (!code) return { error: 'currency' };
  return { amount: Math.round(num * 100) / 100, currency: code };
}

function money(amount, cur) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: cur }).format(amount); }
  catch (e) { return amount.toFixed(2) + ' ' + cur; }
}

function invoiceNumber() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const r = Math.random().toString(36).slice(2, 5).toUpperCase();
  return 'INV-' + d + '-' + r;
}

async function sendGmail(token, to, subject, text) {
  const clean = subject.replace(/[\r\n]+/g, ' ').slice(0, 200);
  const mime = /^[\x20-\x7e]*$/.test(clean) ? clean : '=?UTF-8?B?' + Buffer.from(clean, 'utf8').toString('base64') + '?=';
  const raw = [
    'To: ' + to,
    'Subject: ' + mime,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')
  ].join('\r\n');
  const enc = Buffer.from(raw, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return lib.gfetch(token, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', body: { raw: enc } });
}

async function profileOf(userId) {
  try {
    const r = await lib.db('profiles?id=eq.' + userId + '&select=full_name,email_tone,payment_link');
    return (r && r[0]) || {};
  } catch (e) { return {}; }
}

function payLine(prof) {
  return prof.payment_link ? 'You can pay here: ' + prof.payment_link : 'Please reply to this email and I will share payment details.';
}
function signOff(prof) { return prof.full_name ? '\n\nThank you,\n' + str(prof.full_name, 80) : '\n\nThank you.'; }

function invoiceText(inv, prof) {
  const greet = (GREET[prof.email_tone] || GREET.professional)(inv.client_name);
  return [
    greet, '',
    'Here is your invoice.', '',
    'Invoice: ' + inv.number,
    'For: ' + (inv.description || 'Services'),
    'Amount: ' + money(inv.amount, inv.currency),
    inv.due_date ? 'Due: ' + inv.due_date : '', '',
    payLine(prof)
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n') + signOff(prof);
}

function reminderText(inv, prof) {
  const greet = (GREET[prof.email_tone] || GREET.professional)(inv.client_name);
  return [
    greet, '',
    'This is a friendly reminder that invoice ' + inv.number + ' for ' + money(Number(inv.amount), inv.currency) +
      ' (' + (inv.description || 'Services') + ') is still open.', '',
    payLine(prof), '',
    'If you have already paid, please ignore this message.'
  ].join('\n') + signOff(prof);
}

function sendProblem(r) {
  if (r.status === 401 || r.status === 403) return 'Google did not allow sending. Disconnect and reconnect Google, and tick every permission box.';
  return 'Gmail could not send this (code ' + r.status + '). Please try again.';
}

// Called when the founder approves an invoice plan.
async function createAndSend(row, token, userId) {
  const f = row.details && typeof row.details === 'object' ? row.details : {};
  const clientName = str(f.client, 100) || 'there';
  const m = (str(f.client_email, 300).match(EMAIL_RE) || [])[0];
  if (!m) return { status: 'failed', message: 'I need ' + (str(f.client, 60) || 'the client') + "'s email address to send the invoice. Tell me the address and I will redo the plan." };
  const money_ = parseMoney(f.amount, f.currency);
  if (!money_) return { status: 'failed', message: 'I need a clear amount for this invoice.' };
  if (money_.error) return { status: 'failed', message: 'I need the currency for this invoice, for example USD or NGN.' };

  const prof = await profileOf(userId);
  const due = /^\d{4}-\d{2}-\d{2}$/.test(str(f.due_date, 20)) ? str(f.due_date, 20) : null;
  const inv = {
    number: invoiceNumber(), client_name: clientName, client_email: m,
    amount: money_.amount, currency: money_.currency,
    description: str(f.description, 300) || 'Services', due_date: due
  };
  const sent = await sendGmail(token, m, 'Invoice ' + inv.number + ' from ' + (str(prof.full_name, 80) || 'Loopin') + ': ' + inv.description, invoiceText(inv, prof));
  if (!sent.ok) return { status: 'failed', message: sendProblem(sent) };

  let logged = true;
  try {
    await lib.db('invoices', { method: 'POST', prefer: 'return=minimal', body: Object.assign({ user_id: userId }, inv) });
  } catch (e) { logged = false; }
  return {
    status: 'done',
    message: 'Invoice ' + inv.number + ' for ' + money(inv.amount, inv.currency) + ' sent to ' + m + '. A reminder can go out after 5 days if it is unpaid.' +
      (logged ? '' : ' (It could not be added to your invoice list.)')
  };
}

// Sends the one polite reminder for an open invoice.
async function sendReminder(inv, token, prof) {
  const r = await sendGmail(token, inv.client_email, 'Reminder: invoice ' + inv.number, reminderText(inv, prof));
  if (!r.ok) return { ok: false, message: sendProblem(r) };
  await lib.db('invoices?id=eq.' + inv.id, { method: 'PATCH', body: { status: 'reminded', reminded_at: new Date().toISOString() } });
  return { ok: true, message: 'Reminder sent to ' + inv.client_email + '.' };
}

module.exports = { createAndSend, sendReminder, profileOf, parseMoney, reminderText, invoiceText };
