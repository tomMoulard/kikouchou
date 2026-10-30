/**
 * @fileoverview The account sweep's bookkeeping, one step at a time.
 *
 * `account-sync.test.ts` runs the sweep against a PostgREST-shaped server and
 * pins what it refuses to do. This file replaces the five modules the sweep
 * composes with doubles, so each step can be made to fail on its own and the
 * report can be checked to count it: a sweep that says `failed: 0` after a
 * download went wrong is the silence the result type exists to prevent.
 *
 * @module lib/sync/__tests__/account-sync.counts.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { syncAccountTrips } from '@/lib/sync/account-sync';
import { isoDate } from '@/test/utils';
import type { Trip, TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

const mocks = vi.hoisted(() => ({
  upgradeViewerTrip: vi.fn(),
  downloadTripDocument: vi.fn(),
  ensureRemoteTrip: vi.fn(),
  uploadTripDocument: vi.fn(),
  listRemoteTripsMissingLocally: vi.fn(),
  materialiseJoinedTrip: vi.fn(),
}));

vi.mock('@/lib/sync/viewer', () => ({ upgradeViewerTrip: mocks.upgradeViewerTrip }));
vi.mock('@/lib/sync/download-document', () => ({
  downloadTripDocument: mocks.downloadTripDocument,
}));
vi.mock('@/lib/sync/upload-document', () => ({ uploadTripDocument: mocks.uploadTripDocument }));
vi.mock('@/lib/sync/join-trip', () => ({ materialiseJoinedTrip: mocks.materialiseJoinedTrip }));
vi.mock('@/lib/sync/remote-trip', () => ({
  ensureRemoteTrip: mocks.ensureRemoteTrip,
  listRemoteTripsMissingLocally: mocks.listRemoteTripsMissingLocally,
}));

const USER = 'user-1';
const CLIENT = {} as never;

async function makeTrip(name: string, fields: Partial<Trip> = {}): Promise<Trip> {
  const trip = await createTrip({
    name,
    startDate: isoDate('2026-07-15'),
    endDate: isoDate('2026-07-22'),
  });
  if (Object.keys(fields).length > 0) {
    await db.trips.update(trip.id, fields);
  }
  return (await db.trips.get(trip.id)) as Trip;
}

beforeEach(() => {
  mocks.upgradeViewerTrip.mockResolvedValue({ status: 'upgraded' });
  mocks.downloadTripDocument.mockResolvedValue({ status: 'hydrated' });
  mocks.ensureRemoteTrip.mockResolvedValue({ status: 'ready', remoteTripId: 'remote-new' });
  mocks.uploadTripDocument.mockResolvedValue({ status: 'uploaded' });
  mocks.listRemoteTripsMissingLocally.mockResolvedValue([]);
  mocks.materialiseJoinedTrip.mockResolvedValue({
    status: 'joined',
    tripId: 'joined-trip' as TripId,
  });
});

// ============================================================================
// Viewer trips
// ============================================================================

describe('upgrading viewer trips', () => {
  it('offers only the trips that carry a viewer token', async () => {
    const viewer = await makeTrip('Read only', { viewerToken: 'tok1234567890abc', remoteTripId: 'r-1' });
    await makeTrip('Member', { remoteTripId: 'r-2' });
    await db.yjsUpdates.add({ tripId: viewer.id, update: new Uint8Array([0]) });

    await syncAccountTrips(CLIENT, USER);

    expect(mocks.upgradeViewerTrip).toHaveBeenCalledTimes(1);
    expect(mocks.upgradeViewerTrip).toHaveBeenCalledWith(
      CLIENT,
      USER,
      expect.objectContaining({ id: viewer.id }),
    );
  });

  it.each([
    ['upgraded', { upgraded: 1, failed: 0 }],
    ['already-member', { upgraded: 0, failed: 0 }],
    ['error', { upgraded: 0, failed: 1 }],
  ])('counts an upgrade that answers %s', async (status, counts) => {
    await makeTrip('Read only', { viewerToken: 'tok1234567890abc', remoteTripId: 'r-1' });
    mocks.upgradeViewerTrip.mockResolvedValue({ status, message: 'x' });

    const result = await syncAccountTrips(CLIENT, USER);

    expect(result).toMatchObject(counts);
  });
});

// ============================================================================
// Placeholders
// ============================================================================

describe('hydrating placeholders', () => {
  it('downloads only linked trips that hold no document yet', async () => {
    const placeholder = await makeTrip('Placeholder', { remoteTripId: 'r-1' });
    const opened = await makeTrip('Opened', { remoteTripId: 'r-2' });
    await db.yjsUpdates.add({ tripId: opened.id, update: new Uint8Array([0]) });
    await makeTrip('Local only');
    mocks.ensureRemoteTrip.mockResolvedValue({ status: 'error', message: 'offline' });

    await syncAccountTrips(CLIENT, USER);

    expect(mocks.downloadTripDocument).toHaveBeenCalledTimes(1);
    expect(mocks.downloadTripDocument).toHaveBeenCalledWith(CLIENT, placeholder.id, 'r-1');
  });

  it('counts a placeholder that could not be hydrated', async () => {
    await makeTrip('Placeholder', { remoteTripId: 'r-1' });
    mocks.downloadTripDocument.mockResolvedValue({ status: 'error', message: 'offline' });

    expect(await syncAccountTrips(CLIENT, USER)).toEqual({
      uploaded: 0,
      downloaded: 0,
      upgraded: 0,
      failed: 1,
    });
  });

  it('does not count a placeholder the server has nothing for', async () => {
    await makeTrip('Placeholder', { remoteTripId: 'r-1' });
    mocks.downloadTripDocument.mockResolvedValue({ status: 'empty' });

    expect(await syncAccountTrips(CLIENT, USER)).toMatchObject({ failed: 0 });
  });
});

// ============================================================================
// Push
// ============================================================================

describe('pushing', () => {
  it('counts a trip whose document did not go up, and not as uploaded', async () => {
    await makeTrip('Brittany');
    mocks.uploadTripDocument.mockResolvedValue({ status: 'error', message: 'offline' });

    expect(await syncAccountTrips(CLIENT, USER)).toEqual({
      uploaded: 0,
      downloaded: 0,
      upgraded: 0,
      failed: 1,
    });
  });

  it('counts an already-current document as uploaded', async () => {
    await makeTrip('Brittany');
    mocks.uploadTripDocument.mockResolvedValue({ status: 'already-current' });

    expect(await syncAccountTrips(CLIENT, USER)).toMatchObject({ uploaded: 1, failed: 0 });
  });
});

// ============================================================================
// Pull
// ============================================================================

describe('pulling', () => {
  it('counts a trip that could not be materialised, and downloads nothing for it', async () => {
    mocks.listRemoteTripsMissingLocally.mockResolvedValue([{ id: 'r-9', name: 'Alps' }]);
    mocks.materialiseJoinedTrip.mockResolvedValue({ status: 'error', message: 'offline' });

    expect(await syncAccountTrips(CLIENT, USER)).toEqual({
      uploaded: 0,
      downloaded: 0,
      upgraded: 0,
      failed: 1,
    });
    expect(mocks.downloadTripDocument).not.toHaveBeenCalled();
  });

  it('neither counts nor hydrates a trip another tab already has', async () => {
    mocks.listRemoteTripsMissingLocally.mockResolvedValue([{ id: 'r-9', name: 'Alps' }]);
    mocks.materialiseJoinedTrip.mockResolvedValue({
      status: 'already-local',
      tripId: 'other-tab' as TripId,
    });

    expect(await syncAccountTrips(CLIENT, USER)).toEqual({
      uploaded: 0,
      downloaded: 0,
      upgraded: 0,
      failed: 0,
    });
    expect(mocks.downloadTripDocument).not.toHaveBeenCalled();
  });

  it('counts every trip it brought down', async () => {
    mocks.listRemoteTripsMissingLocally.mockResolvedValue([
      { id: 'r-8', name: 'Coast' },
      { id: 'r-9', name: 'Alps' },
    ]);

    expect(await syncAccountTrips(CLIENT, USER)).toEqual({
      uploaded: 0,
      downloaded: 2,
      upgraded: 0,
      failed: 0,
    });
  });

  it('hydrates a joined trip, and counts a hydration that failed', async () => {
    mocks.listRemoteTripsMissingLocally.mockResolvedValue([{ id: 'r-9', name: 'Alps' }]);
    mocks.downloadTripDocument.mockResolvedValue({ status: 'error', message: 'offline' });

    expect(await syncAccountTrips(CLIENT, USER)).toEqual({
      uploaded: 0,
      downloaded: 1,
      upgraded: 0,
      failed: 1,
    });
    expect(mocks.downloadTripDocument).toHaveBeenCalledWith(CLIENT, 'joined-trip', 'r-9');
  });
});

// ============================================================================
// The whole report
// ============================================================================

describe('the report', () => {
  it('adds up the failures of every step', async () => {
    await makeTrip('Read only', { viewerToken: 'tok1234567890abc', remoteTripId: 'r-1' });
    await makeTrip('Placeholder', { remoteTripId: 'r-2' });
    await makeTrip('Local');
    mocks.listRemoteTripsMissingLocally.mockResolvedValue([{ id: 'r-9', name: 'Alps' }]);
    mocks.upgradeViewerTrip.mockResolvedValue({ status: 'error', message: 'expired' });
    mocks.downloadTripDocument.mockResolvedValue({ status: 'error', message: 'offline' });
    mocks.ensureRemoteTrip.mockResolvedValue({ status: 'error', message: 'offline' });

    // One failure for the viewer, two hydrations (the viewer trip and the
    // placeholder), one push and one hydration after the pull.
    expect(await syncAccountTrips(CLIENT, USER)).toEqual({
      uploaded: 0,
      downloaded: 1,
      upgraded: 0,
      failed: 5,
    });
  });

  it('reports nothing, and says why, when the database itself fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(db.trips, 'toArray').mockRejectedValue(new Error('database closed'));

    expect(await syncAccountTrips(CLIENT, USER)).toEqual({
      uploaded: 0,
      downloaded: 0,
      upgraded: 0,
      failed: 0,
    });
    expect(warn).toHaveBeenCalledWith('[sync] the account sweep did not finish:', 'database closed');
  });

  it('says why in text when the failure is not an Error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(db.trips, 'toArray').mockRejectedValue('quota');

    await syncAccountTrips(CLIENT, USER);

    expect(warn).toHaveBeenCalledWith('[sync] the account sweep did not finish:', 'quota');
  });
});
