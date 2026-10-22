# Add abdul@ and geetha@ as full-access admins

Right now the only account in the system is scott@experience.com, which holds all three global grants (Super Admin, Analyst, Architect). Neither abdul@experience.com nor geetha@experience.com exists yet, so each needs an account created first, then the same three grants.

## What will happen

1. Create the two accounts (`abdul@experience.com`, `geetha@experience.com`) directly, already email-confirmed so they can sign in immediately. Public sign-up stays disabled — the console remains invite-only.
2. Set a one-time temporary password for each and hand them to you in chat, so you can pass them on. They change it on first sign-in via the existing reset-password page. This mirrors how your own account was set up, because branded email delivery isn't configured yet and the default sender was unreliable.
3. Grant each user all three global roles: Super Admin (primary), Architect, Analyst — identical in shape to scott@experience.com's grants (`scope_type = 'global'`, `scope_id = '*'`).
4. Verify: both accounts appear on the Users & Grants page with three role chips each, and the header workspace switcher offers all three roles after they sign in.

## Notes

- No changes to any `exp_` model tables, migrations of the data model, or existing pages — this is account and grant data only.
- If you'd rather they set their own password from an email link instead of a temporary password, say so and I'll switch to the email-invite path (delivery may be slow or land in spam until a branded sender is set up).
- Both accounts get full Super Admin, which can grant and revoke roles for anyone, including you.
