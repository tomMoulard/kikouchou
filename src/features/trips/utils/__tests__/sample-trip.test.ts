/**
 * Tests for buildSampleTrip.
 *
 * The sample trip is the app's demo, so these tests hold it to "every feature":
 * a new trip-scoped table or a new form field fails here until the sample uses
 * it. That is the point. Fill it in rather than adding it to an exclusion list,
 * unless the field is device-local or deprecated.
 *
 * @module features/trips/utils/__tests__/sample-trip.test
 */
import { describe, expect, it } from 'vitest';

import {
  SAMPLE_TRIP_LEAD_DAYS,
  SAMPLE_TRIP_NIGHTS,
  buildSampleTrip,
  type SampleTripRows,
} from '../sample-trip';

import { db } from '@/lib/db/database';
import { toLocalISODateString } from '@/lib/db/utils';
import {
  ActivityFormDataSchema,
  ExpenseFormDataSchema,
  PersonFormDataSchema,
  RideFormDataSchema,
  RoomAssignmentFormDataSchema,
  RoomFormDataSchema,
  TransportFormDataSchema,
  TripFormDataSchema,
  VehicleFormDataSchema,
} from '@/lib/validation/schemas';

import {
  ACTIVITY_CATEGORIES,
  EXPENSE_CATEGORIES,
  EXPENSE_KINDS,
  EXPENSE_SPLIT_MODES,
  RIDE_DIRECTIONS,
  getPersonHeadcount,
  type Language,
} from '@/types';

// ============================================================================
// Constants
// ============================================================================

const LANGUAGES: readonly Language[] = ['en', 'fr'];

/** A fixed local noon, so no day boundary moves under the test. */
const TODAY = new Date(2026, 9, 1, 12, 0);

/**
 * Tables the sample does not fill, and why. Every other table must get rows.
 */
const TABLES_WITHOUT_SAMPLE_ROWS: Readonly<Record<string, string>> = {
  settings: 'device settings, written by the seed itself',
  yjsUpdates: 'CRDT persistence, built when the trip is opened',
  yjsOutbox: 'server delivery queue; the sample is never uploaded',
  syncCursors: 'server log position; the sample is never uploaded',
  tripMembers: 'server roster; the sample is never uploaded',
  rideNotices: 'what this device already announced',
  guestGroups: 'account-level and synced on sign-in; the sample stays on the device',
};

/**
 * Form fields the sample may leave out. Deprecated or device-local only.
 */
const FIELDS_WITHOUT_SAMPLE_VALUES: Readonly<Record<string, readonly string[]>> = {
  transports: ['driverId'],
};

/** Each table, the schema a row of it is written through, and its rows. */
function tablesOf(rows: SampleTripRows) {
  return [
    { table: 'trips', schema: TripFormDataSchema, rows: [rows.trip] },
    { table: 'rooms', schema: RoomFormDataSchema, rows: rows.rooms },
    { table: 'persons', schema: PersonFormDataSchema, rows: rows.persons },
    { table: 'roomAssignments', schema: RoomAssignmentFormDataSchema, rows: rows.roomAssignments },
    { table: 'vehicles', schema: VehicleFormDataSchema, rows: rows.vehicles },
    { table: 'rides', schema: RideFormDataSchema, rows: rows.rides },
    { table: 'transports', schema: TransportFormDataSchema, rows: rows.transports },
    { table: 'activities', schema: ActivityFormDataSchema, rows: rows.activities },
    { table: 'expenses', schema: ExpenseFormDataSchema, rows: rows.expenses },
  ] as const;
}

// ============================================================================
// Tests
// ============================================================================

describe('buildSampleTrip', () => {
  describe.each(LANGUAGES)('in %s', (language) => {
    const rows = buildSampleTrip(language, TODAY);

    it('fills every trip-scoped table', () => {
      const filled = new Set<string>(tablesOf(rows).map(({ table }) => table));
      const missing = db.tables
        .map((table) => table.name)
        .filter((name) => !(name in TABLES_WITHOUT_SAMPLE_ROWS) && !filled.has(name));

      expect(missing).toEqual([]);
      for (const { rows: tableRows } of tablesOf(rows)) {
        expect(tableRows.length).toBeGreaterThan(0);
      }
    });

    it('writes only rows the forms would accept', () => {
      for (const { table, schema, rows: tableRows } of tablesOf(rows)) {
        for (const row of tableRows) {
          const result = schema.safeParse(row);
          expect(result.error?.issues, `${table}: ${JSON.stringify(row)}`).toBeUndefined();
        }
      }
    });

    it('uses every field a form can set', () => {
      for (const { table, schema, rows: tableRows } of tablesOf(rows)) {
        const skipped = FIELDS_WITHOUT_SAMPLE_VALUES[table] ?? [];
        const unused = Object.keys(schema.shape).filter(
          (field) =>
            !skipped.includes(field) &&
            !tableRows.some(
              (row) => (row as unknown as Record<string, unknown>)[field] !== undefined,
            ),
        );

        expect(unused, table).toEqual([]);
      }
    });

    it('covers every kind of activity, money line, split and ride', () => {
      const categories = new Set(rows.activities.map((activity) => activity.category));
      const kinds = new Set(rows.expenses.map((expense) => expense.kind));
      const expenseCategories = new Set(rows.expenses.map((expense) => expense.category));
      const splitModes = new Set(rows.expenses.map((expense) => expense.splitMode));
      const directions = new Set(rows.rides.map((ride) => ride.direction));

      expect([...categories].sort()).toEqual([...ACTIVITY_CATEGORIES].sort());
      expect([...kinds].sort()).toEqual([...EXPENSE_KINDS].sort());
      expect([...expenseCategories].sort()).toEqual([...EXPENSE_CATEGORIES].sort());
      expect([...splitModes].sort()).toEqual([...EXPENSE_SPLIT_MODES].sort());
      expect([...directions].sort()).toEqual([...RIDE_DIRECTIONS].sort());
      expect(rows.activities.some((activity) => activity.allDay)).toBe(true);
      expect(rows.persons.some((person) => getPersonHeadcount(person) > 1)).toBe(true);
      expect(rows.transports.some((transport) => transport.type === 'departure')).toBe(true);
    });

    it('points every reference at a row of the same trip', () => {
      const tripId = rows.trip.id;
      const personIds = new Set(rows.persons.map((person) => person.id));
      const roomIds = new Set(rows.rooms.map((room) => room.id));
      const rideIds = new Set(rows.rides.map((ride) => ride.id));
      const vehicleIds = new Set(rows.vehicles.map((vehicle) => vehicle.id));

      for (const { rows: tableRows } of tablesOf(rows).slice(1)) {
        for (const row of tableRows) {
          expect((row as { tripId: unknown }).tripId).toBe(tripId);
        }
      }
      for (const assignment of rows.roomAssignments) {
        expect(personIds.has(assignment.personId)).toBe(true);
        expect(roomIds.has(assignment.roomId)).toBe(true);
      }
      for (const transport of rows.transports) {
        expect(personIds.has(transport.personId)).toBe(true);
        if (transport.rideId !== undefined) {
          expect(rideIds.has(transport.rideId)).toBe(true);
        }
      }
      for (const ride of rows.rides) {
        expect(ride.driverId === undefined || personIds.has(ride.driverId)).toBe(true);
        expect(ride.vehicleId === undefined || vehicleIds.has(ride.vehicleId)).toBe(true);
      }
      for (const vehicle of rows.vehicles) {
        expect(vehicle.ownerId === undefined || personIds.has(vehicle.ownerId)).toBe(true);
      }
      for (const activity of rows.activities) {
        for (const id of [...activity.participantIds, activity.organizerId]) {
          expect(id === undefined || personIds.has(id)).toBe(true);
        }
      }
      for (const expense of rows.expenses) {
        expect(personIds.has(expense.payerId)).toBe(true);
        for (const split of expense.splits) {
          expect(personIds.has(split.personId)).toBe(true);
        }
      }
    });

    it('never puts more people in a room than it sleeps', () => {
      const headcountById = new Map(
        rows.persons.map((person) => [person.id, getPersonHeadcount(person)]),
      );

      for (const room of rows.rooms) {
        const nights = new Map<string, number>();
        for (const assignment of rows.roomAssignments.filter((a) => a.roomId === room.id)) {
          // endDate is the check-out day: the guest does not sleep there that night.
          for (let night = assignment.startDate; night < assignment.endDate; ) {
            nights.set(night, (nights.get(night) ?? 0) + (headcountById.get(assignment.personId) ?? 1));
            const next = new Date(`${night}T12:00:00`);
            next.setDate(next.getDate() + 1);
            night = toLocalISODateString(next);
          }
        }
        for (const [night, people] of nights) {
          expect(people, `${room.name} on ${night}`).toBeLessThanOrEqual(room.capacity);
        }
      }
    });

    it('starts two weeks from today and keeps every date inside the trip', () => {
      const start = new Date(TODAY);
      start.setDate(start.getDate() + SAMPLE_TRIP_LEAD_DAYS);
      const end = new Date(start);
      end.setDate(end.getDate() + SAMPLE_TRIP_NIGHTS);

      expect(rows.trip.startDate).toBe(toLocalISODateString(start));
      expect(rows.trip.endDate).toBe(toLocalISODateString(end));

      const inTrip = (day: string) =>
        day >= rows.trip.startDate && day <= rows.trip.endDate;
      const localDay = (instant: string) => toLocalISODateString(new Date(instant));

      for (const assignment of rows.roomAssignments) {
        expect(inTrip(assignment.startDate) && inTrip(assignment.endDate)).toBe(true);
      }
      for (const transport of rows.transports) {
        expect(inTrip(localDay(transport.datetime))).toBe(true);
      }
      for (const ride of rows.rides) {
        expect(inTrip(localDay(ride.meetDatetime))).toBe(true);
      }
      for (const activity of rows.activities) {
        expect(inTrip(localDay(activity.startDatetime))).toBe(true);
      }
      for (const expense of rows.expenses) {
        expect(inTrip(expense.date)).toBe(true);
      }
    });

    it('writes no em dash or en dash', () => {
      expect(JSON.stringify(rows)).not.toMatch(/[–—]/);
    });
  });

  it('follows the language it is given', () => {
    const english = buildSampleTrip('en', TODAY);
    const french = buildSampleTrip('fr', TODAY);

    expect(english.trip.name).not.toBe(french.trip.name);
    expect(english.trip.description).not.toBe(french.trip.description);
    expect(english.rooms.map((room) => room.name)).not.toEqual(
      french.rooms.map((room) => room.name),
    );
  });

  it('mints fresh ids on every build', () => {
    const first = buildSampleTrip('en', TODAY);
    const second = buildSampleTrip('en', TODAY);

    expect(first.trip.id).not.toBe(second.trip.id);
    expect(first.trip.shareId).not.toBe(second.trip.shareId);
  });
});
