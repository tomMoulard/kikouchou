/**
 * Unit tests for ShareImportPage (welcome screen).
 *
 * Tests:
 * 3.1 Valid shareId → welcome screen renders trip name (via i18n key), location, date range
 * 3.2 Invalid shareId → friendly not-found message shown (no technical jargon)
 * 3.3 Returning guest (localStorage key + valid tripId) → redirected to calendar
 * 3.4 No location on trip → location row is hidden (conditional rendering)
 *
 * Note: i18next is mocked in test/setup.ts — t('key', options) returns the key string
 * with {{placeholders}} substituted from options.
 *
 * @module features/sharing/pages/__tests__/ShareImportPage.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render as rtlRender } from '@testing-library/react';

import { ShareImportPage } from '../ShareImportPage';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/lib/db', () => ({
  getTripByShareId: vi.fn(),
  setCurrentTrip: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// i18next is auto-mocked in test/setup.ts: t('key') → 'key', t('key', {x}) → 'key'

// localStorage mock — controlled per test via localStorageMock
const localStorageMock: Record<string, string> = {};

Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => localStorageMock[key] ?? null,
    setItem: (key: string, value: string) => { localStorageMock[key] = value; },
    removeItem: (key: string) => { delete localStorageMock[key]; },
    clear: () => { Object.keys(localStorageMock).forEach(k => { delete localStorageMock[k]; }); },
    get length() { return Object.keys(localStorageMock).length; },
    key: (i: number) => Object.keys(localStorageMock)[i] ?? null,
  },
  writable: true,
});

// ============================================================================
// Imports after mocks
// ============================================================================

import type { Trip, TripId, ShareId } from '@/types';
import { isoDate } from '@/test/utils';
import { getTripByShareId, setCurrentTrip } from '@/lib/db';

const mockGetTripByShareId = vi.mocked(getTripByShareId);
const mockSetCurrentTrip = vi.mocked(setCurrentTrip);

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a minimal fixture Trip for testing.
 */
function makeTrip(overrides?: Partial<Trip>): Trip {
  return {
    id: 'trip-abc' as TripId,
    name: 'Beach Vacation',
    location: 'Brittany, France',
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-22'),
    shareId: 'share-123' as ShareId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/**
 * Renders ShareImportPage inside a MemoryRouter with the given shareId in the URL.
 * No AppProviders — this page is outside AppProviders (AR-10).
 */
function renderShareImportPage(shareId = 'abc123'): ReturnType<typeof rtlRender> {
  return rtlRender(
    <MemoryRouter initialEntries={[`/share/${shareId}`]}>
      <Routes>
        <Route path="/share/:shareId/*" element={<ShareImportPage />} />
        <Route
          path="/trips/:tripId/calendar"
          element={<div data-testid="calendar-page">Calendar</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  // Clear localStorageMock between tests
  window.localStorage.clear();
});

// ============================================================================
// 3.1 — Valid shareId: welcome screen
// ============================================================================

describe('ShareImportPage — 3.1: valid shareId renders welcome screen', () => {
  it('renders welcome card title (i18n key with trip name context)', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    renderShareImportPage();

    // The i18n mock returns the key string: t('sharing.welcome', { tripName }) → 'sharing.welcome'
    // We verify the welcome key is present and the loading state is gone
    await waitFor(() => {
      expect(screen.getByText('sharing.welcome')).toBeInTheDocument();
    });
  });

  it('renders date range via date-fns formatting', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    renderShareImportPage();

    // The canonical range collapses the shared month and year: "15 - 22 Jul 2024"
    await waitFor(() => {
      expect(screen.getByText(/15\s+-\s+22\s+Jul\s+2024/)).toBeInTheDocument();
    });
  });

  it('renders location when trip has a location', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip({ location: 'Brittany, France' }));
    renderShareImportPage();

    await waitFor(() => {
      expect(screen.getByText('Brittany, France')).toBeInTheDocument();
    });
  });

  it('renders Get Started CTA button', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    renderShareImportPage();

    await waitFor(() => {
      // t('sharing.getStarted') → 'sharing.getStarted'
      expect(
        screen.getByRole('button', { name: 'sharing.getStarted' }),
      ).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 3.2 — Invalid shareId: friendly not-found
// ============================================================================

describe('ShareImportPage — 3.2: invalid shareId shows friendly not-found', () => {
  it('shows wizard-specific not-found title key', async () => {
    mockGetTripByShareId.mockResolvedValue(undefined);
    renderShareImportPage('bad-id');

    await waitFor(() => {
      // Use exact text match to avoid matching notFoundWizardDescription too
      expect(screen.getByText('sharing.notFoundWizard')).toBeInTheDocument();
    });
  });

  it('shows not-found description key', async () => {
    mockGetTripByShareId.mockResolvedValue(undefined);
    renderShareImportPage('bad-id');

    await waitFor(() => {
      expect(screen.getByText('sharing.notFoundWizardDescription')).toBeInTheDocument();
    });
  });

  it('does NOT show the Get Started button on not-found state', async () => {
    mockGetTripByShareId.mockResolvedValue(undefined);
    renderShareImportPage('bad-id');

    await waitFor(() => {
      // Wait for loading to finish
      expect(screen.getByText('sharing.notFoundWizard')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'sharing.getStarted' })).not.toBeInTheDocument();
  });
});

// ============================================================================
// 3.3 — Returning guest: redirect to calendar
// ============================================================================

describe('ShareImportPage — 3.3: returning guest is redirected to calendar', () => {
  it('redirects to /trips/:tripId/calendar when localStorage identity matches', async () => {
    const trip = makeTrip({ id: 'trip-abc' as TripId });
    mockGetTripByShareId.mockResolvedValue(trip);
    mockSetCurrentTrip.mockResolvedValue(undefined);

    // Simulate returning guest with matching tripId
    window.localStorage.setItem(
      'kikouchou_guest_abc123',
      JSON.stringify({ personId: 'person-1', tripId: 'trip-abc' }),
    );

    renderShareImportPage('abc123');

    await waitFor(() => {
      expect(screen.getByTestId('calendar-page')).toBeInTheDocument();
    });

    expect(mockSetCurrentTrip).toHaveBeenCalledWith('trip-abc');
  });

  it('does NOT redirect when localStorage identity has wrong tripId', async () => {
    const trip = makeTrip({ id: 'trip-abc' as TripId });
    mockGetTripByShareId.mockResolvedValue(trip);

    localStorageMock['kikouchou_guest_abc123'] = JSON.stringify({
      personId: 'person-1',
      tripId: 'trip-DIFFERENT',
    });

    renderShareImportPage('abc123');

    await waitFor(() => {
      expect(screen.getByText('sharing.welcome')).toBeInTheDocument();
    });

    expect(mockSetCurrentTrip).not.toHaveBeenCalled();
  });

  it('does NOT redirect when no localStorage identity exists', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    // No localStorage identity — getItem returns null for non-existent keys

    renderShareImportPage('abc123');

    await waitFor(() => {
      expect(screen.getByText('sharing.welcome')).toBeInTheDocument();
    });

    expect(mockSetCurrentTrip).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 3.4 — No location: location row hidden
// ============================================================================

describe('ShareImportPage — 3.4: location row hidden when no location set', () => {
  it('does not render location row when trip has no location', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip({ location: undefined }));
    renderShareImportPage();

    await waitFor(() => {
      // Welcome card should render
      expect(screen.getByText('sharing.welcome')).toBeInTheDocument();
    });

    // Location text from the fixture should NOT appear
    expect(screen.queryByText('Brittany, France')).not.toBeInTheDocument();
  });

  it('renders location row when trip has a location', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip({ location: 'Paris, France' }));
    renderShareImportPage();

    await waitFor(() => {
      expect(screen.getByText('Paris, France')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 3.5 — Error handling: Get Started and redirect failures
// ============================================================================

describe('ShareImportPage — 3.5: error handling', () => {
  it('shows error toast when Get Started fails to set current trip', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const { toast } = await import('sonner');
    const user = userEvent.setup();

    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockSetCurrentTrip.mockRejectedValueOnce(new Error('DB error'));

    renderShareImportPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'sharing.getStarted' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'sharing.getStarted' }));

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('sharing.viewError');
    });
  });

  it('shows loading state on Get Started button while navigating', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();

    mockGetTripByShareId.mockResolvedValue(makeTrip());
    // Make setCurrentTrip take a while
    mockSetCurrentTrip.mockImplementation(() => new Promise(() => {}));

    renderShareImportPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'sharing.getStarted' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'sharing.getStarted' }));

    await waitFor(() => {
      expect(screen.getByText('common.loading')).toBeInTheDocument();
    });
  });

  it('falls back to welcome screen when returning guest redirect fails', async () => {
    const trip = makeTrip({ id: 'trip-abc' as TripId });
    mockGetTripByShareId.mockResolvedValue(trip);
    mockSetCurrentTrip.mockRejectedValueOnce(new Error('Failed to redirect'));

    // Set up localStorage for returning guest
    window.localStorage.setItem(
      'kikouchou_guest_abc123',
      JSON.stringify({ personId: 'person-1', tripId: 'trip-abc' }),
    );

    renderShareImportPage('abc123');

    // Should fall back to the welcome screen
    await waitFor(() => {
      expect(screen.getByText('sharing.welcome')).toBeInTheDocument();
    });
  });

  it('handles getTripByShareId rejection gracefully', async () => {
    mockGetTripByShareId.mockRejectedValue(new Error('Network error'));

    renderShareImportPage('error-id');

    await waitFor(() => {
      expect(screen.getByText('sharing.notFoundWizard')).toBeInTheDocument();
    });
  });

  it('handles invalid localStorage data gracefully', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());

    // Set invalid JSON in localStorage
    window.localStorage.setItem('kikouchou_guest_abc123', 'not valid json {{{');

    renderShareImportPage('abc123');

    await waitFor(() => {
      expect(screen.getByText('sharing.welcome')).toBeInTheDocument();
    });
  });

  it('handles localStorage with missing fields', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());

    // Set localStorage with missing fields (no tripId)
    window.localStorage.setItem('kikouchou_guest_abc123', JSON.stringify({ personId: 'p1' }));

    renderShareImportPage('abc123');

    await waitFor(() => {
      expect(screen.getByText('sharing.welcome')).toBeInTheDocument();
    });

    // Should not try to redirect
    expect(mockSetCurrentTrip).not.toHaveBeenCalled();
  });

  it('renders same-day date range as single date', async () => {
    mockGetTripByShareId.mockResolvedValue(
      makeTrip({
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-15'),
      }),
    );

    renderShareImportPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.welcome')).toBeInTheDocument();
    });

    // Single date (no range separator)
    expect(screen.getByText('15 Jul 2024')).toBeInTheDocument();
  });

  it('does not render location row when trip location is empty string', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip({ location: '' }));
    renderShareImportPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.welcome')).toBeInTheDocument();
    });

    expect(screen.queryByText('Brittany, France')).not.toBeInTheDocument();
  });
});
