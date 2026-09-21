import { PasswordService } from '../../../src/modules/auth/password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes a password with argon2id and never stores it in plain text', async () => {
    const plain = 's3cret-password';
    const passwordHash = await service.hash(plain);

    expect(passwordHash).not.toContain(plain);
    expect(passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies the correct password and rejects a wrong one', async () => {
    const passwordHash = await service.hash('s3cret-password');

    await expect(service.verify(passwordHash, 's3cret-password')).resolves.toBe(true);
    await expect(service.verify(passwordHash, 'wrong-password')).resolves.toBe(false);
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    await expect(service.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });
});
