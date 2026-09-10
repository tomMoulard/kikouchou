/**
 * @fileoverview The one card that offers trip reminders, and turns them on.
 *
 * Shown on a shared trip's calendar wherever this browser can receive a push —
 * an Android phone, a laptop, the installed iPhone app. Where it cannot (an
 * iPhone's Safari tab) the install nudge stands here instead and says the same
 * thing, because installing is what makes this card possible there.
 *
 * The permission dialog runs from the button and from nowhere else. What the
 * card promises is exactly what the sender does: the evening before the trip
 * starts, before your own arrival, before a pickup you are part of.
 *
 * @module components/shared/ReminderCard
 */

import { type ReactElement, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, BellRing } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/features/auth/AuthContext';
import { resolveTripIdentity } from '@/lib/identity/trip-identity';
import { notify } from '@/lib/notifications';
import {
  type EnableRemindersResult,
  type ReminderState,
  enableTripReminders,
  getReminderState,
} from '@/lib/notifications/push';
import posthog from '@/lib/posthog';
import { getSupabaseClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { Trip } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/** LocalStorage key prefix holding a per-trip dismissal timestamp. */
const DISMISSAL_STORAGE_PREFIX = 'kikouchou-reminder-card-dismissed:';

/** How long "Not now" hides the card for one trip (30 days). */
const DISMISSAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

// ============================================================================
// Type Definitions
// ============================================================================

export interface ReminderCardProps {
  readonly trip: Trip;
  readonly className?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function isDismissedRecently(tripId: string): boolean {
  try {
    const dismissedAt = window.localStorage.getItem(`${DISMISSAL_STORAGE_PREFIX}${tripId}`);
    if (!dismissedAt) {
      return false;
    }
    const timestamp = parseInt(dismissedAt, 10);
    return !Number.isNaN(timestamp) && Date.now() - timestamp < DISMISSAL_DURATION_MS;
  } catch {
    return false;
  }
}

function storeDismissal(tripId: string): void {
  try {
    window.localStorage.setItem(`${DISMISSAL_STORAGE_PREFIX}${tripId}`, Date.now().toString());
  } catch {
    // Storage refused: the dismissal lasts for this page only.
  }
}

/** Whether the server knows this trip at all. */
function isShared(trip: Trip): boolean {
  return trip.viewerToken !== undefined || trip.remoteTripId !== undefined;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Offers reminders for a shared trip and turns them on from one click.
 *
 * @param props - The trip and an optional class
 * @returns The card, or null when there is nothing to offer
 */
export const ReminderCard = memo(function ReminderCard({
  trip,
  className,
}: ReminderCardProps): ReactElement | null {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  const [state, setState] = useState<ReminderState>(() => getReminderState(trip.id));
  const [isDismissed, setIsDismissed] = useState<boolean>(() => isDismissedRecently(trip.id));
  const [isWorking, setIsWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // A permission changed in the browser's own settings is not announced;
    // re-read when the tab comes back.
    const resync = (): void => {
      if (document.visibilityState === 'visible' && isMountedRef.current) {
        setState(getReminderState(trip.id));
      }
    };
    document.addEventListener('visibilitychange', resync);
    return () => {
      document.removeEventListener('visibilitychange', resync);
    };
  }, [trip.id]);

  const isVisible = isShared(trip) && state === 'off' && !isDismissed;

  useEffect(() => {
    if (isVisible) {
      posthog?.capture('reminder_card_shown', {
        trip_access: trip.viewerToken !== undefined ? 'viewer' : 'member',
      });
    }
  }, [isVisible, trip.id, trip.viewerToken]);

  const explain = useCallback(
    (result: EnableRemindersResult): string | null => {
      switch (result.status) {
        case 'enabled':
        case 'dismissed':
          return null;
        case 'blocked':
          return t(
            'reminders.blocked',
            'Your browser is blocking notifications for Kikouchou. Allow them in your browser or system settings, then try again.',
          );
        case 'not-found':
          return t('sharing.join.notFound', "This invite link isn't valid.");
        case 'revoked':
          return t('sharing.join.revoked', 'This invite link has been withdrawn.');
        case 'expired':
          return t('sharing.join.expired', 'This invite link has expired.');
        case 'exhausted':
          return t('sharing.join.exhausted', 'This invite link has been used up.');
        case 'unauthenticated':
        case 'not-a-member':
          return t('reminders.signInFirst', 'Sign in first, then turn reminders on.');
        case 'unsupported':
        case 'error':
          return t(
            'reminders.failed',
            'Reminders could not be turned on. Try again in a moment.',
          );
      }
    },
    [t],
  );

  const handleEnable = useCallback(async (): Promise<void> => {
    setIsWorking(true);
    setProblem(null);
    try {
      const client = await getSupabaseClient();
      if (!client) {
        if (isMountedRef.current) {
          setProblem(t('reminders.failed', 'Reminders could not be turned on. Try again in a moment.'));
        }
        return;
      }
      const identity = await resolveTripIdentity(trip, user?.id);
      const result = await enableTripReminders(client, trip, {
        personId: identity.personId,
        locale: i18n.language,
        analyticsId: posthog?.get_distinct_id(),
      });
      if (!isMountedRef.current) {
        return;
      }
      posthog?.capture('reminders_enable_result', {
        outcome: result.status,
        trip_access: trip.viewerToken !== undefined ? 'viewer' : 'member',
        has_person: identity.personId !== undefined,
      });
      if (result.status === 'enabled') {
        notify.success(t('reminders.enabled', 'Reminders are on for this trip'));
      }
      setState(getReminderState(trip.id));
      setProblem(explain(result));
    } finally {
      if (isMountedRef.current) {
        setIsWorking(false);
      }
    }
  }, [explain, i18n.language, t, trip, user?.id]);

  const handleDismiss = useCallback((): void => {
    posthog?.capture('reminder_card_dismissed');
    storeDismissal(trip.id);
    setIsDismissed(true);
  }, [trip.id]);

  if (!isVisible) {
    return null;
  }

  return (
    <Card
      className={cn('border-primary/20', className)}
      role="region"
      aria-label={t('reminders.region', 'Trip reminders')}
      data-testid="reminder-card"
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <BellRing className="size-6" />
          </div>

          <div className="min-w-0 flex-1">
            <CardTitle className="text-base font-semibold">
              {t('reminders.title', 'Get a reminder before the trip')}
            </CardTitle>
            <CardDescription className="mt-1 text-sm">
              {t('reminders.description', {
                tripName: trip.name,
                defaultValue:
                  '{{tripName}}: a nudge the evening before it starts, before your own arrival, and before a pickup you are part of. Nothing else.',
              })}
            </CardDescription>

            {problem !== null ? (
              <p
                className="mt-2 flex items-start gap-2 text-sm text-destructive"
                role="alert"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{problem}</span>
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                className="h-11 sm:h-8"
                onClick={() => void handleEnable()}
                disabled={isWorking}
              >
                {isWorking
                  ? t('reminders.enabling', 'Waiting for your answer…')
                  : t('reminders.enable', 'Turn on reminders')}
              </Button>
              <Button size="sm" variant="ghost" className="h-11 sm:h-8" onClick={handleDismiss}>
                {t('pwa.notNow', 'Not now')}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
