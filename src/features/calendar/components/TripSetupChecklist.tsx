/**
 * @fileoverview The empty calendar's setup checklist — what a brand new trip
 * still needs before the calendar can draw anything, with counts that tick off.
 *
 * Saving a trip lands on the calendar, which at that point has the guest rows
 * and nothing else: no rooms, nobody sleeping anywhere, no travel. This is what
 * fills that space, in place of a "nothing scheduled yet" that named the
 * problem and not the next step.
 *
 * @module features/calendar/components/TripSetupChecklist
 */

import { type ReactElement, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BedDouble,
  Car,
  Check,
  Home,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type {
  TripSetupChecklist as TripSetupChecklistModel,
  TripSetupStep,
  TripSetupStepKey,
} from '../utils/setup-checklist';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for {@link TripSetupChecklist}.
 *
 * One callback per step rather than one `onStepClick(key)`: each destination is
 * a different route with a different query flag, and the page that owns the
 * router is the right place for that mapping to live.
 */
export interface TripSetupChecklistProps {
  /** The steps and progress, from `buildTripSetupChecklist`. */
  readonly checklist: TripSetupChecklistModel;
  /** Opens the guest form. */
  readonly onAddGuests: () => void;
  /** Opens the room form. */
  readonly onAddRooms: () => void;
  /** Goes to the rooms page, where guests are put into rooms. */
  readonly onAssignRooms: () => void;
  /** Opens the travel form on an arrival. */
  readonly onAddArrivals: () => void;
  /** Optional additional CSS classes for the container. */
  readonly className?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * The icon each step carries.
 *
 * Same icons the navigation uses for the pages the steps lead to — `Home` for
 * rooms, `Car` for travel — so the row and its destination look like the same
 * thing.
 */
const STEP_ICONS: Readonly<Record<TripSetupStepKey, LucideIcon>> = {
  guests: Users,
  rooms: Home,
  assignments: BedDouble,
  arrivals: Car,
};

// ============================================================================
// Component
// ============================================================================

/**
 * The trip-setup checklist for an empty calendar.
 *
 * Every step shows its own count, so progress is visible before any of it is
 * finished — "2 of 5 people have a room" is the answer to "why is this screen
 * still half empty". A finished step keeps its count and trades its button for
 * a tick; the first unfinished one gets the filled button, and the rest outline
 * ones, so there is a single obvious next step without the others looking
 * closed.
 *
 * @param props - Component props
 * @returns The checklist card
 *
 * @example
 * ```tsx
 * <TripSetupChecklist
 *   checklist={buildTripSetupChecklist({ persons, rooms, assignments, arrivals })}
 *   onAddGuests={handleAddGuests}
 *   onAddRooms={handleAddRooms}
 *   onAssignRooms={handleAssignRooms}
 *   onAddArrivals={handleAddArrivals}
 * />
 * ```
 */
const TripSetupChecklist = memo(function TripSetupChecklist({
  checklist,
  onAddGuests,
  onAddRooms,
  onAssignRooms,
  onAddArrivals,
  className,
}: TripSetupChecklistProps): ReactElement {
  const { t } = useTranslation();

  const handlers: Readonly<Record<TripSetupStepKey, () => void>> = {
    guests: onAddGuests,
    rooms: onAddRooms,
    assignments: onAssignRooms,
    arrivals: onAddArrivals,
  };

  const stepTitle: Readonly<Record<TripSetupStepKey, string>> = {
    guests: t('calendar.setup.guests.title', 'Add guests'),
    rooms: t('calendar.setup.rooms.title', 'Add rooms'),
    assignments: t('calendar.setup.assignments.title', 'Put guests in rooms'),
    arrivals: t('calendar.setup.arrivals.title', 'Add arrivals'),
  };

  /*
    The button says what the form it opens is called, not what the row above it
    already says. "Add rooms" on both was one label twice, and it made every
    query for it — a test's or a screen reader user's — ambiguous.
  */
  const stepAction: Readonly<Record<TripSetupStepKey, string>> = {
    guests: t('persons.new', 'New guest'),
    rooms: t('rooms.new', 'New room'),
    assignments: t('calendar.setup.assignments.action', 'Assign rooms'),
    arrivals: t('calendar.setup.arrivals.action', 'New arrival'),
  };

  /*
    Zero gets its own key rather than a `count_zero` plural, because a freshly
    saved trip is at zero on three of the four steps and "No rooms yet" is
    better copy than "0 rooms". Its own key also keeps every string a test sees
    identical to the one the app renders — an i18next plural exception would
    show up only in the locale file, never in the fallback.

    The assignments line interpolates `placed`, not `count`, so it needs no
    plural at all and cannot disagree with itself about "has" and "have".
  */
  const stepCountLabel = (step: TripSetupStep): string => {
    switch (step.key) {
      case 'guests':
        return step.count === 0
          ? t('calendar.setup.guests.countZero', 'Nobody on the list yet')
          : t('calendar.setup.guests.count', '{{count}} people on the list', {
              count: step.count,
            });
      case 'rooms':
        return step.count === 0
          ? t('calendar.setup.rooms.countZero', 'No rooms yet')
          : t('calendar.setup.rooms.count', '{{count}} rooms', { count: step.count });
      case 'assignments':
        return step.count === 0
          ? t('calendar.setup.assignments.countZero', 'Nobody has a room yet')
          : t('calendar.setup.assignments.count', '{{placed}} of {{total}} with a room', {
              placed: step.count,
              total: step.total ?? 0,
            });
      case 'arrivals':
        return step.count === 0
          ? t('calendar.setup.arrivals.countZero', 'No arrivals yet')
          : t('calendar.setup.arrivals.count', '{{count}} arrivals', {
              count: step.count,
            });
    }
  };

  // The one step to point at. A checklist where four buttons are equally loud
  // is the empty state's "two buttons, pick one" problem again, four times.
  const nextStepKey = checklist.steps.find((step) => !step.isDone)?.key;

  const progressLabel = t('calendar.setup.progress', '{{done}} of {{total}} done', {
    done: checklist.doneCount,
    total: checklist.stepCount,
  });

  // Computed geometry, so it cannot be a utility class — see the inline-style
  // carve-out in AGENTS.md.
  const progressPercent =
    checklist.stepCount === 0
      ? 0
      : Math.round((checklist.doneCount / checklist.stepCount) * 100);

  return (
    <Card className={cn('mx-auto w-full max-w-lg', className)}>
      <CardHeader className="gap-3">
        <h2 className="text-lg font-semibold text-foreground text-balance">
          {t('calendar.setup.title', 'Set this trip up')}
        </h2>
        <p className="text-sm text-muted-foreground text-pretty">
          {t(
            'calendar.setup.description',
            'The calendar fills in as you work through these steps.',
          )}
        </p>

        <div className="flex items-center gap-3">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={t('calendar.setup.progressLabel', 'Trip setup progress')}
            aria-valuenow={checklist.doneCount}
            aria-valuemin={0}
            aria-valuemax={checklist.stepCount}
            aria-valuetext={progressLabel}
          >
            <div
              className="h-full rounded-full bg-success"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p
            className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {progressLabel}
          </p>
        </div>
      </CardHeader>

      <CardContent>
        <ol className="flex flex-col gap-3">
          {checklist.steps.map((step) => {
            const StepIcon = STEP_ICONS[step.key];
            const isNext = step.key === nextStepKey;

            return (
              /* A grid rather than one flex row. The action labels are short
                 phrases ("Assign rooms", "Nouvel arrivant") and a Button is
                 `whitespace-nowrap shrink-0`, so on a phone the button held its
                 full width and the only thing left to give was the step's own
                 text — which squeezed to a couple of characters per line beside
                 a button that looked enormous next to it. Here the button drops
                 to its own line under the text until there is room for a third
                 column, and the text keeps the width it needs at every size. */
              <li
                key={step.key}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
              >
                {/* Tick or icon, never colour alone: the tick is the shape that
                    says "done" for anyone who cannot see the green. */}
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full',
                    step.isDone
                      ? 'bg-success-surface text-success-on-surface'
                      : 'bg-muted text-muted-foreground',
                  )}
                  aria-hidden="true"
                >
                  {step.isDone ? (
                    <Check className="size-4" strokeWidth={2.5} />
                  ) : (
                    <StepIcon className="size-4" strokeWidth={1.75} />
                  )}
                </span>

                <div className="min-w-0">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      step.isDone ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {stepTitle[step.key]}
                    {step.isDone && (
                      <span className="sr-only">
                        {' '}
                        {t('calendar.setup.stepDone', 'done')}
                      </span>
                    )}
                  </p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {stepCountLabel(step)}
                  </p>
                </div>

                {!step.isDone && (
                  <Button
                    size="sm"
                    variant={isNext ? 'default' : 'outline'}
                    onClick={handlers[step.key]}
                    className="col-start-2 justify-self-start sm:col-start-3 sm:justify-self-end"
                  >
                    {stepAction[step.key]}
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { TripSetupChecklist };
