/**
 * @fileoverview Hook for offline-aware toast notifications.
 * Wraps sonner toast to show "Saved on this device" when offline
 * instead of the standard success message, reassuring users their
 * data is safely stored locally.
 *
 * @module hooks/useOfflineAwareToast
 */

import { type ReactNode, createElement, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Smartphone } from 'lucide-react';
import { toast } from 'sonner';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Return type for the useOfflineAwareToast hook.
 */
export interface UseOfflineAwareToastReturn {
  /**
   * Show a success toast that adapts to connectivity state.
   * When online: shows the provided message as a standard success toast.
   * When offline: shows "Saved on this device" with a device icon.
   *
   * @param onlineMessage - The message to show when online
   */
  readonly successToast: (onlineMessage: string) => void;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for offline-aware toast notifications.
 *
 * Wraps the sonner toast API to differentiate between online and offline
 * success messages. When the device is offline, success toasts show
 * "Saved on this device" with a device icon instead of the entity-specific
 * success message.
 *
 * Only affects success toasts — error toasts should always show the
 * actual error message regardless of connectivity.
 *
 * @returns Object containing the successToast function
 *
 * @example
 * ```tsx
 * function RoomDialog() {
 *   const { successToast } = useOfflineAwareToast();
 *
 *   const handleSave = () => {
 *     // ... save logic
 *     successToast(t('rooms.createSuccess', 'Room created successfully'));
 *     // When offline → shows "Saved on this device" with device icon
 *     // When online → shows "Room created successfully"
 *   };
 * }
 * ```
 */
export function useOfflineAwareToast(): UseOfflineAwareToastReturn {
  const { isOnline } = useOnlineStatus();
  const { t } = useTranslation();

  const successToast = useCallback(
    (onlineMessage: string): void => {
      if (isOnline) {
        toast.success(onlineMessage);
      } else {
        toast.success(
          t('pwa.savedLocally', 'Saved on this device'),
          {
            icon: createElement(Smartphone, {
              className: 'size-4',
              'aria-hidden': 'true',
            }) as ReactNode,
          },
        );
      }
    },
    [isOnline, t],
  );

  return { successToast };
}
