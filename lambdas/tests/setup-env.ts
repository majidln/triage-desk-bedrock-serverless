// The environment the template gives the functions, so handlers can load in unit tests.
process.env.SUPPORT_TICKETS_TABLE = 'test-tickets-table';
process.env.SNS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:test-topic';
process.env.BEDROCK_MODEL_ID = 'amazon.nova-lite-v1:0';

// Keep Powertools' JSON lines out of the test output; tests that check logs spy on the logger.
process.env.POWERTOOLS_LOG_LEVEL = 'SILENT';
