// Carries out approved plans in the founder's Google account.
const crypto = require('crypto');
const lib = require('./_lib');
const invoices = require('./_invoice');
const billing = require('./_billing');

const EMAIL_RE = /[^\s,;<>"']+@[^\s,;<>"']+\.[^\s,;<>"']+/g;

function str(v, max) {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, max);
}
function isDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
function isTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s || ''); }
function pad(n) { return String(n).padStart(2, '0'); }
function addMinutes(date, time, mins) {
  const p = date.split('-').map(Number);
  const q = time.split(':').map(Number);
  const t = new Date(Date.UTC(p[0], p[1] - 1, p[2], q[0], q[1] + mins));
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()) + 'T' + pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()) + ':00';
}
function emailsIn(s) { return (String(s || '').match(EMAIL_RE) || []).slice(0, 5); }
function problem(r, what) {
  if (r.status === 401 || r.status === 403) {
    const m = JSON.stringify(r.data || {});
    if (/accessNotConfigured|has not been used|is disabled/i.test(m)) return 'The ' + what + ' API is not switched on in Google Cloud.';
    return 'Google did not allow this. Disconnect and reconnect Google, and tick every permission box.';
  }
  return 'Google could not do this (' + what + ', code ' + r.status + '). Please try again.';
}
const bad = (message) => ({ status: 'failed', message });

async function calendarEvent(token, title, f, tz) {
  if (!isDate(f.date) || !isTime(f.start_time)) return bad('I need a date and a start time for this event.');
  const dur = Math.min(720, Math.max(5, parseInt(f.duration_minutes, 10) || 30));
  const guests = emailsIn(f.attendees);
  const names = str(f.attendees, 300).replace(EMAIL_RE, '').replace(/[,;<>]/g, ' ').replace(/\s+/g, ' ').trim();
  const body = {
    summary: title,
    description: [str(f.notes, 2000), names ? 'With: ' + names : ''].filter(Boolean).join('\n'),
    start: { dateTime: f.date + 'T' + f.start_time + ':00', timeZone: tz },
    end: { dateTime: addMinutes(f.date, f.start_time, dur), timeZone: tz }
  };
  if (guests.length) body.attendees = guests.map((email) => ({ email }));
  if (/call|meet|meeting|sync|catch.?up|interview|demo/i.test(title)) {
    body.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  }
  const r = await lib.gfetch(token, 'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all', { method: 'POST', body });
  if (!r.ok) return bad(problem(r, 'Calendar'));
  return { status: 'done', message: 'Calendar event created' + (r.data.hangoutLink ? ' with a Meet link.' : '.'), link: r.data.htmlLink };
}

async function reminder(token, title, f, tz) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)/.exec(str(f.remind_at, 40));
  if (!m || !isDate(m[1])) return bad('I need a date and time for this reminder.');
  const time = m[2] + ':' + m[3];
  const r = await lib.gfetch(token, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    body: {
      summary: 'Reminder: ' + title,
      start: { dateTime: m[1] + 'T' + time + ':00', timeZone: tz },
      end: { dateTime: addMinutes(m[1], time, 15), timeZone: tz },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] }
    }
  });
  if (!r.ok) return bad(problem(r, 'Calendar'));
  return { status: 'done', message: 'Reminder set for ' + m[1] + ' at ' + time + '.', link: r.data.htmlLink };
}

async function sendEmail(token, title, f) {
  const to = emailsIn(f.to);
  if (!to.length) return bad('I need a full email address for "' + (str(f.to, 60) || 'the recipient') + '". Tell me the address and I will redo the plan.');
  const subject = (str(f.subject, 200) || title).replace(/[\r\n]+/g, ' ');
  const text = str(f.body, 8000);
  if (!text) return bad('The email has no message.');
  const mime = /^[\x20-\x7e]*$/.test(subject) ? subject : '=?UTF-8?B?' + Buffer.from(subject, 'utf8').toString('base64') + '?=';
  const raw = [
    'To: ' + to.join(', '),
    'Subject: ' + mime,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')
  ].join('\r\n');
  const enc = Buffer.from(raw, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const r = await lib.gfetch(token, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', body: { raw: enc } });
  if (!r.ok) return bad(problem(r, 'Gmail'));
  return { status: 'done', message: 'Email sent to ' + to.join(', ') + '.' };
}

async function task(token, title, f) {
  const body = { title };
  if (str(f.notes, 2000)) body.notes = str(f.notes, 2000);
  if (isDate(f.due_date)) body.due = f.due_date + 'T00:00:00.000Z';
  const r = await lib.gfetch(token, 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', { method: 'POST', body });
  if (!r.ok) return bad(problem(r, 'Tasks'));
  return { status: 'done', message: 'Task added to Google Tasks' + (body.due ? ' (due ' + f.due_date + ').' : '.') };
}

async function doc(token, title, f) {
  const c = await lib.gfetch(token, 'https://docs.googleapis.com/v1/documents', { method: 'POST', body: { title } });
  if (!c.ok) return bad(problem(c, 'Docs'));
  const content = str(f.content, 20000);
  if (content) {
    const u = await lib.gfetch(token, 'https://docs.googleapis.com/v1/documents/' + c.data.documentId + ':batchUpdate', {
      method: 'POST', body: { requests: [{ insertText: { location: { index: 1 }, text: content } }] }
    });
    if (!u.ok) return bad(problem(u, 'Docs'));
  }
  return { status: 'done', message: 'Google Doc created.', link: 'https://docs.google.com/document/d/' + c.data.documentId + '/edit' };
}

async function sheetRow(token, title, f) {
  const name = str(f.sheet_name, 100) || 'Loopin Tracker';
  const cells = str(f.row_details, 2000).split('|').map((s) => s.trim()).filter((s, i, a) => s || a.length > 1).slice(0, 20);
  if (!cells.length) return bad('There was nothing to put in the row.');
  const esc = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = "name = '" + esc + "' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false";
  const found = await lib.gfetch(token, 'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)&q=' + encodeURIComponent(q));
  if (!found.ok) return bad(problem(found, 'Drive'));
  let id = found.data.files && found.data.files[0] && found.data.files[0].id;
  let created = false;
  if (!id) {
    const c = await lib.gfetch(token, 'https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', body: { properties: { title: name } } });
    if (!c.ok) return bad(problem(c, 'Sheets'));
    id = c.data.spreadsheetId;
    created = true;
  }
  // RAW keeps text as text, so nothing typed in a chat can run as a spreadsheet formula
  const a = await lib.gfetch(token, 'https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', {
    method: 'POST', body: { values: [cells] }
  });
  if (!a.ok) return bad(problem(a, 'Sheets'));
  return { status: 'done', message: 'Row added to "' + name + '"' + (created ? ' (new sheet created).' : '.'), link: 'https://docs.google.com/spreadsheets/d/' + id + '/edit' };
}

async function runAction(row, token, tz, userId) {
  const f = {};
  const d = row.details && typeof row.details === 'object' ? row.details : {};
  Object.keys(d).forEach((k) => { f[k] = typeof d[k] === 'string' ? d[k] : str(d[k], 2000); });
  try {
    switch (row.type) {
      case 'calendar_event': return await calendarEvent(token, row.title, f, tz);
      case 'reminder': return await reminder(token, row.title, f, tz);
      case 'email': return await sendEmail(token, row.title, f);
      case 'task': return await task(token, row.title, f);
      case 'doc': return await doc(token, row.title, f);
      case 'sheet_row': return await sheetRow(token, row.title, f);
      case 'invoice': return await invoices.createAndSend(row, token, userId);
      default: return { status: 'skipped', message: 'This type of plan is saved but not carried out yet.' };
    }
  } catch (e) {
    return bad('Something went wrong on our side. Please try again.');
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const user = await lib.authUser(req);
  if (!user) return res.status(401).json({ error: 'not_logged_in' });
  let entitlement;
  try { entitlement = await billing.requireAccess(user.id); }
  catch (e) { return res.status(502).json({ error: 'billing_check_failed' }); }
  if (!entitlement.ok) return billing.deny(res, entitlement);

  const body = lib.readBody(req);
  const ids = (Array.isArray(body.activity_ids) ? body.activity_ids : []).filter((x) => lib.UUID.test(String(x))).slice(0, 6);
  if (!ids.length) return res.status(400).json({ error: 'bad_request' });
  if (entitlement.access.plan !== 'pro') {
    try {
      const requested = await lib.db('activity?id=in.(' + ids.join(',') + ')&user_id=eq.' + user.id + '&status=eq.approved&result=is.null&select=type');
      if ((requested || []).some((row) => row.type === 'invoice')) {
        return res.status(403).json({ error: 'pro_required' });
      }
    } catch (e) { return res.status(502).json({ error: 'db_error' }); }
  }
  let tz = str(body.timezone, 60) || 'UTC';
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); } catch (e) { tz = 'UTC'; }

  const g = await lib.googleAccessToken(user.id);
  if (g.error) return res.status(409).json({ error: g.error });

  let rows;
  try {
    // Claim the rows first, so a double-tap can never send an email twice
    rows = await lib.db('activity?id=in.(' + ids.join(',') + ')&user_id=eq.' + user.id + '&status=eq.approved&result=is.null', {
      method: 'PATCH', body: { result: 'running' }, prefer: 'return=representation'
    });
  } catch (e) {
    return res.status(502).json({ error: 'db_error' });
  }

  const results = [];
  for (const row of rows || []) {
    const out = await runAction(row, g.token, tz, user.id);
    try {
      await lib.db('activity?id=eq.' + row.id, {
        method: 'PATCH',
        body: { status: out.status === 'skipped' ? 'approved' : out.status, result: out.message + (out.link ? '\n' + out.link : '') }
      });
    } catch (e) { /* the result is still returned below */ }
    results.push({ id: row.id, type: row.type, title: row.title, status: out.status, message: out.message, link: out.link || null });
  }
  return res.status(200).json({ results });
};
