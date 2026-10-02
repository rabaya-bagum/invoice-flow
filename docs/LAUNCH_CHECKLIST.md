# Launch checklist

Everything here needs an account, a device or a decision that only you can make. Items marked
**(done)** are in the repo already. Nothing below has been run against real Apple, Google, Stripe,
Resend, Expo or Supabase accounts from the build environment.

## 1. Accounts and ownership
- [ ] Apple Developer Program (US$99/yr) and Google Play Console (US$25 once). Individual accounts
      on Play need closed testing with 12+ testers for 14 days before production access.
- [ ] Expo account; run `cd mobile && eas init` (writes the project id), then set
      `EXPO_PUBLIC_EAS_PROJECT_ID` in each EAS environment.
- [ ] Decide the final bundle id. `com.invoiceflow.app` is a placeholder and **cannot be changed
      after the first store upload**. Change it in `mobile/app.json` (iOS `bundleIdentifier`, Android
      `package`) and in `mobile/.maestro/*.yaml` (`appId`); the Jest drift guards will tell you if you
      miss one.
- [ ] Check the name "InvoiceFlow" is free as an app name and trademark in your markets.

## 2. Backend (production)
- [ ] Supabase project: run `supabase/migrations` in order; enable email confirmation; set the password
      policy and leaked-password protection; add the app scheme (`invoiceflow://`) and your web URL to
      the redirect allow-list; check JWT expiry; turn on daily backups / point-in-time recovery.
- [ ] Create the private storage bucket (the API does this on boot; confirm it exists).
- [ ] Host the API (any Node 22 / Docker host; `api/Dockerfile` is built in CI). Set every variable in
      `api/.env.example`. In production the API refuses to start without `PUBLIC_LINK_SECRET`.
      Put it behind TLS; `PUBLIC_APP_URL` must be the public https URL.
- [ ] Stripe: live keys, a webhook endpoint at `{PUBLIC_APP_URL}/v1/payments/webhook` (events:
      `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`,
      `charge.refunded`; Connect account status is read on demand, not from webhooks), Connect branding, `PLATFORM_FEE_BPS`,
      Apple Pay domain verification (`APPLE_PAY_DOMAIN_ASSOCIATION`).
- [ ] Resend: verify your sending domain; set `EMAIL_FROM`.
- [ ] Push: `PUSH_ENABLED=true`; APNs key and FCM v1 credentials via `eas credentials`.
- [ ] Monitoring: error tracking, uptime check on `/health`, log retention, alerts on 5xx.
- [ ] Pick a retention policy for audit logs and deleted-account data.

## 3. Mobile builds
- [x] **(done)** `mobile/eas.json` with `development`, `preview` (internal) and `production` profiles;
      production auto-increments build numbers and builds an Android App Bundle.
- [ ] Create EAS environments `development`, `preview`, `production` and add
      `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` to each
      (`eas env:create`). Only these public values belong in the app; never the service-role or Stripe
      secret keys.
- [ ] Replace the template icon, adaptive icon, splash image and favicon in `mobile/assets/` (1024x1024
      icon, no transparency for iOS).
- [ ] `eas build --profile development` and run `cd mobile && maestro test .maestro` on a device.
- [ ] `eas build --profile preview` and test on real phones: push tokens and delivery, Apple/Google Pay
      on the pay page, Face ID lock, PDF share, deep link back from Stripe onboarding, airplane mode.
- [ ] Test with a real Stripe test-mode Connect account end to end (onboard, pay, refund).
- [ ] Offline drafts on a real phone: airplane mode, create a draft, edit it, kill the app, reopen online and
      confirm it uploads once; edit the same draft on two phones to see the conflict choices; sign out with
      an unsynced draft.
- [ ] `eas build --profile production`, then `eas submit` (App Store Connect API key / Play service
      account in `eas.json` under `submit`).

## 4. Store listings
Draft copy and the data-collection answers are in `docs/STORE_LISTING.md`.
- [ ] Screenshots: 6.9" and 6.5" iPhone, 13" iPad (the app declares tablet support), Android phone.
      Use the demo seed so the dashboard is full: `pnpm --filter @invoiceflow/api seed -- --email ...`.
- [ ] Privacy policy at a public URL, from `docs/PRIVACY_POLICY_TEMPLATE.md` **after legal review**.
      Required by both stores because the app collects personal data and has accounts.
- [ ] Account deletion: the app has it (More > Settings), and Google Play also wants a web URL for
      deleting an account. Add a page or a support-email process and link it in the Play console.
- [ ] Apple: App Privacy "nutrition label", export-compliance answer (the app sets
      `ITSAppUsesNonExemptEncryption=false`: it only uses standard HTTPS), age rating, support URL,
      review notes with a demo login.
- [ ] Google: Data safety form, content rating, target audience (not for children), a demo login for
      review.
- [ ] Payments policy: customers pay a business's invoice through Stripe on a web page; the app itself
      sells nothing digital, so In-App Purchase rules should not apply. Confirm with the reviewer
      notes ("invoices for the user's own customers; payment happens on the web via Stripe").

## 5. Before opening to the public
- [ ] Independent security review / pentest (see `docs/SECURITY.md` for scope and gaps).
- [ ] Load-test the API and check Postgres connection limits (`pg` pool max is 10 per instance).
- [ ] Support email, terms of service, and a status/incident contact.
- [ ] Tax/legal wording on invoices for your markets (invoice numbering rules, VAT/GST numbers,
      e-invoicing mandates in some countries). The app supports tax numbers and custom terms but does
      not make legal claims.
- [ ] Decide on a staged rollout (TestFlight / Play internal -> closed -> 10% production).
