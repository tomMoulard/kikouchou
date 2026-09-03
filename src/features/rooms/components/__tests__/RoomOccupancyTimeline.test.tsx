/**
 * @fileoverview Tests for RoomOccupancyTimeline component.
 *
 * The timeline's job is to say *how full each room is on which nights*, so a
 * test that only asserts `rooms.spotsOpen` is on the page checks nothing: the
 * shared `t` double drops `count`, and every occupancy number — 1 spot, 3
 * spots, the wrong spots — renders that same key. The translation double here
 * carries the interpolation values into the DOM instead, which is what lets the
 * numbers be asserted at all.
 *
 * @module features/rooms/components/__tests__/RoomOccupancyTimeline.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoomOccupancyTimeline } from '../RoomOccupancyTimeline';
import { enUS } from 'date-fns/locale';
import type { Person, Room, RoomAssignment, Transport, Trip, ISODateString } from '@/types';

// ============================================================================
// Mocks
// ============================================================================

/**
 * Renders every `t()` call as `key {sorted=options}` so the numbers a surface
 * shows survive into the DOM — the same double the occupancy-agreement suite
 * uses, for the same reason.
 */
vi.mock('react-i18next', () => {
  const translate = (key: string, second?: unknown, third?: unknown): string => {
    const options =
      second !== null && typeof second === 'object'
        ? (second as Record<string, unknown>)
        : third !== null && typeof third === 'object'
          ? (third as Record<string, unknown>)
          : undefined;
    if (!options) {
      return key;
    }
    const parts = Object.entries(options)
      .filter(([name]) => name !== 'context' && name !== 'defaultValue')
      .map(([name, value]) => `${name}=${String(value)}`)
      .sort();
    return parts.length > 0 ? `${key} {${parts.join(',')}}` : key;
  };
  const value = { t: translate, i18n: { language: 'en' } };
  return { useTranslation: () => value };
});

// Mock DnD components to simplify rendering
vi.mock('@/features/rooms/components/DroppableRoom', () => ({
  DroppableRoom: ({
    children,
    className,
    disabled,
  }: {
    children: React.ReactNode;
    className?: string;
    disabled?: boolean;
  }) => (
    <div data-testid="droppable-room" className={className} data-disabled={String(disabled)}>
      {children}
    </div>
  ),
}));

vi.mock('@/features/rooms/components/DraggableGuest', () => ({
  DraggableGuest: ({
    person,
    startDate,
    endDate,
  }: {
    person: Person;
    startDate: string;
    endDate: string;
  }) => (
    <span data-testid="draggable-guest" data-start={startDate} data-end={endDate}>
      {person.name}
    </span>
  ),
}));

// The pill's accessible label is where the stay window reaches a screen reader,
// so the stub keeps it rather than throwing it away.
vi.mock('@/features/rooms/components/DraggableRoomAssignment', () => ({
  DraggableRoomAssignment: ({
    label,
    accessibilityLabel,
    style,
  }: {
    label: string;
    accessibilityLabel?: string;
    style?: React.CSSProperties;
  }) => (
    <span
      data-testid="draggable-assignment"
      aria-label={accessibilityLabel ?? label}
      data-left={String(style?.left ?? '')}
      data-width={String(style?.width ?? '')}
    >
      {label}
    </span>
  ),
}));

vi.mock('@/features/rooms/components/DroppableAssignment', () => ({
  DroppableAssignment: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="droppable-assignment">{children}</div>
  ),
}));

/** Which day column the frame reports as "today"; -1 means none is on screen. */
let todayColumnIndex = -1;

// Mock TripTimelineFrame to expose rows
vi.mock('@/components/shared/TripTimelineFrame', () => ({
  TripTimelineFrame: ({
    children,
    ariaLabel,
    todayKey,
  }: {
    children: (viewport: Record<string, unknown>) => React.ReactNode;
    ariaLabel: string;
    todayKey?: string;
  }) => (
    <div aria-label={ariaLabel} data-testid="timeline-frame" data-today-key={todayKey ?? ''}>
      {children({
        canvasWidth: 800,
        dayGridTemplateColumns: 'repeat(9, 1fr)',
        dayWidthPx: 88,
        useFractionalColumns: false,
        todayColumnIndex,
        laneHeightPx: 36,
      })}
    </div>
  ),
}));

// ============================================================================
// Test Data
// ============================================================================

const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  location: 'Paris',
  startDate: '2026-07-01' as Trip['startDate'],
  endDate: '2026-07-10' as Trip['endDate'],
  description: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const mockRoom: Room = {
  id: 'room-1' as Room['id'],
  tripId: 'trip-1' as Room['tripId'],
  name: 'Main Bedroom',
  capacity: 2,
  order: 0,
};

const mockPerson: Person = {
  id: 'p1' as Person['id'],
  tripId: 'trip-1' as Person['tripId'],
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
};

const mockAssignment: RoomAssignment = {
  id: 'a1' as RoomAssignment['id'],
  tripId: 'trip-1' as RoomAssignment['tripId'],
  roomId: 'room-1' as Room['id'],
  personId: 'p1' as Person['id'],
  startDate: '2026-07-02' as RoomAssignment['startDate'],
  endDate: '2026-07-08' as RoomAssignment['endDate'],
};

const defaultProps = {
  trip: mockTrip,
  rooms: [mockRoom],
  assignments: [] as RoomAssignment[],
  arrivals: [] as Transport[],
  departures: [] as Transport[],
  persons: [mockPerson],
  dateLocale: enUS,
  range: {
    startDate: '2026-07-01' as ISODateString,
    endDate: '2026-07-10' as ISODateString,
  },
};

// ============================================================================
// Tests
// ============================================================================

describe('RoomOccupancyTimeline', () => {
  beforeEach(() => {
    todayColumnIndex = -1;
  });

  it('renders the timeline frame with aria label', () => {
    render(<RoomOccupancyTimeline {...defaultProps} />);
    expect(screen.getByTestId('timeline-frame')).toBeInTheDocument();
  });

  it('renders room rows', () => {
    render(<RoomOccupancyTimeline {...defaultProps} />);
    expect(screen.getByText('Main Bedroom')).toBeInTheDocument();
  });

  it('renders room rows as list items', () => {
    render(<RoomOccupancyTimeline {...defaultProps} />);
    const listItems = screen.getAllByRole('listitem');
    expect(listItems.length).toBeGreaterThanOrEqual(1);
  });

  it('renders assignment bars when assignments exist', () => {
    render(
      <RoomOccupancyTimeline
        {...defaultProps}
        assignments={[mockAssignment]}
      />,
    );
    expect(screen.getByTestId('draggable-assignment')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('labels the bar with the check-in to check-out window it was stored with', () => {
    render(
      <RoomOccupancyTimeline
        {...defaultProps}
        assignments={[mockAssignment]}
      />,
    );

    // Jul 2 → Jul 8 is what the assignment says; a bar labelled Jul 7 would mean
    // the timeline had silently redefined check-out as the last night.
    expect(screen.getByTestId('draggable-assignment')).toHaveAttribute(
      'aria-label',
      'rooms.timeline.assignmentPillA11y {name=Alice,range=Jul 2 – Jul 8}',
    );
  });

  it('draws the bar over the nights of the stay, not the whole trip', () => {
    render(
      <RoomOccupancyTimeline
        {...defaultProps}
        assignments={[mockAssignment]}
      />,
    );

    // Ten day columns across an 800px canvas: the stay starts on the second
    // column and covers six nights (Jul 2 through Jul 7).
    const bar = screen.getByTestId('draggable-assignment');
    expect(bar).toHaveAttribute('data-left', String((1 / 10) * 800));
    expect(bar).toHaveAttribute('data-width', String((6 / 10) * 800));
  });

  it('renders unassigned guests with "needs room" text', () => {
    render(
      <RoomOccupancyTimeline
        {...defaultProps}
        unassignedGuests={[{
          person: mockPerson,
          startDate: '2026-07-03',
          endDate: '2026-07-07',
        }]}
      />,
    );
    expect(screen.getByTestId('draggable-guest')).toBeInTheDocument();
    expect(screen.getByText('rooms.needsRoom')).toBeInTheDocument();
  });

  it('hands the unassigned guest’s own window to the drag payload', () => {
    render(
      <RoomOccupancyTimeline
        {...defaultProps}
        unassignedGuests={[{
          person: mockPerson,
          startDate: '2026-07-03',
          endDate: '2026-07-07',
        }]}
      />,
    );

    // Those dates become the quick-assign dialog's pre-fill after a drop.
    const guest = screen.getByTestId('draggable-guest');
    expect(guest).toHaveAttribute('data-start', '2026-07-03');
    expect(guest).toHaveAttribute('data-end', '2026-07-07');
  });

  it('counts the free beds of an empty room', () => {
    render(<RoomOccupancyTimeline {...defaultProps} />);
    // Capacity 2, nobody booked: both beds are open.
    expect(screen.getByText('rooms.spotsOpen {count=2}')).toBeInTheDocument();
  });

  it('counts a couple in one bar as two people, not one row', () => {
    const couple: Person = { ...mockPerson, name: 'Ada & Bob', headcount: 2 };

    render(
      <RoomOccupancyTimeline
        {...defaultProps}
        persons={[couple]}
        assignments={[mockAssignment]}
      />,
    );

    // One lane, two beds taken — the bug that made the same room read "1 spot
    // taken" here and "2" on its card.
    expect(screen.queryByText(/rooms\.spotsOpen/)).not.toBeInTheDocument();
    expect(screen.getByText('rooms.capacityWarning')).toBeInTheDocument();
  });

  it('reports the remaining bed when one guest of two is booked', () => {
    render(
      <RoomOccupancyTimeline
        {...defaultProps}
        assignments={[mockAssignment]}
      />,
    );

    expect(screen.getByText('rooms.spotsOpen {count=1}')).toBeInTheDocument();
  });

  it('warns rather than reporting negative space when a room is over capacity', () => {
    const secondGuest: Person = {
      ...mockPerson,
      id: 'p2' as Person['id'],
      name: 'Bob',
      headcount: 3,
    };
    const secondAssignment: RoomAssignment = {
      ...mockAssignment,
      id: 'a2' as RoomAssignment['id'],
      personId: secondGuest.id,
    };

    render(
      <RoomOccupancyTimeline
        {...defaultProps}
        persons={[mockPerson, secondGuest]}
        assignments={[mockAssignment, secondAssignment]}
      />,
    );

    expect(screen.getByText('rooms.capacityWarning')).toBeInTheDocument();
    expect(screen.queryByText(/rooms\.spotsOpen/)).not.toBeInTheDocument();
  });

  it('announces the room and its free beds on the row', () => {
    render(<RoomOccupancyTimeline {...defaultProps} />);

    expect(
      screen.getByRole('listitem', { name: 'Main Bedroom. rooms.spotsOpen {count=2}' }),
    ).toBeInTheDocument();
  });

  it('renders multiple rooms', () => {
    const secondRoom: Room = {
      id: 'room-2' as Room['id'],
      tripId: 'trip-1' as Room['tripId'],
      name: 'Guest Room',
      capacity: 1,
      order: 1,
    };

    render(
      <RoomOccupancyTimeline
        {...defaultProps}
        rooms={[mockRoom, secondRoom]}
      />,
    );
    expect(screen.getByText('Main Bedroom')).toBeInTheDocument();
    expect(screen.getByText('Guest Room')).toBeInTheDocument();
  });

  it('renders droppable room zones', () => {
    render(<RoomOccupancyTimeline {...defaultProps} />);
    expect(screen.getByTestId('droppable-room')).toBeInTheDocument();
    // Rows on the timeline are always live drop targets.
    expect(screen.getByTestId('droppable-room')).toHaveAttribute('data-disabled', 'false');
  });

  it('forwards the today key to the frame', () => {
    render(
      <RoomOccupancyTimeline {...defaultProps} todayKey={'2026-07-04' as ISODateString} />,
    );

    // The frame owns the "today" column; the timeline must hand it the key
    // rather than reading a clock of its own.
    expect(screen.getByTestId('timeline-frame')).toHaveAttribute(
      'data-today-key',
      '2026-07-04',
    );
  });

  it('highlights the column the frame reports as today', () => {
    todayColumnIndex = 3;
    const { container } = render(<RoomOccupancyTimeline {...defaultProps} />);

    const highlighted = container.querySelectorAll('.bg-primary\\/12');
    // Exactly one column, on the one room row on screen.
    expect(highlighted).toHaveLength(1);
  });

  it('highlights no column when today is outside the range', () => {
    todayColumnIndex = -1;
    const { container } = render(<RoomOccupancyTimeline {...defaultProps} />);

    expect(container.querySelectorAll('.bg-primary\\/12')).toHaveLength(0);
  });

  it('skips unassigned guests with invalid dates', () => {
    render(
      <RoomOccupancyTimeline
        {...defaultProps}
        unassignedGuests={[{
          person: mockPerson,
          startDate: 'invalid',
          endDate: 'invalid',
        }]}
      />,
    );
    expect(screen.queryByTestId('draggable-guest')).not.toBeInTheDocument();
  });

  it('skips unassigned guests where end is before start', () => {
    render(
      <RoomOccupancyTimeline
        {...defaultProps}
        unassignedGuests={[{
          person: mockPerson,
          startDate: '2026-07-08',
          endDate: '2026-07-08', // same day = last night before start
        }]}
      />,
    );
    expect(screen.queryByTestId('draggable-guest')).not.toBeInTheDocument();
  });
});
