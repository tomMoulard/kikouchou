/**
 * @fileoverview Tests for the "print the trip summary" trip settings card.
 *
 * The card replaced a navigation entry, so what matters is that the sheet is
 * still reachable: the button must navigate to the current trip's summary
 * route, and must not offer a route it cannot build when no trip is open.
 *
 * @module features/trips/components/__tests__/PrintSummaryCard.test
 */

import { createContext, useContext } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, userEvent } from '@/test/utils';
import type { Trip } from '@/types';

// ============================================================================
// Fixtures & mocks
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

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(),
}));

import { useTripContext } from '@/contexts/TripContext';

import { PrintSummaryCard } from '../PrintSummaryCard';

/** Points the mocked trip context at a trip, or at none. */
function setTrip(trip: Trip | null): void {
  vi.mocked(useTripContext).mockReturnValue({
    currentTrip: trip,
  } as ReturnType<typeof useTripContext>);
}

// ============================================================================
// Tests
// ============================================================================

describe('PrintSummaryCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the current trip summary route', async () => {
    setTrip(mockTrip);
    render(<PrintSummaryCard />, { withProviders: false });

    await userEvent.setup().click(screen.getByRole('button', { name: /settings.printSummary/ }));

    expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-1/summary');
  });

  it('disables the button and says why when no trip is open', () => {
    setTrip(null);
    render(<PrintSummaryCard />, { withProviders: false });

    expect(screen.getByRole('button', { name: /settings.printSummary/ })).toBeDisabled();
    expect(screen.getByText('settings.printSummaryNoTrip')).toBeInTheDocument();
  });

  it('names the sheet and says what is on it', () => {
    setTrip(mockTrip);
    render(<PrintSummaryCard />, { withProviders: false });

    expect(screen.getByText('summary.title')).toHaveClass('text-base');
    expect(screen.getByText('summary.description')).toBeInTheDocument();
    expect(screen.queryByText('settings.printSummaryNoTrip')).not.toBeInTheDocument();
  });

  it('opens the summary of the trip open now, not the one open first', async () => {
    // The card is memoised and takes no props, so the trip has to reach it
    // through a real context for a switch to re-render it.
    const TripSwitch = createContext<Trip>(mockTrip);
    vi.mocked(useTripContext).mockImplementation(
      () => ({ currentTrip: useContext(TripSwitch) }) as ReturnType<typeof useTripContext>,
    );
    const other: Trip = { ...mockTrip, id: 'trip-2' as Trip['id'] };
    const { rerender } = render(
      <TripSwitch.Provider value={mockTrip}>
        <PrintSummaryCard />
      </TripSwitch.Provider>,
      { withProviders: false },
    );

    rerender(
      <TripSwitch.Provider value={other}>
        <PrintSummaryCard />
      </TripSwitch.Provider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /settings.printSummary/ }));

    expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-2/summary');
  });
});
