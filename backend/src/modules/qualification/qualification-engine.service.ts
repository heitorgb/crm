import { Inject, Injectable } from '@nestjs/common';
import type { DataSensitivityLevel } from '@prisma/client';
import { AiProviderUnavailableError } from './ai/ai.errors.js';
import { AI_PROVIDER } from './ai/ai-provider.types.js';
import type { AiConversationEntry, AiProfileConfig, AiProvider } from './ai/ai-provider.types.js';

export interface EngineAsk {
  action: 'ASK';
  question: string;
  collectedData: Record<string, unknown>;
  missingInformation: string[];
}

export interface EngineComplete {
  action: 'COMPLETE';
  outcome: 'QUALIFIED' | 'DISQUALIFIED';
  score: number;
  qualificationLevel: string;
  summary: string;
  strengths: string[];
  risks: string[];
  missingInformation: string[];
  recommendedNextStep: string | null;
  qualificationReasons: string[];
  collectedData: Record<string, unknown>;
}

export interface EngineNeedsHuman {
  action: 'NEEDS_HUMAN';
  reason: string;
  collectedData: Record<string, unknown>;
  missingInformation: string[];
}

export type EngineDecision = EngineAsk | EngineComplete | EngineNeedsHuman;

export interface EngineEvaluateInput {
  profile: AiProfileConfig;
  dataSensitivityLevel: DataSensitivityLevel;
  collectedData: Record<string, unknown>;
  transcript: AiConversationEntry[];
  lastLeadMessage?: string;
}

interface ParsedAsk {
  action: 'ASK';
  question: string;
  collectedData: Record<string, unknown>;
}

interface ParsedComplete {
  action: 'COMPLETE';
  outcome: 'QUALIFIED' | 'DISQUALIFIED';
  score: number;
  qualificationLevel: string;
  summary: string;
  strengths: string[];
  risks: string[];
  missingInformation: string[];
  recommendedNextStep: string | null;
  qualificationReasons: string[];
  collectedData: Record<string, unknown>;
}

interface ParsedNeedsHuman {
  action: 'NEEDS_HUMAN';
  reason: string;
  collectedData: Record<string, unknown>;
}

type ParsedEvaluation = ParsedAsk | ParsedComplete | ParsedNeedsHuman;

const HUMAN_REQUEST_TERMS = [
  'humano',
  'atendente',
  'pessoa real',
  'falar com alguém',
  'falar com alguem',
  'supervisor',
  'gerente',
];

const SENSITIVE_DATA_TERMS = [
  'saúde',
  'saude',
  'doença',
  'doenca',
  'diagnóstico',
  'diagnostico',
  'religião',
  'religiao',
  'raça',
  'raca',
  'etnia',
  'política',
  'politica',
  'orientação sexual',
  'orientacao sexual',
  'biometria',
  'biométrico',
  'biometrico',
  'genético',
  'genetico',
];

@Injectable()
export class QualificationEngineService {
  constructor(@Inject(AI_PROVIDER) private readonly ai: AiProvider) {}

  async evaluate(input: EngineEvaluateInput): Promise<EngineDecision> {
    const requiredItems = input.profile.requiredInformation;
    const allowedKeys = requiredItems.map((item) => item.key);
    const mandatoryItems = requiredItems.filter((item) => item.required !== false);

    if (input.lastLeadMessage && containsAny(input.lastLeadMessage, HUMAN_REQUEST_TERMS)) {
      return needsHuman('lead_requested_human', input, allowedKeys);
    }

    if (input.lastLeadMessage && containsAny(input.lastLeadMessage, SENSITIVE_DATA_TERMS)) {
      return needsHuman('sensitive_data_mentioned', input, allowedKeys);
    }

    let raw: unknown;
    try {
      raw = await this.ai.evaluate({
        profile: input.profile,
        collectedData: input.collectedData,
        missingInformation: computeMissing(allowedKeys, input.collectedData),
        transcript: input.transcript,
        lastLeadMessage: input.lastLeadMessage,
      });
    } catch (error) {
      const reason =
        error instanceof AiProviderUnavailableError ? 'provider_unavailable' : 'provider_error';
      return needsHuman(reason, input, allowedKeys);
    }

    const parsed = parseEvaluation(raw);
    if (!parsed) {
      return needsHuman('invalid_ai_response', input, allowedKeys);
    }

    const collectedData = mergeCollected(input.collectedData, parsed.collectedData, allowedKeys);
    const missingInformation = computeMissing(allowedKeys, collectedData);

    if (parsed.action === 'NEEDS_HUMAN') {
      return { action: 'NEEDS_HUMAN', reason: parsed.reason, collectedData, missingInformation };
    }

    if (parsed.action === 'ASK') {
      return { action: 'ASK', question: parsed.question, collectedData, missingInformation };
    }

    const missingMandatory = mandatoryItems.filter((item) => !(item.key in collectedData));
    if (missingMandatory.length > 0) {
      const next = missingMandatory[0];
      return {
        action: 'ASK',
        question: `Você pode informar: ${next.label}?`,
        collectedData,
        missingInformation,
      };
    }

    const levelKeys = input.profile.qualificationLevels.map((level) => level.key);
    if (levelKeys.length > 0 && !levelKeys.includes(parsed.qualificationLevel)) {
      return needsHuman('invalid_qualification_level', input, allowedKeys);
    }

    if (!Number.isInteger(parsed.score) || parsed.score < 0 || parsed.score > 100) {
      return needsHuman('invalid_score', input, allowedKeys);
    }

    if (parsed.outcome === 'DISQUALIFIED' && parsed.qualificationReasons.length === 0) {
      return needsHuman('missing_disqualification_reason', input, allowedKeys);
    }

    if (parsed.outcome === 'DISQUALIFIED' && input.dataSensitivityLevel === 'high') {
      return needsHuman('high_sensitivity_requires_human', input, allowedKeys);
    }

    return {
      action: 'COMPLETE',
      outcome: parsed.outcome,
      score: parsed.score,
      qualificationLevel: parsed.qualificationLevel,
      summary: parsed.summary,
      strengths: parsed.strengths,
      risks: parsed.risks,
      missingInformation,
      recommendedNextStep: parsed.recommendedNextStep,
      qualificationReasons: parsed.qualificationReasons,
      collectedData,
    };
  }
}

function needsHuman(
  reason: string,
  input: EngineEvaluateInput,
  allowedKeys: string[],
): EngineNeedsHuman {
  const collectedData = filterAllowed(input.collectedData, allowedKeys);
  return {
    action: 'NEEDS_HUMAN',
    reason,
    collectedData,
    missingInformation: computeMissing(allowedKeys, collectedData),
  };
}

function parseEvaluation(raw: unknown): ParsedEvaluation | null {
  if (!isRecord(raw)) {
    return null;
  }

  const action = raw.action;

  if (action === 'ASK') {
    if (typeof raw.question !== 'string' || raw.question.trim().length === 0) {
      return null;
    }
    return { action: 'ASK', question: raw.question.trim(), collectedData: asRecord(raw.collectedData) };
  }

  if (action === 'NEEDS_HUMAN') {
    if (typeof raw.reason !== 'string' || raw.reason.trim().length === 0) {
      return null;
    }
    return {
      action: 'NEEDS_HUMAN',
      reason: raw.reason.trim(),
      collectedData: asRecord(raw.collectedData),
    };
  }

  if (action === 'COMPLETE') {
    const outcome =
      raw.outcome === 'QUALIFIED' || raw.outcome === 'DISQUALIFIED' ? raw.outcome : null;
    if (
      !outcome ||
      typeof raw.score !== 'number' ||
      typeof raw.qualificationLevel !== 'string' ||
      raw.qualificationLevel.trim().length === 0 ||
      typeof raw.summary !== 'string' ||
      raw.summary.trim().length === 0
    ) {
      return null;
    }

    return {
      action: 'COMPLETE',
      outcome,
      score: raw.score,
      qualificationLevel: raw.qualificationLevel.trim(),
      summary: raw.summary.trim(),
      strengths: asStringArray(raw.strengths),
      risks: asStringArray(raw.risks),
      missingInformation: asStringArray(raw.missingInformation),
      recommendedNextStep:
        typeof raw.recommendedNextStep === 'string' ? raw.recommendedNextStep : null,
      qualificationReasons: asStringArray(raw.qualificationReasons),
      collectedData: asRecord(raw.collectedData),
    };
  }

  return null;
}

function mergeCollected(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
  allowedKeys: string[],
): Record<string, unknown> {
  const result = filterAllowed(base, allowedKeys);

  for (const [key, value] of Object.entries(incoming)) {
    if (!allowedKeys.includes(key)) {
      continue;
    }
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    } else if (typeof value === 'string' && value.trim().length > 0) {
      result[key] = value.trim();
    }
  }

  return result;
}

function filterAllowed(
  data: Record<string, unknown>,
  allowedKeys: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (key in data) {
      result[key] = data[key];
    }
  }
  return result;
}

function computeMissing(requiredKeys: string[], collected: Record<string, unknown>): string[] {
  return requiredKeys.filter((key) => !(key in collected));
}

function containsAny(text: string, terms: string[]): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}
