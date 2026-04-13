/**
 * @fileoverview Bridges Yjs awareness into {@link SyncPresenceContext} — **no UI** (count only).
 * The visible badge lives in {@link P2PSyncPresence} from `@/components/shared` inside {@link Layout}.
 *
 * @module lib/yjs/P2PSyncPresence
 */

import { type ReactElement, memo, useEffect } from 'react';

import { useSyncPresence } from '@/contexts/SyncPresenceContext';

import { useYjsContext } from './YjsProvider';

/**
 * Subscribes to `onlineUsers.length` and updates global presence count. Renders `null`.
 */
export const P2PSyncPresence = memo(function P2PSyncPresence(): ReactElement | null {
  const yjs = useYjsContext();
  const syncPresence = useSyncPresence();
  const onlineUsers = yjs?.onlineUsers ?? [];
  const count = onlineUsers.length;

  useEffect(() => {
    if (!syncPresence) {
      return;
    }

    if (!yjs?.roomId || !yjs.loaded) {
      syncPresence.setOnlineCount(0);
      return;
    }

    syncPresence.setOnlineCount(count);
  }, [syncPresence, yjs?.loaded, yjs?.roomId, count]);

  useEffect(() => {
    return () => {
      syncPresence?.setOnlineCount(0);
    };
  }, [syncPresence]);

  return null;
});
