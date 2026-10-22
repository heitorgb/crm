// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storePasswordCredential } from './password-credentials';

class FakePasswordCredential {
  readonly id: string;
  readonly name?: string;
  readonly password: string;
  readonly type = 'password';

  constructor(data: { id: string; password: string; name?: string }) {
    this.id = data.id;
    this.name = data.name;
    this.password = data.password;
  }
}

const store = vi.fn<(credential: unknown) => Promise<void>>();
const credentialsDescriptor = Object.getOwnPropertyDescriptor(navigator, 'credentials');

beforeEach(() => {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(window, 'PasswordCredential', {
    configurable: true,
    value: FakePasswordCredential,
  });
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { store },
  });
  store.mockReset();
  store.mockResolvedValue(undefined);
});

afterEach(() => {
  Reflect.deleteProperty(window, 'PasswordCredential');
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });

  if (credentialsDescriptor) {
    Object.defineProperty(navigator, 'credentials', credentialsDescriptor);
  } else {
    Reflect.deleteProperty(navigator, 'credentials');
  }
});

describe('storePasswordCredential', () => {
  it('delegates credential storage to the browser password manager', async () => {
    await storePasswordCredential('ana@example.com', 'senha-segura');

    expect(store).toHaveBeenCalledTimes(1);
    const credential = store.mock.calls[0]?.[0] as unknown as {
      id: string;
      name?: string;
      password: string;
    };

    expect(credential.id).toBe('ana@example.com');
    expect(credential.name).toBe('ana@example.com');
    expect(credential.password).toBe('senha-segura');
  });

  it('does nothing when the browser does not support password credentials', async () => {
    Reflect.deleteProperty(window, 'PasswordCredential');

    await expect(storePasswordCredential('ana@example.com', 'senha-segura')).resolves.toBeUndefined();
    expect(store).not.toHaveBeenCalled();
  });

  it('ignores browsers that refuse to store the credential', async () => {
    store.mockRejectedValue(new Error('blocked'));

    await expect(storePasswordCredential('ana@example.com', 'senha-segura')).resolves.toBeUndefined();
  });
});
