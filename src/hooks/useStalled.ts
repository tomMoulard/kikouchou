/**
 * @fileoverview Tells a dialog when the work it is waiting on has taken too long.
 *
 * A dialog that refuses to close while it is saving is right: closing halfway
 * through a write leaves the reader with no idea what landed. It is right only
 * for as long as the write is going to finish.
 *
 * A Dexie write does not always finish. An idle tab holding an older schema
 * blocks a newer tab's upgrade transaction, and the queued operations behind it
 * neither resolve nor reject — see the handlers in `lib/db/database.ts` and the
 * render gate in `main.tsx`, both written for the same hazard. When that
 * happened underneath a modal, the `await` never returned, the saving flag
 * stayed set, and the close was refused forever. Radix locks body scroll and
 * makes the page behind a modal inert, so the whole app read as frozen: no
 * scrolling, no clicking, nothing to press. A reload was the only way out.
 *
 * This is the escape hatch. The lock still holds for as long as a save can
 * plausibly take, and then it lets go.
 *
 * @module hooks/useStalled
 */

import { useEffect, useState } from 'react';

/**
 * How long an in-flight save may hold a dialog open before the user may close it.
 *
 * Long enough that no working write is ever interrupted — an IndexedDB write on
 * a slow phone is milliseconds, and applying a whole allocation is a handful of
 * them in sequence. Short enough that a person who is stuck does not conclude
 * the app is broken, which at eight seconds of a dead screen they already have.
 */
export const STALL_TIMEOUT_MS = 8000;

/**
 * Whether something has been busy for longer than it should be.
 *
 * @param isBusy - Whether the work is currently in flight. Going back to
 *   `false` resets the clock, so a second attempt gets the full grace period.
 * @param timeoutMs - How long to wait before calling it stalled.
 * @returns `true` once `isBusy` has been continuously `true` for `timeoutMs`.
 *
 * @example
 * ```tsx
 * const isStalled = useStalled(isSaving);
 *
 * const handleOpenChange = (nextOpen: boolean): void => {
 *   // Hold the dialog open while saving — but never indefinitely.
 *   if (isSaving && !isStalled && !nextOpen) {
 *     return;
 *   }
 *   onOpenChange(nextOpen);
 * };
 * ```
 */
export function useStalled(isBusy: boolean, timeoutMs: number = STALL_TIMEOUT_MS): boolean {
  const [isStalled, setIsStalled] = useState(false);

  useEffect(() => {
    if (!isBusy) {
      setIsStalled(false);
      return;
    }

    const timer = setTimeout(() => {
      setIsStalled(true);
    }, timeoutMs);

    return () => {
      clearTimeout(timer);
    };
  }, [isBusy, timeoutMs]);

  return isStalled;
}
