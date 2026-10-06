/**
 * @fileoverview Tests for sharing export-service (guest delta + host snapshot).
 * @module lib/sharing/__tests__/export-service.test
 */

import { describe, expect, it } from 'vitest';

import { buildHostChangeset } from '@/lib/sharing/export-service';
import { getTripById } from '@/lib/db';
import { createTestPerson, createTestTrip, waitForDb } from '@/test/utils';

describe('buildHostChangeset', () => {
  it('returns null when the trip has no exportable entities', async () => {
    const tripId = await createTestTrip({ name: 'Empty', startDate: '2024-06-01' });
    await waitForDb();
    const trip = await getTripById(tripId);
    expect(trip).toBeDefined();

    const changeset = await buildHostChangeset(trip!);
    expect(changeset).toBeNull();
  });

  it('includes all trip persons, assignments, and transports', async () => {
    const tripId = await createTestTrip({ name: 'Host export', startDate: '2024-06-01' });
    await createTestPerson(tripId, { name: 'Alice' });
    await waitForDb();
    const trip = await getTripById(tripId);
    expect(trip).toBeDefined();

    const changeset = await buildHostChangeset(trip!);
    expect(changeset).not.toBeNull();
    expect(changeset!.tripId).toBe(tripId);
    expect(changeset!.shareId).toBe(trip!.shareId);
    expect(changeset!.tripSnapshot?.name).toBe('Host export');
    expect(changeset!.modified.persons).toHaveLength(0);
    expect(changeset!.added.persons).toHaveLength(1);
    expect(changeset!.added.persons[0]?.name).toBe('Alice');
    expect(changeset!.added.rooms).toEqual([]);
    expect(changeset!.exportedBy).toBe(changeset!.added.persons[0]?.id);
  });
});
