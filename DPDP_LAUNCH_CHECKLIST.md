# Privacy and DPDP launch checklist (MARKETRA AI)

This release adds an in-product starter Privacy Notice and captures a notice version and timestamp in Supabase Auth user metadata when signup is submitted. This is a transparency improvement, **not proof of complete DPDP Act compliance**.

Before public launch, the operator must:
1. Replace this starter notice with a reviewed privacy policy based on actual data flows and the legal identity/contact details of the Data Fiduciary.
2. Publish a working privacy/grievance contact and response process. Do not invent contact details.
3. Define retention periods for account data, business profiles, conversations, logs, and SocialCrawl snapshots; implement deletion/backup expiry.
4. Build and test a secure account/data deletion and access/correction/erasure request workflow. This ZIP does not implement full self-serve account deletion.
5. Review consent purpose-by-purpose, withdrawal, notices, children’s data (if relevant), vendor terms, data transfers, breach response, and applicable commencement dates with qualified Indian counsel.
6. Configure Supabase Auth → URL Configuration → Site URL to `https://marketraai.netlify.app` and add the exact production redirect URL(s) used by the deployed app. Confirm the email template sends a valid confirmation link.
7. Test signup with email confirmation enabled: signup → confirmation email → click link → return to site → sign in. Test resend, duplicate email, wrong password, and mobile layouts.

Current provider disclosures in the starter notice reflect code/configuration reviewed: Supabase, Render, Google Gemini, and SocialCrawl. Re-check them whenever providers or data flows change.
