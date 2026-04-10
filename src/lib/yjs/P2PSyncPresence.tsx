import { type ReactElement, memo, useMemo } from 'react';

import { useYjsContext } from './YjsProvider';

export const P2PSyncPresence = memo(function P2PSyncPresence(): ReactElement | null {
  const yjs = useYjsContext();
  const onlineUsers = yjs?.onlineUsers ?? [];

  const summary = useMemo(() => {
    if (onlineUsers.length === 0) {
      return 'Live sync';
    }

    return `${onlineUsers.length} online`;
  }, [onlineUsers.length]);

  if (!yjs?.roomId || !yjs.loaded || onlineUsers.length === 0) {
    return null;
  }

  return (
    <div className="fixed right-4 top-20 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border bg-background/95 px-3 py-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
      <span className="text-xs font-medium text-foreground">{summary}</span>
      <div className="flex items-center gap-1">
        {onlineUsers.slice(0, 4).map((user) => (
          <span
            key={user.clientId}
            className="inline-flex h-7 max-w-28 items-center rounded-full border px-2 text-xs font-medium"
            style={{ borderColor: user.color, color: user.color }}
            title={user.isLocal ? `${user.name} (You)` : user.name}
          >
            <span
              className="mr-1 size-2 rounded-full"
              style={{ backgroundColor: user.color }}
              aria-hidden="true"
            />
            <span className="truncate">
              {user.isLocal ? 'You' : user.name}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
});
