# Squad Payment Portal Implementation Plan

> **For agentic workers:** Execute inline in this session. Keep changes small and validate each touched slice before moving on.

**Goal:** Add Squad sandbox checkout for Starter and Pro, preserve the no-charge 14-day trial, allow immediate paid signup, record verified payments, and enforce plan access.

**Architecture:** The browser asks authenticated Vercel functions to start checkout; the Squad secret key stays server-side. One public Squad function dispatches the existing checkout, return, webhook, cancellation, renewal and status paths using Vercel rewrites to stay within the Hobby function limit. Squad redirects to a return page and sends webhooks; both paths verify the transaction directly with Squad before the server changes subscription access. Trial signup requires no payment. Immediate signup charges the selected month and requests card tokenization for subsequent recurring charges.

**Tech Stack:** Existing plain HTML/CSS/JavaScript, Vercel Node serverless functions, Supabase REST API, and Squad sandbox REST API. No added packages.

**Spec:** `AGENTS.md` sections 3, 4, 6, 7, 8 and 9; official Squad docs at `https://docs.squadco.com/Payments/Initiate-payment`, `https://docs.squadco.com/Payments/verify-transaction`, and `https://docs.squadco.com/Payments/direct-debit`.

## Global Constraints

- Never put a Squad secret key in browser code, public config, or chat.
- Use Squad sandbox base URL `https://sandbox-api-d.squadco.com` for this assignment.
- Current public prices are Starter ₦30,000/month and Pro ₦60,000/month; send NGN amounts in kobo.
- Trial path grants 14 days without charge; direct-subscribe path charges immediately.
- Never activate paid access from a browser redirect alone; verify with Squad's transaction verification endpoint.
- Store Squad card tokens and subscription controls so authenticated users cannot read or change them.
- Preserve Supabase's restricted plan/trial column grants and row-level security.

---

### Task 1: Store billing state safely

**Files:**
- Create: `sql/8-billing.sql`
- Modify: `AGENTS.md`

Create a private subscription record per user with plan, status, Squad card token, next due date, and last transaction reference. Create a payment-attempt table with a unique Squad transaction reference, owner, selected plan, expected amount/currency, and status. Enable RLS, grant access only to `service_role`, and add an index for due renewals. Update project notes with the migration and exact Vercel setting name `SQUAD_SECRET_KEY`.

- [ ] Check the schema against the existing `profiles` and `client_chats` migrations.
- [ ] Ensure authenticated users have no direct access to saved payment tokens or server-owned plan fields.

### Task 2: Start and verify checkout

**Files:**
- Create: `api/_squad.js`
- Create: `api/squad-checkout.js`
- Create: `api/squad-confirm.js`
- Create: `api/squad-webhook.js`
- Create: `billing-return.html`

`POST /api/squad-checkout` accepts `{plan}` for an authenticated user, creates a pending payment record, and calls Squad `POST /transaction/initiate` with a unique `transaction_ref`, `currency: "NGN"`, amount `3000000` or `6000000` kobo, `initiate_type: "inline"`, `is_recurring: true`, callback URL, and metadata. It returns only the validated Squad checkout URL and reference.

`POST /api/squad-confirm` accepts `{transaction_ref}`, verifies that the current user owns the pending attempt, calls Squad `GET /transaction/verify/{transaction_ref}`, and only marks it paid if status, amount, currency, and email match. It updates the user's plan and stores tokenization data only from the verified transaction details.

`POST /api/squad-webhook` receives Squad's `charge_successful` event, uses its transaction reference to locate the local pending attempt, then performs the same server-to-Squad verification before processing. It must be safe to receive the same event more than once.

The return page displays pending/success/failure and calls the confirmation endpoint; it never grants access itself.

- [ ] Verify transaction payload shape and token fields against Squad docs before implementing confirmation.
- [ ] Add focused tests for price mapping, transaction ownership, mismatched amounts, failed verification, and duplicate confirmation.

### Task 3: Offer trial and immediate subscription

**Files:**
- Modify: `signup.html`
- Modify: `dashboard.html`

Signup offers two clear choices: start the 14-day trial (no charge) or subscribe now (selected monthly amount charged immediately). Direct subscribers are sent to Squad after account creation. Add a billing section to the dashboard showing current plan/status and a subscribe action for trial users.

- [ ] Keep the existing account creation and login behavior for trial signups.
- [ ] Show clear recovery guidance if account creation succeeds but checkout cannot start.

### Task 4: Enforce plan access and renewals

**Files:**
- Create: `api/_billing.js`
- Create: `api/squad-renewals.js`
- Modify: `sql/8-billing.sql`
- Modify: relevant existing API handlers and `vercel.json`

The server checks whether the user has an unexpired trial or active paid subscription before using paid app actions. Starter is limited to five client chats and Starter features; Pro-only background features require Pro access. Enforce chat count in the database because the browser currently inserts chats directly. Add a daily Vercel cron to charge due tokenized subscriptions using Squad's documented card-charge endpoint, verify the charge, and update billing state. Failed charges must not be treated as paid; cancellation must use Squad's documented recurring-cancel endpoint.

- [ ] Test expired trial, active trial, active Starter, active Pro, Starter fifth/sixth chat, and duplicate renewal execution.
- [ ] Keep billing/status access available when an account's trial has expired.

### Task 5: Validate and prepare sandbox setup

**Files:**
- Modify: `AGENTS.md`

Run JavaScript syntax checks and focused tests. Document the user's steps: create a Squad sandbox account, set its secret key in Vercel as `SQUAD_SECRET_KEY` for Preview, set the webhook URL to `/api/squad-webhook` in Squad, run `sql/8-billing.sql` in Supabase, push, wait for Vercel, then test with Squad's sandbox card `5200000000000007`.

- [ ] Do not claim a successful Squad transaction until it has been tested with real sandbox credentials.
