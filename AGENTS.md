# Loopin AI: project handoff for AI coding agents

Read this whole file before doing anything. It replaces a long conversation. Do not ask the owner to re-explain what is written here.

## 1. Who you are working for, and how to talk to them

- The owner (Busayo) is **not technical**. Always explain in plain, simple English. No jargon, no ambiguity. If you must use a technical word, explain it in one short sentence.
- Give **one small step at a time**, and say exactly where to click ("click Settings, then Environment Variables").
- Never ask them to paste secret keys into chat or into files. Say clearly which keys are private.
- Be honest. If you did not test something, say so. Never claim something works unless it was tested or the owner confirmed it.
- They have been overwhelmed by long answers. Keep messages short and structured. Do not rewrite working files without a reason.
- They test on the **live site** (push to GitHub, Vercel deploys by itself in about 1 to 2 minutes).

## 2. The assignment (hard deadline: 7 October 2026, 11:59 PM)

Module assignment: "Build an App People Will Pay For". Required:
1. A landing page that sells the product and leads to the app.
2. A working app: sign up, login, dashboard, database, core features.
3. A clear business model and a payment flow (Stripe test or sandbox mode is acceptable): Landing page, Sign up, Payment, Product.
4. Polish: good UI, mobile friendly, loading, empty and error states, form validation, permissions, safe handling of secrets.
5. Deployed on a live URL.
6. A GitHub repository.
7. A short demo video on YouTube showing: landing page, what the product does, sign up or login, the main app, key features, the main customer journey, pricing and payment.

Hand-in: YouTube link goes in the LMS. The live URL and GitHub link go in the group chat. Advice given to the owner: submit in the morning of 7 October, not at 11:59 PM.

## 3. The product

**Loopin AI is an AI executive assistant that lives in WhatsApp.** A founder messages it like a real assistant: "schedule a call with Ada Friday 3pm and email her the agenda". Loopin prepares a plan, the founder approves, and it happens in their Google account. It also works quietly behind client conversations so that what is agreed in a chat actually happens.

Background: Meta launched its own AI agent in WhatsApp Business (June 2026). It answers customers but does nothing with what was agreed. Loopin is the follow-through layer. Tagline: "Always in the loop, never chasing it."

Target customer: solo founders, consultants, coaches and small business owners who run client relationships on WhatsApp, worldwide (strong in Africa).

### The five features
1. **Commitment Sync**: finds agreements (dates, deadlines, prices) in a client chat and turns them into calendar events and tasks.
2. **Revenue Sync**: when a price is agreed, sends an invoice with the founder's payment link, and one polite reminder if unpaid after 5 days.
3. **Consistency Watch**: remembers promises across many chats and warns the founder when the same promise is made twice and still not done.
4. **Accuracy Watch**: checks what a bot or team member told a customer against the business's real prices and policies.
5. **Voice Sync**: voice notes become tracked tasks and reminders.

Plus the assistant commands: schedule meetings, draft and send email, reminders, tasks, docs, sheet rows, read recent email, read calendar.

### Two rules that must never be broken
- **Approval rule:** Loopin never sends, books or creates anything without the founder choosing Yes. Plans show Yes / Edit / No. (The invoice plan also covers one 5-day reminder, and says so on the card.)
- **Permission rule:** the four background features (Commitment Sync, Revenue Sync, Consistency Watch, Accuracy Watch) work **only on client chats the founder has switched on, per chat and per feature. Everything starts OFF.** The check is enforced on the server (see `api/analyze-chat.js`), not just in the interface.

### Pricing (shown on the landing page)
- Starter $19 per month: assistant, Gmail/Calendar/Tasks/Docs/Sheets, reminders, Voice Sync, Commitment Sync on up to 5 chats.
- Pro $39 per month: everything in Starter, all five features on unlimited chats, Revenue Sync, Consistency Watch, Accuracy Watch.
- 14-day free trial on both. Cancel before the trial ends and pay nothing.

## 4. Technology (and why)

- **Frontend:** plain HTML, CSS and JavaScript files. No framework, no build step. Each page is self-contained. Fonts: Bricolage Grotesque (headings), Instrument Sans (body). Colours: ink #12233A, blue #2C4BFF, mint #DDF6E6, sun #FFC94A.
- **Hosting:** Vercel (free Hobby plan). Project name `loopin-ai`, live at `https://loopin-ai.vercel.app`. Every push to `main` on GitHub deploys to production automatically.
- **Server code:** Vercel serverless functions in `/api` (Node, CommonJS, no package.json, no dependencies, uses global `fetch`). Files starting with an underscore are private helpers, not web addresses.
- **Database and logins:** Supabase (project ref `fdtsivknoiholycsgkjt`, URL `https://fdtsivknoiholycsgkjt.supabase.co`). Email and password auth, "Confirm email" turned OFF for the demo. Browser code uses the publishable key. Server code uses the secret key.
- **AI brain:** Groq, model `openai/gpt-oss-120b` (can be changed with env var `GROQ_MODEL`). Voice: Groq `whisper-large-v3-turbo`. Groq was chosen because it has a free tier. `llama-3.3-70b-versatile` is being retired for free accounts, so do not use it.
- **Google:** OAuth web client in a Google Cloud project called "Loopin AI". The app is in **Testing mode**: only listed test users can connect, a connection expires after about 7 days, and users see an "unverified app" warning (Advanced, then Go to Loopin AI). The owner uses a separate demo Google account for the demo.
- **Payments (not built yet):** Stripe in test mode.

### Google permissions requested (ask for the fewest possible)
`openid email profile`, `gmail.send`, `gmail.readonly`, `calendar.events`, `tasks`, `documents`, `spreadsheets`, `drive.file` (only files Loopin creates). Meet and Forms APIs are enabled but unused on purpose. `gmail.readonly` is a Google "restricted" scope: fine in testing, but a security review is needed before going public.

## 5. File map

Main folder:
- `index.html` landing page (hero chat demo, problem, assistant commands, five features, permissions demo, how it works, pricing, FAQ, contact form, footer). Contact form saves to `contact_messages`.
- `signup.html`, `login.html` Supabase email and password. `?plan=starter|pro` pre-selects the plan.
- `dashboard.html` the app. One page with one large inline script. Sections: Google connect bar, assistant chat (with microphone), personality and payment link, invoices, client chats with permission switches, activity list, "Coming next".
- `google-callback.html` where Google sends the user back; sends the code to `/api/google-connect`.
- `privacy.html`, `terms.html` plain-language policies. Keep them true when features change.
- `config.js` public values only (Supabase URL and publishable key, Google client ID, redirect URL).
- `vercel.json` `cleanUrls` true, function time limit 30 seconds, and a daily cron job that calls `/api/followups`.
- `sql/` database setup files, to be run in order in the Supabase SQL Editor (already run on the live database).

`/api`:
- `_lib.js` shared helpers: user check from the login token, database calls with the secret key, Google token refresh, Google fetch helper.
- `_invoice.js` invoice and reminder emails, money parsing, sending through Gmail.
- `chat.js` the assistant brain. Takes the conversation, returns `{reply, actions}`. Can run read-only lookups (recent email, calendar) and answers from them. Reads the user's tone settings.
- `analyze-chat.js` Commitment Sync. Refuses if the chat's switch is off.
- `consistency.js` Consistency Watch. Same server-side switch check. `_ai.js` holds shared AI helpers used by newer functions.
- `execute.js` carries out approved plans in Google (calendar, reminder as a calendar popup, email, task, doc, sheet row, invoice).
- `voice.js` voice note audio to text.
- `invoices.js` the "Send reminder" button. `followups.js` the daily cron (needs `CRON_SECRET`).
- `google-connect.js`, `google-disconnect.js` save and remove the Google connection.

## 6. Database (Supabase)

Run files in `sql/` in numeric order. Tables:
- `contact_messages` (public insert only)
- `profiles` (one per user, created by a trigger on sign up): `full_name`, `plan`, `trial_ends_at`, `assistant_tone`, `email_tone`, `payment_link`
- `activity` (approved plans and their results): `type`, `title`, `details` (jsonb), `status` (approved, done, failed), `result`
- `google_connections` (refresh token; the browser can only see email and scopes, never the token)
- `client_chats` (name and four permission switches, all default false), `chat_messages` (saved text of allowed chats; only the server inserts)
- `invoices` (number, client, amount, currency, status sent, reminded or paid)

**Rules learned the hard way:** Supabase is set so new tables are NOT exposed automatically. Every new table needs row level security on, explicit `grant` statements for `authenticated` and also for `service_role`, and policies. Use column-level grants where users must not edit every column (for example users cannot change their own `plan` or `trial_ends_at`).

## 7. Environment variables

Set in Vercel, project **Settings, Environment Variables, Project tab** (NOT the Shared tab; Shared variables do not reach the project unless linked). Choose Secret. Tick Production and Preview. **Redeploy after changing any variable.** Never put secrets in files or in chat.
- `GROQ_API_KEY`
- `GOOGLE_CLIENT_SECRET`
- `SUPABASE_SECRET_KEY`
- `CRON_SECRET`
- `GROQ_MODEL` (optional)
- Needed later: Stripe secret key and webhook secret.

## 8. Security decisions already made (keep them)

- Never put model output or user text into the page with `innerHTML`. Use `textContent`.
- Content from emails, calendars and client chats is **untrusted**. After a lookup, the second AI pass has its actions thrown away. Commitment Sync output is limited to four action types.
- `execute.js` re-validates every field itself (email addresses, dates, amounts) and never trusts the browser.
- Rows are "claimed" (`result=running`) before running, so a double tap cannot send an email twice.
- Sheet rows use `RAW` input so text from a chat can never run as a formula.
- The Groq free tier may use data for training and its data policy was not confirmed. Use sample data only until a paid plan is chosen.

## 9. Status

### Done and confirmed by the owner
Landing page (live), contact form, sign up, login, dashboard, assistant chat with Yes / Edit / No, Google connection, Commitment Sync with per-chat permission switches, Voice Sync, personality settings (professional, formal, friendly, casual; one for talking to the founder, one for emails to clients), and Revenue Sync (invoice email, invoice list, reminder button, payment link; tested live by the owner).

### Built and mock-tested, awaiting the owner's live test
Consistency Watch: `api/consistency.js` plus a "Check repeated promises" button on client chats that have the switch on. No new database setup or keys needed. It reads the saved text of that one chat, finds promises the founder made 2 or more times that still look unfinished, and offers a task for each (approved with Yes / Edit / No like everything else).

### Still to build, in this order
1. **Accuracy Watch** (the founder stores real prices and policies; check a pasted bot or staff reply against them; flag mismatches).
2. **Stripe subscriptions in test mode:** checkout for Starter and Pro with the 14-day trial, a webhook that records the subscription, plan gating (Starter limits such as 5 chats and Pro-only features), a billing section on the dashboard. The signup page currently collects a plan but takes no payment.
3. **Landing page update:** show the new features honestly (voice, personality in four tones with the same reminder example, Google tools). Keep every claim true.
4. **Polish:** test on a phone, empty and error states, forgot password, loading states, accessibility checks.
5. **Demo video preparation:** a demo Google account with believable emails and calendar events.

### WhatsApp (blocked, but it is the heart of the product)
The owner wants Loopin to be a real WhatsApp contact. The Meta developer app is blocked: the new business portfolio is "restricted from advertising", and review needs an ID the owner could not find. Until unlocked, the dashboard chat is the working assistant. Decision day was set for 3 October: if still blocked, use a WhatsApp demo alternative that does not need Meta's approval, or demo from the dashboard.
Design when unlocked: a webhook function (`api/whatsapp.js`) receives messages, links a phone number to a user account, replies with interactive Yes / Edit / No buttons, reuses `chat.js` logic and `voice.js` for voice notes. Meta's free test number can message up to 5 verified numbers and a free-form reply is allowed only within 24 hours of the user's last message. Real limit: WhatsApp does not let any app read a person's personal chats, so client chats reach Loopin by forwarding or pasting (today: paste into the dashboard).

### Later (not needed for the assignment)
Real Loopin number and Meta business name approval and verification; message templates for reminders Loopin starts by itself; paid AI plan and a data policy check; legal review of privacy and terms; Google verification and the security review for restricted scopes; encrypt stored Google tokens; turn email confirmation back on; switch Stripe to live mode; custom domain; real testimonials; email alerts for contact form messages; auto-create payment links inside each founder's own Stripe or Paystack; more personality options.

## 10. Working agreements for you

- Match the existing code style and patterns. Do not introduce a framework or build step.
- Make small changes and tell the owner exactly which files changed and what to test.
- After changing files that need new keys or database tables, tell the owner the steps in order: run SQL, add keys, push to GitHub, wait, test.
- When you finish a task, update section 9 of this file.
