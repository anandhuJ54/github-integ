# Create the first Admin Console account (scott@experience.com)

There is currently no user in the system — the auth user list is empty, which is why no email/password exists to hand over. Passwords are never readable, so the account has to be created and the password set by you.

You chose the email-invite route, so the flow below lets you set your own password from a link in your inbox.

## What will happen

1. Temporarily allow sign-up so the invite path can create exactly one account, and keep email confirmation ON (no auto-confirm) so the account is only usable after you click the link.
2. Trigger the account creation for `scott@experience.com` from the sign-in screen (one-time), which sends a confirmation email from the default sender.
3. You click the link in the email and set your password.
4. First authenticated user auto-bootstraps to `super_admin` via the existing bootstrap routine — this is already built.
5. Immediately re-disable public sign-up so the console stays invite-only.

## Sign-in screen change

Add a small one-time "Request access" affordance on `/auth` (email field + button) used only for this bootstrap, then remove it once your account exists. Alternative if you prefer zero UI change: I set a temporary password you use once and change immediately — say the word and I'll switch to that.

## Notes

- No changes to any `exp_` model tables, migrations, or existing pages.
- The confirmation email comes from the default sender until a branded email domain is set up; check spam if it doesn't arrive.
- If email delivery is throttled, the auth email hourly limit can be raised.

## Also fixing quietly

A hydration warning on `/auth` (server/client markup mismatch) that appears in the preview console.
