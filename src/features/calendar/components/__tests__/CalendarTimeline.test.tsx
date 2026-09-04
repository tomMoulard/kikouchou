/**
 * @fileoverview Tests for CalendarTimeline component.
 * @module features/calendar/components/__tests__/CalendarTimeline.test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CalendarTimeline } from '../CalendarTimeline';
import type {
  Activity,
  HexColor,
  ISODateString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  Transport,
  Trip,
  TripId,
} from '@/types';
import { enUS } from 'date-fns/locale';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback;
      return key;
    },
  }),
}));

// ============================================================================
// Test Data
// ============================================================================

function makeTrip(): Trip {
  return {
    id: 'trip-1' as TripId,
    shareId: 'share-1' as Trip['shareId'],
    name: 'Test Trip',
    startDate: '2026-01-05' as ISODateString,
    endDate: '2026-01-10' as ISODateString,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makePerson(name: string, id = 'p1'): Person {
  return {
    id: id as PersonId,
    tripId: 'trip-1' as TripId,
    name,
    color: '#3b82f6' as HexColor,
  };
}

function makeRoom(): Room {
  return {
    id: 'room-1' as RoomId,
    tripId: 'trip-1' as TripId,
    name: 'Room A',
    capacity: 2,
    order: 0,
  };
}

function makeAssignment(personId: string): RoomAssignment {
  return {
    id: 'a1' as RoomAssignmentId,
    tripId: 'trip-1' as TripId,
    roomId: 'room-1' as RoomId,
    personId: personId as PersonId,
    startDate: '2026-01-06' as ISODateString,
    endDate: '2026-01-09' as ISODateString,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('CalendarTimeline', () => {
  const defaultProps = {
    trip: makeTrip(),
    persons: [makePerson('Alice')],
    rooms: [makeRoom()],
    assignments: [] as RoomAssignment[],
    arrivals: [] as Transport[],
    departures: [] as Transport[],
    activities: [] as Activity[],
    dateLocale: enUS,
    today: new Date('2026-01-07'),
    onAssignmentClick: vi.fn(),
    onTransportClick: vi.fn(),
  };

  it('renders the timeline frame with correct aria label', () => {
    render(<CalendarTimeline {...defaultProps} />);
    expect(screen.getByRole('region', { name: 'Timeline calendar' })).toBeInTheDocument();
  });

  it('renders left header with Guests label', () => {
    render(<CalendarTimeline {...defaultProps} />);
    expect(screen.getByText('Guests')).toBeInTheDocument();
  });

  it('renders person row in the timeline', () => {
    render(<CalendarTimeline {...defaultProps} />);
    // The person name should appear as a row label
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows empty state when there are no guests, assignments, arrivals or departures', () => {
    render(<CalendarTimeline {...defaultProps} persons={[]} />);
    expect(screen.getByText('calendar.noAssignments')).toBeInTheDocument();
    // The same EmptyState the month view uses, so switching views does not
    // change how "nothing here yet" is presented. This file's `t` mock returns
    // the fallback when one is given, hence the English string here.
    expect(screen.getByText('Nothing scheduled yet')).toBeInTheDocument();
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Nothing scheduled yet');
  });

  // A guest with no dates of their own is taken to be there for the whole trip,
  // so their row is drawn and the timeline is not empty — it used to say
  // "nothing scheduled" over a guest list the host had just filled in.
  it('does not show empty state for a guest with no dates of their own', () => {
    render(<CalendarTimeline {...defaultProps} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('calendar.noAssignments')).not.toBeInTheDocument();
  });

  it('does not show empty state when assignments exist', () => {
    render(
      <CalendarTimeline
        {...defaultProps}
        assignments={[makeAssignment('p1')]}
      />
    );
    expect(screen.queryByText('calendar.noAssignments')).not.toBeInTheDocument();
  });

  it('renders timeline rows as list items', () => {
    render(
      <CalendarTimeline
        {...defaultProps}
        persons={[makePerson('Alice', 'p1'), makePerson('Bob', 'p2')]}
      />
    );
    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(2);
  });

  it('renders the timeline rows list', () => {
    render(<CalendarTimeline {...defaultProps} />);
    expect(screen.getByRole('list', { name: 'Timeline rows' })).toBeInTheDocument();
  });

  // An empty calendar is usually an empty trip, so the empty state offers the
  // two things that have to exist before anything can be scheduled.
  it('offers to add guests and rooms from the empty state', async () => {
    const user = userEvent.setup();
    const onAddGuests = vi.fn();
    const onAddRooms = vi.fn();

    render(
      <CalendarTimeline
        {...defaultProps}
        persons={[]}
        onAddGuests={onAddGuests}
        onAddRooms={onAddRooms}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add guests' }));
    await user.click(screen.getByRole('button', { name: 'Add rooms' }));

    expect(onAddGuests).toHaveBeenCalledTimes(1);
    expect(onAddRooms).toHaveBeenCalledTimes(1);
  });

  // Regression: the empty state used to render inside the frame's scrolling
  // canvas, which is as wide as the trip is long (~1450px for 32 days). Its
  // `mx-auto` centred it on that canvas rather than on the screen, so on a
  // phone the message — and, once they existed, both buttons — sat hundreds of
  // pixels off to the right and could not be reached without scrolling.
  it('renders the empty state outside the horizontally scrolling canvas', () => {
    render(
      <CalendarTimeline
        {...defaultProps}
        persons={[]}
        onAddGuests={vi.fn()}
        onAddRooms={vi.fn()}
      />
    );

    // The frame's scroll container is the element carrying the collapse flag.
    const scroller = document.querySelector('[data-labels-collapsed]');
    expect(scroller).not.toBeNull();

    const emptyState = screen.getByRole('status');
    expect(scroller!.contains(emptyState)).toBe(false);

    // Both actions live with it, so they travel out of the canvas too.
    for (const name of ['Add guests', 'Add rooms']) {
      const button = screen.getByRole('button', { name });
      expect(scroller!.contains(button)).toBe(false);
    }
  });

  it('keeps the empty state text-only when no handlers are given', () => {
    render(<CalendarTimeline {...defaultProps} persons={[]} />);
    expect(screen.getByText('Nothing scheduled yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add guests' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add rooms' })).not.toBeInTheDocument();
  });

  it('does not offer the empty-state actions once the timeline has content', () => {
    render(
      <CalendarTimeline
        {...defaultProps}
        assignments={[makeAssignment('p1')]}
        onAddGuests={vi.fn()}
        onAddRooms={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Add guests' })).not.toBeInTheDocument();
  });
});
