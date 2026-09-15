/**
 * @fileoverview The printed sheet must say who sleeps where, who arrives when
 * and who drives — including when the answer is "nobody yet".
 *
 * @module features/summary/components/__tests__/SummarySheet.test
 */

import { describe, expect, it } from 'vitest';

import { SummarySheet } from '@/features/summary/components/SummarySheet';
import type { TripSummary } from '@/features/summary/lib/trip-summary';
import { render, screen, within } from '@/test/utils';
import type {
  ISODateString,
  PersonId,
  RoomAssignmentId,
  RoomId,
  TransportId,
  TripId,
} from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const PRINTED_ON = new Date('2026-06-30T09:00');

function buildSummary(overrides: Partial<TripSummary> = {}): TripSummary {
  return {
    tripId: 'trip-a' as TripId,
    name: 'Summer in Brittany',
    location: 'Beach house',
    startDate: '2026-07-01' as ISODateString,
    endDate: '2026-07-08' as ISODateString,
    headcount: 3,
    rooms: [
      {
        roomId: 'room-1' as RoomId,
        name: 'Master bedroom',
        capacity: 2,
        icon: undefined,
        stays: [
          {
            assignmentId: 'a1' as RoomAssignmentId,
            personId: 'p1' as PersonId,
            personName: 'Marie',
            headcount: 2,
            startDate: '2026-07-01' as ISODateString,
            endDate: '2026-07-08' as ISODateString,
          },
        ],
      },
      {
        roomId: 'room-2' as RoomId,
        name: 'Attic',
        capacity: 1,
        icon: undefined,
        stays: [],
      },
    ],
    guestsWithoutRoom: ['Camille'],
    travels: [
      {
        transportId: 't1' as TransportId,
        type: 'arrival',
        datetime: new Date('2026-07-01T14:30').toISOString(),
        personName: 'Marie',
        location: 'Gare Montparnasse',
        mode: 'train',
        number: 'TGV 8541',
        needsPickup: true,
        driverName: 'Paul',
      },
      {
        transportId: 't2' as TransportId,
        type: 'departure',
        datetime: new Date('2026-07-08T09:15').toISOString(),
        personName: 'Camille',
        location: 'Gare Montparnasse',
        mode: undefined,
        number: undefined,
        needsPickup: true,
        driverName: null,
      },
    ],
    guests: [
      {
        personId: 'p1' as PersonId,
        name: 'Marie',
        headcount: 2,
        phone: '+33 6 12 34 56 78',
        notes: 'No peanuts',
        arrivalDate: '2026-07-01' as ISODateString,
        departureDate: '2026-07-08' as ISODateString,
      },
    ],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('SummarySheet', () => {
  it('prints who sleeps where, including a room nobody has claimed', () => {
    render(<SummarySheet summary={buildSummary()} printedOn={PRINTED_ON} />);

    const rooms = within(screen.getByRole('region', { name: 'summary.rooms' }));

    expect(rooms.getByText('Master bedroom')).toBeInTheDocument();
    expect(rooms.getByText('Marie')).toBeInTheDocument();
    expect(rooms.getByText('Attic')).toBeInTheDocument();
    expect(screen.getByText('summary.roomEmpty')).toBeInTheDocument();
  });

  it('names the guests still without a bed', () => {
    render(<SummarySheet summary={buildSummary()} printedOn={PRINTED_ON} />);

    expect(screen.getByText('summary.guestsWithoutRoom')).toBeInTheDocument();
  });

  it('prints the time, the direction and the driver of each travel', () => {
    render(<SummarySheet summary={buildSummary()} printedOn={PRINTED_ON} />);

    expect(screen.getByText('14:30')).toBeInTheDocument();
    expect(screen.getByText('09:15')).toBeInTheDocument();
    // The arrow never travels alone: the word beside it is what makes the line
    // readable once the sheet is printed in black and white.
    expect(screen.getByText('↓ transports.arrival')).toBeInTheDocument();
    expect(screen.getByText('↑ transports.departure')).toBeInTheDocument();
    expect(screen.getByText('summary.driver')).toBeInTheDocument();
  });

  it('says so when a pickup has nobody driving', () => {
    render(<SummarySheet summary={buildSummary()} printedOn={PRINTED_ON} />);

    expect(screen.getByText('summary.driverMissing')).toBeInTheDocument();
  });

  it('leaves the driver line off a travel nobody has to fetch', () => {
    const summary = buildSummary({
      travels: [
        {
          transportId: 't3' as TransportId,
          type: 'arrival',
          datetime: new Date('2026-07-01T14:30').toISOString(),
          personName: 'Marie',
          location: 'Gare Montparnasse',
          mode: undefined,
          number: undefined,
          needsPickup: false,
          driverName: null,
        },
      ],
    });

    render(<SummarySheet summary={summary} printedOn={PRINTED_ON} />);

    expect(screen.queryByText('summary.driverMissing')).not.toBeInTheDocument();
  });

  it('prints the phone number the group has to call', () => {
    render(<SummarySheet summary={buildSummary()} printedOn={PRINTED_ON} />);

    expect(screen.getByText('+33 6 12 34 56 78')).toBeInTheDocument();
    expect(screen.getByText('No peanuts')).toBeInTheDocument();
  });

  it('names a traveller who is no longer a guest as unknown', () => {
    const summary = buildSummary({
      travels: [
        {
          transportId: 't4' as TransportId,
          type: 'arrival',
          datetime: new Date('2026-07-01T14:30').toISOString(),
          personName: null,
          location: 'Gare Montparnasse',
          mode: undefined,
          number: undefined,
          needsPickup: false,
          driverName: null,
        },
      ],
    });

    render(<SummarySheet summary={summary} printedOn={PRINTED_ON} />);

    expect(screen.getByText('common.unknown')).toBeInTheDocument();
  });

  it('says when there is nothing to print in a section yet', () => {
    const summary = buildSummary({
      rooms: [],
      guestsWithoutRoom: [],
      travels: [],
      guests: [],
    });

    render(<SummarySheet summary={summary} printedOn={PRINTED_ON} />);

    expect(screen.getByText('summary.noRooms')).toBeInTheDocument();
    expect(screen.getByText('summary.noTravel')).toBeInTheDocument();
    expect(screen.getByText('summary.noGuests')).toBeInTheDocument();
  });

  it('dates the sheet, so paper on a wall says how old it is', () => {
    render(<SummarySheet summary={buildSummary()} printedOn={PRINTED_ON} />);

    expect(screen.getByText('summary.printedOn')).toBeInTheDocument();
  });
});
