/**
 * @fileoverview Tests for the wizard's per-leg travel-plan badges.
 * @module features/sharing/components/__tests__/TransportPlanBadges.test
 */

import { describe, expect, it } from 'vitest';

import { render, screen } from '@/test/utils';
import type { PersonId, Transport } from '@/types';

import { TransportPlanBadges } from '../TransportPlanBadges';

// ============================================================================
// Fixtures
// ============================================================================

const ME = 'person-me' as PersonId;
const SOMEBODY_ELSE = 'person-other' as PersonId;

function leg(overrides: Partial<Transport> = {}): Transport {
  return {
    id: 'transport-1',
    tripId: 'trip-1',
    personId: ME,
    type: 'arrival',
    datetime: '2026-07-15T14:30:00.000Z',
    location: 'Gare de Vannes',
    needsPickup: false,
    ...overrides,
  } as unknown as Transport;
}

// ============================================================================
// Tests
// ============================================================================

describe('TransportPlanBadges', () => {
  it('says a pickup is needed when the guest asked for one', () => {
    render(<TransportPlanBadges transport={leg({ needsPickup: true })} guestPersonId={ME} />, {
      withProviders: false,
    });

    expect(screen.getByText('sharing.transportNeedsPickupBadge')).toBeInTheDocument();
    expect(screen.queryByText('sharing.transportDrivingBadge')).not.toBeInTheDocument();
  });

  it('says the guest is driving when they are their own driver', () => {
    render(<TransportPlanBadges transport={leg({ driverId: ME })} guestPersonId={ME} />, {
      withProviders: false,
    });

    expect(screen.getByText('sharing.transportDrivingBadge')).toBeInTheDocument();
    expect(screen.queryByText('sharing.transportDrivenBadge')).not.toBeInTheDocument();
  });

  it('does not ask for a pickup on a leg the guest is driving themselves', () => {
    // `needsPickup` goes stale on its own: the organiser's transport form
    // derives it from "is there a driver", so opening a self-driven leg there
    // and pressing save sets it back to true without anybody deciding to.
    // Read literally, that printed "Needs pickup" beside "Driving myself".
    render(
      <TransportPlanBadges
        transport={leg({ needsPickup: true, driverId: ME })}
        guestPersonId={ME}
      />,
      { withProviders: false },
    );

    expect(screen.getByText('sharing.transportDrivingBadge')).toBeInTheDocument();
    expect(
      screen.queryByText('sharing.transportNeedsPickupBadge'),
    ).not.toBeInTheDocument();
  });

  it('says somebody else is driving when the driver is not the guest', () => {
    render(
      <TransportPlanBadges transport={leg({ driverId: SOMEBODY_ELSE })} guestPersonId={ME} />,
      { withProviders: false },
    );

    expect(screen.getByText('sharing.transportDrivenBadge')).toBeInTheDocument();
    expect(screen.queryByText('sharing.transportDrivingBadge')).not.toBeInTheDocument();
  });

  it('claims nothing about a leg nobody is driving', () => {
    const { container } = render(
      <TransportPlanBadges transport={leg()} guestPersonId={ME} />,
      { withProviders: false },
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('does not read an unknown identity as "you are driving"', () => {
    // Both sides undefined would compare equal. The wizard reaches this state
    // whenever the stored identity has not been parsed yet, and reporting a
    // driverless leg as self-driven would tell a guest a car was arranged.
    render(<TransportPlanBadges transport={leg()} guestPersonId={undefined} />, {
      withProviders: false,
    });

    expect(screen.queryByText('sharing.transportDrivingBadge')).not.toBeInTheDocument();
  });

  it('says nothing about a driver for a leg whose ride this device lacks', () => {
    // `Ride` does not travel in a QR changeset, so a guest device routinely
    // holds a leg pointing at a ride it has never seen. "We do not know who is
    // driving" must not be rendered as "nobody is".
    render(
      <TransportPlanBadges
        transport={leg({ rideId: 'ride-the-host-holds' as Transport['rideId'] })}
        guestPersonId={ME}
      />,
      { withProviders: false },
    );

    expect(screen.queryByText('sharing.transportDrivingBadge')).not.toBeInTheDocument();
    expect(screen.queryByText('sharing.transportDrivenBadge')).not.toBeInTheDocument();
  });
});
