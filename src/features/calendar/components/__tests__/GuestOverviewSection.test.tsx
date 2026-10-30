/**
 * @fileoverview Tests for GuestOverviewSection: the "about this guest" block
 * of the stay dialog.
 *
 * @module features/calendar/components/__tests__/GuestOverviewSection.test
 */

import { describe, expect, it, vi } from 'vitest';
import { enUS } from 'date-fns/locale';

import { render, screen, within } from '@/test/utils';
import type {
  Activity,
  ActivityId,
  HexColor,
  ISODateString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  Transport,
  TransportId,
  TripId,
} from '@/types';

import { GuestOverviewSection } from '../GuestOverviewSection';
import type { GuestOverview } from '../../utils/guest-overview';

// ============================================================================
// Mocks
// ============================================================================

// The English fallback with its placeholders filled, so the copy the section
// passes is what the assertions read.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      if (typeof fallback !== 'string') {
        return key;
      }
      let result = fallback;
      for (const [name, value] of Object.entries(options ?? {})) {
        result = result.replace(`{{${name}}}`, String(value));
      }
      return result;
    },
    i18n: { language: 'en' },
  }),
}));

// ============================================================================
// Helpers
// ============================================================================

const person: Person = {
  id: 'person-1' as PersonId,
  tripId: 'trip-1' as TripId,
  name: 'Alice',
  color: '#3b82f6' as HexColor,
};

const room: Room = {
  id: 'room-1' as RoomId,
  tripId: 'trip-1' as TripId,
  name: 'Blue Room',
  capacity: 2,
  order: 0,
};

function makeStay(id: string, startDate: string, endDate: string): RoomAssignment {
  return {
    id: id as RoomAssignmentId,
    tripId: 'trip-1' as TripId,
    roomId: room.id,
    personId: person.id,
    startDate: startDate as ISODateString,
    endDate: endDate as ISODateString,
  };
}

function makeLeg(overrides: Partial<Transport> = {}): Transport {
  return {
    id: 'leg-1' as TransportId,
    tripId: 'trip-1' as TripId,
    personId: person.id,
    type: 'arrival',
    // Offset-less, so the rendered day and clock do not move with the runner.
    datetime: '2026-01-10T14:30:00',
    location: 'Lyon Part-Dieu',
    needsPickup: false,
    transportMode: 'train',
    ...overrides,
  };
}

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'activity-1' as ActivityId,
    tripId: 'trip-1' as TripId,
    title: 'Plant fair',
    category: 'horticulture',
    startDatetime: '2026-01-11T09:00:00',
    endDatetime: '2026-01-11T12:00:00',
    allDay: false,
    participantIds: [person.id],
    ...overrides,
  };
}

function makeOverview(overrides: Partial<GuestOverview> = {}): GuestOverview {
  return {
    person,
    checkIn: '2026-01-10' as ISODateString,
    checkOut: '2026-01-13' as ISODateString,
    stays: [],
    transports: [],
    activities: [],
    balance: undefined,
    currency: 'EUR',
    ...overrides,
  };
}

function renderOverview(overview: GuestOverview, shownTransportIds?: readonly TransportId[]) {
  return render(
    <GuestOverviewSection
      overview={overview}
      dateLocale={enUS}
      shownTransportIds={shownTransportIds}
    />,
    { withProviders: false },
  );
}

/** The line that holds `label`, so a value can be read next to its label. */
function lineOf(label: string): HTMLElement {
  const element = screen.getByText(label).parentElement;
  if (!element) {
    throw new Error(`No line for ${label}`);
  }
  return element;
}

// ============================================================================
// Tests
// ============================================================================

describe('GuestOverviewSection', () => {
  it('names the guest and their check-in and check-out days', () => {
    renderOverview(makeOverview());

    expect(screen.getByRole('heading', { name: 'About Alice' })).toBeInTheDocument();
    expect(lineOf('Check-in')).toHaveTextContent('January 10th, 2026');
    expect(lineOf('Check-out')).toHaveTextContent('January 13th, 2026');
  });

  it('says a day is unknown when it is missing or cannot be read', () => {
    renderOverview(makeOverview({ checkIn: null, checkOut: 'not-a-day' as ISODateString }));

    expect(lineOf('Check-in')).toHaveTextContent('common.unknown');
    expect(lineOf('Check-out')).toHaveTextContent('common.unknown');
  });

  it('lists every room with the nights in it', () => {
    renderOverview(
      makeOverview({
        stays: [
          { assignment: makeStay('a1', '2026-01-10', '2026-01-12'), room },
          { assignment: makeStay('a2', '2026-01-12', '2026-01-13'), room: undefined },
        ],
      }),
    );

    expect(screen.getByRole('heading', { name: 'Rooms' })).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Blue Room');
    expect(rows[0]).toHaveTextContent('January 10th, 2026 → January 12th, 2026');
    expect(rows[1]).toHaveTextContent('common.unknown');
  });

  it('lists travel not already shown above, with its direction and time', () => {
    const shown = makeLeg({ id: 'shown' as TransportId, location: 'Shown above' });
    renderOverview(
      makeOverview({
        transports: [
          shown,
          makeLeg({ id: 'in' as TransportId }),
          makeLeg({
            id: 'out' as TransportId,
            type: 'departure',
            location: '',
            datetime: '2026-01-13T08:15:00',
            transportMode: undefined,
          }),
        ],
      }),
      [shown.id],
    );

    expect(screen.getByRole('heading', { name: 'Other travel' })).toBeInTheDocument();
    expect(screen.queryByText('Shown above')).not.toBeInTheDocument();
    const [arrival, departure] = screen.getAllByRole('listitem');
    expect(arrival).toHaveTextContent('↓');
    expect(arrival).toHaveTextContent('Lyon Part-Dieu');
    expect(arrival).toHaveTextContent('14:30');
    expect(departure).toHaveTextContent('↑');
    expect(departure).toHaveTextContent('common.unknown');
    expect(departure).toHaveTextContent('08:15');
    expect(arrival).toHaveTextContent('January 10th, 2026 14:30');
    expect(arrival!.querySelector('svg.lucide-tram-front')).not.toBeNull();
    expect(departure!.querySelector('svg.lucide-circle-dot')).not.toBeNull();
    expect(screen.queryByText('No travel recorded')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing else booked for this guest yet')).not.toBeInTheDocument();
  });

  it('lists every leg when nothing is shown above, whatever its id', () => {
    renderOverview(makeOverview({ transports: [makeLeg({ id: 'Stryker was here' as TransportId })] }));

    expect(screen.getByRole('heading', { name: 'Other travel' })).toBeInTheDocument();
    expect(screen.getByText('Lyon Part-Dieu')).toBeInTheDocument();
  });

  it('lists an activity stored without a category, with the generic icon', () => {
    renderOverview(
      makeOverview({
        activities: [{ ...makeActivity(), category: undefined } as unknown as Activity],
      }),
    );

    const [row] = screen.getAllByRole('listitem');
    expect(row).toHaveTextContent('Plant fair');
    expect(row!.querySelector('svg.lucide-party-popper')).not.toBeNull();
  });

  it('lists the activities with their day and hours', () => {
    renderOverview(
      makeOverview({
        activities: [
          makeActivity(),
          makeActivity({ id: 'activity-2' as ActivityId, title: 'Picnic', allDay: true }),
        ],
      }),
    );

    expect(screen.getByRole('heading', { name: 'Activities' })).toBeInTheDocument();
    const [fair, picnic] = screen.getAllByRole('listitem');
    expect(fair).toHaveTextContent('Plant fair');
    expect(fair).toHaveTextContent(/Sun 11 Jan · 09:00 \S 12:00/u);
    expect(picnic).toHaveTextContent('Picnic');
    expect(picnic).not.toHaveTextContent('·');
    expect(picnic!.lastElementChild).toHaveTextContent(/^Sun 11 Jan$/);
    expect(fair!.querySelector('svg.lucide-sprout')).not.toBeNull();
    expect(screen.queryByText('Nothing else booked for this guest yet')).not.toBeInTheDocument();
  });

  it('says so when nothing else is booked and no travel is recorded', () => {
    renderOverview(makeOverview());

    expect(screen.getByText('Nothing else booked for this guest yet')).toBeInTheDocument();
    expect(screen.getByText('No travel recorded')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Rooms' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Other travel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Activities' })).not.toBeInTheDocument();
  });

  it('says nothing about "nothing else" for a guest with a room', () => {
    renderOverview(makeOverview({ stays: [{ assignment: makeStay('a1', '2026-01-10', '2026-01-12'), room }] }));

    expect(screen.queryByText('Nothing else booked for this guest yet')).not.toBeInTheDocument();
  });

  it('keeps "nothing else" when the only travel is shown above', () => {
    const shown = makeLeg();
    renderOverview(makeOverview({ transports: [shown] }), [shown.id]);

    expect(screen.getByText('Nothing else booked for this guest yet')).toBeInTheDocument();
    expect(screen.queryByText('No travel recorded')).not.toBeInTheDocument();
  });

  it('says what the guest owes, in the trip currency', () => {
    renderOverview(
      makeOverview({
        balance: { personId: person.id, paid: 10, owed: 52, balance: -42 },
      }),
    );

    const line = lineOf('Owes the group');
    expect(screen.getByText('Owes the group')).toHaveTextContent(/^Owes the group \S/);
    expect(within(line).getByText(/42/)).toHaveTextContent('€');
    expect(line).not.toHaveTextContent('-42');
  });

  it('says what the group owes the guest', () => {
    renderOverview(
      makeOverview({
        balance: { personId: person.id, paid: 90, owed: 20, balance: 70 },
      }),
    );

    expect(lineOf('The group owes them')).toHaveTextContent('70');
    expect(screen.getByText('The group owes them')).toHaveTextContent(/^The group owes them \S/);
  });

  it('tells a settled guest apart from one on no money line', () => {
    const { rerender } = renderOverview(makeOverview());
    expect(screen.getByText('Not on any money line yet')).toBeInTheDocument();

    rerender(
      <GuestOverviewSection
        overview={makeOverview({ balance: { personId: person.id, paid: 5, owed: 5, balance: 0 } })}
        dateLocale={enUS}
      />,
    );

    expect(screen.getByText('Square with the group')).toHaveClass('text-muted-foreground');
  });
});
