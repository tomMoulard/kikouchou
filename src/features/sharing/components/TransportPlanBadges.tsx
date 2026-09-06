/**
 * @fileoverview How one leg is being covered, as badges, for the wizard.
 *
 * The transport step and the summary step both show a guest their own legs, and
 * both have to say the same thing about each one — so they say it from here.
 * When the two forked, the step that collected "I'll be driving" was also the
 * only step that showed it, and the summary the guest actually reads before
 * entering the trip still said nothing at all.
 *
 * Everything below is read from the leg itself, never from a {@link Ride}. The
 * wizard runs on a device that reached the trip through a share link, and
 * neither `Ride` nor `Vehicle` travels in a QR changeset yet, so a badge that
 * needed a ride row would be blank on exactly the devices this screen runs on.
 * A leg sitting in a ride whose row this device does not hold therefore shows
 * no driver badge rather than a guessed one: not knowing who is driving and
 * knowing that nobody is are different things to tell somebody.
 *
 * @module features/sharing/components/TransportPlanBadges
 */

import { type ReactElement, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isLegCovered } from '@/features/transports/utils/pickup-utils';
import { cn } from '@/lib/utils';
import type { PersonId, Transport } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export interface TransportPlanBadgesProps {
  /** The leg being described. */
  readonly transport: Transport;
  /** The guest holding this device, from the wizard's stored identity. */
  readonly guestPersonId: PersonId | undefined;
  /** Extra classes for the badge row. */
  readonly className?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** One badge's look, shared so the three cannot drift apart. */
const BADGE_CLASS =
  'rounded bg-warning-surface px-2 py-0.5 text-xs text-warning-on-surface';

/**
 * The rides this device knows somebody is driving — always none, here.
 *
 * The wizard runs outside `AppProviders` and reads no ride rows, so
 * {@link isLegCovered} is asked the only half of its question this screen can
 * answer: does the leg name a driver of its own. Passing the shared predicate
 * an empty set is deliberate rather than lazy — a local `driverId !== undefined`
 * would be a second definition of "somebody is driving this leg", and the two
 * surfaces that already had one contradicted each other on the same page.
 */
const NO_KNOWN_RIDES: ReadonlySet<string> = new Set();

// ============================================================================
// Component
// ============================================================================

/**
 * Renders the badges describing how a guest covers one leg.
 *
 * At most one driver badge appears, because the underlying states are
 * exclusive: the leg's driver is either this guest or somebody else.
 *
 * @param props - The leg and who is looking at it
 * @returns The badge row, empty when the leg says nothing worth badging
 *
 * @example
 * ```tsx
 * <TransportPlanBadges transport={leg} guestPersonId={guestPersonId} />
 * ```
 */
const TransportPlanBadges = memo(function TransportPlanBadges({
  transport,
  guestPersonId,
  className,
}: TransportPlanBadgesProps): ReactElement | null {
  const { t } = useTranslation();

  // Guarded on both sides: an undefined identity must not match an undefined
  // `driverId` and report a leg nobody is driving as "you are driving it".
  const isSelfDriving =
    guestPersonId !== undefined && transport.driverId === guestPersonId;
  const isDrivenByOther =
    transport.driverId !== undefined && transport.driverId !== guestPersonId;

  // A leg somebody is driving is not a leg waiting to be collected, whatever
  // its `needsPickup` flag still says. The flag goes stale on its own: the
  // organiser's transport form derives it from "is there a driver", so opening
  // a self-driven leg there and pressing save sets it back to true. Reading it
  // literally would print "Needs pickup" beside "Driving myself" — the two
  // states this component's own docblock calls exclusive.
  const showsPickup = transport.needsPickup && !isLegCovered(transport, NO_KNOWN_RIDES);

  if (!showsPickup && !isSelfDriving && !isDrivenByOther) {
    return null;
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {showsPickup && (
        <span className={BADGE_CLASS}>
          {t('sharing.transportNeedsPickupBadge', 'Needs pickup')}
        </span>
      )}
      {isSelfDriving && (
        <span className={BADGE_CLASS}>
          {t('sharing.transportDrivingBadge', 'Driving myself')}
        </span>
      )}
      {isDrivenByOther && (
        <span className={BADGE_CLASS}>
          {t('sharing.transportDrivenBadge', 'Someone is driving you')}
        </span>
      )}
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { TransportPlanBadges };
