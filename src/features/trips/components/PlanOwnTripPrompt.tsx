/**
 * @fileoverview Invites a guest of somebody else's trip to plan one themselves.
 *
 * Every visitor who arrives through a share link is one house away from being an
 * organiser, and nothing in the app ever says so: the trip list they land on is
 * a list of somebody else's trip. This card is that sentence, shown once the
 * visitor has actually seen a trip run — `usePlanOwnTripPrompt` owns the whole
 * decision about when, and this file only renders it.
 *
 * Deliberately *not* placed in the join wizard or on the share welcome screen.
 * Somebody mid-join came for another person's trip, and a second call to action
 * there competes with the one step you actually want them to finish.
 *
 * @module features/trips/components/PlanOwnTripPrompt
 */

import { type ReactElement, memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PartyPopper, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from '@/components/ui/card';
import { captureEvent } from '@/lib/posthog';
import { cn } from '@/lib/utils';
import { usePlanOwnTripPrompt } from '../hooks/usePlanOwnTripPrompt';
import type { Trip } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the PlanOwnTripPrompt component.
 */
export interface PlanOwnTripPromptProps {
  /** The trips on this device, used to decide whether to show anything. */
  readonly trips: readonly Trip[];
  /** Opens the create-trip form. */
  readonly onCreateTrip: () => void;
  /** Additional CSS classes for the card. */
  readonly className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * The "plan your own" invitation on the trip list.
 *
 * @param props - Component props
 * @returns The card, or null when this visitor is not the one to show it to
 *
 * @example
 * ```tsx
 * <PlanOwnTripPrompt trips={trips} onCreateTrip={handleCreateClick} />
 * ```
 */
export const PlanOwnTripPrompt = memo(function PlanOwnTripPrompt({
  trips,
  onCreateTrip,
  className,
}: PlanOwnTripPromptProps): ReactElement | null {
  const { t } = useTranslation();
  const { isVisible, dismiss } = usePlanOwnTripPrompt(trips);

  /**
   * Whether the impression has already been reported.
   *
   * Never reset, on purpose: StrictMode runs the effect below twice on mount in
   * development, and a flag that a cleanup cleared would report one impression
   * as two.
   */
  const hasReportedRef = useRef<boolean>(false);

  useEffect(() => {
    if (isVisible && !hasReportedRef.current) {
      hasReportedRef.current = true;
      // Not a `captureUsage` action: seeing a card is not using the app, and the
      // `trip_created` this hopes to produce is already counted as activity.
      captureEvent('own_trip_prompt_shown', { trip_count: trips.length });
    }
  }, [isVisible, trips.length]);

  const handleCreate = useCallback((): void => {
    captureEvent('own_trip_prompt_accepted');
    onCreateTrip();
  }, [onCreateTrip]);

  const handleDismiss = useCallback((): void => {
    captureEvent('own_trip_prompt_dismissed');
    dismiss();
  }, [dismiss]);

  if (!isVisible) {
    return null;
  }

  return (
    <Card className={cn('mb-4 border-primary/20', className)}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"
            aria-hidden="true"
          >
            <PartyPopper className="size-6" />
          </div>

          <div className="min-w-0 flex-1">
            <CardTitle className="text-base font-semibold">
              {t('trips.ownTripPrompt.title')}
            </CardTitle>
            <CardDescription className="mt-1 text-sm">
              {t('trips.ownTripPrompt.description')}
            </CardDescription>

            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleCreate}
                className="h-11 flex-1 sm:h-8 sm:flex-none"
              >
                <Plus className="mr-2 size-4" aria-hidden="true" />
                {t('trips.ownTripPrompt.action')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDismiss}
                className="h-11 sm:h-8"
              >
                {t('trips.ownTripPrompt.notNow')}
              </Button>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="-mt-1 -mr-1 size-11 shrink-0 md:size-8"
            onClick={handleDismiss}
            aria-label={t('common.close')}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});
