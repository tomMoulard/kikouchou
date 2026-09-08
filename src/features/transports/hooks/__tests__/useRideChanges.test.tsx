/**
 * @fileoverview Tests for the pickup-change watermark.
 *
 * The trip data is mocked — every context this hook reads hands back a plain
 * array — while `rideNotices` is the **real** Dexie table. That split is the
 * point of the file: the watermark is the only thing here with a bug worth
 * catching, and it is the only thing exercised for real.
 *
 * Timezones are handled the way the invariant demands. Instants are compared,
 * never strings, so the offset-equivalence case below spells one instant two
 * ways (`…Z` and `+02:00`) and asserts it is *not* a change. No fixture encodes
 * the machine's own offset, so CI at UTC and a laptop in Paris agree.
 *
 * @module features/transports/hooks/__tests__/useRideChanges.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { act, renderHook, waitFor, hexColor } from '@/test/utils';
import { db } from '@/lib/db/database';
import { rideNoticeKey } from '@/lib/db';
import type {
  ISODateTimeString,
  Person,
  PersonId,
  Ride,
  RideId,
  Transport,
  TransportId,
  TripId,
} from '@/types';

// ============================================================================
// Mocked trip data
// ============================================================================

/** Everything the mocked contexts hand back, rewritten per test. */
const world = vi.hoisted(() => ({
  tripId: 'trip-changes' as string,
  persons: [] as unknown[],
  transports: [] as unknown[],
  rides: [] as unknown[],
  myPersonId: undefined as string | undefined,
}));

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({ currentTrip: { id: world.tripId } }),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({ persons: world.persons, isLoading: false }),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => ({ transports: world.transports, isLoading: false }),
}));

vi.mock('@/contexts/RideContext', () => ({
  useRideContext: () => ({ rides: world.rides, vehicles: [], isLoading: false }),
}));

vi.mock('@/hooks', () => ({
  useTripIdentity: () => ({
    myPersonId: world.myPersonId,
    source: 'explicit',
    isResolved: true,
    setMyPersonId: vi.fn(),
  }),
}));

import { useRideChanges } from '../useRideChanges';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = world.tripId as TripId;

const ALICE = 'person-alice' as PersonId;
const TOM = 'person-tom' as PersonId;
const CHLOE = 'person-chloe' as PersonId;

const RIDE_A = 'ride-a' as RideId;
const RIDE_B = 'ride-b' as RideId;

/** 17:00 Paris, spelled as the UTC instant the app stores. */
const AT_1700 = '2026-07-15T15:00:00.000Z';
/** The same instant, spelled with an offset instead. */
const AT_1700_OFFSET = '2026-07-15T17:00:00+02:00';
/** Two hours later. */
const AT_1900 = '2026-07-15T17:00:00.000Z';

/**
 * Builds a guest.
 *
 * @param id - The guest's id
 * @param name - Display name
 * @returns The person
 */
function makePerson(id: PersonId, name: string): Person {
  return { id, tripId: TRIP_ID, name, color: hexColor('#3b82f6') };
}

/**
 * Builds one leg.
 *
 * @param fields - Id, traveller, time and the car it sits in
 * @returns The transport
 */
function makeTransport(fields: {
  id: string;
  personId: PersonId;
  datetime: string;
  rideId?: RideId;
  driverId?: PersonId;
  tripId?: TripId;
}): Transport {
  return {
    id: fields.id as TransportId,
    tripId: fields.tripId ?? TRIP_ID,
    personId: fields.personId,
    type: 'arrival',
    datetime: fields.datetime as ISODateTimeString,
    location: 'Gare Montparnasse',
    needsPickup: true,
    rideId: fields.rideId,
    driverId: fields.driverId,
  };
}

/**
 * Builds a car journey.
 *
 * @param id - The ride's id
 * @param driverId - Who is driving
 * @param meetDatetime - The rendez-vous, ISO 8601
 * @returns The ride
 */
function makeRide(
  id: RideId,
  driverId: PersonId,
  meetDatetime: string = AT_1700,
): Ride {
  return {
    id,
    tripId: TRIP_ID,
    direction: 'pickup',
    meetDatetime: meetDatetime as ISODateTimeString,
    location: 'Gare Montparnasse',
    driverId,
  };
}

/**
 * Writes a watermark straight to the table, as an earlier session would have.
 *
 * Deliberately not routed through `markTransportSeen`: several tests need a
 * watermark that the repository would never write, such as one this device can
 * no longer parse.
 *
 * @param transportId - The leg being watermarked
 * @param seenDatetime - The time this device last showed
 */
async function seedWatermark(
  transportId: string,
  seenDatetime: string,
): Promise<void> {
  await db.rideNotices.put({
    key: rideNoticeKey('moved', transportId as TransportId),
    tripId: TRIP_ID,
    seenDatetime,
  });
}

/**
 * Renders the hook and waits for the first Dexie read to land.
 *
 * @returns The `renderHook` result
 */
async function renderChanges(): Promise<
  ReturnType<typeof renderHook<ReturnType<typeof useRideChanges>, unknown>>
> {
  const rendered = renderHook(() => useRideChanges());

  await waitFor(() => {
    expect(rendered.result.current.isLoading).toBe(false);
  });

  return rendered;
}

// ============================================================================
// Tests
// ============================================================================

describe('useRideChanges', () => {
  beforeEach(() => {
    world.tripId = TRIP_ID;
    // Tom drives, Alice and Chloé ride with him.
    world.persons = [
      makePerson(TOM, 'Tom'),
      makePerson(ALICE, 'Alice'),
      makePerson(CHLOE, 'Chloé'),
    ];
    world.rides = [makeRide(RIDE_A, TOM)];
    world.transports = [
      makeTransport({ id: 'leg-alice', personId: ALICE, datetime: AT_1700, rideId: RIDE_A }),
    ];
    world.myPersonId = TOM;
  });

  // --------------------------------------------------------------------------
  // Detection
  // --------------------------------------------------------------------------

  describe('detection', () => {
    it('does not call a leg it has never seen "moved"', async () => {
      const { result } = await renderChanges();

      expect(result.current.changes).toEqual([]);
      // It is watched from here on, which is a different statement.
      expect(result.current.unwatchedCount).toBe(1);
    });

    it('reports a leg whose time moved since this device showed it', async () => {
      await seedWatermark('leg-alice', AT_1700);
      world.transports = [
        makeTransport({
          id: 'leg-alice',
          personId: ALICE,
          datetime: AT_1900,
          rideId: RIDE_A,
        }),
      ];

      const { result } = await renderChanges();

      expect(result.current.changes).toHaveLength(1);
      const change = result.current.changes[0]!;
      expect(change.transport.id).toBe('leg-alice');
      expect(change.person?.name).toBe('Alice');
      expect(change.seenDatetime).toBe(AT_1700);
      expect(change.datetime).toBe(AT_1900);
      expect(change.movedLater).toBe(true);
      expect(change.journey.id).toBe(RIDE_A);
      expect(result.current.unwatchedCount).toBe(0);
    });

    it('reports a leg that moved earlier as moved earlier', async () => {
      await seedWatermark('leg-alice', AT_1900);

      const { result } = await renderChanges();

      expect(result.current.changes).toHaveLength(1);
      expect(result.current.changes[0]!.movedLater).toBe(false);
    });

    it('compares instants, so one time spelled two ways is not a change', async () => {
      // `+02:00` sorts *after* the `Z` form and happens at the same moment.
      await seedWatermark('leg-alice', AT_1700_OFFSET);

      const { result } = await renderChanges();

      expect(result.current.changes).toEqual([]);
      expect(result.current.unwatchedCount).toBe(0);
    });

    it('still reports a leg whose guest the trip no longer holds', async () => {
      world.persons = [makePerson(TOM, 'Tom')];
      await seedWatermark('leg-alice', AT_1700);
      world.transports = [
        makeTransport({
          id: 'leg-alice',
          personId: ALICE,
          datetime: AT_1900,
          rideId: RIDE_A,
        }),
      ];

      const { result } = await renderChanges();

      expect(result.current.changes).toHaveLength(1);
      expect(result.current.changes[0]!.person).toBeUndefined();
      expect(result.current.changes[0]!.transport.id).toBe('leg-alice');
    });

    it('separates loading from "nothing has moved"', () => {
      const { result } = renderHook(() => useRideChanges());

      // The first render happens before Dexie answers, and a feed that could
      // not tell the two apart would flash empty on every navigation.
      expect(result.current.isLoading).toBe(true);
      expect(result.current.changes).toEqual([]);
    });

    it('ignores a leg a context is still holding from another trip', async () => {
      // The contexts report `isLoading: false` the moment their own first
      // query lands and keep the previous trip's rows across a switch, so a
      // stray row is a real state rather than a hypothetical one.
      world.transports = [
        makeTransport({ id: 'leg-alice', personId: ALICE, datetime: AT_1700, rideId: RIDE_A }),
        makeTransport({
          id: 'leg-elsewhere',
          personId: ALICE,
          datetime: AT_1900,
          rideId: RIDE_A,
          tripId: 'trip-elsewhere' as TripId,
        }),
      ];
      await seedWatermark('leg-elsewhere', AT_1700);

      const { result } = await renderChanges();

      expect(result.current.changes).toEqual([]);
      // Only the leg that belongs here is waiting to be watched.
      expect(result.current.unwatchedCount).toBe(1);
    });

    it('discards a watermark map read for a different trip', async () => {
      await seedWatermark('leg-alice', AT_1700);
      world.transports = [
        makeTransport({
          id: 'leg-alice',
          personId: ALICE,
          datetime: AT_1900,
          rideId: RIDE_A,
        }),
      ];

      const { result, rerender } = await renderChanges();
      expect(result.current.changes).toHaveLength(1);

      // The user opens another trip. `useLiveQuery` keeps its previous result
      // across a deps change, so without the trip tag this would go on
      // weighing one trip's legs against another trip's watermarks.
      world.tripId = 'trip-elsewhere';
      rerender();

      expect(result.current.isLoading).toBe(true);
      expect(result.current.changes).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // Unreadable datetimes
  // --------------------------------------------------------------------------

  describe('unreadable datetimes', () => {
    it('never reports a leg whose datetime cannot be parsed', async () => {
      await seedWatermark('leg-alice', AT_1700);
      world.transports = [
        makeTransport({
          id: 'leg-alice',
          personId: ALICE,
          datetime: 'not-a-datetime',
          rideId: RIDE_A,
        }),
      ];

      const { result } = await renderChanges();

      expect(result.current.changes).toEqual([]);
      // Nor is it waiting to be watched: a watermark it could never be
      // compared against would keep the offer on screen forever.
      expect(result.current.unwatchedCount).toBe(0);
    });

    it('treats a watermark it cannot parse as no watermark at all', async () => {
      await seedWatermark('leg-alice', 'whatever-this-was');

      const { result } = await renderChanges();

      expect(result.current.changes).toEqual([]);
      expect(result.current.unwatchedCount).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Audience
  // --------------------------------------------------------------------------

  describe('audience', () => {
    it('reaches the driver of the car the moved leg travels in', async () => {
      await seedWatermark('leg-alice', AT_1700);
      world.transports = [
        makeTransport({
          id: 'leg-alice',
          personId: ALICE,
          datetime: AT_1900,
          rideId: RIDE_A,
        }),
      ];
      world.myPersonId = TOM;

      const { result } = await renderChanges();

      expect(result.current.changes).toHaveLength(1);
    });

    it('reaches a driver this device cannot name yet', async () => {
      // The ride has projected and the guest behind it has not, which is a
      // normal minute after a join rather than a corrupt state.
      world.persons = [makePerson(ALICE, 'Alice')];
      await seedWatermark('leg-alice', AT_1700);
      world.transports = [
        makeTransport({
          id: 'leg-alice',
          personId: ALICE,
          datetime: AT_1900,
          rideId: RIDE_A,
        }),
      ];
      world.myPersonId = TOM;

      const { result } = await renderChanges();

      expect(result.current.changes).toHaveLength(1);
    });

    it('reaches a car-mate who is not driving', async () => {
      await seedWatermark('leg-alice', AT_1700);
      world.transports = [
        makeTransport({
          id: 'leg-alice',
          personId: ALICE,
          datetime: AT_1900,
          rideId: RIDE_A,
        }),
        makeTransport({
          id: 'leg-chloe',
          personId: CHLOE,
          datetime: AT_1700,
          rideId: RIDE_A,
        }),
      ];
      world.myPersonId = CHLOE;

      const { result } = await renderChanges();

      expect(result.current.changes).toHaveLength(1);
      expect(result.current.changes[0]!.transport.id).toBe('leg-alice');
    });

    it('reaches nobody outside the car', async () => {
      // Chloé has her own car, and Alice's train moving is not her news.
      world.rides = [makeRide(RIDE_A, TOM), makeRide(RIDE_B, CHLOE)];
      world.transports = [
        makeTransport({
          id: 'leg-alice',
          personId: ALICE,
          datetime: AT_1900,
          rideId: RIDE_A,
        }),
        makeTransport({
          id: 'leg-chloe',
          personId: CHLOE,
          datetime: AT_1700,
          rideId: RIDE_B,
        }),
      ];
      await seedWatermark('leg-alice', AT_1700);
      await seedWatermark('leg-chloe', AT_1700);
      world.myPersonId = CHLOE;

      const { result } = await renderChanges();

      expect(result.current.changes).toEqual([]);
    });

    it('reports nothing at all when nobody is identified', async () => {
      await seedWatermark('leg-alice', AT_1700);
      world.transports = [
        makeTransport({
          id: 'leg-alice',
          personId: ALICE,
          datetime: AT_1900,
          rideId: RIDE_A,
        }),
      ];
      world.myPersonId = undefined;

      const { result } = await renderChanges();

      expect(result.current.changes).toEqual([]);
      expect(result.current.unwatchedCount).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Acknowledgement
  // --------------------------------------------------------------------------

  describe('acknowledgement', () => {
    it('advances the watermark, so the change is not reported twice', async () => {
      await seedWatermark('leg-alice', AT_1700);
      world.transports = [
        makeTransport({
          id: 'leg-alice',
          personId: ALICE,
          datetime: AT_1900,
          rideId: RIDE_A,
        }),
      ];

      const { result } = await renderChanges();
      expect(result.current.changes).toHaveLength(1);

      await act(async () => {
        await result.current.acknowledge('leg-alice' as TransportId);
      });

      await waitFor(() => {
        expect(result.current.changes).toEqual([]);
      });

      const row = await db.rideNotices.get(
        rideNoticeKey('moved', 'leg-alice' as TransportId),
      );
      expect(row?.seenDatetime).toBe(AT_1900);
    });

    it('writes no watermark on render alone', async () => {
      await renderChanges();

      // A change that arrived while the phone was in a pocket must not be
      // marked read by a card mounting.
      expect(await db.rideNotices.count()).toBe(0);
    });

    it('seeds a watermark for every unwatched leg when all are acknowledged', async () => {
      world.transports = [
        makeTransport({ id: 'leg-alice', personId: ALICE, datetime: AT_1700, rideId: RIDE_A }),
        makeTransport({ id: 'leg-chloe', personId: CHLOE, datetime: AT_1900, rideId: RIDE_A }),
      ];

      const { result } = await renderChanges();
      expect(result.current.unwatchedCount).toBe(2);

      await act(async () => {
        await result.current.acknowledgeAll();
      });

      await waitFor(() => {
        expect(result.current.unwatchedCount).toBe(0);
      });

      expect(
        (await db.rideNotices.get(rideNoticeKey('moved', 'leg-alice' as TransportId)))
          ?.seenDatetime,
      ).toBe(AT_1700);
      expect(
        (await db.rideNotices.get(rideNoticeKey('moved', 'leg-chloe' as TransportId)))
          ?.seenDatetime,
      ).toBe(AT_1900);
    });

    it('ignores an acknowledgement for a leg outside the identified cars', async () => {
      world.rides = [makeRide(RIDE_A, TOM), makeRide(RIDE_B, CHLOE)];
      world.transports = [
        makeTransport({ id: 'leg-alice', personId: ALICE, datetime: AT_1700, rideId: RIDE_A }),
        makeTransport({ id: 'leg-chloe', personId: CHLOE, datetime: AT_1700, rideId: RIDE_B }),
      ];

      const { result } = await renderChanges();

      await act(async () => {
        await result.current.acknowledge('leg-chloe' as TransportId);
      });

      expect(
        await db.rideNotices.get(rideNoticeKey('moved', 'leg-chloe' as TransportId)),
      ).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Ordering
  // --------------------------------------------------------------------------

  describe('ordering', () => {
    it('lists the soonest changed departure first', async () => {
      world.transports = [
        makeTransport({ id: 'leg-chloe', personId: CHLOE, datetime: AT_1900, rideId: RIDE_A }),
        makeTransport({ id: 'leg-alice', personId: ALICE, datetime: AT_1700, rideId: RIDE_A }),
      ];
      await seedWatermark('leg-chloe', AT_1700);
      await seedWatermark('leg-alice', AT_1900);

      const { result } = await renderChanges();

      expect(result.current.changes.map((change) => change.transport.id)).toEqual([
        'leg-alice',
        'leg-chloe',
      ]);
    });
  });
});
