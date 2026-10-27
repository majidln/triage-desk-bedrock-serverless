# Triage Desk: an AI-Powered Customer Support Pipeline

A serverless AWS application that processes customer support tickets using AI to automatically analyze urgency and generate responses.

## Overview

This pipeline receives customer support requests via API Gateway, stores them in DynamoDB, processes them asynchronously using AWS Bedrock (Amazon Nova Lite), and notifies the support team via SNS.

### Architecture

![Architecture Diagram](image.png)

1. **Support Request Receiver** (`support-request-receiver.ts`)
   - Receives POST requests at `/support-request`
   - Creates the ticket in DynamoDB: its only write

2. **Ticket intake** (an EventBridge Pipe, no code)
   - Reads new tickets (`INSERT`s) from the table's DynamoDB stream and puts each one on the SQS queue
   - One write in the receiver means a ticket can't be stored without also being queued

3. **Fetch Support Ticket** (`fetch-support-ticket.ts`)
   - Receives GET requests at `/support-request?ticketId=<id>`
   - Retrieves ticket information from DynamoDB
   - Returns the ticket's status, and the AI-generated reply once it's processed

4. **Support Request Processor** (`support-request-processor.ts`)
   - Processes tickets from the SQS queue (each message is one DynamoDB stream record)
   - Uses AWS Bedrock (Amazon Nova Lite) to decide the urgency and draft a reply
   - Retries transient failures, and marks a ticket `FAILED` on permanent ones
   - Updates the ticket in DynamoDB (once, even if SQS delivers it twice)
   - Sends notifications to support team via SNS

### AWS Resources

- **API Gateway**: HTTP API with endpoints for creating and fetching support tickets
- **Lambda Functions**: Three functions for receiving, fetching, and processing tickets
- **DynamoDB**: Ticket storage with server-side encryption, and a stream of changes
- **EventBridge Pipes**: Moves new tickets from the stream to the queue, with its own dead-letter queue
- **SQS**: Queue with dead-letter queue for reliable processing
- **SNS**: Topics for ticket notifications and error alerts
- **CloudWatch**: Log groups, metric filters, and alarms for monitoring and alerting

## Prerequisites

- AWS CLI configured
- SAM CLI installed
- Node.js 22+
- Docker (for local testing)

## Deployment

Build and deploy the application:

```bash
sam build
sam deploy --guided
```

The API Gateway endpoint URL will be displayed in the deployment output.

**Important:** After deployment, subscribe to the SNS topics for notifications:
- **Support Ticket Notifications**: Subscribe to receive notifications when tickets are processed
- **Bedrock Error Alerts**: Subscribe to receive alerts when Bedrock processing errors occur

Use the SNS Topic ARNs from the deployment outputs to subscribe via AWS Console, CLI, or SDK.

## Local Development

Build the application:

```bash
sam build
```

Start the API locally:

```bash
sam local start-api
```

Test individual functions:

```bash
sam local invoke SupportRequestReceiverFunction --event events/new-ticket.json
sam local invoke FetchSupportRequestFunction --event events/fetch-ticket.json
sam local invoke SupportRequestProcessorFunction --event events/sqs-event.json
```

Formatting and linting cover `lambdas/` and `eval/` from one config at the repo root (Prettier for layout, ESLint with typescript-eslint for code issues):

```bash
npm install          # once, at the repo root
npm run format       # rewrite files into the shared style
npm run check        # what CI would run: format check + lint
```

## Project Structure

```
.
├── lambdas/
│   ├── handlers/
│   │   ├── support-request-receiver.ts  # POST endpoint handler
│   │   ├── fetch-support-ticket.ts      # GET endpoint handler
│   │   └── support-request-processor.ts # SQS handler
│   └── shared/
│       ├── types.ts                     # TypeScript types
│       ├── triage-model.ts              # Prompt, Bedrock call, reading the model's answer
│       ├── classify-error.ts            # Retry (transient) or fail (permanent)?
│       ├── logger.ts                    # Structured JSON logger (Powertools)
│       └── env.ts                       # Required environment variables
├── events/
│   └── new-ticket.json                  # Test event
├── eval/                                # Evaluation: measures the deployed pipeline
│   ├── tickets.jsonl                    # The frozen evaluation set
│   ├── run.ts                           # Runner: submit → collect → score → cost → report
│   ├── src/                             # One file per part
│   └── reports/                         # One report per run
├── template.yaml                        # SAM infrastructure template
└── samconfig.toml                       # SAM configuration
```

## Evaluation

`eval/` measures the deployed pipeline against a fixed set of labeled tickets: urgency accuracy, CRITICAL recall, reply checks, red-team results, latency and cost. How it works is explained in [PLANNING.md, Step 0](PLANNING.md#how-the-evaluation-works); results go in [RESULTS.md](RESULTS.md).

```bash
cd eval && npm install
```

Run the scoring tests (no AWS needed):

```bash
cd eval && npm test
```

Run the evaluation against the deployed stack. Use the `HttpApiUrl` output from `sam deploy`, and run nothing else on the same Bedrock model while it runs, because cost is read from account-wide metrics:

```bash
cd eval && API_URL=https://<api-id>.execute-api.us-east-1.amazonaws.com/Dev TABLE_NAME=triage-desk-Table npx tsx run.ts --label v0
```

On a new AWS account, whose Lambda concurrency limit is 10, add `CONCURRENCY=1`, or the receiver gets throttled and tickets show up as `not-submitted`.

It takes a few minutes: about a minute to submit and collect, then a wait for the CloudWatch token metrics. It prints the results and writes three files to `eval/reports/`:
- `<time>-<label>.json`: every ticket and score, raw
- `<time>-<label>.md`: the tables for RESULTS.md
- `<time>-<label>-review.md`: every reply with a blank verdict, for the manual review. Created once and then yours to edit

Commit before a real run: the report records the commit, and warns when there are uncommitted changes.

## API Usage

### Create Support Ticket

**Endpoint:** `POST /support-request`

**Request:**
```json
{
  "content": "I'm having trouble logging into my account"
}
```

**Responses:**

| Status | When | Body |
|---|---|---|
| `202` | The ticket is stored and queued | `{ "message": "new ticket has been created for this request", "ticketId": "<uuid>" }` |
| `400` | The body isn't a JSON object with a non-empty `content` string | `{ "message": "<reason>" }` |
| `500` | Something failed on our side | `{ "message": "some error happened" }` |

### Fetch Support Ticket

**Endpoint:** `GET /support-request?ticketId=<ticket-id>`

**Responses:**

| Status | When | Body |
|---|---|---|
| `200` | The ticket exists | `{ "ticketId": "<uuid>", "status": "RECEIVED" \| "PROCESSED" \| "FAILED", "response"?: "<reply>" }` |
| `400` | `ticketId` is missing or isn't a UUID | `{ "message": "<reason>" }` |
| `404` | No ticket with that id | `{ "message": "ticket not found" }` |

`response` is present only when `status` is `PROCESSED`. Keep polling while it's `RECEIVED`; `FAILED` means the ticket couldn't be answered automatically.

## Monitoring and Observability

### CloudWatch Logs

The processor writes structured JSON logs with [Powertools for AWS Lambda](https://docs.powertools.aws.dev/lambda/typescript/latest/core/logger/) to its own log group, `/{StackName}/processor` (30-day retention). Logs hold ids, sizes and outcomes, never ticket content or model replies.

| `message` | Level | Meaning |
|---|---|---|
| `TicketProcessed` | INFO | Triaged, saved and the support team notified (`urgency`, `durationMs`) |
| `RecordRetried` | WARN | A transient error; SQS retries the message, then sends it to the DLQ |
| `TicketFailed` | ERROR | A permanent error; the ticket is marked `FAILED` with the reason |
| `PoisonedMessage` | ERROR | A message that isn't a readable ticket; dropped |
| `TicketNotFound` | ERROR | A message for a ticket that isn't in the table; dropped |
| `DuplicateMessage` | INFO | SQS delivered a ticket that was already handled; nothing done again |

One line per message, for how it ended: nothing else is logged. The level is set by `POWERTOOLS_LOG_LEVEL` in `template.yaml`.

### CloudWatch Metrics and Alarms

- **Metric** `TriageDesk / ProcessorErrors`: a metric filter counts the processor's `ERROR` lines.
- **Alarm** `{StackName}-ProcessorErrors`: fires on 1 or more in 5 minutes, since each one is a ticket that needs a person. It notifies the alert topic (output `AlertTopicArn`). Missing data counts as OK.

## Cleanup

Delete the deployed stack:

```bash
sam delete --stack-name triage-desk
```

## Future Work

**API Authentication & Authorization**
- Add API Gateway authorizer (AWS Cognito or Lambda authorizer) to secure endpoints
- Extract customer ID from authenticated user context instead of placeholder values
- Implement API key management for service-to-service communication

**Enhanced Testing & Quality Assurance**
- Create comprehensive unit tests for all Lambda functions with Jest
- Add integration tests for end-to-end flow validation
- Set up CI/CD pipeline with automated testing and deployment

**Advanced Error Handling & Retry Logic**
- Implement retry logic with exponential backoff for transient failures (Bedrock API, DynamoDB throttling)

**Additional Monitoring & Observability**
- Add custom CloudWatch metrics for ticket processing success rates and latency
- Set up alarms for DLQ message count and Lambda function errors
- Enable AWS X-Ray for distributed tracing across all services

**Feature Enhancements**
- Add support for ticket attachments and file uploads
- Implement ticket status updates and webhook notifications
- Add support for multiple languages in ticket processing
