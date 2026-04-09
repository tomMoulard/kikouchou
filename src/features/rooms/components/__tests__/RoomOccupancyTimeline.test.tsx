/**
 * @fileoverview Tests for RoomOccupancyTimeline component.
 * @module features/rooms/components/__tests__/RoomOccupancyTimeline.test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoomOccupancyTimeline } from '../RoomOccupancyTimeline';
import { enUS } from 'date-fns/locale';
import type { Person, Room, RoomAssignment, Transport, Trip, ISODateString } from '@/types';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

// Mock DnD components to simplify rendering
vi.mock('@/features/rooms/components/DroppableRoom', () => ({
  DroppableRoom: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="droppable-room" className={className}>{children}</div>
  ),
}));

vi.mock('@/features/rooms/components/DraggableGuest', () => ({
  DraggableGuest: ({ person }: { person: Person }) => (
    <span data-testid="draggable-guest">{person.name}</span>
  ),
}));

vi.mock('@/features/rooms/components/DraggableRoomAssignment', () => ({
  DraggableRoomAssignment: ({ label }: { label: string }) => (
    <span data-testid="draggable-assignment">{label}</span>
  ),
}));

vi.mock('@/features/rooms/components/DroppableAssignment', () => ({
  DroppableAssignment: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="droppable-assignment">{children}</div>
  ),
}));

// Mock TripTimelineFrame to expose rows
vi.mock('@/components/shared/TripTimelineFrame', () => ({
  TripTimelineFrame: ({ children, ariaLabel }: { children: (viewport: Record<string, unknown>) => React.ReactNode; ariaLabel: string }) => (
    <div aria-label={ariaLabel} data-testid="timeline-frame">
      {children({
        canvasWidth: 800,
        dayGridTemplateColumns: 'repeat(9, 1fr)',
        dayWidthPx: 88,
        useFractionalColumns: false,
        todayColumnIndex: -1,
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
  createdAt: Date.now(),
  updatedAt: Date.now(),
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

  it('renders spots open text for multi-capacity rooms', () => {
    render(<RoomOccupancyTimeline {...defaultProps} />);
    // Room has capacity 2 with 0 assignments, so 2 spots open
    expect(screen.getByText('rooms.spotsOpen')).toBeInTheDocument();
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
