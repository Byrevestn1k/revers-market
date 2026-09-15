# Email verification

Registration requires a unique email (trimmed and compared case-insensitively).
Existing accounts can keep a null email until their owner adds one in Profile.
Login accepts either username or email, plus the existing password. Verification
does not currently block access to the account. Email is private profile data.

The server generates 32 random bytes, stores a SHA-256 hash and a 24-hour expiry,
and sends the original token in an APP_URL/verify-email?token=... link. The page
removes the token from the address bar and asks the user to confirm explicitly,
then POSTs it to /api/auth/confirm-email. A single conditional database UPDATE
checks expiry, marks the address verified and clears the token. Links are single
use; changing the address or resending replaces the previous token.

Resending requires a session and is limited atomically in PostgreSQL to once per
minute per unchanged, unverified address. Already verified addresses are not reset
by resending. Editing an email resets verification; saving an unchanged address
preserves it. The profile shows verification status and a resend button.

## Configuration and rollout

Run `npm run db:migrate --workspace backend` before starting the updated backend.
Migration 016 adds nullable email columns for existing users; 017 invalidates
raw tokens produced by earlier development builds. Users can request new links.

Set APP_URL to the public frontend URL, and configure SMTP_HOST, SMTP_PORT,
SMTP_SECURE, SMTP_USER, SMTP_PASS and SMTP_FROM (see .env.example). Keep secrets
in the deployment environment. Serve /verify-email through the frontend SPA
fallback. The current message is a Ukrainian plain-text email sent by nodemailer.

Without SMTP in development the link is printed to the backend console and the
API reports emailVerificationSent=false. Production never falls back to logging
tokens. A mail delivery error does not delete the account; resend can be retried.
emailVerificationSent=true means SMTP accepted the message, not inbox delivery.

## Further production work

Delivery is currently synchronous; there is no durable retry queue. A durable
outbox would insert an email job in the same transaction as the account/address
change; a worker would send it and retry transient failures, track provider
bounces and expire jobs. Any raw token in a queued job needs protected storage
and removal after delivery. An HTML template can accompany the existing text.
Configure the sending domain and provider's SPF/DKIM/DMARC records before rollout.

Phone verification uses the same development fallback: the four-digit code is
printed to the backend log. In production set SMS_WEBHOOK_URL to a provider or
internal gateway that accepts JSON `{ "to": "+380...", "code": "1234" }` and
returns a successful HTTP status; optionally send SMS_WEBHOOK_TOKEN as a bearer
token. Without this setting, production refuses to pretend that an SMS was sent.
Changing email currently takes effect immediately; a separate pending-email
flow with password reauthentication would preserve the old login address until
the new one is confirmed. Neither that flow nor password recovery is implemented.
