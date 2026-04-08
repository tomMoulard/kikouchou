/**
 * @fileoverview Tests for UpcomingPickups helper functions.
 * Tests the pure functions: formatRelativeTime, getUrgencyClasses, getDateLocale.
 * @module features/transports/components/__tests__/UpcomingPickups.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('shows "all covered" when pickups exist but all have drivers', async () => {
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

    render(<UpcomingPickups />);
    expect(screen.getByText('pickups.allCovered')).toBeInTheDocument();
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
});
