/**
 * @fileoverview The travel step's controls, and what it does when a read or a
 * write fails.
 *
 * The sibling file covers the fields rendering and a successful entry. This one
 * covers the toggle between an arrival and a departure, the flight or train
 * number, and the three failures: the trip that is not there, the existing legs
 * that would not load (which is survivable), and the save that did not land
 * (which is not).
 *
 * @module features/sharing/pages/__tests__/TransportEntryStepPage.failures.test
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

const localStorageMock: Record<string, string> = {};

Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => localStorageMock[key] ?? null,
    setItem: (key: string, value: string) => {
      localStorageMock[key] = value;
    },
    removeItem: (key: string) => {
      delete localStorageMock[key];
    },
    clear: () => {
      Object.keys(localStorageMock).forEach((key) => {
        delete localStorageMock[key];
      });
    },
    get length() {
      return Object.keys(localStorageMock).length;
    },
    key: (index: number) => Object.keys(localStorageMock)[index] ?? null,
  },
  writable: true,
});

import type {
  ISODateString,
  PersonId,
  ShareId,
  Transport,
  TransportId,
  Trip,
  TripId,
  UnixTimestamp,
} from '@/types';
import { getTripByShareId, createTransport, getTransportsByPersonId } from '@/lib/db';

const mockGetTripByShareId = vi.mocked(getTripByShareId);
const mockCreateTransport = vi.mocked(createTransport);
const mockGetTransportsByPersonId = vi.mocked(getTransportsByPersonId);

// ============================================================================
// Helpers
// ============================================================================

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

/** What the repository hands back, which the page then lists. */
function makeSavedTransport(overrides: Partial<Transport> = {}): Transport {
  return {
    id: 't1' as TransportId,
    tripId: 'trip1' as TripId,
    personId: 'person1' as PersonId,
    type: 'arrival',
    datetime: '2026-07-15T14:30:00',
    location: 'Gare de Vannes',
    transportMode: 'train',
    needsPickup: false,
    ...overrides,
  } as Transport;
}

function setStoredIdentity(
  shareId: string,
  identity: { personId: string; tripId: string },
): void {
  localStorageMock[`kikouchou_guest_${shareId}`] = JSON.stringify(identity);
}

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

/** Fills the two required fields and submits. */
async function fillAndSubmit(user: ReturnType<typeof render>['user']): Promise<void> {
  await user.type(screen.getByLabelText('sharing.transportDatetime'), '2026-07-15T14:30');
  await user.type(screen.getByLabelText(/sharing\.transportLocation/), 'Gare de Vannes');
  await user.click(screen.getByRole('button', { name: /sharing\.transportAdd/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

// ============================================================================
// Tests
// ============================================================================

describe('TransportEntryStepPage — the controls', () => {
  beforeEach(() => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetTransportsByPersonId.mockResolvedValue([]);
    mockCreateTransport.mockResolvedValue(makeSavedTransport());
  });

  it('switches between an arrival and a departure', async () => {
    const { user } = renderTransportEntryPage();

    const departure = await screen.findByRole('button', {
      name: 'sharing.transportDeparture',
    });
    await user.click(departure);
    await fillAndSubmit(user);

    await waitFor(() => {
      expect(mockCreateTransport).toHaveBeenCalledWith(
        'trip1',
        expect.objectContaining({ type: 'departure' }),
      );
    });
  });

  it('carries the flight or train number through to the saved leg', async () => {
    const { user } = renderTransportEntryPage();

    await screen.findByLabelText('sharing.transportNumber');
    await user.type(screen.getByLabelText('sharing.transportNumber'), 'TGV 8613');
    await fillAndSubmit(user);

    await waitFor(() => {
      expect(mockCreateTransport).toHaveBeenCalledWith(
        'trip1',
        expect.objectContaining({ transportNumber: 'TGV 8613' }),
      );
    });
  });
});

describe('TransportEntryStepPage — when something will not load', () => {
  it('says the link does not work when the trip is not there', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(undefined);

    renderTransportEntryPage();

    expect(await screen.findByText('sharing.notFoundWizard')).toBeInTheDocument();
  });

  it('says the trip could not be opened when the read itself failed', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockRejectedValue(new Error('boom'));

    renderTransportEntryPage();

    expect(await screen.findByText('sharing.loadFailedWizard')).toBeInTheDocument();
  });

  it('still offers the form when the existing legs will not load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetTransportsByPersonId.mockRejectedValue(new Error('the read failed'));

    renderTransportEntryPage();

    // Not fatal: the reader came here to add a leg, not to read the old ones.
    expect(await screen.findByLabelText('sharing.transportDatetime')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('sends a blank stored name back to the identity step', async () => {
    setStoredIdentity('abc123', { personId: '  ', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());

    renderTransportEntryPage();

    expect(await screen.findByTestId('identity-page')).toBeInTheDocument();
  });
});

describe('TransportEntryStepPage — when the leg will not save', () => {
  it('says so and keeps what was typed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetTransportsByPersonId.mockResolvedValue([]);
    mockCreateTransport.mockRejectedValue(new Error('offline'));

    const { user } = renderTransportEntryPage();

    await screen.findByLabelText('sharing.transportDatetime');
    await fillAndSubmit(user);

    expect(await screen.findByText('sharing.transportCreateError')).toBeInTheDocument();
    expect(screen.getByLabelText(/sharing\.transportLocation/)).toHaveValue('Gare de Vannes');
    consoleError.mockRestore();
  });
});
