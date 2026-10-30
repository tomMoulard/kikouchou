/**
 * @fileoverview Trip reminders in the store apps: an APNs or FCM device token.
 *
 * A store app's web view has no `PushManager` and no service worker, so the
 * Web Push path in `lib/notifications/push` cannot run there. The operating
 * system's own push service takes its place: Apple Push Notification service
 * on iOS, Firebase Cloud Messaging on Android. `@capacitor/push-notifications`
 * asks for the permission and hands back a device token, which the server
 * stores in the same `push_subscriptions` row a browser endpoint lives in, with
 * `transport` saying which sender to use (`server/share-preview/src/native_push.rs`).
 *
 * The F-Droid build carries no Firebase, and so no plugin: there
 * {@link isNativePushAvailable} is false and the reminder card stays hidden.
 *
 * @module lib/notifications/native-push
 */

import { PushNotifications } from '@capacitor/push-notifications';

import { getAppPlatform, hasNativePlugin } from '@/lib/platform';

// ============================================================================
// Type Definitions
// ============================================================================

/** Which push service a device token belongs to. */
export type NativePushTransport = 'apns' | 'fcm';

/** What the server stores for a store app, in place of a browser subscription. */
export interface NativePushSubscription {
  readonly transport: NativePushTransport;
  readonly token: string;
}

export type NativePushRegistration =
  | { readonly status: 'registered'; readonly subscription: NativePushSubscription }
  | { readonly status: 'blocked' }
  | { readonly status: 'dismissed' }
  | { readonly status: 'unsupported' }
  | { readonly status: 'error'; readonly message: string };

/** The fields a reminder carries on its `data`, from `native_push.rs`. */
export interface NativeNotificationOpen {
  readonly kind: string;
  readonly url: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * The Android notification channel reminders are posted to. Android 8 and
 * later require one, and the user can silence it without silencing the app.
 * The server names it on every FCM message.
 */
export const REMINDER_CHANNEL_ID = 'trip-reminders';

/** How long to wait for the operating system to hand back a token. */
const REGISTRATION_TIMEOUT_MS = 15_000;

// ============================================================================
// Capability
// ============================================================================

/** Whether this build can receive a push through the operating system. */
export function isNativePushAvailable(): boolean {
  return hasNativePlugin('PushNotifications');
}

/** The push service this platform's tokens belong to. */
export function nativePushTransport(): NativePushTransport {
  return getAppPlatform() === 'ios' ? 'apns' : 'fcm';
}

// ============================================================================
// Registration
// ============================================================================

/** Waits for the token the next `register()` produces. */
function nextToken(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const handles: { remove: () => Promise<void> }[] = [];
    const cleanUp = (): void => {
      clearTimeout(timer);
      for (const handle of handles) {
        void handle.remove();
      }
    };
    const timer = setTimeout(() => {
      cleanUp();
      reject(new Error('push registration timed out'));
    }, REGISTRATION_TIMEOUT_MS);

    void PushNotifications.addListener('registration', (token) => {
      cleanUp();
      resolve(token.value);
    }).then((handle) => handles.push(handle));
    void PushNotifications.addListener('registrationError', (error) => {
      cleanUp();
      reject(new Error(error.error));
    }).then((handle) => handles.push(handle));
  });
}

/**
 * Asks for permission and registers this device with its push service.
 *
 * Call from a click, like the web path: an unprompted permission dialog is how
 * notifications get refused forever.
 *
 * @param channelName - The reminder channel's name, already translated (Android)
 */
export async function registerNativePush(channelName: string): Promise<NativePushRegistration> {
  if (!isNativePushAvailable()) {
    return { status: 'unsupported' };
  }
  try {
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await PushNotifications.requestPermissions();
    }
    if (permission.receive === 'denied') {
      return { status: 'blocked' };
    }
    if (permission.receive !== 'granted') {
      return { status: 'dismissed' };
    }

    if (getAppPlatform() === 'android') {
      await PushNotifications.createChannel({
        id: REMINDER_CHANNEL_ID,
        name: channelName,
        importance: 4,
        visibility: 0,
      });
    }

    const token = nextToken();
    await PushNotifications.register();
    return {
      status: 'registered',
      subscription: { transport: nativePushTransport(), token: await token },
    };
  } catch (error: unknown) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'push registration failed',
    };
  }
}

/**
 * Forgets this device's token with its push service. The server row is what
 * stops the reminders; this is tidy-up.
 */
export async function unregisterNativePush(): Promise<void> {
  if (!isNativePushAvailable()) {
    return;
  }
  try {
    await PushNotifications.unregister();
  } catch {
    // Nothing to do.
  }
}

// ============================================================================
// Clicks
// ============================================================================

/**
 * Subscribes to taps on a reminder. The server puts the reminder's `kind` and
 * the path to open on the notification's `data`, as the web payload does.
 *
 * @returns The unsubscribe function
 */
export function onNativeNotificationOpened(
  listener: (open: NativeNotificationOpen) => void,
): () => void {
  if (!isNativePushAvailable()) {
    return () => undefined;
  }
  let removed = false;
  let remove: (() => void) | undefined;
  void PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const data: unknown = action.notification.data;
    const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    listener({
      kind: typeof record.kind === 'string' ? record.kind : 'unknown',
      url: typeof record.url === 'string' ? record.url : '',
    });
  })
    .then((handle) => {
      remove = () => void handle.remove();
      if (removed) {
        remove();
      }
    })
    .catch(() => undefined);
  return () => {
    removed = true;
    remove?.();
  };
}
