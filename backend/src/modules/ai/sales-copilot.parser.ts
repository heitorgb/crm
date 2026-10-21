import { z } from 'zod';
import {
  AiSalesInvalidResponseError,
  AiSalesReplyInvalidResponseError,
} from './ai.errors.js';
import type { SalesAnalysisPayload } from './sales-copilot.models.js';

const listText = z
  .array(z.string())
  .max(40)
  .transform((items) =>
    items
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, 20)
      .map((item) => item.slice(0, 500)),
  );

const updateFieldSchema = z.enum([
  'NEED',
  'PRODUCT',
  'BUDGET',
  'DEADLINE',
  'USERS',
  'REQUIREMENTS',
  'OBJECTION',
  'STAGE',
  'LOSS_REASON',
  'NOTES',
]);

const analysisSchema = z.object({
  summary: z.string().trim().min(1).max(4_000),
  objective: z.string().trim().min(1).max(2_000),
  need: z.string().trim().min(1).max(2_000),
  knownInformation: listText,
  hypotheses: listText,
  pendingInformation: listText,
  nextQuestion: z.string().trim().min(1).max(1_000),
  suggestedReply: z.string().trim().min(1).max(4_000),
  rationale: z.string().trim().min(1).max(2_000),
  nextAction: z.object({
    action: z.string().trim().min(1).max(500),
    reason: z.string().trim().min(1).max(2_000),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    expectedOutcome: z.string().trim().min(1).max(1_000),
    missingInformation: listText,
    suggestedDueAt: z.string().trim().max(64).nullable(),
    suggestedMessage: z.string().trim().max(4_000).nullable(),
  }),
  leadUpdateSuggestions: z
    .array(
      z.object({
        field: updateFieldSchema,
        proposedValue: z.string().trim().min(1).max(2_000),
        evidence: z.string().trim().min(1).max(2_000),
      }),
    )
    .max(8),
});

export function parseSalesAnalysis(raw: string): SalesAnalysisPayload {
  const json = extractJsonObject(raw);
  if (!json) {
    throw new AiSalesInvalidResponseError();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new AiSalesInvalidResponseError();
  }

  const parsed = analysisSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AiSalesInvalidResponseError();
  }

  return parsed.data;
}

export function parseSalesReply(raw: string): string {
  const text = stripCodeFence(raw).trim();
  if (text.length === 0 || text.length > 4_000) {
    throw new AiSalesReplyInvalidResponseError();
  }
  return text;
}

function extractJsonObject(raw: string): string | null {
  const text = stripCodeFence(raw).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function stripCodeFence(raw: string): string {
  const text = raw.trim();
  if (text.startsWith('```') && text.endsWith('```')) {
    return text.replace(/^```[a-zA-Z0-9_-]*\s*/, '').replace(/\s*```$/, '');
  }
  return text;
}
