// Everything that talks to the Bedrock Guardrail. The receiver runs each ticket through it
// before the first write, so PII is masked in every copy of a ticket from the start.
import { ApplyGuardrailCommand, BedrockRuntimeClient, GuardrailAssessment } from '@aws-sdk/client-bedrock-runtime';
import { requireEnv } from './env';

// Read once at cold start: a missing variable fails here, not on the first ticket.
const config = {
  guardrailId: requireEnv('GUARDRAIL_ID'),
  guardrailVersion: requireEnv('GUARDRAIL_VERSION'),
};

// Limits for one check. It runs while the customer waits for their 202, so a hanging call
// has to fail fast.
const GUARDRAIL_ATTEMPT_TIMEOUT_MS = 3_000;
const GUARDRAIL_MAX_ATTEMPTS = 2;

// The denied topic's name in template.yaml
const NOT_SUPPORT_TOPIC = 'NotSupport';

const bedrockClient = new BedrockRuntimeClient({
  maxAttempts: GUARDRAIL_MAX_ATTEMPTS,
  requestHandler: { requestTimeout: GUARDRAIL_ATTEMPT_TIMEOUT_MS },
});

export enum TicketFlag {
  PROMPT_ATTACK = 'PROMPT_ATTACK',
  NOT_SUPPORT = 'NOT_SUPPORT',
}

export interface TicketCheck {
  content: string; // Masked: the only version of the ticket that may be stored or sent on
  flags: TicketFlag[];
  piiTypes: string[]; // The kinds of PII masked, never the values
  version: string; // The guardrail version that checked it
}

// Checks one ticket. Errors are thrown as they are: without a check there is no masked text,
// so the caller must refuse the ticket rather than store the original.
export async function checkTicket(content: string): Promise<TicketCheck> {
  const response = await bedrockClient.send(
    new ApplyGuardrailCommand({
      guardrailIdentifier: config.guardrailId,
      guardrailVersion: config.guardrailVersion,
      source: 'INPUT',
      content: [{ text: { text: content } }],
    }),
  );

  // Don't log these assessments: each PII finding's `match` holds the raw card number or password.
  const assessments = response.assessments ?? [];
  const piiTypes = detectedPiiTypes(assessments);
  const masked = response.outputs?.[0]?.text;
  if (piiTypes.length > 0 && masked === undefined) {
    throw new Error('Guardrail found PII but returned no masked text');
  }
  return {
    content: masked ?? content,
    flags: detectedFlags(assessments),
    piiTypes,
    version: config.guardrailVersion,
  };
}

function detectedFlags(assessments: GuardrailAssessment[]): TicketFlag[] {
  const flags: TicketFlag[] = [];
  const filters = assessments.flatMap((a) => a.contentPolicy?.filters ?? []);
  if (filters.some((f) => f.type === 'PROMPT_ATTACK' && f.detected)) {
    flags.push(TicketFlag.PROMPT_ATTACK);
  }
  const topics = assessments.flatMap((a) => a.topicPolicy?.topics ?? []);
  if (topics.some((t) => t.name === NOT_SUPPORT_TOPIC && t.detected)) {
    flags.push(TicketFlag.NOT_SUPPORT);
  }
  return flags;
}

function detectedPiiTypes(assessments: GuardrailAssessment[]): string[] {
  const entities = assessments.flatMap((a) => a.sensitiveInformationPolicy?.piiEntities ?? []);
  return [...new Set(entities.filter((e) => e.detected).map((e) => String(e.type)))];
}
