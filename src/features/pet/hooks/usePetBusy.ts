/**
 * @fileoverview Whether the visitor is typing or dragging, live.
 *
 * @module features/pet/hooks/usePetBusy
 */

import { useEffect, useState } from 'react';

import { watchBusy } from '../lib/pet-busy';

/**
 * Returns `true` while the visitor types in a field or drags something.
 *
 * @param enabled - Whether to watch at all; `false` answers `false`
 * @returns Whether the visitor is busy
 */
export function usePetBusy(enabled: boolean): boolean {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setBusy(false);
      return undefined;
    }
    return watchBusy(document, setBusy);
  }, [enabled]);

  return busy;
}
