# Store listing draft

Placeholders in `[brackets]` need your decision. Keep claims to what the app does today.

**Name:** InvoiceFlow
**Subtitle / short description (30/80 chars):** Invoices and payments, simplified.
**Short description (Google, 80):** Create, send and get paid for invoices from your phone.

**Full description**

InvoiceFlow helps freelancers and small businesses invoice professionally from their phone.

- Create invoices in seconds from saved customers and products or services
- Taxes, discounts and fees calculated exactly, in 40+ currencies
- Send invoices by email as a PDF, or share a secure link
- Let customers pay online by card, Apple Pay or Google Pay (powered by Stripe)
- See what is outstanding, overdue and paid on one dashboard
- Get notified when an invoice is viewed, paid or overdue
- Lock the app with Face ID / fingerprint

Payments are processed by Stripe. [Stripe fees and any platform fee apply.]

**Keywords (iOS, 100 chars):** invoice,invoicing,billing,freelance,small business,payments,receipts,bookkeeping
**Category:** Business (primary), Finance (secondary)
**Support URL / marketing URL / privacy URL:** [to be added]

## Data collection answers (verify against your final deployment)

| Data | Collected | Linked to user | Used for | Shared with |
| --- | --- | --- | --- | --- |
| Email, name | Yes | Yes | Account, app functionality | Supabase (auth/database host) |
| Business profile, logo, signature | Yes | Yes | App functionality (invoices) | Supabase |
| Customers' names, emails, addresses (entered by the user) | Yes | Yes | App functionality | Supabase; email sent via Resend |
| Invoices and payment records | Yes | Yes | App functionality | Supabase; Stripe (payments) |
| Payment card details | **No**, entered on Stripe's own form; never reach InvoiceFlow servers | n/a | n/a | Stripe |
| Device push token | Yes | Yes | Notifications | Expo push service, Apple/Google |
| IP address (security audit log, rate limiting) | Yes | Yes | Security | Hosting provider |
| Contacts, location, photos library | No (photos are only read when the user picks a logo or signature) | n/a | n/a | n/a |
| Tracking / advertising | No | n/a | n/a | n/a |
| Analytics / crash reporting | None built in yet [update if you add one] | | | |

Data is encrypted in transit (HTTPS). Users can delete their account and all data in the app.

## Review notes (paste into App Store Connect / Play Console)

> InvoiceFlow lets a business create invoices for its own customers. Customers pay through a Stripe
> checkout page on the web; the app does not sell digital goods or subscriptions. Demo login:
> [email] / [password] (pre-filled with sample data). Payments run in Stripe test mode on this account.
