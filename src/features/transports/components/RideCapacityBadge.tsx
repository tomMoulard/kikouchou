/**
 * @fileoverview "Does this lot fit in that car?", said out loud.
 *
 * `summariseRideCapacity` already answers the question; this renders the
 * answer, and nothing else. It takes the summary rather than a journey so the
 * ride card and the ride form can hand it the same object and cannot end up
 * disagreeing about the same car — and so this file never has to decide how
 * many people a guest row stands for.
 *
 * Three rules the helper encodes that this component must not undo:
 *
 * - **Count people, not rows.** The summary is built by summing a required
 *   {@link HeadcountResolver}, so "Alice+Auré" is two seats. Nothing here
 *   counts `legs.length`; build the summary with `createHeadcountResolver`.
 * - **An absent limit is not a limit of zero.** `seatsAvailable === undefined`
 *   means the car has not been measured (or none is chosen yet), so it renders
 *   as `vehicles.seatsUnknown` and raises nothing. Drawing a missing capacity
 *   as `0 seats` would mark every unmeasured car overloaded.
 * - **Being exactly full is not a warning.** `isFull` gets a plain neutral
 *   chip; only {@link hasCapacityWarning} — over capacity, or a child seat the
 *   car does not carry — colours anything and announces anything.
 *
 * Colour never carries the meaning alone: every chip spells its state out in
 * words, and the two warning states add an icon on top of the tone.
 *
 * @module features/transports/components/RideCapacityBadge
 *
 * @example
 * ```tsx
 * const resolveHeadcount = useMemo(() => createHeadcountResolver(persons), [persons]);
 * const summary = useMemo(
 *   () => summariseRideCapacity(journey, resolveHeadcount),
 *   [journey, resolveHeadcount],
 * );
 * <RideCapacityBadge summary={summary} />
 * ```
 */

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  statusVariants,
  type StatusTone,
} from '@/components/ui/status.variants';
import {
  hasCapacityWarning,
  type RideCapacitySummary,
} from '@/features/transports/utils/ride-capacity';
import { cn } from '@/lib/utils';
import { CHILD_SEAT_KINDS } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** Props for {@link RideCapacityBadge}. */
export interface RideCapacityBadgeProps {
  /**
   * The answer to render.
   *
   * Build it with `summariseRideCapacity(journey, createHeadcountResolver(persons))`
   * — the resolver is what makes a couple travelling on one guest row take two
   * seats instead of one.
   */
  readonly summary: RideCapacitySummary;
  /** Extra classes for the chip row. */
  readonly className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * The seats and child seats of one ride, as a row of chips.
 *
 * The row is a live region either way, and only escalates to `role="alert"`
 * while something is actually wrong — so changing the car in the ride form
 * announces the consequence instead of leaving it to be noticed after saving,
 * and a ride that merely fills its car interrupts nobody.
 *
 * @param props - {@link RideCapacityBadgeProps}
 * @returns The capacity chips
 */
export const RideCapacityBadge = memo(function RideCapacityBadge({
  summary,
  className,
}: RideCapacityBadgeProps) {
  const { t } = useTranslation();

  // An unmeasured car and no car at all are the same question — "against what?"
  // — and get the same answer, rather than a capacity of zero.
  const isUnmeasured = summary.seatsAvailable === undefined,
    seatTone: StatusTone = summary.isOverCapacity ? 'danger' : 'neutral',
    seatLabel = isUnmeasured
      ? t('vehicles.seatsUnknown')
      : summary.isOverCapacity
        ? t('vehicles.overCapacity', {
            used: summary.seatsUsed,
            total: summary.seatsAvailable,
          })
        : t('vehicles.seatsUsed', {
            used: summary.seatsUsed,
            total: summary.seatsAvailable,
          });

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      // A live region from mount, rather than one that appears with the
      // warning: a region created in the same commit as its content is not
      // reliably announced, which would lose exactly the case this is for —
      // picking a smaller car in the ride form. `status` is the quiet default
      // and `alert` interrupts, so a benign seat count never talks over
      // anything while an overloaded car does.
      role={hasCapacityWarning(summary) ? 'alert' : 'status'}
      aria-atomic="true"
    >
      <Badge
        variant="outline"
        className={statusVariants({ tone: seatTone, emphasis: 'outline' })}
      >
        {summary.isOverCapacity ? <AlertTriangle aria-hidden="true" /> : null}
        {seatLabel}
      </Badge>

      {summary.isFull ? (
        <Badge
          variant="outline"
          className={statusVariants({ tone: 'neutral', emphasis: 'outline' })}
        >
          {t('vehicles.full')}
        </Badge>
      ) : null}

      {CHILD_SEAT_KINDS.map((kind) => {
        const required = summary.requiredChildSeats[kind];
        if (required === 0) return null;

        const shortfall = summary.childSeatShortfalls.find(
            (entry) => entry.kind === kind,
          ),
          // The kind is a word in its own right ("Booster seat"), so it is
          // translated once and interpolated into whichever sentence wraps it.
          kindLabel = t(`childSeats.${kind}`);

        return shortfall === undefined ? (
          <Badge
            key={kind}
            variant="outline"
            className={statusVariants({ tone: 'neutral', emphasis: 'outline' })}
          >
            {t('childSeats.required', { count: required, kind: kindLabel })}
          </Badge>
        ) : (
          <Badge
            key={kind}
            variant="outline"
            className={statusVariants({ tone: 'warning', emphasis: 'outline' })}
          >
            <AlertTriangle aria-hidden="true" />
            {t('childSeats.missing', {
              count: shortfall.missing,
              kind: kindLabel,
            })}
          </Badge>
        );
      })}
    </div>
  );
});
