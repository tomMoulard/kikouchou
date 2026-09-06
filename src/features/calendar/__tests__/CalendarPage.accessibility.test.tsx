/**
 * @fileoverview Accessibility-focused tests for the calendar page.
 *
 * @module features/calendar/__tests__/CalendarPage.accessibility
 */

import { act } from 'react';
import { Routes, Route } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';
import type { Person, Trip } from '@/types';

import { CalendarPage } from '../pages/CalendarPage';

const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Accessibility Trip',
  location: 'Paris',
  startDate: '2026-04-01' as Trip['startDate'],
  endDate: '2026-04-10' as Trip['endDate'],
  description: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const mockPerson: Person = {
  id: 'person-1' as Person['id'],
  tripId: mockTrip.id,
  name: 'Alex',
  color: '#3b82f6' as Person['color'],
  stayStartDate: '2026-04-01' as NonNullable<Person['stayStartDate']>,
  stayEndDate: '2026-04-10' as NonNullable<Person['stayEndDate']>,
};

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({
    currentTrip: mockTrip,
    isLoading: false,
    setCurrentTrip: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/contexts/RoomContext', () => ({
  useRoomContext: () => ({
    rooms: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: () => ({
    assignments: [],
    isLoading: false,
    error: null,
    deleteAssignment: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({
    persons: [mockPerson],
    getPersonById: vi.fn().mockImplementation((personId: string) =>
      personId === mockPerson.id ? mockPerson : undefined,
    ),
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => ({
    arrivals: [],
    departures: [],
    isLoading: false,
    error: null,
    deleteTransport: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/contexts/ActivityContext', () => ({
  useActivityContext: () => ({
    activities: [],
    isLoading: false,
    error: null,
    deleteActivity: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/contexts/RideContext', () => ({
  useRideContext: () => ({
    rides: [],
    vehicles: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({
    successToast: vi.fn(),
  }),
}));

vi.mock('@/hooks/useToday', () => ({
  useToday: () => ({
    today: new Date('2026-04-04T12:00:00.000Z'),
  }),
}));

vi.mock('@/features/transports', () => ({
  TransportDialog: () => null,
}));

vi.mock('@/features/activities/components/ActivityDialog', () => ({
  ActivityDialog: () => null,
}));

describe('CalendarPage accessibility', () => {
  it('renders a valid grid structure and supports arrow-key navigation', async () => {
    const { user } = render(
      <Routes>
        <Route path="/trips/:tripId/calendar" element={<CalendarPage />} />
      </Routes>,
      {
        initialRoute: '/trips/trip-1/calendar',
        withProviders: false,
      },
    );

    // View toggle should be present (Month / Timeline)
    expect(screen.getByRole('radiogroup', { name: 'calendar.view.ariaLabel' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'calendar.view.month' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'calendar.view.timeline' })).toBeInTheDocument();

    // Default view is timeline; switch to month (card) to validate grid behavior
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));

    const grid = screen.getByRole('grid', { name: 'calendar.monthView' });
    expect(grid).toBeInTheDocument();

    const columnHeaders = screen.getAllByRole('columnheader');
    expect(columnHeaders).toHaveLength(7);

    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);

    const cells = screen.getAllByRole('gridcell');
    expect(cells.length).toBeGreaterThanOrEqual(35);

    const firstCell = cells[0];
    const secondCell = cells[1];
    const eighthCell = cells[7];

    await act(async () => {
      firstCell?.focus();
    });
    expect(firstCell).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(secondCell).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(cells[8]).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(eighthCell).toHaveFocus();

    await user.keyboard('{Home}');
    expect(eighthCell).toHaveFocus();
  });
});
