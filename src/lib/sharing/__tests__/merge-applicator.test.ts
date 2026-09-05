/**
 * @fileoverview Tests for merge-applicator — applies resolved merge results to the DB.
 *
 * @module lib/sharing/__tests__/merge-applicator.test
 */

import { describe, it, expect } from 'vitest';

import { db } from '@/lib/db/database';
import { applyMerge } from '../merge-applicator';
import type { MergeResult, MergeConflict, AppChangeset, EntityCollection } from '../types';
import type { Person, RoomAssignment, Transport, PersonId, RoomId, RoomAssignmentId, TransportId, TripId, ISODateString, HexColor } from '@/types';

// ============================================================================
// Test Helpers
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;

function makePerson(id: string, name = 'Person'): Person {
  return {
    id: id as PersonId,
    tripId: TRIP_ID,
    name,
    color: '#ef4444' as HexColor,
  };
}

function makeAssignment(id: string): RoomAssignment {
  return {
    id: id as RoomAssignmentId,
    tripId: TRIP_ID,
    roomId: 'room-1' as RoomId,
    personId: 'person-1' as PersonId,
    startDate: '2024-07-15' as ISODateString,
    endDate: '2024-07-20' as ISODateString,
  };
}

function makeTransport(id: string): Transport {
  return {
    id: id as TransportId,
    tripId: TRIP_ID,
    personId: 'person-1' as PersonId,
    type: 'arrival',
    datetime: '2024-07-15T14:00:00.000Z',
    location: 'Station',
    needsPickup: false,
  };
}

const emptyChangeset: AppChangeset = {
  version: 1,
  tripId: TRIP_ID,
  shareId: 'share-1',
  exportedBy: 'person-1' as PersonId,
  exportedAt: Date.now(),
  baseSnapshotAt: Date.now(),
  added: { persons: [], assignments: [], transports: [], rooms: [] },
  modified: { persons: [], assignments: [], transports: [], rooms: [] },
};

function buildMergeResult(overrides: Partial<MergeResult> = {}): MergeResult {
  return {
    changeset: emptyChangeset,
    autoApply: { persons: [], assignments: [], transports: [], rooms: [] },
    conflicts: [],
    warnings: [],
    summary: { additions: 0, autoUpdates: 0, conflicts: 0, warnings: 0 },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('applyMerge', () => {
  it('throws when there are unresolved conflicts', async () => {
    const conflict: MergeConflict = {
      entityType: 'person',
      entityId: 'person-1' as PersonId,
      label: 'Test Person',
      hostVersion: makePerson('person-1'),
      guestVersion: makePerson('person-1', 'Guest Name'),
      conflictingFields: ['name'],
      // No resolution set
    };

    const mergeResult = buildMergeResult({ conflicts: [conflict] });

    await expect(applyMerge(mergeResult)).rejects.toThrow('unresolved conflict');
  });

  it('applies auto-apply persons, assignments, and transports', async () => {
    const person = makePerson('auto-p1', 'Auto Person');
    const assignment = makeAssignment('auto-a1');
    const transport = makeTransport('auto-t1');

    const autoApply: EntityCollection = {
      persons: [person],
      assignments: [assignment],
      transports: [transport],
      rooms: [],
    };

    const mergeResult = buildMergeResult({ autoApply });
    const result = await applyMerge(mergeResult);

    expect(result.roomsUpserted).toBe(0);
    expect(result.personsUpserted).toBe(1);
    expect(result.assignmentsUpserted).toBe(1);
    expect(result.transportsUpserted).toBe(1);

    // Verify in DB
    const dbPerson = await db.persons.get(person.id);
    expect(dbPerson?.name).toBe('Auto Person');

    const dbAssignment = await db.roomAssignments.get(assignment.id);
    expect(dbAssignment).toBeDefined();

    const dbTransport = await db.transports.get(transport.id);
    expect(dbTransport).toBeDefined();
  });

  it('applies accept-guest conflict resolution', async () => {
    const guestPerson = makePerson('conflict-p1', 'Guest Name');
    const conflict: MergeConflict = {
      entityType: 'person',
      entityId: 'conflict-p1' as PersonId,
      label: 'Test Person',
      hostVersion: makePerson('conflict-p1', 'Host Name'),
      guestVersion: guestPerson,
      conflictingFields: ['name'],
      resolution: 'accept-guest',
    };

    const mergeResult = buildMergeResult({ conflicts: [conflict] });
    const result = await applyMerge(mergeResult);

    expect(result.conflictsAccepted).toBe(1);
    expect(result.conflictsKept).toBe(0);

    // Guest version should be in DB
    const dbPerson = await db.persons.get('conflict-p1' as PersonId);
    expect(dbPerson?.name).toBe('Guest Name');
  });

  it('skips keep-host conflict resolution', async () => {
    const hostPerson = makePerson('keep-p1', 'Host Name');
    await db.persons.put(hostPerson);

    const conflict: MergeConflict = {
      entityType: 'person',
      entityId: 'keep-p1' as PersonId,
      label: 'Test Person',
      hostVersion: hostPerson,
      guestVersion: makePerson('keep-p1', 'Guest Name'),
      conflictingFields: ['name'],
      resolution: 'keep-host',
    };

    const mergeResult = buildMergeResult({ conflicts: [conflict] });
    const result = await applyMerge(mergeResult);

    expect(result.conflictsKept).toBe(1);
    expect(result.conflictsAccepted).toBe(0);

    // Host version should remain
    const dbPerson = await db.persons.get('keep-p1' as PersonId);
    expect(dbPerson?.name).toBe('Host Name');
  });

  it('handles accept-guest for assignment conflicts', async () => {
    const guestAssignment = makeAssignment('conflict-a1');
    const conflict: MergeConflict = {
      entityType: 'assignment',
      entityId: 'conflict-a1' as RoomAssignmentId,
      label: 'Assignment',
      hostVersion: makeAssignment('conflict-a1'),
      guestVersion: guestAssignment,
      conflictingFields: ['startDate'],
      resolution: 'accept-guest',
    };

    const mergeResult = buildMergeResult({ conflicts: [conflict] });
    const result = await applyMerge(mergeResult);

    expect(result.conflictsAccepted).toBe(1);
    const dbAssignment = await db.roomAssignments.get('conflict-a1' as RoomAssignmentId);
    expect(dbAssignment).toBeDefined();
  });

  it('handles accept-guest for transport conflicts', async () => {
    const guestTransport = makeTransport('conflict-t1');
    const conflict: MergeConflict = {
      entityType: 'transport',
      entityId: 'conflict-t1' as TransportId,
      label: 'Transport',
      hostVersion: makeTransport('conflict-t1'),
      guestVersion: guestTransport,
      conflictingFields: ['location'],
      resolution: 'accept-guest',
    };

    const mergeResult = buildMergeResult({ conflicts: [conflict] });
    const result = await applyMerge(mergeResult);

    expect(result.conflictsAccepted).toBe(1);
    const dbTransport = await db.transports.get('conflict-t1' as TransportId);
    expect(dbTransport).toBeDefined();
  });

  it('returns zero counts for empty merge result', async () => {
    const mergeResult = buildMergeResult();
    const result = await applyMerge(mergeResult);

    expect(result.roomsUpserted).toBe(0);
    expect(result.personsUpserted).toBe(0);
    expect(result.assignmentsUpserted).toBe(0);
    expect(result.transportsUpserted).toBe(0);
    expect(result.conflictsAccepted).toBe(0);
    expect(result.conflictsKept).toBe(0);
  });
});
