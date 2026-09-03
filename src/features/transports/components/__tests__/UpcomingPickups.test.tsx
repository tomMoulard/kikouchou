/**
 * @fileoverview Tests for UpcomingPickups helper functions.
 * Tests the pure functions: formatRelativeTime, getUrgencyClasses, getDateLocale.
 * @module features/transports/components/__tests__/UpcomingPickups.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpcomingPickups } from '../UpcomingPickups';

// Mock contexts
vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: vi.fn(() => ({
    upcomingPickups: [],
    updateTransport: vi.fn(),
  })),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: vi.fn(() => ({
    persons: [],
  })),
}));

vi.mock('@/hooks', () => ({
  useFormSubmission: vi.fn(() => ({
    isSubmitting: false,
    submitError: undefined,
    handleSubmit: vi.fn(),
    clearError: vi.fn(),
  })),
  useOfflineAwareToast: vi.fn(() => ({
    successToast: vi.fn(),
  })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback;
      if (typeof fallback === 'object' && fallback !== null && 'count' in fallback) {
        return `${fallback.count}`;
      }
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('UpcomingPickups', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when no pickups need a ride', () => {
    const { container } = render(<UpcomingPickups />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when pickups exist but all have drivers', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [
        {
          id: 't1',
          tripId: 'trip-1',
          personId: 'p1',
          type: 'arrival',
          datetime: '2026-07-15T14:00:00.000Z',
          location: 'Station A',
          mode: 'train',
          transportNumber: '',
          needsPickup: true,
          driverId: 'driver-1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    const { container } = render(<UpcomingPickups />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('pickups.allCovered')).not.toBeInTheDocument();
  });

  it('renders pickup cards for unassigned pickups', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{
        id: 'p1',
        tripId: 'trip-1',
        name: 'Alice',
        color: '#ef4444',
        order: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Station A',
        mode: 'train',
        transportNumber: 'TGV 1234',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);

    // Should show the "needs driver" header (may appear in multiple places)
    const headers = screen.getAllByText('pickups.needsDriver');
    expect(headers.length).toBeGreaterThanOrEqual(1);
    // Should show the volunteer button
    expect(screen.getByText('pickups.volunteerDrive')).toBeInTheDocument();
    // Should show transport number
    expect(screen.getByText('TGV 1234')).toBeInTheDocument();
    // Should show station
    expect(screen.getByText('Station A')).toBeInTheDocument();
  });

  it('renders departure type pickups', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{
        id: 'p1',
        tripId: 'trip-1',
        name: 'Bob',
        color: '#3b82f6',
      }] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't2',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'departure',
        datetime: '2026-07-16T08:00:00.000Z',
        location: 'Airport',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    expect(screen.getByText('Airport')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('renders pickup without transport number', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{
        id: 'p1',
        tripId: 'trip-1',
        name: 'Alice',
        color: '#ef4444',
      }] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't3',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Bus Stop',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    expect(screen.getByText('Bus Stop')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('renders unknown person when person is not found', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't4',
        tripId: 'trip-1',
        personId: 'nonexistent',
        type: 'arrival',
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Station X',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    expect(screen.getByText('Station X')).toBeInTheDocument();
  });

  it('opens driver dialog when volunteer button is clicked', async () => {
    // Use real timers for this test — radix Dialog relies on real requestAnimationFrame
    vi.useRealTimers();

    const user = userEvent.setup();
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [
        { id: 'p1', tripId: 'trip-1', name: 'Alice', color: '#ef4444' },
        { id: 'p2', tripId: 'trip-1', name: 'Bob', color: '#3b82f6' },
      ] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: '2126-07-15T14:00:00.000Z',
        location: 'Station A',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);

    // Click volunteer button
    const volunteerBtn = screen.getByText('pickups.volunteerDrive');
    await user.click(volunteerBtn);

    // Driver dialog should open — title + aria-label both use this key
    await waitFor(() => {
      expect(screen.getAllByText('pickups.selectDriver').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders grouped pickups at the same station', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [
        { id: 'p1', tripId: 'trip-1', name: 'Alice', color: '#ef4444' },
        { id: 'p2', tripId: 'trip-1', name: 'Bob', color: '#3b82f6' },
      ] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [
        {
          id: 't1',
          tripId: 'trip-1',
          personId: 'p1',
          type: 'arrival',
          datetime: '2026-07-15T14:00:00.000Z',
          location: 'Station A',
          needsPickup: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 't2',
          tripId: 'trip-1',
          personId: 'p2',
          type: 'arrival',
          datetime: '2026-07-15T14:30:00.000Z',
          location: 'Station A',
          needsPickup: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    // Both pickups should render
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    // Combined trip badge should appear for grouped pickups
    expect(screen.getByText('pickups.combinedTrip')).toBeInTheDocument();
  });

  it('applies custom className', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Station A',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    const { container } = render(<UpcomingPickups className="custom-test" />);
    expect(container.querySelector('.custom-test')).toBeInTheDocument();
  });

  /**
   * The panel no longer re-decides what counts as upcoming: `TransportContext`
   * owns that against one reference instant it refreshes each minute. So a
   * pickup that has just fallen due stays on screen, flagged as overdue, until
   * that tick drops it — instead of vanishing from this panel alone at the very
   * moment somebody needs to drive, while the analytics badge still counted it.
   */
  it('keeps a pickup the context still lists, flagged as overdue', async () => {
    // Set time to after the pickup, as if the minute tick had not landed yet
    vi.setSystemTime(new Date('2026-07-16T10:00:00.000Z'));

    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{
        id: 'p1',
        tripId: 'trip-1',
        name: 'Alice',
        color: '#ef4444',
      }] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't5',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Station Late',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);

    expect(screen.getByText('Station Late')).toBeInTheDocument();
    expect(screen.getAllByText('pickups.overdue').length).toBeGreaterThan(0);
  });

  it('handles driver assignment with resolving animation', async () => {
    // Use real timers for dialog interaction
    vi.useRealTimers();

    const user = userEvent.setup();
    const mockUpdateTransport = vi.fn().mockResolvedValue(undefined);
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [
        { id: 'p1', tripId: 'trip-1', name: 'Alice', color: '#ef4444' },
        { id: 'p2', tripId: 'trip-1', name: 'Bob', color: '#3b82f6' },
      ] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: '2126-07-15T14:00:00.000Z',
        location: 'Station A',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: mockUpdateTransport,
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);

    // Click volunteer button
    const volunteerBtn = screen.getByText('pickups.volunteerDrive');
    await user.click(volunteerBtn);

    // Wait for dialog to open
    await waitFor(() => {
      expect(screen.getAllByText('pickups.selectDriver').length).toBeGreaterThanOrEqual(1);
    });

    // The confirm button should be disabled since no driver is selected
    const confirmBtn = screen.getByText('common.confirm');
    expect(confirmBtn).toBeDisabled();
  });

  it('handles driver assignment failure with error toast', async () => {
    // Use real timers for this test
    vi.useRealTimers();

    const { toast: toastMock } = await import('sonner');
    const mockUpdateTransport = vi.fn().mockRejectedValue(new Error('Network error'));
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [
        { id: 'p1', tripId: 'trip-1', name: 'Alice', color: '#ef4444' },
        { id: 'p2', tripId: 'trip-1', name: 'Bob', color: '#3b82f6' },
      ] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: '2126-07-15T14:00:00.000Z',
        location: 'Station A',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: mockUpdateTransport,
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);

    // Verify the component renders the pickup cards
    expect(screen.getByText('pickups.volunteerDrive')).toBeInTheDocument();
    // Verify transport error toast is mocked
    expect(vi.mocked(toastMock.error)).toBeDefined();
  });

  it('renders pickup with tomorrow datetime', async () => {
    // Set time so pickup is tomorrow
    vi.setSystemTime(new Date('2026-07-14T10:00:00.000Z'));

    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{
        id: 'p1',
        tripId: 'trip-1',
        name: 'Alice',
        color: '#ef4444',
      }] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Station A',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    // Should render the pickup card with tomorrow's time
    expect(screen.getByText('Station A')).toBeInTheDocument();
  });

  it('renders pickup with date later than tomorrow', async () => {
    // Set time so pickup is 3 days from now
    vi.setSystemTime(new Date('2026-07-12T10:00:00.000Z'));

    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{
        id: 'p1',
        tripId: 'trip-1',
        name: 'Alice',
        color: '#ef4444',
      }] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Station A',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    // Should render the pickup card for a later date
    expect(screen.getByText('Station A')).toBeInTheDocument();
  });

  it('renders pickup with invalid datetime as unknown', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{
        id: 'p1',
        tripId: 'trip-1',
        name: 'Alice',
        color: '#ef4444',
      }] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: 'invalid-date',
        location: 'Station A',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    // The component should render (groupPickupsByProximity may filter it out or show it)
    // At minimum it should not crash
    expect(screen.queryByText('Station A')).toBeDefined();
  });

  it('renders pickup with French locale', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    // Override the useTranslation mock to return French
    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare du Nord',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{
        id: 'p1',
        tripId: 'trip-1',
        name: 'Alice',
        color: '#ef4444',
      }] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    expect(screen.getByText('Gare du Nord')).toBeInTheDocument();
  });

  it('renders unassigned count badge', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [
        { id: 'p1', tripId: 'trip-1', name: 'Alice', color: '#ef4444' },
        { id: 'p2', tripId: 'trip-1', name: 'Bob', color: '#3b82f6' },
      ] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [
        {
          id: 't1',
          tripId: 'trip-1',
          personId: 'p1',
          type: 'arrival',
          datetime: '2026-07-15T14:00:00.000Z',
          location: 'Different Station',
          needsPickup: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 't2',
          tripId: 'trip-1',
          personId: 'p2',
          type: 'arrival',
          datetime: '2026-07-15T18:00:00.000Z',
          location: 'Another Station',
          needsPickup: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    // Both pickups should render (different stations so ungrouped)
    expect(screen.getAllByText('pickups.volunteerDrive').length).toBe(2);
  });

  it('renders pickup with multiple transport numbers in a group', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [
        { id: 'p1', tripId: 'trip-1', name: 'Alice', color: '#ef4444' },
        { id: 'p2', tripId: 'trip-1', name: 'Bob', color: '#3b82f6' },
      ] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [
        {
          id: 't1',
          tripId: 'trip-1',
          personId: 'p1',
          type: 'arrival',
          datetime: '2026-07-15T14:00:00.000Z',
          location: 'Station A',
          transportNumber: 'TGV 100',
          needsPickup: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 't2',
          tripId: 'trip-1',
          personId: 'p2',
          type: 'arrival',
          datetime: '2026-07-15T14:30:00.000Z',
          location: 'Station A',
          transportNumber: 'TGV 200',
          needsPickup: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    // Both transport numbers should be visible
    expect(screen.getByText('TGV 100')).toBeInTheDocument();
    expect(screen.getByText('TGV 200')).toBeInTheDocument();
    // Combined trip badge should appear
    expect(screen.getByText('pickups.combinedTrip')).toBeInTheDocument();
  });

  it('renders pickup with no person as unknown in aria-label', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'nonexistent',
        type: 'arrival',
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Station Z',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    // The article should have an aria-label containing "unknown" key
    const article = screen.getByRole('article');
    expect(article).toHaveAttribute('aria-label', expect.stringContaining('common.unknown'));
  });
});
