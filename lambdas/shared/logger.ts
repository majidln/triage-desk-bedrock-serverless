import { Logger } from '@aws-lambda-powertools/logger';

// One structured JSON logger for the functions. The service name and level come from
// POWERTOOLS_SERVICE_NAME and POWERTOOLS_LOG_LEVEL in the template.
//
// Log ids, sizes and outcomes, never ticket content or model replies: tickets can hold
// passwords and card numbers, and logs are kept longer and read more widely than the table.
export const logger = new Logger();
