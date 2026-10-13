import { isGroupJid, phoneFromJid } from '../../../../src/common/whatsapp/jid.js';

describe('whatsapp jid helpers', () => {
  describe('phoneFromJid', () => {
    it('extracts the phone from an individual JID', () => {
      expect(phoneFromJid('559984057083@s.whatsapp.net')).toBe('559984057083');
      expect(phoneFromJid('5511911111111@c.us')).toBe('5511911111111');
    });

    it('drops the device suffix from a JID', () => {
      expect(phoneFromJid('5511911111111:12@s.whatsapp.net')).toBe('5511911111111');
    });

    it('rejects groups, broadcasts, newsletters, bots and LIDs', () => {
      expect(phoneFromJid('120363000000000000@g.us')).toBeNull();
      expect(phoneFromJid('status@broadcast')).toBeNull();
      expect(phoneFromJid('120363410064967646@newsletter')).toBeNull();
      expect(phoneFromJid('867051314767696@bot')).toBeNull();
      expect(phoneFromJid('75209205874877@lid')).toBeNull();
    });

    it('rejects malformed identifiers', () => {
      expect(phoneFromJid('')).toBeNull();
      expect(phoneFromJid('5511911111111')).toBeNull();
      expect(phoneFromJid('@s.whatsapp.net')).toBeNull();
      expect(phoneFromJid('123456@s.whatsapp.net')).toBeNull();
      expect(phoneFromJid('1234567890123456789@s.whatsapp.net')).toBeNull();
    });
  });

  describe('isGroupJid', () => {
    it('detects group JIDs', () => {
      expect(isGroupJid('120363000000000000@g.us')).toBe(true);
      expect(isGroupJid('559984057083@s.whatsapp.net')).toBe(false);
    });
  });
});
