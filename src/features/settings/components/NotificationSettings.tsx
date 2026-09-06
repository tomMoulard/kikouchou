/**
 * @fileoverview Ride-alert notification card for the settings page.
 *
 * The only place in the app that calls `Notification.requestPermission()`, and
 * it does so from a click. An unprompted dialog on load is how a PWA gets its
 * notifications denied forever — and `denied` is terminal: no API can undo it,
 * so this card explains the browser's own site settings instead of offering a
 * retry button that would silently do nothing.
 *
 * @module features/settings/components/NotificationSettings
 */

import { type ReactElement, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  getNotificationState,
  requestNotificationPermission,
  type NotificationState,
} from '@/lib/notifications';

// ============================================================================
// Constants
// ============================================================================

/**
 * How each state is badged.
 *
 * A `Record` keyed by the union rather than a chain of ternaries, so adding a
 * state to `NOTIFICATION_STATES` is a type error here until it gets a badge.
 *
 * `denied` is `outline` rather than `destructive`: nothing is broken and
 * nothing was destroyed — the user, or their browser, said no. The explanation
 * underneath is what carries the meaning, which is also what keeps colour from
 * being the only signal.
 */
const STATE_BADGE_VARIANTS: Record<
  NotificationState,
  'default' | 'secondary' | 'outline'
> = {
  unsupported: 'outline',
  default: 'secondary',
  granted: 'default',
  denied: 'outline',
};

// ============================================================================
// Component
// ============================================================================

/**
 * Lets the user opt in to OS notifications for the rides they drive.
 *
 * States the deal plainly before asking: what gets sent, that only the driver
 * of a ride hears about it, and that delivery is best-effort without a server
 * behind it. See `lib/notifications` for why that last sentence is true.
 *
 * @returns The notification preference card
 */
export const NotificationSettings = memo(function NotificationSettings(): ReactElement {
  const { t } = useTranslation(),
    [state, setState] = useState<NotificationState>(getNotificationState),
    [isAsking, setIsAsking] = useState(false),
    isMountedRef = useRef(true);

  useEffect(() => {
    // Set on setup, not only in cleanup: StrictMode's dev-time
    // mount -> cleanup -> mount cycle would otherwise latch this false
    // forever, silently turning every guarded setState into a no-op.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Turning notifications back on after a `denied` happens in the browser's
    // own site settings, and nothing in the page is told when it does. Re-read
    // whenever the tab comes back, so the card stops claiming "Blocked" after
    // a trip through those settings and back.
    const resync = (): void => {
      if (document.visibilityState === 'visible' && isMountedRef.current) {
        setState(getNotificationState());
      }
    };

    document.addEventListener('visibilitychange', resync);
    return () => {
      document.removeEventListener('visibilitychange', resync);
    };
  }, []);

  const handleEnable = useCallback(async (): Promise<void> => {
    setIsAsking(true);
    try {
      const next = await requestNotificationPermission();

      if (isMountedRef.current) {
        setState(next);
      }
    } finally {
      if (isMountedRef.current) {
        setIsAsking(false);
      }
    }
  }, []);

  const handleEnableClick = useCallback((): void => {
    void handleEnable();
  }, [handleEnable]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
            <Bell className="size-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-base">
              {t('notifications.title', 'Ride alerts')}
            </CardTitle>
            <CardDescription>
              {t(
                'notifications.description',
                'Let this device tell you when a car needs you',
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {t('notifications.whatYouGet', 'Turned on, this device tells you:')}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              {t(
                'notifications.leaveItem',
                'when it is time to leave for a pick-up you are driving',
              )}
            </li>
            <li>
              {t(
                'notifications.movedItem',
                'when somebody riding in your car changes their time',
              )}
            </li>
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(
              'notifications.onlyDriver',
              'Only the driver of a ride is told about it, and only on the devices where this is turned on.',
            )}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {t('notifications.statusLabel', 'On this device')}
          </span>
          <Badge variant={STATE_BADGE_VARIANTS[state]}>
            {t(`notifications.states.${state}`, state)}
          </Badge>
        </div>

        {state === 'granted' && (
          <p className="text-sm text-muted-foreground">
            {t(
              'notifications.bestEffort',
              'Kikouchou has no server, so an alert can only be sent while the app is running or recently used. The alert inside the app is always there when you open it.',
            )}
          </p>
        )}

        {state === 'denied' && (
          <p className="text-sm text-muted-foreground">
            {t(
              'notifications.deniedHint',
              'Your browser is blocking notifications for Kikouchou. The app cannot ask again — allow them for this site in your browser or system settings.',
            )}
          </p>
        )}

        {state === 'unsupported' && (
          <p className="text-sm text-muted-foreground">
            {t(
              'notifications.unsupportedHint',
              'This browser cannot show notifications. On an iPhone, add Kikouchou to the Home Screen first. Ride alerts still appear inside the app.',
            )}
          </p>
        )}

        {state === 'default' && (
          <Button
            onClick={handleEnableClick}
            disabled={isAsking}
            className="w-full sm:w-auto"
          >
            <Bell className="mr-2 size-4" aria-hidden="true" />
            {isAsking
              ? t('notifications.enabling', 'Waiting for your answer…')
              : t('notifications.enable', 'Turn on ride alerts')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
});
