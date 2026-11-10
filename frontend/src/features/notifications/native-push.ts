import { Capacitor } from '@capacitor/core';
import { apiRequest } from '@/lib/api-client';

export const PUSH_CHANNEL_ID = 'messages';

let registeredToken: string | null = null;

/**
 * True only inside an app build that ships the native push plugin, so the web
 * version (and older app builds loading the new site) never touch it.
 */
export function isNativePushAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('PushNotifications');
}

export async function registerPushDevice(token: string): Promise<void> {
  await apiRequest<void>('/push-devices', {
    method: 'POST',
    body: { token, platform: 'android' },
  });
  registeredToken = token;
}

/** Best-effort: logout must never be blocked by a failed unregister. */
export async function unregisterPushDevice(): Promise<void> {
  const token = registeredToken;
  if (!token) {
    return;
  }
  registeredToken = null;
  try {
    await apiRequest<void>('/push-devices', { method: 'DELETE', body: { token } });
  } catch {
    return;
  }
}

export function safeNotificationPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return null;
  }
  return value;
}
