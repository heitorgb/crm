const INDIVIDUAL_DOMAINS = new Set(['s.whatsapp.net', 'c.us']);

const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15;

export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}

/**
 * Extracts a dialable phone number from an individual WhatsApp JID. Groups,
 * newsletters, broadcast lists, bots and LIDs are not phone numbers and return
 * null, as do malformed identifiers.
 */
export function phoneFromJid(jid: string): string | null {
  const separatorIndex = jid.indexOf('@');
  if (separatorIndex <= 0) {
    return null;
  }

  const domain = jid.slice(separatorIndex + 1);
  if (!INDIVIDUAL_DOMAINS.has(domain)) {
    return null;
  }

  const localPart = jid.slice(0, separatorIndex).split(':')[0];
  const digits = localPart.replace(/\D/g, '');
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) {
    return null;
  }

  return digits;
}

/**
 * Extracts a LID JID (`<digits>@lid`) from an alternative identifier. A LID is
 * not a dialable phone but it is the address WhatsApp migrated some accounts to;
 * sending to it is what actually delivers on those accounts. Any device suffix
 * (`:NN`) is dropped. Non-LID identifiers return null.
 */
export function lidFromJid(jid: string | null | undefined): string | null {
  if (!jid) {
    return null;
  }
  const separatorIndex = jid.indexOf('@');
  if (separatorIndex <= 0 || jid.slice(separatorIndex + 1) !== 'lid') {
    return null;
  }
  const digits = jid.slice(0, separatorIndex).split(':')[0].replace(/\D/g, '');
  if (digits.length === 0) {
    return null;
  }
  return `${digits}@lid`;
}
