/**
 * @fileoverview Guards the notice that hands a drifted shared car back to its
 * driver.
 *
 * Three things this file is careful about:
 *
 * - **The strings are real.** It renders through `renderWithRealI18n`, so
 *   "Alice is 120 minutes late" is asserted as the sentence a driver reads
 *   rather than as a key that would still pass with the catalogue deleted —
 *   and `moveCost`'s plural selection is exercised, which the suite-wide `t`
 *   mock cannot do because it drops `count`.
 * - **Time is timezone-free.** Every fixture instant is built with
 *   `localInstant`, so a 17:00 car and a 19:00 train stay two hours apart in
 *   Kiritimati and at CI's UTC alike.
 * - **The journeys come from `resolveRides`.** Flagging is the foundation's
 *   job, so the fixtures go through it rather than hand-setting `mismatch` —
 *   except where the point is precisely that this component refuses a journey
 *   `resolveRides` could never produce.
 *
 * @module features/transports/components/__tests__/RideMismatchNotice.test
 */

vi.unmock('i18next');
vi.unmock('react-i18next');

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hexColor,
  localInstant,
  renderWithRealI18n,
  screen,
  waitFor,
} from '@/test/utils';
import { resolveRides } from '@/features/transports/utils/ride-model';
import type { ResolvedRide } from '@/features/transports/utils/ride-model';
import type {
  Person,
  PersonId,
  Ride,
  RideId,
  Transport,
  TransportId,
  TripId,
  VehicleId,
} from '@/types';

import { RideMismatchNotice } from '../RideMismatchNotice';

// ============================================================================
// Mocks
// ============================================================================

const { updateRide, setTransportRide, successToast, errorToast } = vi.hoisted(
  () => ({
    updateRide: vi.fn(),
    setTransportRide: vi.fn(),
    successToast: vi.fn(),
    errorToast: vi.fn(),
  }),
);

vi.mock('@/contexts/RideContext', () => ({
  useRideContext: () => ({ updateRide, setTransportRide }),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({ successToast }),
}));

vi.mock('sonner', () => ({
  toast: { success: successToast, error: errorToast },
}));

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId,
  RIDE_ID = 'ride-1' as RideId;

/** The car everybody agreed on: Lyon Part-Dieu, 17:00. */
const MEET_AT = localInstant('2026-04-11', '17:00');

function makePerson(id: string, name: string): Person {
  return {
    id: id as PersonId,
    tripId: TRIP_ID,
    name,
    color: hexColor('#3b82f6'),
  };
}

function makeTransport(
  id: string,
  personId: string,
  datetime: string,
  overrides: Partial<Transport> = {},
): Transport {
  return {
    id: id as TransportId,
    tripId: TRIP_ID,
    personId: personId as PersonId,
    type: 'arrival',
    datetime,
    location: 'Lyon Part-Dieu',
    needsPickup: true,
    rideId: RIDE_ID,
    ...overrides,
  };
}

const RIDE: Ride = {
  id: RIDE_ID,
  tripId: TRIP_ID,
  direction: 'pickup',
  meetDatetime: MEET_AT,
  location: 'Lyon Part-Dieu',
  driverId: 'guillaume' as PersonId,
  vehicleId: 'car-1' as VehicleId,
};

const PERSONS: Person[] = [
  makePerson('alice', 'Alice'),
  makePerson('tom', 'Tom'),
  makePerson('aurelia', 'Aurélia'),
  makePerson('guillaume', 'Guillaume'),
];

/**
 * Resolves one journey out of the transports given, so the fixtures exercise
 * the same flagging every surface reads.
 *
 * @param transports - The legs of the trip
 * @param rides - The rides of the trip, defaulting to the 17:00 car
 * @returns The single resolved journey
 */
function journeyFrom(
  transports: readonly Transport[],
  rides: readonly Ride[] = [RIDE],
): ResolvedRide {
  const [journey] = resolveRides({
    transports,
    rides,
    vehicles: [],
    persons: PERSONS,
  });

  if (journey === undefined) {
    throw new Error('The fixture resolved to no journey at all');
  }

  return journey;
}

/** Alice moved her train two hours; Tom and Aurélia did not move. */
const ALICE_LATE = makeTransport('t-alice', 'alice', localInstant('2026-04-11', '19:00')),
  TOM = makeTransport('t-tom', 'tom', localInstant('2026-04-11', '17:00')),
  AURELIA = makeTransport('t-aurelia', 'aurelia', localInstant('2026-04-11', '17:05'));

// ============================================================================
// Tests
// ============================================================================

describe('RideMismatchNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateRide.mockResolvedValue(undefined);
    setTransportRide.mockResolvedValue(undefined);
  });

  describe('flagging the drift', () => {
    it('names the guest, the direction and the exact minutes they moved', async () => {
      await renderWithRealI18n(
        <RideMismatchNotice journey={journeyFrom([ALICE_LATE, TOM, AURELIA])} />,
        { withProviders: false },
      );

      const notice = screen.getByRole('alert');

      expect(notice).toHaveTextContent(
        'Alice now arrives 120 min after this ride',
      );
      // Tom and Aurélia still fit the car, so nothing accuses them of moving.
      expect(notice).not.toHaveTextContent('Tom now arrives');
      expect(notice).not.toHaveTextContent('Aurélia now arrives');
    });

    it('flags a guest who moved earlier as before, not after', async () => {
      const aliceEarly = makeTransport(
        't-alice',
        'alice',
        localInstant('2026-04-11', '15:00'),
      );

      await renderWithRealI18n(
        <RideMismatchNotice journey={journeyFrom([aliceEarly, TOM])} />,
        { withProviders: false },
      );

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Alice now arrives 120 min before this ride',
      );
    });

    it('says the ride has not moved by itself, so colour is not the only carrier', async () => {
      await renderWithRealI18n(
        <RideMismatchNotice journey={journeyFrom([ALICE_LATE, TOM])} />,
        { withProviders: false },
      );

      expect(screen.getByRole('alert')).toHaveTextContent(
        /has kept its time, and nobody has been taken out of it/i,
      );
    });

    it('renders nothing when every leg still fits the car', async () => {
      await renderWithRealI18n(
        <RideMismatchNotice journey={journeyFrom([TOM, AURELIA])} />,
        { withProviders: false },
      );

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('never flags a leg whose datetime cannot be read', async () => {
      const unreadable = makeTransport('t-alice', 'alice', 'not-a-datetime');

      await renderWithRealI18n(
        <RideMismatchNotice journey={journeyFrom([unreadable, TOM])} />,
        { withProviders: false },
      );

      // We cannot prove the row does not fit, so it must not accuse Alice of
      // having moved — and with nothing else flagged there is no notice at all.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('legacy journeys', () => {
    it('renders nothing for a driverId-only transport', async () => {
      const legacy = makeTransport('t-alice', 'alice', localInstant('2026-04-11', '19:00'), {
        rideId: undefined,
        driverId: 'guillaume' as PersonId,
      });

      await renderWithRealI18n(
        <RideMismatchNotice journey={journeyFrom([legacy], [])} />,
        { withProviders: false },
      );

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('refuses a legacy journey even when a leg arrives already flagged', async () => {
      // `resolveRides` cannot produce this — a one-passenger journey derived
      // from its own leg cannot disagree with it. The guard is asserted anyway,
      // because there is no `Ride` row to move and offering to move one would
      // be an action with nothing behind it.
      const base = journeyFrom([ALICE_LATE, TOM]),
        flaggedLeg = base.legs.find((leg) => leg.mismatch !== undefined);

      if (flaggedLeg === undefined) {
        throw new Error('The fixture produced no flagged leg to borrow');
      }

      const legacyJourney: ResolvedRide = {
        ...base,
        ride: undefined,
        isLegacy: true,
        legs: [flaggedLeg],
      };

      await renderWithRealI18n(<RideMismatchNotice journey={legacyJourney} />, {
        withProviders: false,
      });

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('moving the ride', () => {
    it('offers the drifted time and names who the move would push out', async () => {
      await renderWithRealI18n(
        <RideMismatchNotice journey={journeyFrom([ALICE_LATE, TOM, AURELIA])} />,
        { withProviders: false },
      );

      expect(
        screen.getByRole('button', { name: /Move the ride to .*19:00/ }),
      ).toBeInTheDocument();

      const notice = screen.getByRole('alert');
      expect(notice).toHaveTextContent(
        'Moving there would leave 2 other passengers too far from the car: Tom, Aurélia.',
      );
    });

    it('says the move costs nothing when nobody else is in the car', async () => {
      await renderWithRealI18n(
        <RideMismatchNotice journey={journeyFrom([ALICE_LATE])} />,
        { withProviders: false },
      );

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Nobody else in this car is put out by that move.',
      );
    });

    it('names the single passenger a move would push out', async () => {
      await renderWithRealI18n(
        <RideMismatchNotice journey={journeyFrom([ALICE_LATE, TOM])} />,
        { withProviders: false },
      );

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Moving there would leave Tom too far from the car.',
      );
    });

    it('prices the move in French too, plural form and all', async () => {
      // The French catalogue is the half an English-only assertion can never
      // reach: `t` falls back to it, so a key missing from `en` still renders
      // and a key missing from `fr` renders as itself.
      await renderWithRealI18n(
        <RideMismatchNotice journey={journeyFrom([ALICE_LATE, TOM, AURELIA])} />,
        { language: 'fr', withProviders: false },
      );

      const notice = screen.getByRole('alert');

      expect(notice).toHaveTextContent(
        'Alice arrive maintenant 120 min après ce trajet',
      );
      expect(notice).toHaveTextContent(
        'Ce décalage laisserait 2 autres passagers trop loin de la voiture : Tom, Aurélia.',
      );
      expect(
        screen.getByRole('button', { name: /Retirer Alice de ce trajet/ }),
      ).toBeInTheDocument();
    });

    it('moves the ride to the drifted leg own time, and only on a click', async () => {
      const { user } = await renderWithRealI18n(
        <RideMismatchNotice journey={journeyFrom([ALICE_LATE, TOM, AURELIA])} />,
        { withProviders: false },
      );

      expect(updateRide).not.toHaveBeenCalled();

      await user.click(
        screen.getByRole('button', { name: /Move the ride to .*19:00/ }),
      );

      expect(updateRide).toHaveBeenCalledTimes(1);
      expect(updateRide).toHaveBeenCalledWith(RIDE_ID, {
        meetDatetime: ALICE_LATE.datetime,
      });
      // Moving the car is not dropping anybody from it.
      expect(setTransportRide).not.toHaveBeenCalled();
    });

    it('tells the driver when the move could not be saved', async () => {
      updateRide.mockRejectedValue(new Error('offline'));
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      const { user } = await renderWithRealI18n(
        <RideMismatchNotice journey={journeyFrom([ALICE_LATE, TOM])} />,
        { withProviders: false },
      );

      await user.click(
        screen.getByRole('button', { name: /Move the ride to .*19:00/ }),
      );

      expect(errorToast).toHaveBeenCalledWith('Failed to save');
      // The button comes back rather than staying stuck on the failed attempt.
      expect(
        screen.getByRole('button', { name: /Move the ride to .*19:00/ }),
      ).toBeEnabled();

      consoleError.mockRestore();
    });
  });

  describe('dropping the passenger', () => {
    it('asks first, and says the seat goes rather than the journey', async () => {
      const { user } = await renderWithRealI18n(
        <RideMismatchNotice journey={journeyFrom([ALICE_LATE, TOM, AURELIA])} />,
        { withProviders: false },
      );

      await user.click(
        screen.getByRole('button', { name: 'Drop Alice from this ride' }),
      );

      expect(setTransportRide).not.toHaveBeenCalled();

      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toHaveTextContent('Drop Alice from this ride?');
      expect(dialog).toHaveTextContent(/keeps their travel plans/i);
      expect(dialog).toHaveTextContent(/back to needing a lift/i);
    });

    it('detaches only that leg from the ride', async () => {
      const { user } = await renderWithRealI18n(
        <RideMismatchNotice journey={journeyFrom([ALICE_LATE, TOM, AURELIA])} />,
        { withProviders: false },
      );

      await user.click(
        screen.getByRole('button', { name: 'Drop Alice from this ride' }),
      );
      await user.click(screen.getByRole('button', { name: 'Drop from ride' }));

      expect(setTransportRide).toHaveBeenCalledTimes(1);
      expect(setTransportRide).toHaveBeenCalledWith(ALICE_LATE.id, undefined);
      // Tom and Aurélia keep their seats, and the car keeps its time.
      expect(setTransportRide).not.toHaveBeenCalledWith(TOM.id, undefined);
      expect(updateRide).not.toHaveBeenCalled();
    });

    it('closes the question once the seat is actually gone', async () => {
      const { user } = await renderWithRealI18n(
        <RideMismatchNotice journey={journeyFrom([ALICE_LATE, TOM])} />,
        { withProviders: false },
      );

      await user.click(
        screen.getByRole('button', { name: 'Drop Alice from this ride' }),
      );
      await user.click(screen.getByRole('button', { name: 'Drop from ride' }));

      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      });
    });

    it('keeps the question open when the drop could not be saved', async () => {
      setTransportRide.mockRejectedValue(new Error('offline'));
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      const { user } = await renderWithRealI18n(
        <RideMismatchNotice journey={journeyFrom([ALICE_LATE, TOM])} />,
        { withProviders: false },
      );

      await user.click(
        screen.getByRole('button', { name: 'Drop Alice from this ride' }),
      );
      await user.click(screen.getByRole('button', { name: 'Drop from ride' }));

      expect(errorToast).toHaveBeenCalledWith('Failed to save');
      // Dismissing it would leave the driver certain they had dropped somebody
      // who is still in the car.
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Drop from ride' }),
      ).toBeEnabled();

      consoleError.mockRestore();
    });

    it('drops the guest the button belongs to when several legs drifted', async () => {
      const tomEarly = makeTransport(
        't-tom',
        'tom',
        localInstant('2026-04-11', '14:00'),
      );

      const { user } = await renderWithRealI18n(
        <RideMismatchNotice journey={journeyFrom([ALICE_LATE, tomEarly, AURELIA])} />,
        { withProviders: false },
      );

      await user.click(
        screen.getByRole('button', { name: 'Drop Tom from this ride' }),
      );
      await user.click(screen.getByRole('button', { name: 'Drop from ride' }));

      expect(setTransportRide).toHaveBeenCalledTimes(1);
      expect(setTransportRide).toHaveBeenCalledWith(tomEarly.id, undefined);
    });
  });

});
