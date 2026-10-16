export type DestinationType = 'PN' | 'LID' | 'GROUP';

export interface DestinationInput {
  externalContactId: string | null;
  externalLid: string | null;
  contactPhone: string | null;
}

export interface Destination {
  type: DestinationType;
  address: string;
}

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function isPnJid(value: string): boolean {
  return value.endsWith('@s.whatsapp.net') || value.endsWith('@c.us');
}

/**
 * Candidate send addresses for a 1:1 conversation. The dialable phone (PN) may
 * live in `externalContactId` (when the conversation is PN-addressed) or in the
 * contact phone (when it is LID-addressed); the LID comes from `externalLid` or
 * from a LID-addressed conversation.
 */
export function destinationCandidates(input: DestinationInput): {
  pn: string | null;
  lid: string | null;
} {
  const value = input.externalContactId ?? '';
  const pn = isPnJid(value)
    ? digits(value)
    : input.contactPhone
      ? digits(input.contactPhone)
      : '';
  const lid = input.externalLid ?? (value.endsWith('@lid') ? value : null);
  return { pn: pn || null, lid: lid || null };
}

/**
 * Picks the address to send to. WhatsApp migrated some accounts to LID
 * addressing, but which address a given account accepts for outbound depends on
 * the account, not on the inbound addressing mode. The learned `preferred`
 * address wins; otherwise the LID (the migrated default) is used, falling back to
 * the dialable phone. Groups keep their JID.
 */
export function pickDestination(
  input: DestinationInput,
  preferred: string | null,
): Destination | null {
  const value = input.externalContactId ?? '';
  if (value.endsWith('@g.us')) {
    return { type: 'GROUP', address: value };
  }

  const { pn, lid } = destinationCandidates(input);
  if (preferred === 'PN' && pn) {
    return { type: 'PN', address: pn };
  }
  if (preferred === 'LID' && lid) {
    return { type: 'LID', address: lid };
  }
  if (lid) {
    return { type: 'LID', address: lid };
  }
  if (pn) {
    return { type: 'PN', address: pn };
  }
  return null;
}

/** The other candidate address, used as a one-shot fallback after a provider ERROR. */
export function alternateDestination(
  input: DestinationInput,
  current: DestinationType,
): Destination | null {
  if (current === 'GROUP') {
    return null;
  }
  const { pn, lid } = destinationCandidates(input);
  if (current === 'LID') {
    return pn ? { type: 'PN', address: pn } : null;
  }
  return lid ? { type: 'LID', address: lid } : null;
}
