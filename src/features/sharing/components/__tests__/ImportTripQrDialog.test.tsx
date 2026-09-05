/**
 * @fileoverview Tests for ImportTripQrDialog — QR scanning + import flow.
 *
 * These used to replace `@/lib/sharing` wholesale — `decodeChangeset`,
 * `computeMerge`, `applyMerge`, `parseFrame`, `reassembleFrames`, all `vi.fn()`
 * — and then mock `../../utils/share-qr-parse` on top, re-implementing
 * `extractShareIdFromScannedPayload` inside the mock factory. Every navigation
 * assertion therefore checked a private copy of the parser written in this file
 * while the shipped one was bypassed, and every import assertion was
 * `expect(mock).toHaveBeenCalled()` with no argument check, so a wrong share id
 * reaching `computeMerge` passed.
 *
 * What is mocked now is the boundary and nothing else: the camera (`QRScanner`),
 * the toaster, the router and analytics. The real codec, the real parser, the
 * real merge engine and the real Dexie database (faked by `fake-indexeddb` in
 * the global setup) all run, so these assertions are about rows that actually
 * landed on disk.
 *
 * @module features/sharing/components/__tests__/ImportTripQrDialog.test
 */

import { act } from 'react';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
import type {
  HexColor,
  ISODateString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  Trip,
  TripId,
} from '@/types';

// ============================================================================
// Boundary mocks
// ============================================================================

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockCapture = vi.fn();

vi.mock('@/lib/posthog', () => ({
  // The real module exports `undefined` without env config, which is the case
  // in tests, so nothing here could observe a capture without this.
  default: { capture: (...args: unknown[]) => mockCapture(...args) },
  // `captureUsage` fires the domain event *and* `app_used` beside it, and the
  // double is faithful to that: a mock that only forwarded the first would let
  // a call site lose the activity event without a single test noticing.
  captureUsage: (action: string, properties?: unknown) => {
    mockCapture(action, properties);
    mockCapture('app_used', { action });
  },
}));

/**
 * The database barrel, real in every respect except that `getTripByShareId` can
 * be made to hang or fail for the two tests that need the import to stall or
 * blow up. It is the outermost seam the import pipeline touches, so steering it
 * leaves the codec, the parser and the merge engine running for real.
 */
const dbFailures: { getTripByShareId: (() => Promise<never>) | null } = {
  getTripByShareId: null,
};

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...actual,
    getTripByShareId: (...args: Parameters<typeof actual.getTripByShareId>) =>
      dbFailures.getTripByShareId
        ? dbFailures.getTripByShareId()
        : actual.getTripByShareId(...args),
  };
});

let capturedOnScan: ((data: string) => void) | null = null;

vi.mock('@/components/shared/QRScanner', () => ({
  QRScanner: ({ onScan }: { onScan: (data: string) => void }) => {
    capturedOnScan = onScan;
    return <div data-testid="qr-scanner">QR Scanner</div>;
  },
}));

import { db } from '@/lib/db/database';
import { encodeChangeset, splitIntoFrames } from '@/lib/sharing';
import type { AppChangeset } from '@/lib/sharing';

import { ImportTripQrDialog } from '../ImportTripQrDialog';

// ============================================================================
// Fixtures
// ============================================================================

/** The trip id the exporting device used — deliberately not a local one. */
const GUEST_TRIP_ID = 'trip-on-the-other-phone' as TripId;
const SHARE_ID = 'shr1234567';

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'guest-room-1' as RoomId,
    tripId: GUEST_TRIP_ID,
    name: 'Blue Room',
    capacity: 2,
    order: 0,
    ...overrides,
  };
}

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: 'guest-person-1' as PersonId,
    tripId: GUEST_TRIP_ID,
    name: 'Alice',
    color: '#3b82f6' as HexColor,
    stayStartDate: '2026-07-15' as ISODateString,
    stayEndDate: '2026-07-20' as ISODateString,
    ...overrides,
  };
}

function makeAssignment(overrides: Partial<RoomAssignment> = {}): RoomAssignment {
  return {
    id: 'guest-assign-1' as RoomAssignmentId,
    tripId: GUEST_TRIP_ID,
    roomId: 'guest-room-1' as RoomId,
    personId: 'guest-person-1' as PersonId,
    startDate: '2026-07-15' as ISODateString,
    endDate: '2026-07-20' as ISODateString,
    ...overrides,
  };
}

function makeChangeset(overrides: Partial<AppChangeset> = {}): AppChangeset {
  return {
    version: 1,
    tripId: GUEST_TRIP_ID,
    shareId: SHARE_ID,
    exportedBy: 'guest-person-1' as PersonId,
    exportedAt: 1_775_649_600_000,
    baseSnapshotAt: 1_775_563_200_000,
    added: {
      persons: [makePerson()],
      assignments: [makeAssignment()],
      transports: [],
      rooms: [makeRoom()],
    },
    modified: { persons: [], assignments: [], transports: [], rooms: [] },
    ...overrides,
  };
}

/** Writes a host trip straight to Dexie, bypassing `createTrip`'s random ids. */
async function seedLocalTrip(overrides: Partial<Trip> = {}): Promise<Trip> {
  const trip: Trip = {
    id: 'local-trip-1' as TripId,
    shareId: SHARE_ID as Trip['shareId'],
    name: 'Brittany 2026',
    location: 'Vannes',
    startDate: '2026-07-14' as ISODateString,
    endDate: '2026-07-21' as ISODateString,
    description: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
  await db.trips.add(trip);
  return trip;
}

/**
 * Delivers one or more payloads to the captured `onScan`, inside a single
 * `act`. Several tests depend on the payloads landing in the *same* tick, which
 * is what the re-entrancy guard is a ref for.
 */
async function scan(...payloads: readonly string[]): Promise<void> {
  await act(async () => {
    for (const payload of payloads) {
      capturedOnScan!(payload);
    }
  });
}

function renderDialog(open = true) {
  const onOpenChange = vi.fn();
  const result = render(<ImportTripQrDialog open={open} onOpenChange={onOpenChange} />, {
    withProviders: false,
  });
  return { ...result, onOpenChange };
}

// ============================================================================
// Tests
// ============================================================================

describe('ImportTripQrDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnScan = null;
    dbFailures.getTripByShareId = null;
  });

  // Undoes any `vi.spyOn` a test installed. The global setup only clears
  // recorded calls, so a stubbed `console.error` would outlive its test.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('scanner surface', () => {
    it('renders dialog with QR scanner when open', async () => {
      renderDialog();
      expect(screen.getByTestId('qr-scanner')).toBeInTheDocument();
      expect(screen.getByText('trips.importFromQrTitle')).toBeInTheDocument();
    });

    it('does not render scanner when closed', async () => {
      renderDialog(false);
      expect(screen.queryByTestId('qr-scanner')).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Routing — every one of these now runs the shipped parsers
  // ==========================================================================

  describe('routing a scanned link', () => {
    it('navigates to the join page when an invite link is scanned', async () => {
      const { onOpenChange } = renderDialog();
      expect(capturedOnScan).not.toBeNull();

      // This is what the Share dialog now produces. A scanner that cannot read
      // the app's own current QR code looks like a broken camera rather than an
      // unsupported format, which is why invite tokens are matched first.
      await scan('https://kikouchou.app/join/aBcDeFgHiJkL3456');

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(mockNavigate).toHaveBeenCalledWith('/join/aBcDeFgHiJkL3456');
    });

    it('navigates to the join page for a bare invite token', async () => {
      renderDialog();

      await scan('aBcDeFgHiJkL3456');

      expect(mockNavigate).toHaveBeenCalledWith('/join/aBcDeFgHiJkL3456');
    });

    it('navigates to share page when a share link is scanned', async () => {
      const { onOpenChange } = renderDialog();

      await scan('https://app.example.com/share/abc123');

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(mockNavigate).toHaveBeenCalledWith('/share/abc123');
    });

    it('navigates to share page for a bare ten-character share code', async () => {
      // The shape the real `extractShareIdFromScannedPayload` accepts as a bare
      // code, and one the file-local re-implementation this suite used to assert
      // against did not recognise at all: it only ever stripped a
      // `https://app.example.com/share/` prefix.
      renderDialog();

      await scan('Ab3-dEf_12');

      expect(mockNavigate).toHaveBeenCalledWith('/share/Ab3-dEf_12');
    });

    it('does not mistake a nine-character code for a share id', async () => {
      // Nine characters is not a share id, so this falls through to the import
      // path and fails to decode rather than routing somewhere wrong.
      renderDialog();

      await scan('Ab3-dEf_1');

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('trips.importQrInvalid');
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('still prefers the legacy formats over a bare-token reading', async () => {
      renderDialog();

      // A 10-character share id and a 12-character room id must not be mistaken
      // for a 16-character invite token now that invites are checked first.
      await scan('https://app.example.com/share/abc123');

      expect(mockNavigate).toHaveBeenCalledWith('/share/abc123');
    });

    it('navigates to P2P trip link when collaboration URL is scanned', async () => {
      const { onOpenChange } = renderDialog();

      await scan('https://example.com/trip/room-abc#enc-key-xyz');

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(mockNavigate).toHaveBeenCalledWith('/trip/room-abc#enc-key-xyz');
    });

    it('keeps the /share/ reading of a link that also carries a hash', async () => {
      // `extractP2pTripInviteFromScannedPayload` only claims `/trip/:id#key`,
      // so a share link with a fragment must still route to /share.
      renderDialog();

      await scan('https://app.example.com/share/abc123#ignored');

      expect(mockNavigate).toHaveBeenCalledWith('/share/abc123');
    });
  });

  // ==========================================================================
  // Import — the real codec, merge engine and database
  // ==========================================================================

  describe('importing a changeset', () => {
    it('merges a scanned export into the local trip it belongs to', async () => {
      const trip = await seedLocalTrip();
      const { onOpenChange } = renderDialog();

      await scan(encodeChangeset(makeChangeset()));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(`/trips/${trip.id}/calendar`);
      });

      // The rows the merge actually wrote, re-scoped to the local trip id — the
      // assertion the old `expect(mockApplyMerge).toHaveBeenCalled()` could not
      // make, because nothing was ever applied.
      const persons = await db.persons.where('tripId').equals(trip.id).toArray();
      expect(persons.map((person) => person.name)).toEqual(['Alice']);
      const rooms = await db.rooms.where('tripId').equals(trip.id).toArray();
      expect(rooms.map((room) => room.name)).toEqual(['Blue Room']);
      const assignments = await db.roomAssignments.where('tripId').equals(trip.id).toArray();
      expect(assignments).toHaveLength(1);
      expect(assignments[0]?.roomId).toBe(rooms[0]?.id);

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(mockToastSuccess).toHaveBeenCalledWith('trips.importQrMergeSuccess');
      expect(
        mockCapture.mock.calls.filter(([event]) => event === 'trip_imported'),
      ).toEqual([['trip_imported', { conflict_count: 0 }]]);
    });

    it('folds the export onto the local room of the same name', async () => {
      const trip = await seedLocalTrip();
      await db.rooms.add({
        id: 'local-room-1' as RoomId,
        tripId: trip.id,
        name: 'Blue Room',
        capacity: 3,
        order: 0,
      });
      renderDialog();

      await scan(encodeChangeset(makeChangeset()));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(`/trips/${trip.id}/calendar`);
      });

      // One room, not two: `buildRoomIdMapByName` remaps the export's room id
      // onto the local one, and the assignment follows it.
      const rooms = await db.rooms.where('tripId').equals(trip.id).toArray();
      expect(rooms).toHaveLength(1);
      const assignments = await db.roomAssignments.where('tripId').equals(trip.id).toArray();
      expect(assignments[0]?.roomId).toBe('local-room-1');
    });

    it('creates a trip from the snapshot when this device has never seen it', async () => {
      renderDialog();

      await scan(
        encodeChangeset(
          makeChangeset({
            tripSnapshot: {
              name: 'Brittany 2026',
              startDate: '2026-07-14' as ISODateString,
              endDate: '2026-07-21' as ISODateString,
              location: 'Vannes',
            },
          }),
        ),
      );

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalled();
      });

      const trips = await db.trips.toArray();
      expect(trips).toHaveLength(1);
      expect(trips[0]?.name).toBe('Brittany 2026');
      expect(trips[0]?.location).toBe('Vannes');
      // The route names the *local* id, not the exporting device's.
      expect(mockNavigate).toHaveBeenCalledWith(`/trips/${trips[0]?.id}/calendar`);
      expect(trips[0]?.id).not.toBe(GUEST_TRIP_ID);
    });

    it('reassembles a multi-frame export and imports it once complete', async () => {
      const trip = await seedLocalTrip();
      // Enough guests to push the payload past MAX_QR_BYTES, so the frames come
      // from the shipped splitter rather than from a hand-written fixture.
      const persons = Array.from({ length: 120 }, (_, index) =>
        makePerson({
          id: `guest-person-${index}` as PersonId,
          name: `Guest number ${index} with a long enough name`,
        }),
      );
      const frames = splitIntoFrames(
        encodeChangeset(
          makeChangeset({
            added: { persons, assignments: [], transports: [], rooms: [] },
          }),
        ),
      );
      expect(frames.length).toBeGreaterThan(1);

      renderDialog();

      for (const frame of frames.slice(0, -1)) {
        await scan(frame);
      }
      // Nothing is imported while frames are still missing.
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(await db.persons.count()).toBe(0);

      await scan(frames[frames.length - 1]!);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(`/trips/${trip.id}/calendar`);
      });
      expect(await db.persons.where('tripId').equals(trip.id).count()).toBe(persons.length);
    });
  });

  // ==========================================================================
  // Failure paths
  // ==========================================================================

  describe('failures', () => {
    it('reports an unreadable payload as an invalid share', async () => {
      renderDialog();

      await scan('!!!definitely-not-a-changeset!!!');

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('trips.importQrInvalid');
      });
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(await db.trips.count()).toBe(0);
    });

    it('asks for a fresh export when the payload carries no trip snapshot', async () => {
      // No local trip with this share id, and no snapshot to create one from.
      renderDialog();

      await scan(encodeChangeset(makeChangeset()));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('trips.importQrSnapshotRequired');
      });
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(await db.trips.count()).toBe(0);
    });

    it('falls back to the generic message when the merge itself fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      dbFailures.getTripByShareId = () => Promise.reject(new Error('IndexedDB is unavailable'));
      renderDialog();

      await scan(encodeChangeset(makeChangeset()));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('trips.importQrMergeFailed');
      });
      expect(mockToastError).not.toHaveBeenCalledWith('trips.importQrSnapshotRequired');
      expect(mockNavigate).not.toHaveBeenCalled();
      // The spy exists to keep the expected failure out of the test output; it
      // is asserted so it is not merely a silencer.
      expect(consoleError).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Re-entrancy
  // ==========================================================================

  describe('re-entrancy', () => {
    it('ignores scans while an import is in flight', async () => {
      // The lookup never settles, so the import stays open for the whole test.
      let lookups = 0;
      dbFailures.getTripByShareId = () => {
        lookups += 1;
        return new Promise<never>(() => undefined);
      };
      await seedLocalTrip();
      renderDialog();

      await scan(encodeChangeset(makeChangeset()));
      await waitFor(() => {
        expect(lookups).toBe(1);
      });

      // A second payload, for a *different* route, is dropped rather than acted
      // on: nothing may run while an import holds the dialog.
      await scan('https://kikouchou.app/join/aBcDeFgHiJkL3456');
      await scan(encodeChangeset(makeChangeset()));

      expect(mockNavigate).not.toHaveBeenCalled();
      expect(lookups).toBe(1);
    });

    /**
     * The case a real scanner produces, and the one the test above cannot see.
     *
     * `useZxing` re-decodes continuously, so holding one code in frame fires
     * `onScan` many times a second — repeatedly within a single tick. The guard
     * therefore has to hold before React has re-rendered, which is why it is a
     * ref and not `isImporting` state: reading state here only ever saw the
     * value captured when the handler was created, so both scans passed it and
     * the trip was imported twice.
     */
    it('ignores a second scan delivered in the same tick as the first', async () => {
      const trip = await seedLocalTrip();
      renderDialog();
      const payload = encodeChangeset(makeChangeset());

      // Back to back, in one tick: React cannot have re-rendered between them.
      await scan(payload, payload);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(`/trips/${trip.id}/calendar`);
      });

      // One import, so one person row and one analytics event — a second pass
      // would upsert the same ids and be invisible in the row count, but not in
      // the capture count.
      expect(mockCapture.mock.calls.filter(([event]) => event === 'trip_imported')).toHaveLength(1);
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it('accepts a new code after the dialog has been dismissed', async () => {
      const { user } = renderDialog();

      await scan('https://kikouchou.app/join/aBcDeFgHiJkL3456');
      expect(mockNavigate).toHaveBeenCalledTimes(1);

      // A second scan is refused: this one is already handled.
      await scan('https://app.example.com/share/abc123');
      expect(mockNavigate).toHaveBeenCalledTimes(1);

      // Escape is what `handleOpenChange(false)` hangs off, and it is where the
      // handled flag is cleared.
      await user.keyboard('{Escape}');

      await scan('https://app.example.com/share/abc123');
      expect(mockNavigate).toHaveBeenNthCalledWith(2, '/share/abc123');
    });
  });
});
