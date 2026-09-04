/**
 * Datetime normalisation tests for the Transport repository.
 *
 * A transport's `datetime` is ordered by the `[tripId+datetime]` Dexie index,
 * compared as a string by every sort in the repository, and sliced into a day
 * key by its readers. All of that is character comparison, so it only means
 * anything if every row uses one representation. Two writers historically did
 * not: the share wizard persisted the raw `datetime-local` value
 * (`2026-09-03T14:30` — no `Z`, no offset), and the Yjs bridge and the share
 * merge applicator write whatever a peer sent, offsets included.
 *
 * These tests pin both halves of the fix:
 * - writes normalise, so no entry point can store an ambiguous value again;
 * - reads coerce, so rows already in IndexedDB still order and bucket as
 *   instants — without a migration rewriting them (see the repository module
 *   note for why one would make the guess worse rather than better).
 *
 * Nothing here encodes the machine's offset: ambiguous values are *derived*
 * from a known instant, either as that instant's local wall clock or with an
 * explicit offset, so every assertion holds in UTC+14 as well as UTC-11.
 *
 * @module lib/db/repositories/__tests__/transport-datetime-normalisation.test
 */
import { describe, it, expect } from 'vitest';

import { db } from '@/lib/db/database';
import {
  createTransport,
  getArrivals,
  getDepartures,
  getTransportById,
  getTransportsByDriverId,
  getTransportsByPersonId,
  getTransportsByTripId,
  getTransportsForDate,
  getUpcomingPickups,
  updateTransport,
  updateTransportWithOwnershipCheck,
} from '@/lib/db/repositories/transport-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { hexColor, isoDate } from '@/test/utils';
import type {
  ISODateTimeString,
  PersonId,
  Transport,
  TransportFormData,
  TransportId,
  TripId,
} from '@/types';

// ============================================================================
// Helpers
// ============================================================================

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * Renders an instant the way the wizard's `datetime-local` input would, in
 * whatever zone the test process runs in: local wall clock, no offset.
 */
function asLocalInputValue(instant: Date): string {
  return [
    `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`,
    `${pad(instant.getHours())}:${pad(instant.getMinutes())}`,
  ].join('T');
}

/**
 * Renders an instant with an explicit UTC offset, the shape a row synced from
 * a peer or restored from an import can carry. Unambiguous as an instant, and
 * still wrong under character ordering against a `…Z` row.
 */
function asOffsetValue(instant: Date, offsetHours: number): string {
  const shifted = new Date(instant.getTime() + offsetHours * 3_600_000),
    sign = offsetHours < 0 ? '-' : '+';

  return `${shifted.toISOString().slice(0, 19)}${sign}${pad(Math.abs(offsetHours))}:00`;
}

/**
 * Writes a row straight to Dexie, bypassing the repository — exactly what the
 * Yjs bridge and the merge applicator do, and what every row written before
 * write-time normalisation looks like.
 */
async function putLegacyRow(
  tripId: TripId,
  personId: PersonId,
  id: string,
  datetime: string,
  overrides?: Partial<Transport>,
): Promise<TransportId> {
  const transport: Transport = {
    id: id as TransportId,
    tripId,
    personId,
    type: 'arrival',
    datetime: datetime as ISODateTimeString,
    location: 'Gare de Vannes',
    needsPickup: false,
    ...overrides,
  };

  await db.transports.put(transport);
  return transport.id;
}

function transportData(
  personId: PersonId,
  datetime: string,
  overrides?: Partial<TransportFormData>,
): TransportFormData {
  return {
    personId,
    type: 'arrival',
    datetime: datetime as ISODateTimeString,
    location: 'Gare Montparnasse',
    needsPickup: false,
    ...overrides,
  };
}

async function seedTrip(): Promise<{ tripId: TripId; personId: PersonId }> {
  const trip = await createTrip({
      name: 'Test Trip',
      startDate: isoDate('2026-09-01'),
      endDate: isoDate('2026-09-10'),
    }),
    person = await createPerson(trip.id, {
      name: 'Marie',
      color: hexColor('#ef4444'),
    });

  return { tripId: trip.id, personId: person.id };
}

// ============================================================================
// Ordering — the [tripId+datetime] index contract
// ============================================================================

describe('getTransportsByTripId — instant ordering across representations', () => {
  it('sorts a trip mixing an offset row and UTC rows by instant, not by characters', async () => {
    const { tripId, personId } = await seedTrip(),
      middle = new Date('2026-09-03T12:00:00.000Z'),
      early = await createTransport(
        tripId,
        transportData(personId, '2026-09-03T11:00:00.000Z'),
      ),
      late = await createTransport(
        tripId,
        transportData(personId, '2026-09-03T13:00:00.000Z'),
      ),
      // 12:00Z written as 14:00+02:00 — later than both by character order,
      // between them by instant.
      legacyId = await putLegacyRow(
        tripId,
        personId,
        'legacy-offset',
        asOffsetValue(middle, 2),
      ),
      ordered = await getTransportsByTripId(tripId);

    expect(ordered.map((t) => t.id)).toEqual([early.id, legacyId, late.id]);
  });

  it('returns the legacy row coerced while leaving the stored value untouched', async () => {
    const { tripId, personId } = await seedTrip(),
      instant = new Date('2026-09-03T12:00:00.000Z'),
      rawValue = asOffsetValue(instant, 2),
      legacyId = await putLegacyRow(tripId, personId, 'legacy-raw', rawValue),
      [read] = await getTransportsByTripId(tripId),
      stored = await db.transports.get(legacyId);

    expect(read?.datetime).toBe(instant.toISOString());
    // Deliberate: coercion is a read-time guess, never a rewrite of the row.
    expect(stored?.datetime).toBe(rawValue);
  });

  it('leaves an unparseable legacy datetime alone and sorts it last', async () => {
    const { tripId, personId } = await seedTrip(),
      real = await createTransport(
        tripId,
        transportData(personId, '2026-09-03T11:00:00.000Z'),
      ),
      brokenId = await putLegacyRow(
        tripId,
        personId,
        'legacy-broken',
        '0000-corrupt',
      ),
      ordered = await getTransportsByTripId(tripId);

    // A row nobody can place in time belongs at the end of a chronological
    // list, not sorted to the top of one by its leading zeroes.
    expect(ordered.map((t) => t.id)).toEqual([real.id, brokenId]);
    expect(ordered[1]?.datetime).toBe('0000-corrupt');
  });
});

// ============================================================================
// Day bucketing — the wizard and the form must agree
// ============================================================================

describe('createTransport — one representation for every writer', () => {
  it('lands a wizard entry and a form entry for the same instant in the same day bucket', async () => {
    const { tripId, personId } = await seedTrip(),
      instant = new Date('2026-09-03T12:30:00.000Z'),
      // What the share wizard's datetime-local input produces…
      wizard = await createTransport(
        tripId,
        transportData(personId, asLocalInputValue(instant)),
      ),
      // …and what TransportForm produces for the very same moment.
      form = await createTransport(
        tripId,
        transportData(personId, instant.toISOString()),
      );

    expect(wizard.datetime).toBe(form.datetime);
    expect(wizard.datetime.substring(0, 10)).toBe(form.datetime.substring(0, 10));
    expect(wizard.datetime).toBe(instant.toISOString());
  });

  it('persists the normalised value, not just the returned object', async () => {
    const { tripId, personId } = await seedTrip(),
      instant = new Date('2026-09-03T12:30:00.000Z'),
      created = await createTransport(
        tripId,
        transportData(personId, asLocalInputValue(instant)),
      ),
      stored = await db.transports.get(created.id);

    expect(stored?.datetime).toBe(instant.toISOString());
  });

  it('normalises an offset-carrying value to UTC', async () => {
    const { tripId, personId } = await seedTrip(),
      instant = new Date('2026-09-03T12:30:00.000Z'),
      created = await createTransport(
        tripId,
        transportData(personId, asOffsetValue(instant, -11)),
      );

    expect(created.datetime).toBe(instant.toISOString());
  });

  it('rejects an unparseable datetime instead of storing it', async () => {
    const { tripId, personId } = await seedTrip();

    await expect(
      createTransport(tripId, transportData(personId, 'tomorrow-ish')),
    ).rejects.toThrow(/Invalid transport datetime/u);
    await expect(db.transports.count()).resolves.toBe(0);
  });
});

// ============================================================================
// Updates
// ============================================================================

describe('update paths — normalisation', () => {
  it('normalises a local wall-clock value through updateTransportWithOwnershipCheck', async () => {
    const { tripId, personId } = await seedTrip(),
      instant = new Date('2026-09-04T09:15:00.000Z'),
      created = await createTransport(
        tripId,
        transportData(personId, '2026-09-03T11:00:00.000Z'),
      );

    await updateTransportWithOwnershipCheck(created.id, tripId, {
      datetime: asLocalInputValue(instant) as ISODateTimeString,
    });

    const stored = await db.transports.get(created.id);
    expect(stored?.datetime).toBe(instant.toISOString());
  });

  it('rejects an unparseable datetime through updateTransportWithOwnershipCheck', async () => {
    const { tripId, personId } = await seedTrip(),
      created = await createTransport(
        tripId,
        transportData(personId, '2026-09-03T11:00:00.000Z'),
      );

    await expect(
      updateTransportWithOwnershipCheck(created.id, tripId, {
        datetime: 'sometime' as ISODateTimeString,
      }),
    ).rejects.toThrow(/Invalid transport datetime/u);

    const stored = await db.transports.get(created.id);
    expect(stored?.datetime).toBe('2026-09-03T11:00:00.000Z');
  });

  it('normalises a local wall-clock value through the deprecated updateTransport', async () => {
    const { tripId, personId } = await seedTrip(),
      instant = new Date('2026-09-04T09:15:00.000Z'),
      created = await createTransport(
        tripId,
        transportData(personId, '2026-09-03T11:00:00.000Z'),
      );

    await updateTransport(created.id, {
      datetime: asLocalInputValue(instant) as ISODateTimeString,
    });

    const stored = await db.transports.get(created.id);
    expect(stored?.datetime).toBe(instant.toISOString());
  });
});

// ============================================================================
// Datetime-sensitive reads
// ============================================================================

describe('getUpcomingPickups — compares instants, not characters', () => {
  it('treats a cleared cutoff as now rather than throwing', async () => {
    const { tripId } = await seedTrip();

    await expect(getUpcomingPickups(tripId, '')).resolves.toEqual([]);
  });

  it('excludes a legacy row whose characters look future but whose instant is past', async () => {
    const { tripId, personId } = await seedTrip(),
      cutoff = '2026-09-03T12:00:00.000Z';

    // 11:00Z — an hour before the cutoff, written as 13:00+02:00.
    await putLegacyRow(
      tripId,
      personId,
      'looks-future',
      asOffsetValue(new Date('2026-09-03T11:00:00.000Z'), 2),
      { needsPickup: true },
    );

    await expect(getUpcomingPickups(tripId, cutoff)).resolves.toEqual([]);
  });

  it('includes a legacy row whose characters look past but whose instant is future', async () => {
    const { tripId, personId } = await seedTrip(),
      cutoff = '2026-09-03T12:00:00.000Z',
      instant = new Date('2026-09-03T13:00:00.000Z'),
      // 13:00Z written as 11:00-02:00.
      legacyId = await putLegacyRow(
        tripId,
        personId,
        'looks-past',
        asOffsetValue(instant, -2),
        { needsPickup: true },
      ),
      pickups = await getUpcomingPickups(tripId, cutoff);

    expect(pickups.map((t) => t.id)).toEqual([legacyId]);
    expect(pickups[0]?.datetime).toBe(instant.toISOString());
  });
});

describe('getTransportsForDate — buckets by the canonical UTC day', () => {
  it('files a legacy row under the UTC day of its instant', async () => {
    const { tripId, personId } = await seedTrip(),
      // 2026-09-03T22:30Z, written as the next local day in UTC+2.
      instant = new Date('2026-09-03T22:30:00.000Z'),
      legacyId = await putLegacyRow(
        tripId,
        personId,
        'late-night',
        asOffsetValue(instant, 2),
      );

    await expect(
      getTransportsForDate(tripId, '2026-09-03').then((rows) => rows.map((t) => t.id)),
    ).resolves.toEqual([legacyId]);
    await expect(getTransportsForDate(tripId, '2026-09-04')).resolves.toEqual([]);
  });
});

describe('person, type and driver reads — coercion', () => {
  it('coerces and orders rows read by person', async () => {
    const { tripId, personId } = await seedTrip(),
      middle = new Date('2026-09-03T12:00:00.000Z'),
      early = await createTransport(
        tripId,
        transportData(personId, '2026-09-03T11:00:00.000Z'),
      ),
      late = await createTransport(
        tripId,
        transportData(personId, '2026-09-03T13:00:00.000Z'),
      ),
      legacyId = await putLegacyRow(
        tripId,
        personId,
        'legacy-person',
        asOffsetValue(middle, 2),
      ),
      rows = await getTransportsByPersonId(personId);

    expect(rows.map((t) => t.id)).toEqual([early.id, legacyId, late.id]);
    expect(rows[1]?.datetime).toBe(middle.toISOString());
  });

  it('coerces rows read by type', async () => {
    const { tripId, personId } = await seedTrip(),
      instant = new Date('2026-09-03T12:00:00.000Z');

    await putLegacyRow(tripId, personId, 'legacy-arrival', asOffsetValue(instant, 2));
    await putLegacyRow(tripId, personId, 'legacy-departure', asOffsetValue(instant, 2), {
      type: 'departure',
    });

    const [arrival] = await getArrivals(tripId),
      [departure] = await getDepartures(tripId);

    expect(arrival?.datetime).toBe(instant.toISOString());
    expect(departure?.datetime).toBe(instant.toISOString());
  });

  it('coerces rows read by driver', async () => {
    const { tripId, personId } = await seedTrip(),
      driver = await createPerson(tripId, {
        name: 'Driver',
        color: hexColor('#22c55e'),
      }),
      instant = new Date('2026-09-03T12:00:00.000Z');

    await putLegacyRow(tripId, personId, 'legacy-driven', asOffsetValue(instant, 2), {
      driverId: driver.id,
      needsPickup: true,
    });

    const rows = await getTransportsByDriverId(driver.id);

    expect(rows[0]?.datetime).toBe(instant.toISOString());
  });

  it('coerces a row read by id', async () => {
    const { tripId, personId } = await seedTrip(),
      instant = new Date('2026-09-03T12:00:00.000Z'),
      legacyId = await putLegacyRow(
        tripId,
        personId,
        'legacy-by-id',
        asOffsetValue(instant, 2),
      ),
      read = await getTransportById(legacyId);

    expect(read?.datetime).toBe(instant.toISOString());
  });
});
