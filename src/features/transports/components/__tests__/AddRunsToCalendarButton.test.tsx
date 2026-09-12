/**
 * @fileoverview Tests for the button that hands a driver's runs to their own
 * calendar.
 *
 * The claims that matter to a user: it appears only for a driver with runs
 * still ahead, the file it saves holds those runs and nobody else's, and a
 * browser that cannot save a file says so rather than failing silently.
 *
 * @module features/transports/components/__tests__/AddRunsToCalendarButton.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';
import type {
  Person,
  PersonId,
  Ride,
  RideId,
  Transport,
  TransportId,
  Trip,
  TripId,
  Vehicle,
  VehicleId,
} from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;

/** The frozen reference instant every offset is measured from. */
const NOW_MS = Date.UTC(2026, 6, 15, 10, 0, 0);

const MINUTE_MS = 60_000;

function minutesFromNow(minutes: number): string {
  return new Date(NOW_MS + minutes * MINUTE_MS).toISOString();
}

const mockTrip = {
  id: TRIP_ID,
  shareId: 'share-1',
  name: 'Provence, août',
  location: 'Provence',
  startDate: '2026-07-14',
  endDate: '2026-07-20',
  description: '',
  createdAt: NOW_MS,
  updatedAt: NOW_MS,
} as unknown as Trip;

const guillaume: Person = {
  id: 'guillaume' as PersonId,
  tripId: TRIP_ID,
  name: 'Guillaume',
  color: '#3b82f6' as Person['color'],
};

const alice: Person = {
  id: 'alice' as PersonId,
  tripId: TRIP_ID,
  name: 'Alice',
  color: '#ef4444' as Person['color'],
};

const clio: Vehicle = {
  id: 'vehicle-clio' as VehicleId,
  tripId: TRIP_ID,
  name: 'la Clio',
  seatCount: 5,
};

/** Guillaume fetches Alice in two hours. */
const myRun: Ride = {
  id: 'ride-mine' as RideId,
  tripId: TRIP_ID,
  direction: 'pickup',
  meetDatetime: minutesFromNow(120) as Ride['meetDatetime'],
  location: 'Lyon Part-Dieu',
  leadTimeMinutes: 30,
  driverId: guillaume.id,
  vehicleId: clio.id,
};

/** Somebody else's run, on the same day. */
const otherRun: Ride = {
  id: 'ride-theirs' as RideId,
  tripId: TRIP_ID,
  direction: 'dropoff',
  meetDatetime: minutesFromNow(240) as Ride['meetDatetime'],
  location: 'Orly',
  driverId: alice.id,
};

const aliceArrives: Transport = {
  id: 'leg-alice' as TransportId,
  tripId: TRIP_ID,
  personId: alice.id,
  type: 'arrival',
  datetime: minutesFromNow(120) as Transport['datetime'],
  location: 'Lyon Part-Dieu',
  needsPickup: true,
  rideId: myRun.id,
};

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: vi.fn(),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: vi.fn(),
}));

vi.mock('@/contexts/RideContext', () => ({
  useRideContext: vi.fn(),
}));

vi.mock('@/hooks/useTripIdentity', () => ({
  useTripIdentity: vi.fn(),
}));

vi.mock('@/lib/utils/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/download')>()),
  downloadTextFile: vi.fn(() => true),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { AddRunsToCalendarButton } from '../AddRunsToCalendarButton';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';
import { useTripIdentity } from '@/hooks/useTripIdentity';
import { downloadTextFile } from '@/lib/utils/download';
import { toast } from 'sonner';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Points the contexts at a trip.
 *
 * @param rides - The trip's rides
 * @param transports - The trip's legs
 */
function setMocks(rides: readonly Ride[], transports: readonly Transport[]): void {
  vi.mocked(useTripContext).mockReturnValue({
    currentTrip: mockTrip,
  } as unknown as ReturnType<typeof useTripContext>);

  vi.mocked(usePersonContext).mockReturnValue({
    persons: [guillaume, alice],
  } as unknown as ReturnType<typeof usePersonContext>);

  vi.mocked(useTransportContext).mockReturnValue({
    transports,
    nowMs: NOW_MS,
  } as unknown as ReturnType<typeof useTransportContext>);

  vi.mocked(useRideContext).mockReturnValue({
    rides,
    vehicles: [clio],
  } as unknown as ReturnType<typeof useRideContext>);
}

/**
 * Says who is holding the device.
 *
 * @param myPersonId - The guest, or undefined when nobody has said
 */
function setIdentity(myPersonId: PersonId | undefined): void {
  vi.mocked(useTripIdentity).mockReturnValue({
    myPersonId,
    source: myPersonId === undefined ? undefined : 'explicit',
    isResolved: true,
    setMyPersonId: vi.fn(),
  });
}

/** The file content of the one download that was started. */
function savedFile(): { filename: string; text: string } {
  const call = vi.mocked(downloadTextFile).mock.calls.at(-1);

  if (!call) {
    throw new Error('No download was started');
  }

  return { filename: call[0].filename, text: call[0].text };
}

// ============================================================================
// Tests
// ============================================================================

describe('AddRunsToCalendarButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(downloadTextFile).mockReturnValue(true);
    setIdentity(guillaume.id);
    setMocks([myRun, otherRun], [aliceArrives]);
  });

  it('offers the export to a driver with a run ahead', () => {
    render(<AddRunsToCalendarButton />, { withProviders: false });

    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('stays away when this browser is nobody in the trip', () => {
    setIdentity(undefined);

    const { container } = render(<AddRunsToCalendarButton />, { withProviders: false });

    expect(container).toBeEmptyDOMElement();
  });

  it('stays away when the guest drives nothing that is still ahead', () => {
    setMocks([{ ...myRun, meetDatetime: minutesFromNow(-120) as Ride['meetDatetime'] }], []);

    const { container } = render(<AddRunsToCalendarButton />, { withProviders: false });

    expect(container).toBeEmptyDOMElement();
  });

  it('saves a calendar file holding this driver’s run alone', async () => {
    const { user } = render(<AddRunsToCalendarButton />, { withProviders: false });

    await user.click(screen.getByRole('button'));

    const { filename, text } = savedFile();

    expect(filename).toBe('provence-aout-runs.ics');
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain('UID:ride-mine@kikouchou.app');
    // Alice's own run is hers to export.
    expect(text).not.toContain('ride-theirs');
  });

  it('writes an alarm, which is the whole point of the file', async () => {
    const { user } = render(<AddRunsToCalendarButton />, { withProviders: false });

    await user.click(screen.getByRole('button'));

    expect(savedFile().text).toContain('BEGIN:VALARM');
    expect(savedFile().text).toContain('TRIGGER:-PT15M');
  });

  it('blocks out the drive, from the leave time to the rendez-vous', async () => {
    const { user } = render(<AddRunsToCalendarButton />, { withProviders: false });

    await user.click(screen.getByRole('button'));

    // Meeting at 12:00 UTC, leaving 30 minutes before it.
    expect(savedFile().text).toContain('DTSTART:20260715T113000Z');
    expect(savedFile().text).toContain('DTEND:20260715T120000Z');
  });

  it('says so when the browser cannot save a file', async () => {
    vi.mocked(downloadTextFile).mockReturnValue(false);

    const { user } = render(<AddRunsToCalendarButton />, { withProviders: false });

    await user.click(screen.getByRole('button'));

    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
