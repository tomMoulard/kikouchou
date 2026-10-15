/**
 * @fileoverview The live region that speaks the app's confirmations.
 *
 * Confirmations leave the page for the operating system notification shade
 * (`src/lib/notifications/notify.ts`), and an OS notification is outside the
 * document: a screen reader reading this app would never hear "Room created
 * successfully" again. The sonner toast it replaced carried its own
 * `role="status"`, so this region takes that job over.
 *
 * Mounted once, next to the `Toaster`, in `src/App.tsx`.
 *
 * @module components/shared/StatusAnnouncer
 */

import { type ReactElement, useEffect, useRef, useState } from 'react';

import { subscribeToStatus } from '@/lib/notifications';

// ============================================================================
// Constants
// ============================================================================

/**
 * The blank frame between clearing the region and filling it again.
 *
 * A live region only announces text that *changed*, so creating two rooms in a
 * row — two identical "Room created successfully" strings — would be spoken
 * once. Emptying it first makes the second one a change again. One frame is
 * enough for the accessibility tree to see both states, and short enough that
 * no announcement is ever perceptibly late.
 */
const RESET_MS = 100;

// ============================================================================
// Component
// ============================================================================

/**
 * An `aria-live` region carrying the most recent confirmation.
 *
 * Renders nothing visible: the message it holds is already on the user's
 * screen as an OS notification.
 *
 * @returns The live region element.
 *
 * @example
 * ```tsx
 * <StatusAnnouncer />
 * ```
 */
export function StatusAnnouncer(): ReactElement {
  const [message, setMessage] = useState('');
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = subscribeToStatus((announced: string): void => {
      window.clearTimeout(resetTimer.current);
      setMessage('');
      resetTimer.current = window.setTimeout(
        () => setMessage(announced),
        RESET_MS,
      );
    });

    return (): void => {
      window.clearTimeout(resetTimer.current);
      unsubscribe();
    };
  }, []);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}
