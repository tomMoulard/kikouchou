/**
 * @fileoverview Tests for CalendarTimeline component.
 * @module features/calendar/components/__tests__/CalendarTimeline.test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CalendarTimeline } from '../CalendarTimeline';
import type {
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

  it('shows empty state when no assignments, arrivals, or departures', () => {
    render(<CalendarTimeline {...defaultProps} />);
    expect(screen.getByText('calendar.noAssignments')).toBeInTheDocument();
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
});
