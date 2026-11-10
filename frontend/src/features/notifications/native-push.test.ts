import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiRequest }));

import {
  isNativePushAvailable,
  registerPushDevice,
  safeNotificationPath,
  unregisterPushDevice,
} from './native-push';

describe('native push', () => {
  beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockResolvedValue(undefined);
  });

  it('is unavailable in the web build', () => {
    expect(isNativePushAvailable()).toBe(false);
  });

  it('does not call the API on logout when no device was registered', async () => {
    await unregisterPushDevice();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('registers the token and unregisters it once on logout', async () => {
    await registerPushDevice('fcm-token');
    expect(apiRequest).toHaveBeenCalledWith('/push-devices', {
      method: 'POST',
      body: { token: 'fcm-token', platform: 'android' },
    });

    await unregisterPushDevice();
    await unregisterPushDevice();

    expect(apiRequest).toHaveBeenCalledWith('/push-devices', {
      method: 'DELETE',
      body: { token: 'fcm-token' },
    });
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it('never fails logout when unregistering fails', async () => {
    await registerPushDevice('fcm-token');
    apiRequest.mockRejectedValueOnce(new Error('offline'));

    await expect(unregisterPushDevice()).resolves.toBeUndefined();
  });

  it('only accepts in-app paths from notification data', () => {
    expect(safeNotificationPath('/atendimento/conversas?conversation=1')).toBe(
      '/atendimento/conversas?conversation=1',
    );
    expect(safeNotificationPath('https://evil.example')).toBeNull();
    expect(safeNotificationPath('//evil.example')).toBeNull();
    expect(safeNotificationPath(42)).toBeNull();
  });
});
