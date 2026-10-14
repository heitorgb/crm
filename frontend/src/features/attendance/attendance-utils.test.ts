import { describe, expect, it } from 'vitest';
import type { ConversationMessage } from '@/types/attendance';
import { areGrouped } from './attendance-utils';

const WINDOW_MS = 5 * 60 * 1000;
const BASE = new Date('2026-10-14T12:00:00.000Z');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function at(offsetMs: number): string {
  return new Date(BASE.getTime() + offsetMs).toISOString();
}

let sequence = 0;

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  sequence += 1;
  return {
    id: `msg-${sequence}`,
    conversationId: 'conv-1',
    direction: 'INBOUND',
    type: 'TEXT',
    content: 'oi',
    externalMessageId: null,
    status: 'RECEIVED',
    senderId: null,
    senderName: null,
    metadata: null,
    occurredAt: BASE.toISOString(),
    createdAt: BASE.toISOString(),
    attachments: [],
    ...overrides,
  };
}

describe('areGrouped', () => {
  it('groups two consecutive messages from the same participant in a group', () => {
    const first = message({ senderId: 'ana@s.whatsapp.net', senderName: 'Ana', occurredAt: at(0) });
    const second = message({
      senderId: 'ana@s.whatsapp.net',
      senderName: 'Ana',
      occurredAt: at(2_000),
    });

    expect(areGrouped(first, second, true)).toBe(true);
  });

  it('does not group messages from different participants in a group', () => {
    const ana = message({ senderId: 'ana@s.whatsapp.net', occurredAt: at(0) });
    const bruno = message({ senderId: 'bruno@s.whatsapp.net', occurredAt: at(1_000) });

    expect(areGrouped(ana, bruno, true)).toBe(false);
  });

  it('does not group unidentified group messages into the same block', () => {
    const first = message({ senderId: null, senderName: null, occurredAt: at(0) });
    const second = message({ senderId: null, senderName: null, occurredAt: at(1_000) });

    expect(areGrouped(first, second, true)).toBe(false);
  });

  it('falls back to the sender name when the identifier is missing', () => {
    const ana1 = message({ senderId: null, senderName: 'Ana', occurredAt: at(0) });
    const ana2 = message({ senderId: null, senderName: 'Ana', occurredAt: at(1_000) });
    const bruno = message({ senderId: null, senderName: 'Bruno', occurredAt: at(2_000) });

    expect(areGrouped(ana1, ana2, true)).toBe(true);
    expect(areGrouped(ana1, bruno, true)).toBe(false);
  });

  it('groups incoming messages of a one-to-one conversation with no participant id', () => {
    const first = message({ direction: 'INBOUND', senderId: null, occurredAt: at(0) });
    const second = message({ direction: 'INBOUND', senderId: null, occurredAt: at(1_000) });

    expect(areGrouped(first, second, false)).toBe(true);
  });

  it('does not group an incoming message followed by an outgoing one', () => {
    const inbound = message({ direction: 'INBOUND', senderId: 'contact', occurredAt: at(0) });
    const outbound = message({ direction: 'OUTBOUND', senderId: 'agent-1', occurredAt: at(1_000) });

    expect(areGrouped(inbound, outbound, false)).toBe(false);
    expect(areGrouped(outbound, inbound, false)).toBe(false);
  });

  it('groups outgoing messages from the same agent and splits different agents', () => {
    const first = message({ direction: 'OUTBOUND', senderId: 'agent-1', occurredAt: at(0) });
    const same = message({ direction: 'OUTBOUND', senderId: 'agent-1', occurredAt: at(1_000) });
    const other = message({ direction: 'OUTBOUND', senderId: 'agent-2', occurredAt: at(2_000) });

    expect(areGrouped(first, same, true)).toBe(true);
    expect(areGrouped(first, other, true)).toBe(false);
  });

  it('keeps messages within the time window grouped and splits beyond it', () => {
    const first = message({ senderId: 'ana', occurredAt: at(0) });
    const inside = message({ senderId: 'ana', occurredAt: at(WINDOW_MS) });
    const outside = message({ senderId: 'ana', occurredAt: at(WINDOW_MS + 1) });

    expect(areGrouped(first, inside, true)).toBe(true);
    expect(areGrouped(first, outside, true)).toBe(false);
  });

  it('does not group messages across different days', () => {
    const first = message({ senderId: 'ana', occurredAt: at(0) });
    const nextDay = message({ senderId: 'ana', occurredAt: at(ONE_DAY_MS) });

    expect(areGrouped(first, nextDay, true)).toBe(false);
  });

  it('never groups reactions', () => {
    const text = message({ senderId: 'ana', occurredAt: at(0) });
    const reaction = message({ senderId: 'ana', type: 'REACTION', occurredAt: at(1_000) });

    expect(areGrouped(text, reaction, true)).toBe(false);
    expect(areGrouped(reaction, text, true)).toBe(false);
  });

  it('groups consecutive media and text from the same participant', () => {
    const text = message({ senderId: 'ana', type: 'TEXT', occurredAt: at(0) });
    const image = message({ senderId: 'ana', type: 'IMAGE', occurredAt: at(1_000) });

    expect(areGrouped(text, image, true)).toBe(true);
  });

  it('returns false when either side of the boundary is missing', () => {
    const only = message({ senderId: 'ana' });

    expect(areGrouped(undefined, only, true)).toBe(false);
    expect(areGrouped(only, undefined, true)).toBe(false);
  });
});
