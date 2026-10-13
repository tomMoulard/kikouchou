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

import { type ReactElement, memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, BellRing } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useTripContext } from '@/contexts/TripContext';
import {
  getNotificationState,
  requestNotificationPermission,
  type NotificationState,
} from '@/lib/notifications';
import {
  disableTripReminders,
  getReminderState,
  type ReminderState,
} from '@/lib/notifications/push';
import { notify } from '@/lib/notifications';
import { captureEvent } from '@/lib/posthog';
import { getSupabaseClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

// ============================================================================
// Constants
// ============================================================================

/**
 * The states in which the switch cannot do anything, and is greyed out.
 *
 * `denied` is terminal — no API can undo it, the browser's own site settings
 * can — and `unsupported` is a browser with no notifications at all. The
 * explanation underneath says which, so the grey is never the only signal.
 */
const UNAVAILABLE_STATES: ReadonlySet<NotificationState> = new Set(['denied', 'unsupported']);

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
    { currentTrip } = useTripContext(),
    [state, setState] = useState<NotificationState>(getNotificationState),
    [isAsking, setIsAsking] = useState(false),
    /**
     * The server-sent reminders for the trip on screen. Read on every render
     * because it is a cheap storage read, and the card that turns them on
     * lives on another page.
     */
    reminderState: ReminderState | null =
      currentTrip !== null ? getReminderState(currentTrip.id) : null,
    [isTurningOff, setIsTurningOff] = useState(false),
    [turnedOffTripId, setTurnedOffTripId] = useState<string | null>(null),
    /** Set when the user tries to switch off a permission only the browser can take back. */
    [showTurnOffHint, setShowTurnOffHint] = useState(false),
    switchId = useId(),
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

  /**
   * Off to on asks for permission, from this click and from nowhere else. On to
   * off cannot be done from the page — no API revokes a granted permission — so
   * the switch stays on and says where it is done instead.
   */
  const handleCheckedChange = useCallback(
    (checked: boolean): void => {
      if (checked) {
        void handleEnable();
        return;
      }
      setShowTurnOffHint(true);
    },
    [handleEnable],
  );

  const handleTurnOffReminders = useCallback(async (): Promise<void> => {
    if (currentTrip === null) {
      return;
    }
    setIsTurningOff(true);
    let turnedOff = false;
    try {
      const client = await getSupabaseClient();
      if (client) {
        turnedOff = await disableTripReminders(client, currentTrip.id);
        if (turnedOff) {
          captureEvent('reminders_disabled', {
            trip_access: currentTrip.viewerToken !== undefined ? 'viewer' : 'member',
          });
        }
      }
    } catch (error) {
      console.error('Failed to turn off trip reminders:', error);
    } finally {
      if (isMountedRef.current) {
        // Only claimed when the server actually forgot the endpoint. Reporting
        // it regardless left the card saying "off" while the sender went on
        // pushing the trip's pickup places and times to this device, and there
        // was no way back: the button had nothing left to do.
        if (turnedOff) {
          setTurnedOffTripId(currentTrip.id);
        } else {
          notify.error(
            t('notifications.turnOffFailed'),
          );
        }
        setIsTurningOff(false);
      }
    }
  }, [currentTrip, t]);

  /** Effective state: a turn-off this render already knows about wins. */
  const effectiveReminderState: ReminderState | null =
    reminderState === 'on' && turnedOffTripId === currentTrip?.id ? 'off' : reminderState;

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
              'Only the driver of a ride is told about it, and only on devices where you allowed notifications.',
            )}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Label
            htmlFor={switchId}
            className={cn(
              'text-sm font-normal text-muted-foreground',
              UNAVAILABLE_STATES.has(state) && 'opacity-50',
            )}
          >
            {t('notifications.statusLabel', 'On this device')}
          </Label>
          <div className="flex items-center gap-2">
            {/* The state in words beside the switch: "Blocked" and "Not
                available" are not the same grey, and colour alone says neither. */}
            <span className="text-xs text-muted-foreground" aria-hidden="true">
              {isAsking
                ? t('notifications.enabling', 'Waiting for your answer…')
                : t(`notifications.states.${state}`, state)}
            </span>
            <Switch
              id={switchId}
              checked={state === 'granted'}
              disabled={UNAVAILABLE_STATES.has(state) || isAsking}
              onCheckedChange={handleCheckedChange}
              aria-label={t('notifications.title', 'Ride alerts')}
            />
          </div>
        </div>

        {state === 'granted' && showTurnOffHint && (
          <p className="text-sm text-muted-foreground" role="status">
            {t(
              'notifications.turnOffHint',
              'Only your browser can turn ride alerts off. Block notifications for Kikouchou in your browser or system settings.',
            )}
          </p>
        )}

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
              'Your browser is blocking notifications for Kikouchou. The app cannot ask again. Allow them for this site in your browser or system settings.',
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

        {/*
          Shown in every state, because the limitation it answers holds in
          every state: granted, denied, or a browser that cannot notify at
          all. The calendar file needs no permission from anybody.
        */}
        <p className="text-sm text-muted-foreground">
          {t(
            'notifications.calendarFallback',
            'For the runs you drive, open a trip’s transport page and choose “Add my runs to my calendar”. The phone’s own calendar then rings on time, with Kikouchou closed.',
          )}
        </p>

        {currentTrip !== null && effectiveReminderState !== null && (
          <div
            className="space-y-2 border-t pt-4"
            data-testid="trip-reminders-settings"
          >
            <div className="flex items-center gap-2">
              <BellRing className="size-4 text-primary" aria-hidden="true" />
              <p className="text-sm font-medium">
                {t('reminders.settingsTitle', 'Trip reminders')}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {effectiveReminderState === 'on'
                ? t('reminders.settingsOn', {
                    tripName: currentTrip.name,
                    defaultValue: 'On for {{tripName}} on this device.',
                  })
                : effectiveReminderState === 'unsupported'
                  ? t(
                      'reminders.settingsUnsupported',
                      'This browser cannot receive reminders. On an iPhone, add Kikouchou to the Home Screen first.',
                    )
                  : t('reminders.settingsOff', {
                      tripName: currentTrip.name,
                      defaultValue: "Off for {{tripName}}. Turn them on from the trip's calendar.",
                    })}
            </p>
            {effectiveReminderState === 'on' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleTurnOffReminders()}
                disabled={isTurningOff}
              >
                {t('reminders.turnOff', 'Turn off')}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
});
