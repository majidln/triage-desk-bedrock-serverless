# Accounts and security

Signing in, protecting your account, managing people, and Business plan features.

## Logging in, passwords and your profile

### Forgot your password

1. On the login page, choose **Forgot password?**
2. Open the email we send you and follow the link. The link is valid for **1 hour**.
3. Choose a new password of at least **10 characters**.

No email? Check your spam folder, and make sure you used the address on your account.

### Your profile

Change your name, photo and email address under *Settings → Profile*.

When you change your email, we send a confirmation link to the **new** address, and a notice to the **old** one. If you get a notice about a change you didn't make, contact **`security@flowboard.example`** right away. See *Account security* below.

### Can't sign in?

- Using 2FA and lost access to it? See *Account security* below.
- Is your workspace using SSO? Sign in through your company's identity provider. See *Business plan features* below.
- Check `status.flowboard.example` in case of an incident.

## Account security

### What we'll never ask for

Flowboard support **never asks for your password, a 2FA code or a recovery code**. If you've shared one in a ticket or email, change it now.

### Reporting a security issue

Send vulnerabilities and suspected data exposure to **`security@flowboard.example`**. Our security team handles every report. Frontline support passes reports on and can't investigate them or comment on them.

### If someone may have taken over your account

Our security team locks the account. We then contact the owner at the email address that was on the account **before** the takeover was reported.

### Resetting 2FA

| Your situation | What to do |
|---|---|
| You have a recovery code | Use *Login → Can't access 2FA* |
| No recovery code, and your workspace has an admin | Ask a **workspace admin** to reset your 2FA. Support can't do it for you |
| You are the **only admin** and you're locked out | Support verifies your identity through the billing owner and resets 2FA within **2 business days** |

### Single sign-on (SSO)

SSO with SAML is available on the **Business** plan. When SSO is enforced, password login is turned off for every member except the workspace owner.

## Members, roles and guests

### Roles

| Role | Can do |
|---|---|
| **Workspace admin** | Manage members and settings, export the workspace, reset a member's 2FA. The person who created the workspace is always an admin |
| **Member** | Create and edit boards and tasks, comment, attach files |
| **Guest** | Work only on the boards they're invited to. **Business plan only** |

The **billing owner** is a separate responsibility; see *Payments and invoices* in the *Billing guide*.

### Inviting and removing people

- Admins invite people by email under *Settings → Members*. An invitation link expires after **7 days**; send a new one if it lapses.
- Admins remove a member in the same place. The person's tasks stay on their boards and become unassigned.
- Removing a member lowers your seat count at your next renewal. See *Plans and pricing* in the *Billing guide*.

### Guests

Guests are people outside your organization, such as clients. They're free on Business.

- An admin invites a guest to specific boards.
- A guest sees only those boards. They can comment and edit tasks on them.
- A guest can't see other boards, the member list, billing or settings.

## Business plan features

These are available on the **Business** plan only. See *Plans and pricing* in the *Billing guide*.

### Single sign-on (SAML)

SSO works with any **SAML 2.0** identity provider. A workspace admin sets it up under *Settings → Security*. When SSO is enforced, password login is turned off for everyone except the workspace owner. See *Account security* above.

### Audit log

The audit log records **sign-ins, membership changes and settings changes**. Admins can view it under *Settings → Audit log*. Entries are kept for **12 months**.

### Guests

Invite clients and partners as free guests. See *Members, roles and guests* above.

### Uptime SLA and priority support

See *Uptime, incidents and maintenance* in the *Data and reliability* guide and *Contacting support* in the *Getting help* guide.
