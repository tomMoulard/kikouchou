/**
 * @fileoverview Tests for RideCard.
 *
 * The fixtures are fed through the real `resolveRides` rather than hand-built
 * as `ResolvedRide` literals. That is the contract this card exists to honour:
 * it must draw whatever the resolver produces, including the legacy
 * `driverId`-only transport the resolver hands back as a one-passenger journey
 * with no ride row behind it. A hand-built literal would let the card and the
 * resolver drift apart in exactly the place the two are supposed to meet.
 *
 * `react-i18next` is mocked locally rather than through `src/test/setup.ts`,
 * because the values this card is judged on — the meeting time, and the "leave
 * at" time derived from `leaveAtMs` — reach the DOM only as interpolations.
 * The global mock drops them, which would leave the derivation untested.
 *
 * Datetimes are offset-less local wall clocks, and the expected times are
 * derived from the same instants, so nothing here passes or fails by timezone.
 *
 * @module features/transports/components/__tests__/RideCard.test
 */

import { describe, expect, it, vi } from 'vitest';
import { enUS } from 'date-fns/locale';

import { render, screen, userEvent, within } from '@/test/utils';
import { createHeadcountResolver } from '@/features/rooms/utils/capacity-utils';
import { collectDrivenRideIds } from '@/features/transports/utils/pickup-utils';
import {
  type ResolvedRide,
  resolveRides,
} from '@/features/transports/utils/ride-model';
import type {
  HexColor,
  ISODateTimeString,
  Person,
  PersonId,
  Ride,
  RideId,
  Transport,
  TransportId,
  TripId,
  Vehicle,
  VehicleId,
} from '@/types';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) => {
      if (typeof options !== 'object' || options === null) {
        return key;
      }
      const parts = Object.entries(options as Record<string, unknown>).map(
        ([name, value]) => `${name}=${String(value)}`,
      );
      return parts.length === 0 ? key : `${key}(${parts.join(',')})`;
    },
    i18n: { language: 'en' },
  }),
}));

import { RideCard } from '../RideCard';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;

/** Offset-less, so it reads as the machine's own wall clock either side. */
const MEET_DATETIME = '2026-07-15T14:30:00' as ISODateTimeString;

/**
 * A guest.
 *
 * @param id - Person id
 * @param name - Display name
 * @param color - Badge colour
 * @returns The person record
 */
function makePerson(id: string, name: string, color: string): Person {
  return {
    id: id as PersonId,
    tripId: TRIP_ID,
    name,
    color: color as HexColor,
  };
}

/**
 * One guest's leg.
 *
 * @param id - Transport id
 * @param personId - The traveller
 * @param datetime - Offset-less ISO datetime
 * @param overrides - Anything else the test cares about
 * @returns The transport record
 */
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
    datetime: datetime as ISODateTimeString,
    location: 'Paris CDG',
    needsPickup: true,
    ...overrides,
  };
}

const ALICE = makePerson('person-alice', 'Alice', '#3b82f6'),
  BOB = makePerson('person-bob', 'Bob', '#ef4444'),
  CHARLIE = makePerson('person-charlie', 'Charlie', '#22c55e'),
  DRIVER = makePerson('person-diane', 'Diane', '#a855f7'),
  ESPACE: Vehicle = {
    id: 'vehicle-1' as VehicleId,
    tripId: TRIP_ID,
    name: 'Rented Espace',
    seatCount: 7,
  };

/**
 * What one resolved journey needs to be drawn.
 *
 * The driven-ride index travels with the journey rather than being defaulted
 * empty, because "is anybody driving this" is answered from it: a test handed
 * an empty set would quietly stop asking the question it is named for.
 */
interface CardFixture {
  readonly journey: ResolvedRide;
  readonly drivenRideIds: ReadonlySet<string>;
  /**
   * The real resolver over the fixture's own roster, not a stub returning 1.
   *
   * The card's capacity chips are counted through it, and a stub would make a
   * guest row standing for a couple take one seat — which is the exact reading
   * `HeadcountResolver` is required rather than optional to prevent.
   */
  readonly resolveHeadcount: ReturnType<typeof createHeadcountResolver>;
}

/**
 * Resolves one journey out of the rows a real trip would hold.
 *
 * @param transports - The legs
 * @param rides - The trip's rides
 * @param persons - The roster the legs and the driver resolve against
 * @param vehicles - The trip's cars
 * @returns The first journey, with the index its card needs
 */
function resolveFixture(
  transports: readonly Transport[],
  rides: readonly Ride[],
  persons: readonly Person[],
  vehicles: readonly Vehicle[] = [],
): CardFixture {
  const journey = resolveRides({ transports, rides, vehicles, persons })[0];

  if (journey === undefined) {
    throw new Error('resolveRides returned no journey for the fixture');
  }
  return {
    journey,
    drivenRideIds: collectDrivenRideIds(rides),
    resolveHeadcount: createHeadcountResolver(persons),
  };
}

/**
 * Builds the shared-car journey every test starts from.
 *
 * @param rideOverrides - Fields of the stored ride to change
 * @param persons - The roster the legs resolve against
 * @returns The single resolved journey and its driven-ride index
 */
function resolveSharedRide(
  rideOverrides: Partial<Ride> = {},
  persons: readonly Person[] = [ALICE, BOB, CHARLIE, DRIVER],
): CardFixture {
  const rideId = 'ride-1' as RideId,
    ride: Ride = {
      id: rideId,
      tripId: TRIP_ID,
      direction: 'pickup',
      meetDatetime: MEET_DATETIME,
      location: 'Paris CDG',
      leadTimeMinutes: 30,
      driverId: DRIVER.id,
      vehicleId: ESPACE.id,
      ...rideOverrides,
    },
    transports = [
      makeTransport('t-alice', ALICE.id, '2026-07-15T14:15:00', { rideId }),
      makeTransport('t-bob', BOB.id, '2026-07-15T14:30:00', { rideId }),
      makeTransport('t-charlie', CHARLIE.id, '2026-07-15T14:45:00', { rideId }),
    ];

  return resolveFixture(transports, [ride], persons, [ESPACE]);
}

/**
 * Renders a journey with the props every test would otherwise repeat.
 *
 * @param fixture - The resolved journey and its driven-ride index
 * @param handlers - Optional leg callbacks
 * @returns The callbacks, so a test can assert on them
 */
function renderCard(
  fixture: CardFixture,
  handlers: {
    onEditLeg?: (id: TransportId) => void;
    onDeleteLeg?: (id: TransportId) => void;
    onEditRide?: (id: RideId) => void;
    onDeleteRide?: (id: RideId) => void;
  } = {},
) {
  const onEditLeg = handlers.onEditLeg ?? vi.fn(),
    onDeleteLeg = handlers.onDeleteLeg ?? vi.fn();

  render(
    <RideCard
      journey={fixture.journey}
      dateLocale={enUS}
      drivenRideIds={fixture.drivenRideIds}
      resolveHeadcount={fixture.resolveHeadcount}
      onEditRide={handlers.onEditRide}
      onDeleteRide={handlers.onDeleteRide}
      onEditLeg={onEditLeg}
      onDeleteLeg={onDeleteLeg}
    />,
    { withProviders: false },
  );

  return { onEditLeg, onDeleteLeg };
}

// ============================================================================
// Tests
// ============================================================================

describe('RideCard', () => {
  it('draws three legs sharing a car as one card holding all three', () => {
    renderCard(resolveSharedRide());

    // One card, not three. This is the whole point of the component.
    expect(screen.getAllByRole('article')).toHaveLength(1);

    const card = screen.getByRole('article');
    expect(within(card).getByText('Alice')).toBeInTheDocument();
    expect(within(card).getByText('Bob')).toBeInTheDocument();
    expect(within(card).getByText('Charlie')).toBeInTheDocument();
    expect(within(card).getByText('rides.passengers(count=3)')).toBeInTheDocument();
  });

  it('names the driver and the car', () => {
    renderCard(resolveSharedRide());

    expect(screen.getByText('rides.driver:')).toBeInTheDocument();
    expect(screen.getByText('Diane')).toBeInTheDocument();
    expect(screen.getByText('Rented Espace')).toBeInTheDocument();
  });

  it('says nobody is driving and no car is chosen when neither is set', () => {
    renderCard(
      resolveSharedRide({ driverId: undefined, vehicleId: undefined }),
    );

    expect(screen.getByText('rides.noDriver')).toBeInTheDocument();
    expect(screen.getByText('rides.noVehicle')).toBeInTheDocument();
    expect(screen.queryByText('rides.driver:')).not.toBeInTheDocument();
  });

  it('does not report a driver the trip cannot name as no driver at all', () => {
    // The ride has a volunteer; this device just does not hold their guest row
    // — a real, transient state on the CRDT path. The amber alert gate reads
    // `isLegCovered`, which calls this ride covered, so a card saying "nobody
    // driving yet" would make the same page contradict itself.
    renderCard(resolveSharedRide({}, [ALICE, BOB, CHARLIE]));

    expect(screen.getByText('rides.driver: common.unknown')).toBeInTheDocument();
    expect(screen.queryByText('rides.noDriver')).not.toBeInTheDocument();
  });

  it('still reports a driver on a car nobody has joined yet', () => {
    // No legs at all, so there is no leg to ask `isLegCovered` about — a car
    // arranged before anybody claims a seat. The ride's own `driverId` is the
    // field `collectDrivenRideIds` indexes, so it is the one that answers here.
    const ride: Ride = {
      id: 'ride-empty' as RideId,
      tripId: TRIP_ID,
      direction: 'pickup',
      meetDatetime: MEET_DATETIME,
      location: 'Paris CDG',
      driverId: DRIVER.id,
    };

    renderCard(resolveFixture([], [ride], [DRIVER]));

    expect(screen.getByText('rides.driver:')).toBeInTheDocument();
    expect(screen.getByText('Diane')).toBeInTheDocument();
    expect(screen.queryByText('rides.noDriver')).not.toBeInTheDocument();
    expect(screen.getByText('rides.passengers(count=0)')).toBeInTheDocument();
  });

  it('says the guests are driving themselves instead of naming a chauffeur', () => {
    // Alice owns one of the legs *and* drives: the hire-car case.
    renderCard(resolveSharedRide({ driverId: ALICE.id }));

    expect(screen.getByText('rides.selfDriven')).toBeInTheDocument();
    expect(screen.queryByText('rides.driver:')).not.toBeInTheDocument();
    // She is still in the car, and still listed in it.
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows the meeting time and the leave time derived from the lead time', () => {
    renderCard(resolveSharedRide());

    // 14:30 rendez-vous, 30 minutes of lead time, so the driver leaves at 14:00.
    expect(screen.getByText('rides.meetAt(time=14:30)')).toBeInTheDocument();
    expect(screen.getByText('rides.leaveAt(time=14:00)')).toBeInTheDocument();
    expect(screen.getByText('Paris CDG')).toBeInTheDocument();
  });

  it('moves the leave time with the ride lead time', () => {
    renderCard(resolveSharedRide({ leadTimeMinutes: 90 }));

    expect(screen.getByText('rides.leaveAt(time=13:00)')).toBeInTheDocument();
  });

  it('gives every passenger their own leg time', () => {
    renderCard(resolveSharedRide());

    // Three different arrivals inside one car — a single shared time would be
    // wrong for two of the three people standing at the terminal.
    expect(screen.getByText('14:15')).toBeInTheDocument();
    expect(screen.getByText('14:45')).toBeInTheDocument();
    // 14:30 is both Bob's leg and the meeting time, so it appears twice.
    expect(screen.getAllByText('14:30').length).toBeGreaterThanOrEqual(1);
  });

  it('labels a leg whose guest the trip no longer holds', () => {
    renderCard(resolveSharedRide({}, [BOB, CHARLIE, DRIVER]));

    expect(screen.getByText('common.unknown')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('renders a legacy driverId-only transport as a one-passenger ride', () => {
    const legacy = makeTransport('t-legacy', ALICE.id, MEET_DATETIME, {
        driverId: DRIVER.id,
      }),
      fixture = resolveFixture([legacy], [], [ALICE, DRIVER]);

    // The distinction the resolver keeps: no row to edit yet.
    expect(fixture.journey.isLegacy).toBe(true);
    expect(fixture.journey.ride).toBeUndefined();

    renderCard(fixture);

    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('rides.passengers(count=1)')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('rides.driver:')).toBeInTheDocument();
    expect(screen.getByText('Diane')).toBeInTheDocument();
    // No car was ever recorded on the old shape, and none is invented.
    expect(screen.getByText('rides.noVehicle')).toBeInTheDocument();
    // Default lead time of 30 minutes against a 14:30 leg.
    expect(screen.getByText('rides.leaveAt(time=14:00)')).toBeInTheDocument();
  });

  it('marks a dropoff with the departure direction', () => {
    renderCard(resolveSharedRide({ direction: 'dropoff' }));

    expect(screen.getByText('rides.directions.dropoff')).toBeInTheDocument();
    expect(screen.queryByText('rides.directions.pickup')).not.toBeInTheDocument();
  });

  it('keeps each passenger their own flight number and notes', () => {
    const rideId = 'ride-1' as RideId,
      ride: Ride = {
        id: rideId,
        tripId: TRIP_ID,
        direction: 'pickup',
        meetDatetime: MEET_DATETIME,
        location: 'Paris CDG',
      };

    renderCard(
      resolveFixture(
        [
          makeTransport('t-alice', ALICE.id, MEET_DATETIME, {
            rideId,
            transportNumber: 'AF123',
            notes: 'Meet at gate 12',
          }),
        ],
        [ride],
        [ALICE],
      ),
    );

    expect(screen.getByText('AF123')).toBeInTheDocument();
    expect(screen.getByText('Meet at gate 12')).toBeInTheDocument();
  });

  it('edits and deletes the leg the row belongs to, not the journey', async () => {
    const user = userEvent.setup(),
      onEditLeg = vi.fn(),
      onDeleteLeg = vi.fn();

    renderCard(resolveSharedRide(), { onEditLeg, onDeleteLeg });

    // Named per passenger, so three identical "Actions" buttons cannot be
    // confused with one another by a screen reader or by this test.
    await user.click(
      screen.getByRole('button', { name: 'common.actions: Charlie' }),
    );
    await user.click(screen.getByText('common.edit'));

    expect(onEditLeg).toHaveBeenCalledWith('t-charlie');
    expect(onDeleteLeg).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'common.actions: Alice' }));
    await user.click(screen.getByText('common.delete'));

    expect(onDeleteLeg).toHaveBeenCalledWith('t-alice');
  });

  it('disables the row actions when asked', () => {
    const fixture = resolveSharedRide();

    render(
      <RideCard
        journey={fixture.journey}
        dateLocale={enUS}
        drivenRideIds={fixture.drivenRideIds}
        resolveHeadcount={fixture.resolveHeadcount}
        onEditLeg={vi.fn()}
        onDeleteLeg={vi.fn()}
        isActionsDisabled
      />,
      { withProviders: false },
    );

    for (const button of screen.getAllByRole('button', {
      name: /common\.actions/,
    })) {
      expect(button).toBeDisabled();
    }
  });

  it('names the journey in its accessible label', () => {
    renderCard(resolveSharedRide());

    const card = screen.getByRole('article'),
      label = card.getAttribute('aria-label') ?? '';

    // The label is what a screen reader hears instead of the layout, so it has
    // to carry the same four facts the card shows.
    expect(label).toContain('rides.directions.pickup');
    expect(label).toContain('14:30');
    expect(label).toContain('Paris CDG');
    expect(label).toContain('rides.driver: Diane');
  });

  // ==========================================================================
  // The Car's Own Actions
  // ==========================================================================

  describe('the journey menu', () => {
    /** The card's own actions trigger, distinct from a passenger row's. */
    function journeyMenuButton(): HTMLElement {
      return screen.getByRole('button', {
        name: 'common.actions: rides.directions.pickup',
      });
    }

    it('opens the ride for editing, naming the ride and not a leg', async () => {
      const onEditRide = vi.fn(),
        fixture = resolveSharedRide(),
        user = userEvent.setup();

      renderCard(fixture, { onEditRide });

      await user.click(journeyMenuButton());
      await user.click(screen.getByText('rides.edit'));

      // The *ride's* id. A card carries three legs and one journey, and handing
      // back a leg id here would open one passenger's arrival on a control that
      // says it edits the car.
      expect(onEditRide).toHaveBeenCalledWith(fixture.journey.ride?.id);
    });

    it('offers to cancel the journey', async () => {
      const onDeleteRide = vi.fn(),
        fixture = resolveSharedRide(),
        user = userEvent.setup();

      renderCard(fixture, { onDeleteRide });

      await user.click(journeyMenuButton());
      await user.click(screen.getByText('rides.cancel'));

      expect(onDeleteRide).toHaveBeenCalledWith(fixture.journey.ride?.id);
    });

    it('is absent on a legacy journey, which has no ride to act on', () => {
      const legacy = makeTransport('t-legacy', ALICE.id, MEET_DATETIME, {
          driverId: DRIVER.id,
        }),
        fixture = resolveFixture([legacy], [], [ALICE, DRIVER]);

      expect(fixture.journey.isLegacy).toBe(true);

      renderCard(fixture, { onEditRide: vi.fn(), onDeleteRide: vi.fn() });

      // Both handlers were supplied, so their absence is the card's decision
      // and not the caller's: a `driverId`-only leg has no `Ride` row, so there
      // is nothing for an edit to open and nothing for a cancel to remove.
      expect(
        screen.queryByRole('button', {
          name: 'common.actions: rides.directions.pickup',
        }),
      ).not.toBeInTheDocument();
    });

    it('shows no journey menu when the page offers no handlers', () => {
      renderCard(resolveSharedRide());

      expect(
        screen.queryByRole('button', {
          name: 'common.actions: rides.directions.pickup',
        }),
      ).not.toBeInTheDocument();
    });
  });
});
