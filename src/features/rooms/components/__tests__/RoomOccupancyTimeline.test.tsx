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
    bar,
    style,
  }: {
    person: Person;
    startDate: string;
    endDate: string;
    bar?: boolean;
    style?: { left?: string | number; width?: string | number; top?: string | number };
  }) => (
    <span
      data-testid="draggable-guest"
      data-start={startDate}
      data-end={endDate}
      data-bar={bar ? 'true' : 'false'}
      data-left={String(style?.left ?? '')}
      data-top={String(style?.top ?? '')}
    >
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
        labelColumnWidth: 140,
        labelsCollapsed: false,
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

  it('calls onEditRoom when the room name is double-clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onEditRoom = vi.fn();
    render(<RoomOccupancyTimeline {...defaultProps} onEditRoom={onEditRoom} />);
    await user.dblClick(screen.getByText('Main Bedroom'));
    expect(onEditRoom).toHaveBeenCalledWith(mockRoom);
  });

  // Without the callback the names carry no gesture, so the tooltip must not
  // advertise one.
  it('only offers the double-click hint when onEditRoom is wired up', () => {
    const { unmount } = render(<RoomOccupancyTimeline {...defaultProps} />);
    expect(screen.getByTitle(/Main Bedroom/).getAttribute('title')).not.toContain(
      'rooms.doubleClickToEdit',
    );
    unmount();

    render(<RoomOccupancyTimeline {...defaultProps} onEditRoom={vi.fn()} />);
    expect(screen.getByTitle(/Main Bedroom/).getAttribute('title')).toContain(
      'rooms.doubleClickToEdit',
    );
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

    // The frame reports 88px columns. Jul 2 is the second one, and the stay is
    // six nights (Jul 2 through Jul 7) — a bar seven columns wide would be the
    // check-out day drawn as a night slept.
    const DAY_WIDTH_PX = 88;
    const bar = screen.getByTestId('draggable-assignment');
    expect(bar).toHaveAttribute('data-left', String(1 * DAY_WIDTH_PX + 2));
    expect(bar).toHaveAttribute('data-width', String(6 * DAY_WIDTH_PX - 4));
  });

  it('renders unassigned guests in a row marked as needing a room', () => {
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
    // The row carries the "no bed yet" meaning, so the guest itself does not
    // have to be drawn as an absence.
    expect(
      screen.getByRole('listitem', { name: 'rooms.needsRoom' }),
    ).toBeInTheDocument();
  });

  // Was an empty dashed outline with no name in it, while the guest's name sat
  // back in the label column. It reads as the same pill an assigned guest gets
  // now — same colour, same name, same place on the day axis.
  it('draws an unassigned guest as a named pill on the day axis', () => {
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

    const pill = screen.getByTestId('draggable-guest');
    expect(pill).toHaveAttribute('data-bar', 'true');
    expect(pill).toHaveTextContent('Alice');
    // Positioned rather than inline, so it lands on its own nights.
    expect(pill.getAttribute('data-left')).not.toBe('');
  });

  it('stacks overlapping unassigned guests into separate lanes', () => {
    const other: Person = {
      ...mockPerson,
      id: 'p2' as Person['id'],
      name: 'Bob',
    };

    render(
      <RoomOccupancyTimeline
        {...defaultProps}
        persons={[mockPerson, other]}
        unassignedGuests={[
          { person: mockPerson, startDate: '2026-07-03', endDate: '2026-07-07' },
          { person: other, startDate: '2026-07-04', endDate: '2026-07-08' },
        ]}
      />,
    );

    const tops = screen
      .getAllByTestId('draggable-guest')
      .map((pill) => pill.getAttribute('data-top'));

    // Two overlapping guests must not be drawn over one another.
    expect(new Set(tops).size).toBe(2);
  });

  // The 140px label column truncated the sentence to "a besoin d'u…", which is
  // a caption nobody can finish. The pills carry the names, so the column shows
  // the warning and nothing else — with the sentence still reachable.
  it('labels the unassigned row with an icon rather than truncated text', () => {
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

    // Present for assistive tech and on hover, but not drawn as a caption.
    expect(screen.getByText('rooms.needsRoom')).toHaveClass('sr-only');
    expect(
      screen.getByRole('listitem', { name: 'rooms.needsRoom' }),
    ).toBeInTheDocument();
  });

  it('renders no unassigned row when everyone has a bed', () => {
    render(<RoomOccupancyTimeline {...defaultProps} />);

    expect(screen.queryByTestId('draggable-guest')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('listitem', { name: 'rooms.needsRoom' }),
    ).not.toBeInTheDocument();
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

  // The row means "the part of this stay with no bed yet", and the pill has to
  // mean the same thing. It was drawn across the guest's *whole* window instead,
  // so a guest housed for part of their stay claimed the nights they already had
  // a room for — and dragging that pill would book the whole window again on top
  // of the existing assignment. Invisible while guests are all-or-nothing housed;
  // the moment a stay is split across rooms it is what you see.
  describe('partially housed guests', () => {
    it('draws the pill over the uncovered nights, not the whole stay', () => {
      render(
        <RoomOccupancyTimeline
          {...defaultProps}
          unassignedGuests={[{
            person: mockPerson,
            startDate: '2026-07-01',
            endDate: '2026-07-10',
            // Housed for the rest; only these two nights still need a bed.
            unassignedDates: ['2026-07-03', '2026-07-04'],
          }]}
        />,
      );

      const pill = screen.getByTestId('draggable-guest');
      // Check-out model: two nights from the 3rd means checking out on the 5th.
      expect(pill).toHaveAttribute('data-start', '2026-07-03');
      expect(pill).toHaveAttribute('data-end', '2026-07-05');
    });

    it('gives each run of uncovered nights its own pill', () => {
      render(
        <RoomOccupancyTimeline
          {...defaultProps}
          unassignedGuests={[{
            person: mockPerson,
            startDate: '2026-07-01',
            endDate: '2026-07-10',
            // A bed on the 4th, 5th and 6th; two separate gaps around it.
            unassignedDates: ['2026-07-02', '2026-07-03', '2026-07-07'],
          }]}
        />,
      );

      const pills = screen.getAllByTestId('draggable-guest');
      expect(pills).toHaveLength(2);
      expect(pills[0]).toHaveAttribute('data-start', '2026-07-02');
      expect(pills[0]).toHaveAttribute('data-end', '2026-07-04');
      expect(pills[1]).toHaveAttribute('data-start', '2026-07-07');
      expect(pills[1]).toHaveAttribute('data-end', '2026-07-08');
    });

    it('still spans the stay for a guest with no bed at all', () => {
      render(
        <RoomOccupancyTimeline
          {...defaultProps}
          unassignedGuests={[{
            person: mockPerson,
            startDate: '2026-07-03',
            endDate: '2026-07-07',
            unassignedDates: ['2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06'],
          }]}
        />,
      );

      const pill = screen.getByTestId('draggable-guest');
      expect(pill).toHaveAttribute('data-start', '2026-07-03');
      expect(pill).toHaveAttribute('data-end', '2026-07-07');
    });
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

    // One lane, two beds taken, so the two-bed room is full. Counting lanes or
    // assignment rows instead would leave "1 spot open" on the row — the bug
    // that had the same room reading 1 here and 2 on its card.
    expect(screen.queryByText(/rooms\.spotsOpen/)).not.toBeInTheDocument();
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

  // As a caption under the room name the warning was truncated to "This room
  // may be ove…", which tells the reader nothing. It is an icon beside the
  // name now, carrying the whole sentence on hover and for screen readers.
  it('shows the over-capacity warning as an icon carrying the full sentence', () => {
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

    const warning = screen.getByTestId('room-capacity-warning-room-1');
    // Hover shows it in full rather than clipping it to the label column.
    expect(warning).toHaveAttribute('title', 'rooms.capacityWarning');
    // And it is not the clipped caption any more.
    expect(screen.getByText('rooms.capacityWarning')).toHaveClass('sr-only');
  });

  it('announces the over-capacity warning on the row, not just on hover', () => {
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

    expect(
      screen.getByRole('listitem', { name: 'Main Bedroom. rooms.capacityWarning' }),
    ).toBeInTheDocument();
  });

  it('shows no capacity icon for a room that is within capacity', () => {
    render(<RoomOccupancyTimeline {...defaultProps} />);

    expect(screen.queryByTestId('room-capacity-warning-room-1')).not.toBeInTheDocument();
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
