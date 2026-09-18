/**
 * @fileoverview Hook for offline-aware success confirmations.
 *
 * Wraps {@link notify} so that a save made with no connection confirms
 * "Saved on this device" instead of the entity-specific message, which would
 * otherwise imply the change had reached everyone else on the trip.
 *
 * Was `useOfflineAwareToast`. The confirmation is no longer a toast — it is an
 * operating system notification, because a burst of them used to stack up over
 * the content. See `src/lib/notifications/notify.ts` for the split.
 *
 * @module hooks/useOfflineAwareNotify
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { notify } from '@/lib/notifications';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Return type for the useOfflineAwareNotify hook.
 */
export interface UseOfflineAwareNotifyReturn {
  /**
   * Confirm a save, adapting the message to connectivity state.
   * When online: confirms with the provided message.
   * When offline: confirms "Saved on this device".
   *
   * @param onlineMessage - The message to use when online
   */
  readonly notifySuccess: (onlineMessage: string) => void;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for offline-aware success confirmations.
 *
 * Only affects confirmations — errors always report the actual problem,
 * whatever the connection is doing.
 *
 * The device icon the offline toast used to carry is gone: an OS notification
 * takes the app icon and no per-message one, and the words carry the meaning.
 *
 * @returns Object containing the notifySuccess function
 *
 * @example
 * ```tsx
 * function RoomDialog() {
 *   const { notifySuccess } = useOfflineAwareNotify();
 *
 *   const handleSave = () => {
 *     // ... save logic
 *     notifySuccess(t('rooms.createSuccess', 'Room created successfully'));
 *     // When offline → "Saved on this device"
 *     // When online → "Room created successfully"
 *   };
 * }
 * ```
 */
export function useOfflineAwareNotify(): UseOfflineAwareNotifyReturn {
  const { isOnline } = useOnlineStatus();
  const { t } = useTranslation();

  const notifySuccess = useCallback(
    (onlineMessage: string): void => {
      notify.success(
        isOnline
          ? onlineMessage
          : t('pwa.savedLocally', 'Saved on this device'),
      );
    },
    [isOnline, t],
  );

  return { notifySuccess };
}
