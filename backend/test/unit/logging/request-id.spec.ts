import { normalizeRequestId } from '../../../src/common/logging/request-id.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('normalizeRequestId', () => {
  it('keeps a safe request id', () => {
    expect(normalizeRequestId('abc-123_XYZ.9')).toBe('abc-123_XYZ.9');
  });

  it('generates a uuid when the value is missing', () => {
    expect(normalizeRequestId(undefined)).toMatch(UUID_PATTERN);
    expect(normalizeRequestId(null)).toMatch(UUID_PATTERN);
  });

  it('generates a uuid when the value is not a string', () => {
    expect(normalizeRequestId(['a'])).toMatch(UUID_PATTERN);
    expect(normalizeRequestId(42)).toMatch(UUID_PATTERN);
  });

  it('rejects values with unsafe characters', () => {
    expect(normalizeRequestId('<script>alert(1)</script>')).toMatch(UUID_PATTERN);
    expect(normalizeRequestId('id with spaces')).toMatch(UUID_PATTERN);
    expect(normalizeRequestId('id\ninjected')).toMatch(UUID_PATTERN);
  });

  it('rejects values longer than 128 characters', () => {
    expect(normalizeRequestId('a'.repeat(129))).toMatch(UUID_PATTERN);
  });

  it('accepts values with exactly 128 characters', () => {
    const value = 'a'.repeat(128);

    expect(normalizeRequestId(value)).toBe(value);
  });
});
