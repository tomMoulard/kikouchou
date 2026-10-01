/**
 * @fileoverview What the room step shows when it cannot do its job.
 *
 * The sibling file covers the happy path: rooms load, a guest claims one. This
 * one covers the four ways it can fail, which matter more than usual because
 * the reader here is an invitee with no account and no other way in — a blank
 * screen gives them nothing to do.
 *
 * @module features/sharing/pages/__tests__/RoomSelectionStepPage.failures.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { render } from '@/test/utils';

import { RoomSelectionStepPage } from '../RoomSelectionStepPage';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/lib/db', () => ({
  getTripByShareId: vi.fn(),
  getRoomsByTripId: vi.fn(),
  getAssignmentsByTripId: vi.fn(),
  getPersonsByTripId: vi.fn(),
  checkAssignmentConflict: vi.fn(),
  createAssignment: vi.fn(),
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
  HexColor,
  ISODateString,
  Person,
  PersonId,
  Room,
  RoomId,
  ShareId,
  Trip,
  TripId,
  UnixTimestamp,
} from '@/types';
import {
  getTripByShareId,
  getRoomsByTripId,
  getAssignmentsByTripId,
  getPersonsByTripId,
  checkAssignmentConflict,
  createAssignment,
} from '@/lib/db';

const mockGetTripByShareId = vi.mocked(getTripByShareId);
const mockGetRoomsByTripId = vi.mocked(getRoomsByTripId);
const mockGetAssignmentsByTripId = vi.mocked(getAssignmentsByTripId);
const mockGetPersonsByTripId = vi.mocked(getPersonsByTripId);
const mockCheckAssignmentConflict = vi.mocked(checkAssignmentConflict);
const mockCreateAssignment = vi.mocked(createAssignment);

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

function makeRoom(overrides?: Partial<Room>): Room {
  return {
    id: 'room1' as RoomId,
    tripId: 'trip1' as TripId,
    name: 'Master Bedroom',
    capacity: 2,
    order: 0,
    icon: 'bed-double',
    ...overrides,
  };
}

function makePerson(overrides?: Partial<Person>): Person {
  return {
    id: 'person1' as PersonId,
    tripId: 'trip1' as TripId,
    name: 'Alice',
    color: '#3b82f6' as HexColor,
    ...overrides,
  };
}

function setStoredIdentity(
  shareId: string,
  identity: { personId: string; tripId: string },
): void {
  localStorageMock[`kikouchou_guest_${shareId}`] = JSON.stringify(identity);
}

function renderRoomSelectionPage(shareId = 'abc123') {
  return render(
    <Routes>
      <Route path="/share/:shareId/room" element={<RoomSelectionStepPage />} />
      <Route
        path="/share/:shareId/identity"
        element={<div data-testid="identity-page">Identity step</div>}
      />
      <Route
        path="/share/:shareId/transport"
        element={<div data-testid="transport-page">Transport step</div>}
      />
    </Routes>,
    { withProviders: false, initialEntries: [`/share/${shareId}/room`] },
  );
}

/** The same page reached without a share id in the path. */
function renderWithoutShareId() {
  return render(
    <Routes>
      <Route path="/share/room" element={<RoomSelectionStepPage />} />
    </Routes>,
    { withProviders: false, initialEntries: ['/share/room'] },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockGetPersonsByTripId.mockResolvedValue([]);
});

// ============================================================================
// Tests
// ============================================================================

describe('RoomSelectionStepPage — when the rooms will not load', () => {
  it('says so rather than showing an empty list', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetRoomsByTripId.mockRejectedValue(new Error('the read failed'));
    mockGetAssignmentsByTripId.mockResolvedValue([]);

    renderRoomSelectionPage();

    expect(await screen.findByText('sharing.roomLoadError')).toBeInTheDocument();
    expect(screen.getByText('sharing.roomLoadErrorDescription')).toBeInTheDocument();
  });

  it('falls back to the invalid-link card when the trip itself will not load', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockRejectedValue(new Error('boom'));

    renderRoomSelectionPage();

    expect(await screen.findByText('sharing.loadFailedWizard')).toBeInTheDocument();
  });

  it('treats a link with no share id as a link that does not work', async () => {
    renderWithoutShareId();

    await waitFor(() => {
      expect(mockGetTripByShareId).not.toHaveBeenCalled();
    });
    expect(await screen.findByText('sharing.notFoundWizard')).toBeInTheDocument();
  });
});

describe('RoomSelectionStepPage — when the stored identity is no good', () => {
  it('sends a blank stored name back to the identity step', async () => {
    setStoredIdentity('abc123', { personId: '   ', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());

    renderRoomSelectionPage();

    expect(await screen.findByTestId('identity-page')).toBeInTheDocument();
  });

  it('sends an identity stored against another trip back, and forgets it', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'some-other-trip' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetRoomsByTripId.mockResolvedValue([]);
    mockGetAssignmentsByTripId.mockResolvedValue([]);

    renderRoomSelectionPage();

    expect(await screen.findByTestId('identity-page')).toBeInTheDocument();
    await waitFor(() => {
      expect(window.localStorage.getItem('kikouchou_guest_abc123')).toBeNull();
    });
  });
});

describe('RoomSelectionStepPage — when the claim fails', () => {
  it('says so and leaves the reader on the step', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetRoomsByTripId.mockResolvedValue([makeRoom()]);
    mockGetAssignmentsByTripId.mockResolvedValue([]);
    mockGetPersonsByTripId.mockResolvedValue([makePerson()]);
    mockCheckAssignmentConflict.mockRejectedValue(new Error('offline'));

    const { user } = renderRoomSelectionPage();

    await user.click(await screen.findByRole('button', { name: 'sharing.roomClaimNamed' }));

    expect(await screen.findByText('sharing.roomClaimError')).toBeInTheDocument();
    expect(mockCreateAssignment).not.toHaveBeenCalled();
    expect(screen.queryByTestId('transport-page')).not.toBeInTheDocument();
    consoleError.mockRestore();
  });
});
