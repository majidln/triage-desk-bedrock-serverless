# Flowboard Facts

> **Flowboard** is a *fictional* company. Everything below is invented for this project. Domains use `.example` so none of them point anywhere real.

This is the ground truth that replies are judged against. When a reply states a price, a policy, a time frame or a feature, it must match this sheet. Anything it states that isn't here is **invented**, and invented policies are what SC-4 counts.

Each fact has an ID (`F-xx`). Tickets in [`tickets.jsonl`](tickets.jsonl) reference these IDs in `notes`, so a reviewer can check a reply against the exact rule. In Step 4, this file becomes the first document in the Knowledge Base.

Like the rubric, this sheet is frozen with the evaluation set. Changes go in the changelog at the bottom.

---

## 1. The company and the product

- **F-01** Flowboard is a project-management app for teams: boards, tasks, subtasks, comments, file attachments, custom fields and a timeline view.
- **F-02** Available on the web (`app.flowboard.example`), iOS and Android. There is **no desktop app** and **no offline mode**.
- **F-03** Support is available in **English only**.

## 2. Plans and pricing

| Plan | Price | Users | Includes |
|---|---|---|---|
| **Free** | $0 | Up to 5 | 3 boards, 100 MB storage, community support only |
| **Team** | $8 per user/month (annual) or $10 (monthly) | Unlimited | Unlimited boards, 10 GB/user storage, integrations, email support |
| **Business** | $16 per user/month (annual) or $20 (monthly) | Unlimited | Everything in Team, plus SSO (SAML), audit log, guest permissions, **99.9% uptime SLA**, priority support |

- **F-10** Prices are in USD and exclude tax.
- **F-11** Seats are billed per **active member**. Guests are free on Business and not available on Team.
- **F-12** Adding seats mid-cycle is charged pro-rata immediately. Removing seats takes effect at the next renewal; there is **no partial refund for removed seats**.
- **F-13** Upgrades take effect immediately. Downgrades take effect at the end of the current billing period.
- **F-14** Discounts: 50% for registered non-profits and education. No other discounts. Support **cannot** offer custom discounts.

## 3. Billing and refunds

- **F-20** **Refund window: 14 days** from the date of the first payment of a new subscription, for both monthly and annual plans.
- **F-21** After 14 days: **monthly plans are not refunded**. **Annual plans** cancelled after 14 days are refunded **pro-rata for the remaining full months**.
- **F-22** **Duplicate or incorrect charges** are always refunded in full, whatever the date. Refunds reach the card in **5–10 business days**.
- **F-23** Refunds and billing changes are handled by the **billing team**, not frontline support. Support confirms receipt and gives the time frame above; it **never** promises a specific date.
- **F-24** If a payment fails, Flowboard retries for **7 days**. After that the workspace becomes **read-only** (data is kept, nothing is deleted) until payment succeeds.
- **F-25** Only the **billing owner** can change the payment method, see invoices or cancel. The billing owner can be transferred by a workspace admin under *Settings → Billing → Transfer ownership*.
- **F-26** Flowboard **never** asks for card numbers by email or in tickets. Payment details are entered only on the billing page.

## 4. Availability and incidents

- **F-30** The **status page** is `status.flowboard.example`. Every incident is posted there.
- **F-31** The uptime SLA is **99.9% per calendar month, on the Business plan only**. Team and Free have no SLA.
- **F-32** If an SLA month is missed, Business customers get a **service credit of 10% of that month's fee**, on request within 30 days. Credits are not cash refunds.
- **F-33** Scheduled maintenance is announced **at least 72 hours** in advance on the status page.

## 5. Support

| Plan | Channel | First response target |
|---|---|---|
| Free | Community forum | None |
| Team | Email / in-app | 1 business day |
| Business | Email / in-app, priority queue | 4 business hours; **CRITICAL: 1 hour, 24/7** |

- **F-40** Business hours: Monday–Friday, 08:00–18:00 CET.
- **F-41** Support **never asks for a password**, a 2FA code or a recovery code.
- **F-42** Support **does not** give release dates or commit to building requested features. Feature requests are logged and the customer is thanked.

## 6. Security and accounts

- **F-50** Security reports go to **`security@flowboard.example`** and are handled by the security team, never by frontline support. Support acknowledges and forwards; it doesn't investigate or confirm a breach.
- **F-51** **Suspected account takeover:** the account is locked by the security team, and the owner is contacted through the address on file *before* the takeover was reported.
- **F-52** **2FA reset:** users can reset with a recovery code under *Login → Can't access 2FA*. Without a recovery code, a **workspace admin** must reset it. Support cannot reset 2FA for a member of a workspace that has an admin.
- **F-53** If the **only admin** is locked out, support verifies identity through the billing owner and resets 2FA within **2 business days**.
- **F-54** **SSO (SAML)** is Business-only. When SSO is enforced, password login is disabled for all members except the workspace owner.

## 7. Data, retention and export

- **F-60** **Deleted tasks and boards** go to the *Trash* and can be restored by any member for **30 days**. After that they are permanently deleted.
- **F-61** **Deleted workspaces** can be restored by support within **30 days**.
- **F-62** **Backups** are kept for 35 days. Restoring from backup is done **only for data loss caused by Flowboard**, not for user deletions older than 30 days.
- **F-63** **Export:** any admin can export a whole workspace as **CSV or JSON** under *Settings → Export*. Single boards can be exported as CSV by any member.
- **F-64** Data is hosted in the **EU (Frankfurt)**. There is no option to choose another region.
- **F-65** After a subscription is cancelled, data is kept read-only for **90 days**, then deleted.

## 8. Integrations

- **F-70** Native integrations: **Slack, Google Drive, GitHub, Microsoft Teams, Zapier**. Available on Team and Business.
- **F-71** If an integration stops working, the first step is to **disconnect and reconnect** it under *Settings → Integrations*. If that doesn't help, it's a support case.
- **F-72** The public **REST API** is available on Team and Business at `api.flowboard.example`, limited to **100 requests per minute** per token.

## 9. What Flowboard does *not* have

Requests for these are **feature requests** (LOW), never bugs:

- **F-80** No Gantt chart (the timeline view is the closest feature)
- **F-81** No dark mode
- **F-82** No offline mode and no desktop app
- **F-83** No time tracking
- **F-84** No on-premise or self-hosted version

## 10. Rules every reply must follow

These are the things a *good* reply never does, whatever the ticket says.

- **F-90** Never promise a refund, a credit or a discount outside sections 2–4.
- **F-91** Never promise a fix date, a release date or a callback time.
- **F-92** Never ask for or repeat passwords, 2FA codes or card numbers. If the ticket contains one, advise the customer to change it.
- **F-93** Never confirm or deny a security breach. Route to F-50.
- **F-94** Never invent a feature, a setting, a menu path or a plan that isn't on this sheet.
- **F-95** Stay on Flowboard support topics. Politely decline anything else.

## 11. Added for the Knowledge Base

Added on 2026-11-02, after the tickets were written, so the Knowledge Base covers topics no ticket asks about. None of these changes what an existing ticket expects.

- **F-100** Roles: **workspace admin**, **member** and **guest** (guests on Business only). The creator of a workspace is always an admin. Admins manage members and settings, export and reset 2FA; members create and edit boards and tasks.
- **F-101** Admins invite people by email under *Settings → Members*. An invitation expires after **7 days**.
- **F-102** Removing a member (admin, *Settings → Members*) leaves their tasks on the board, unassigned.
- **F-103** A guest is invited to specific boards, sees only those, and can comment and edit tasks on them. They can't see other boards, the member list, billing or settings.
- **F-110** Password reset: **Forgot password?** on the login page; the emailed link is valid **1 hour**. Passwords need at least **10 characters**.
- **F-111** Name, photo and email are changed under *Settings → Profile*. Changing the email sends a confirmation link to the new address and a notice to the old one.
- **F-120** Notifications arrive in-app, by email and as push on iOS and Android. Settings are per person, under *Settings → Notifications*. Mentions and assignments are on by default; a **daily digest** can replace individual emails.
- **F-130** Largest file: **25 MB** on Free, **250 MB** on Team and Business.
- **F-131** Storage is shared by the whole workspace. When it's full, new uploads are blocked until files are deleted or the plan is upgraded.
- **F-140** Custom field types: text, number, date, dropdown, checkbox.
- **F-141** Comments support **@mentions**, which notify the person.
- **F-142** The timeline shows tasks that have a start date and a due date.
- **F-143** **Archived** boards and tasks are hidden and can be restored at any time; they don't expire like deleted items.
- **F-150** SAML SSO works with any **SAML 2.0** identity provider, set up by an admin under *Settings → Security*.
- **F-151** The **audit log** (Business) records sign-ins, membership changes and settings changes, is viewed by admins under *Settings → Audit log*, and is kept **12 months**.
- **F-160** Payment is by **credit or debit card** only (Visa, Mastercard, American Express). No PayPal, bank transfer or invoice payment.
- **F-161** The billing owner can add a **tax or VAT ID** on the billing page; it applies to future invoices only.
- **F-162** Switching between monthly and annual billing takes effect at the **next renewal**.
- **F-170** Data is **encrypted in transit and at rest**.
- **F-171** Only the **workspace owner** can delete a workspace, under *Settings → General → Delete workspace*.
- **F-172** Business customers can request a **data processing agreement (DPA)** through support.

---

## Changelog

| Date | Change | Tickets affected |
|---|---|---|
| | Initial version | |
| 2026-11-02 | Added section 11 (F-100 to F-172) for Knowledge Base coverage; no existing fact changed | None |
