# Data and reliability

Deleted items, exports, privacy, uptime, and connecting other tools.

## Deleted items, trash and backups

### Restoring deleted tasks and boards

Deleted tasks and boards go to the **Trash**. Any member can restore them for **30 days**. After 30 days they are permanently deleted.

### Restoring a deleted workspace

Support can restore a deleted workspace within **30 days** of its deletion.

### Backups

Flowboard keeps backups for **35 days**. We restore from backup **only when data was lost because of a problem on Flowboard's side**. Backups aren't used to recover items you deleted more than 30 days ago.

If something is missing, check the Trash first, then contact support.

## Exporting your data

### What you can export

| What | Formats | Who can do it | Where |
|---|---|---|---|
| A whole workspace | CSV or JSON | Any workspace admin | *Settings → Export* |
| A single board | CSV | Any member | |

Your data's location and protection: see *Privacy and your data* below.

## Privacy and your data

### Where data lives

Flowboard data is hosted in the **EU (Frankfurt)**. It isn't possible to choose another region.

### Protection

Data is **encrypted in transit and at rest**.

### Data processing agreement

Business customers can request a data processing agreement (DPA) through support.

### Deleting a workspace

Only the **workspace owner** can delete a workspace, under *Settings → General → Delete workspace*. Support can restore it within 30 days. See *Deleted items, trash and backups* above.

If you cancel your subscription instead, your data stays read-only for 90 days. See *Refunds and cancellations* in the *Billing guide*.

### Getting your data out

See *Exporting your data* above.

## Uptime, incidents and maintenance

### The status page

Every incident is posted on our status page: **`status.flowboard.example`**. If Flowboard isn't working for you, check it first for the latest updates.

### Uptime SLA

The **Business** plan has an uptime SLA of **99.9% per calendar month**. Team and Free have no SLA.

If we miss the SLA in a month, Business customers can request a **service credit of 10% of that month's fee**. Request it **within 30 days**. Credits aren't cash refunds.

### Scheduled maintenance

Planned maintenance is announced on the status page **at least 72 hours** in advance.

## Integrations and the API

### Native integrations

Flowboard connects with **Slack, Google Drive, GitHub, Microsoft Teams and Zapier**. Integrations are available on the **Team** and **Business** plans.

### If an integration stops working

1. Disconnect it and connect it again under *Settings → Integrations*.
2. If that doesn't fix it, contact support.

### The REST API

The public REST API is at **`api.flowboard.example`**, on the Team and Business plans.

Each token is limited to **100 requests per minute**. Requests over the limit get a `429` error.
