// Decides whether a failed ticket is worth retrying.
//   transient: may succeed later, so the processor throws and SQS retries (then the DLQ)
//   permanent: fails the same way every time, so the ticket is marked FAILED and not retried
export type ErrorKind = 'transient' | 'permanent';

// Our own failures that retrying can't fix: a message body that isn't JSON,
// or a model answer we can't parse.
export class PermanentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PermanentError';
    }
}

// Bedrock errors where the same request fails the same way until a person fixes something.
const PERMANENT_BEDROCK_ERRORS = new Set([
    'ValidationException', // bad model id or request body
    'AccessDeniedException', // missing IAM permission or model access
    'ResourceNotFoundException', // model doesn't exist in this region
    'ServiceQuotaExceededException', // over an account quota, needs a quota increase
]);

// Anything not listed is transient: an unknown error gets its retries and lands in the
// DLQ, where an alarm makes it visible, rather than being marked FAILED unnoticed.
export function classifyError(err: unknown): ErrorKind {
    if (err instanceof PermanentError) {
        return 'permanent';
    }
    const name = (err as { name?: unknown } | null)?.name;
    return typeof name === 'string' && PERMANENT_BEDROCK_ERRORS.has(name) ? 'permanent' : 'transient';
}
