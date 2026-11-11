import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PushNotifications } from '@capacitor/push-notifications';
import { useAuthStore } from '@/stores/auth-store';
import {
  isNativePushAvailable,
  PUSH_CHANNEL_ID,
  registerPushDevice,
  safeNotificationPath,
} from './native-push';

/**
 * Inside the Android app, asks for notification permission, registers the
 * device for the signed-in membership and opens the conversation when a
 * notification is tapped. Re-runs on organization switch so the device follows
 * the active membership.
 */
export function useNativePush(): void {
  const navigate = useNavigate();
  const membershipId = useAuthStore((state) => state.session?.membershipId ?? null);

  useEffect(() => {
    if (!membershipId || !isNativePushAvailable()) {
      return;
    }

    let cancelled = false;

    const setup = async (): Promise<void> => {
      await PushNotifications.removeAllListeners();
      if (cancelled) {
        return;
      }

      await PushNotifications.addListener('registration', ({ value }) => {
        void registerPushDevice(value).catch(() => undefined);
      });
      await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
        const path = safeNotificationPath(notification.data?.path);
        if (path) {
          navigate(path);
        }
      });

      await PushNotifications.createChannel({
        id: PUSH_CHANNEL_ID,
        name: 'Mensagens',
        description: 'Novas mensagens do atendimento',
        importance: 4,
        visibility: 0,
      });

      let permission = await PushNotifications.checkPermissions();
      if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
        permission = await PushNotifications.requestPermissions();
      }
      if (!cancelled && permission.receive === 'granted') {
        await PushNotifications.register();
      }
    };

    void setup().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [membershipId, navigate]);
}
