/**
 * Unit tests for TransportEntryStepPage (transport entry step).
 *
 * Tests:
 * 4.1 Page loads with form fields visible (type toggle, datetime, location, mode, number, pickup switch)
 * 4.2 Missing localStorage identity redirects to identity step
 * 4.3 Filling in valid data and submitting calls `createTransport` with correct `TransportFormData`
 * 4.4 the travel-plan choice is passed through to `createTransport`
 * 4.5 After successful submit, transport appears as summary card and form resets with opposite type
 * 4.6 Validation — empty datetime shows error, empty location shows error
 * 4.7 "Skip for now" navigates to `/share/:shareId/summary`
 * 4.8 "Next"/"Done" navigates to `/share/:shareId/summary`
 * 4.9 i18n — text nodes use translation keys (keys returned as-is by mock)
 * 4.10 Loading state shown while data loads
 * 4.11 Existing transports for guest are shown as summary cards on load
 *
 * Note: i18next is mocked in test/setup.ts — t('key', options) returns the key string.
 *
 * @module features/sharing/pages/__tests__/TransportEntryStepPage.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { render } from '@/test/utils';

import { TransportEntryStepPage } from '../TransportEntryStepPage';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/lib/db', () => ({
  getTripByShareId: vi.fn(),
  createTransport: vi.fn(),
  getTransportsByPersonId: vi.fn(),
}));

// i18next is auto-mocked in test/setup.ts: t('key') → 'key', t('key', {x}) → 'key'

// localStorage mock — controlled per test
const localStorageMock: Record<string, string> = {};

Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => localStorageMock[key] ?? null,
    setItem: (key: string, value: string) => { localStorageMock[key] = value; },
    removeItem: (key: string) => { delete localStorageMock[key]; },
    clear: () => { Object.keys(localStorageMock).forEach((k) => { delete localStorageMock[k]; }); },
    get length() { return Object.keys(localStorageMock).length; },
    key: (i: number) => Object.keys(localStorageMock)[i] ?? null,
  },
  writable: true,
});

// ============================================================================
// Imports after mocks
// ============================================================================

import type {
  ISODateString,
  ISODateTimeString,
  PersonId,
  ShareId,
  Transport,
  TransportId,
  TransportMode,
  TransportType,
  Trip,
  TripId,
  UnixTimestamp,
} from '@/types';
import {
  getTripByShareId,
  createTransport,
  getTransportsByPersonId,
} from '@/lib/db';

const mockGetTripByShareId = vi.mocked(getTripByShareId);
const mockCreateTransport = vi.mocked(createTransport);
const mockGetTransportsByPersonId = vi.mocked(getTransportsByPersonId);

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a minimal fixture Trip for testing.
 */
function makeTrip(overrides?: Partial<Trip>): Trip {
  return {
    id: 'trip1' as TripId,
    shareId: 'abc123' as ShareId,
    name: 'Test Trip',
    location: 'Paris',
    startDate: '2026-07-15' as ISODateString,
    endDate: '2026-07-22' as ISODateString,
    createdAt: 0 as UnixTimestamp,
    updatedAt: 0 as UnixTimestamp,
    ...overrides,
  };
}

/**
 * Creates a minimal fixture Transport for testing.
 */
function makeTransport(overrides?: Partial<Transport>): Transport {
  return {
    id: 'transport1' as TransportId,
    tripId: 'trip1' as TripId,
    personId: 'person1' as PersonId,
    type: 'arrival' as TransportType,
    datetime: '2026-07-15T14:30' as ISODateTimeString,
    location: 'Gare de Vannes',
    needsPickup: true,
    transportMode: 'train' as TransportMode,
    transportNumber: 'TGV 8541',
    ...overrides,
  };
}

/**
 * Sets the stored guest identity in the fake localStorage.
 */
function setStoredIdentity(
  shareId: string,
  identity: { personId: string; tripId: string },
): void {
  localStorageMock[`kikouchou_guest_${shareId}`] = JSON.stringify(identity);
}

/**
 * Renders TransportEntryStepPage inside a MemoryRouter with shareId in the URL.
 * Uses @/test/utils render with withProviders: false — page is outside AppProviders (AR-10).
 * Passes initialEntries so @/test/utils provides the router; Routes are defined directly.
 */
function renderTransportEntryPage(shareId = 'abc123') {
  return render(
    <Routes>
      <Route path="/share/:shareId/transport" element={<TransportEntryStepPage />} />
      <Route
        path="/share/:shareId/identity"
        element={<div data-testid="identity-page">Identity step</div>}
      />
      <Route
        path="/share/:shareId/summary"
        element={<div data-testid="summary-page">Summary step</div>}
      />
    </Routes>,
    { withProviders: false, initialEntries: [`/share/${shareId}/transport`] },
  );
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

// ============================================================================
// 4.1 — Page loads with form fields visible
// ============================================================================

describe('TransportEntryStepPage — 4.1: page loads with form fields visible', () => {
  it('renders form fields after loading (type toggle, datetime, location, mode, number, travel plan)', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetTransportsByPersonId.mockResolvedValue([]);

    renderTransportEntryPage();

    await waitFor(() => {
      // Type toggle buttons
      expect(screen.getByRole('button', { name: 'sharing.transportArrival' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'sharing.transportDeparture' })).toBeInTheDocument();
      // Datetime input
      expect(screen.getByLabelText('sharing.transportDatetime')).toBeInTheDocument();
      // Location input
      expect(screen.getByLabelText(/sharing\.transportLocation/)).toBeInTheDocument();
      // Transport mode select
      expect(screen.getByRole('combobox')).toBeInTheDocument();
      // Transport number input
      expect(screen.getByLabelText('sharing.transportNumber')).toBeInTheDocument();
      // Travel plan — one exclusive choice, not a pair of toggles
      expect(screen.getByRole('radio', { name: 'sharing.transportPlanLift' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'sharing.transportPlanDriving' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'sharing.transportPlanOwnWay' })).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 4.2 — Missing localStorage identity redirects to identity step
// ============================================================================

describe('TransportEntryStepPage — 4.2: missing identity redirects to identity step', () => {
  it('redirects to /share/:shareId/identity when localStorage key is absent', async () => {
    // Do NOT set stored identity
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetTransportsByPersonId.mockResolvedValue([]);

    renderTransportEntryPage('abc123');

    await waitFor(() => {
      expect(screen.getByTestId('identity-page')).toBeInTheDocument();
    });
  });

  it('redirects when stored identity JSON is invalid', async () => {
    localStorageMock['kikouchou_guest_abc123'] = 'not-valid-json{{{';
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetTransportsByPersonId.mockResolvedValue([]);

    renderTransportEntryPage('abc123');

    await waitFor(() => {
      expect(screen.getByTestId('identity-page')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 4.2b — Stale tripId cross-validation redirects to identity step
// ============================================================================

describe('TransportEntryStepPage — 4.2b: stale tripId redirects to identity step', () => {
  it('redirects when stored tripId does not match loaded trip', async () => {
    // Stored identity references a different trip
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'different-trip' });
    mockGetTripByShareId.mockResolvedValue(makeTrip({ id: 'trip1' as TripId }));
    mockGetTransportsByPersonId.mockResolvedValue([]);

    renderTransportEntryPage('abc123');

    await waitFor(() => {
      expect(screen.getByTestId('identity-page')).toBeInTheDocument();
    });

    // localStorage should be cleared
    expect(localStorageMock['kikouchou_guest_abc123']).toBeUndefined();
  });
});

// ============================================================================
// 4.3 — Filling in valid data and submitting calls createTransport
// ============================================================================

describe('TransportEntryStepPage — 4.3: submitting valid data calls createTransport', () => {
  it('calls createTransport with correct TransportFormData on submit', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    const trip = makeTrip();
    mockGetTripByShareId.mockResolvedValue(trip);
    mockGetTransportsByPersonId.mockResolvedValue([]);
    const newTransport = makeTransport({ id: 'new-transport' as TransportId });
    mockCreateTransport.mockResolvedValue(newTransport);

    const { user } = renderTransportEntryPage();

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByLabelText('sharing.transportDatetime')).toBeInTheDocument();
    });

    // Fill in form fields
    const datetimeInput = screen.getByLabelText('sharing.transportDatetime');
    await user.clear(datetimeInput);
    await user.type(datetimeInput, '2026-07-15T14:30');

    const locationInput = screen.getByLabelText(/sharing\.transportLocation/);
    await user.type(locationInput, 'Gare de Vannes');

    // Submit
    const addButton = screen.getByRole('button', { name: /sharing\.transportAdd/i });
    await user.click(addButton);

    await waitFor(() => {
      expect(mockCreateTransport).toHaveBeenCalledWith('trip1', {
        personId: 'person1',
        type: 'arrival',
        // The input holds a local wall clock; the wizard stores the instant.
        datetime: new Date('2026-07-15T14:30').toISOString(),
        location: 'Gare de Vannes',
        transportMode: undefined,
        transportNumber: undefined,
        needsPickup: false,
      });
    });
  });

  it('normalises the datetime-local value to a UTC instant, not the raw input', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetTransportsByPersonId.mockResolvedValue([]);
    mockCreateTransport.mockResolvedValue(makeTransport({ id: 'new-transport' as TransportId }));

    const { user } = renderTransportEntryPage();

    await waitFor(() => {
      expect(screen.getByLabelText('sharing.transportDatetime')).toBeInTheDocument();
    });

    const datetimeInput = screen.getByLabelText('sharing.transportDatetime');
    await user.clear(datetimeInput);
    await user.type(datetimeInput, '2026-07-15T14:30');
    await user.type(screen.getByLabelText(/sharing\.transportLocation/), 'Gare de Vannes');
    await user.click(screen.getByRole('button', { name: /sharing\.transportAdd/i }));

    await waitFor(() => {
      expect(mockCreateTransport).toHaveBeenCalled();
    });

    const [, formData] = mockCreateTransport.mock.calls[0] ?? [];
    // Instant, not wall clock: no writer may hand storage an offset-less value,
    // or the day bucket and the [tripId+datetime] index disagree with every
    // other writer's rows. The expected value is derived, never hard-coded, so
    // this holds in UTC+14 and UTC-11 alike.
    expect(formData?.datetime).toBe(new Date('2026-07-15T14:30').toISOString());
    expect(formData?.datetime).toMatch(/Z$/u);
  });
});

// ============================================================================
// 4.4 — the travel-plan choice is passed through to createTransport
// ============================================================================

/**
 * Fills the two required fields and picks one travel plan, then submits.
 *
 * @param user - The userEvent instance from the render helper
 * @param planLabel - The i18n key the radio renders as its label
 */
async function submitWithPlan(
  user: ReturnType<typeof renderTransportEntryPage>['user'],
  planLabel: string,
): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole('radio', { name: planLabel })).toBeInTheDocument();
  });

  const datetimeInput = screen.getByLabelText('sharing.transportDatetime');
  await user.clear(datetimeInput);
  await user.type(datetimeInput, '2026-07-15T14:30');

  const locationInput = screen.getByLabelText(/sharing\.transportLocation/);
  await user.type(locationInput, 'Gare de Vannes');

  await user.click(screen.getByRole('radio', { name: planLabel }));
  await user.click(screen.getByRole('button', { name: /sharing\.transportAdd/i }));
}

describe('TransportEntryStepPage — 4.4: travel plan passed to createTransport', () => {
  beforeEach(() => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetTransportsByPersonId.mockResolvedValue([]);
    mockCreateTransport.mockResolvedValue(makeTransport());
  });

  it('asks for a pickup, and names no driver, when the guest needs a lift', async () => {
    const { user } = renderTransportEntryPage();

    await submitWithPlan(user, 'sharing.transportPlanLift');

    await waitFor(() => {
      expect(mockCreateTransport).toHaveBeenCalledWith('trip1', expect.objectContaining({
        needsPickup: true,
      }));
    });
    expect(mockCreateTransport.mock.calls[0]?.[1]).not.toHaveProperty('driverId');
  });

  it('names the guest as their own driver when they say they are driving', async () => {
    // The only shape that survives the QR changeset: `Ride` does not travel, so
    // a locally-created ride would reach the host as a dangling reference.
    // `resolveRides()` reads this leg back as a self-driven journey.
    const { user } = renderTransportEntryPage();

    await submitWithPlan(user, 'sharing.transportPlanDriving');

    await waitFor(() => {
      expect(mockCreateTransport).toHaveBeenCalledWith('trip1', expect.objectContaining({
        driverId: 'person1',
        needsPickup: false,
      }));
    });
  });

  it('leaves both empty when the guest makes their own way', async () => {
    const { user } = renderTransportEntryPage();

    await submitWithPlan(user, 'sharing.transportPlanOwnWay');

    await waitFor(() => {
      expect(mockCreateTransport).toHaveBeenCalledWith('trip1', expect.objectContaining({
        needsPickup: false,
      }));
    });
    expect(mockCreateTransport.mock.calls[0]?.[1]).not.toHaveProperty('driverId');
  });
});

// ============================================================================
// 4.5 — After successful submit, transport appears as summary card and form resets
// ============================================================================

describe('TransportEntryStepPage — 4.5: successful submit shows card and resets form', () => {
  it('shows transport as summary card and resets form with opposite type after submit', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetTransportsByPersonId.mockResolvedValue([]);
    const newTransport = makeTransport({
      id: 'new-transport' as TransportId,
      type: 'arrival',
      location: 'Test Station',
    });
    mockCreateTransport.mockResolvedValue(newTransport);

    const { user } = renderTransportEntryPage();

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByLabelText('sharing.transportDatetime')).toBeInTheDocument();
    });

    // Fill in form
    const datetimeInput = screen.getByLabelText('sharing.transportDatetime');
    await user.type(datetimeInput, '2026-07-15T14:30');

    const locationInput = screen.getByLabelText(/sharing\.transportLocation/);
    await user.type(locationInput, 'Test Station');

    // Submit
    const addButton = screen.getByRole('button', { name: /sharing\.transportAdd/i });
    await user.click(addButton);

    // Should show success message
    await waitFor(() => {
      expect(screen.getByText('sharing.transportAdded')).toBeInTheDocument();
    });

    // Should show the transport as a summary card (check for location text)
    await waitFor(() => {
      expect(screen.getByText('Test Station')).toBeInTheDocument();
    });

    // Form should reset - datetime and location should be empty
    expect(datetimeInput).toHaveValue('');
    expect(locationInput).toHaveValue('');

    // Type should flip from arrival to departure. Assert the pressed state
    // rather than the fill, so the test survives a re-theme.
    const departureButton = screen.getByRole('button', { name: 'sharing.transportDeparture' });
    expect(departureButton).toHaveAttribute('aria-pressed', 'true');
  });
});

// ============================================================================
// 4.6 — Validation: empty datetime and location show errors
// ============================================================================

describe('TransportEntryStepPage — 4.6: validation shows errors for empty fields', () => {
  it('shows datetime error when empty', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetTransportsByPersonId.mockResolvedValue([]);

    const { user } = renderTransportEntryPage();

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sharing\.transportAdd/i })).toBeInTheDocument();
    });

    // Submit without filling in fields
    const addButton = screen.getByRole('button', { name: /sharing\.transportAdd/i });
    await user.click(addButton);

    // Should show validation errors (multiple alerts since both fields are empty)
    await waitFor(() => {
      // Use getAllByRole since both datetime and location errors appear
      const alerts = screen.getAllByRole('alert');
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('sharing.transportDatetimeRequired')).toBeInTheDocument();
    });

    // createTransport should not be called
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });

  it('shows location error when empty', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetTransportsByPersonId.mockResolvedValue([]);

    const { user } = renderTransportEntryPage();

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByLabelText('sharing.transportDatetime')).toBeInTheDocument();
    });

    // Fill in only datetime
    const datetimeInput = screen.getByLabelText('sharing.transportDatetime');
    await user.type(datetimeInput, '2026-07-15T14:30');

    // Submit with empty location
    const addButton = screen.getByRole('button', { name: /sharing\.transportAdd/i });
    await user.click(addButton);

    // Should show validation error for location
    await waitFor(() => {
      expect(screen.getByText('sharing.transportLocationRequired')).toBeInTheDocument();
    });

    // createTransport should not be called
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 4.7 — "Skip for now" navigates to /share/:shareId/summary
// ============================================================================

describe('TransportEntryStepPage — 4.7: "Skip for now" navigates to summary step', () => {
  it('navigates to summary page when "Skip for now" is clicked', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetTransportsByPersonId.mockResolvedValue([]);

    const { user } = renderTransportEntryPage('abc123');

    const skipButton = await screen.findByRole('button', { name: 'sharing.transportSkip' });
    await user.click(skipButton);

    await waitFor(() => {
      expect(screen.getByTestId('summary-page')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 4.8 — "Next"/"Done" navigates to /share/:shareId/summary
// ============================================================================

describe('TransportEntryStepPage — 4.8: "Next"/"Done" navigates to summary step', () => {
  it('navigates to summary page when "Next" is clicked (no transports)', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetTransportsByPersonId.mockResolvedValue([]);

    const { user } = renderTransportEntryPage('abc123');

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'sharing.transportNext' })).toBeInTheDocument();
    });

    const nextButton = screen.getByRole('button', { name: 'sharing.transportNext' });
    await user.click(nextButton);

    await waitFor(() => {
      expect(screen.getByTestId('summary-page')).toBeInTheDocument();
    });
  });

  it('shows "Done" button instead of "Next" when transports have been entered', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetTransportsByPersonId.mockResolvedValue([makeTransport()]);

    renderTransportEntryPage('abc123');

    // Wait for loading to complete with existing transports
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'sharing.transportDone' })).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 4.9 — i18n: text nodes use translation keys
// ============================================================================

describe('TransportEntryStepPage — 4.9: i18n text nodes use translation keys', () => {
  it('renders title, subtitle, form labels, and buttons via i18n keys', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetTransportsByPersonId.mockResolvedValue([]);

    renderTransportEntryPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.transportTitle')).toBeInTheDocument();
      expect(screen.getByText('sharing.transportSubtitle')).toBeInTheDocument();
      expect(screen.getByText('sharing.transportType')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sharing\.transportAdd/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'sharing.transportNext' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'sharing.transportSkip' })).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 4.10 — Loading state shown while data loads
// ============================================================================

describe('TransportEntryStepPage — 4.10: loading state shown while data loads', () => {
  it('shows loading state while fetching', () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockReturnValue(new Promise(() => { /* never resolves */ }));

    renderTransportEntryPage();

    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

// ============================================================================
// 4.11 — Existing transports for guest are shown as summary cards on load
// ============================================================================

describe('TransportEntryStepPage — 4.11: existing transports shown as summary cards', () => {
  it('shows existing transports as summary cards on load', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetTransportsByPersonId.mockResolvedValue([
      makeTransport({
        id: 'existing1' as TransportId,
        location: 'Paris Gare de Lyon',
        transportNumber: 'TGV 1234',
        needsPickup: true,
      }),
    ]);

    renderTransportEntryPage();

    await waitFor(() => {
      // Should show the existing transport's location
      expect(screen.getByText('Paris Gare de Lyon')).toBeInTheDocument();
      // Should show the transport number
      expect(screen.getByText('TGV 1234')).toBeInTheDocument();
      // Should show needs pickup badge
      expect(screen.getByText('sharing.transportNeedsPickupBadge')).toBeInTheDocument();
    });
  });

  it('only shows transports for the current trip', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetTransportsByPersonId.mockResolvedValue([
      makeTransport({
        id: 'transport1' as TransportId,
        tripId: 'trip1' as TripId,
        location: 'This Trip Station',
      }),
      makeTransport({
        id: 'transport2' as TransportId,
        tripId: 'other-trip' as TripId,
        location: 'Other Trip Station',
      }),
    ]);

    renderTransportEntryPage();

    await waitFor(() => {
      expect(screen.getByText('This Trip Station')).toBeInTheDocument();
    });

    // The other trip's transport should NOT be shown
    expect(screen.queryByText('Other Trip Station')).not.toBeInTheDocument();
  });
});
