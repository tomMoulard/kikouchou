/**
 * @fileoverview Unit tests for the merge engine.
 * Tests conflict detection, auto-apply logic, and warning generation.
 *
 * @module lib/sharing/__tests__/merge-engine.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { computeMerge } from '@/lib/sharing/merge-engine';
import type { AppChangeset } from '@/lib/sharing/types';
import type {
  HexColor,
  ISODateString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  Transport,
  TransportId,
  TripId,
} from '@/types';

// ============================================================================
// Mock Database
// ============================================================================

const mockHostPersons: Person[] = [];
const mockHostAssignments: RoomAssignment[] = [];
const mockHostTransports: Transport[] = [];
const mockHostRooms: Room[] = [];

vi.mock('@/lib/db', () => ({
  getPersonsByTripId: vi.fn(async () => mockHostPersons),
  getAssignmentsByTripId: vi.fn(async () => mockHostAssignments),
  getTransportsByTripId: vi.fn(async () => mockHostTransports),
  getRoomsByTripId: vi.fn(async () => mockHostRooms),
}));

// ============================================================================
// Helpers
// ============================================================================

const TRIP_ID = 'trip-123' as TripId;

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: 'person-1' as PersonId,
    tripId: TRIP_ID,
    name: 'Alice',
    color: '#ff0000' as HexColor,
    stayStartDate: '2026-07-15' as ISODateString,
    stayEndDate: '2026-07-20' as ISODateString,
    ...overrides,
  };
}

function makeAssignment(overrides: Partial<RoomAssignment> = {}): RoomAssignment {
  return {
    id: 'assign-1' as RoomAssignmentId,
    tripId: TRIP_ID,
    roomId: 'room-1' as RoomId,
    personId: 'person-1' as PersonId,
    startDate: '2026-07-15' as ISODateString,
    endDate: '2026-07-20' as ISODateString,
    ...overrides,
  };
}

function makeTransport(overrides: Partial<Transport> = {}): Transport {
  return {
    id: 'transport-1' as TransportId,
    tripId: TRIP_ID,
    personId: 'person-1' as PersonId,
    type: 'arrival' as const,
    datetime: '2026-07-15T14:30:00Z',
    location: 'Gare de Vannes',
    transportMode: 'train',
    needsPickup: false,
    ...overrides,
  };
}

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1' as RoomId,
    tripId: TRIP_ID,
    name: 'Room 1',
    capacity: 2,
    order: 0,
    ...overrides,
  };
}

function makeChangeset(overrides: Partial<AppChangeset> = {}): AppChangeset {
  return {
    version: 1,
    tripId: TRIP_ID,
    shareId: 'share-abc',
    exportedBy: 'person-1' as PersonId,
    exportedAt: 1775649600000,
    baseSnapshotAt: 1775563200000,
    added: { persons: [], assignments: [], transports: [] },
    modified: { persons: [], assignments: [], transports: [] },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  mockHostPersons.length = 0;
  mockHostAssignments.length = 0;
  mockHostTransports.length = 0;
  mockHostRooms.length = 0;
});

describe('computeMerge', () => {
  describe('additions', () => {
    it('auto-applies a new person not present on host', async () => {
      const newPerson = makePerson({ id: 'person-new' as PersonId, name: 'Bob' });
      const changeset = makeChangeset({
        added: { persons: [newPerson], assignments: [], transports: [] },
      });

      const result = await computeMerge(changeset);

      expect(result.autoApply.persons).toHaveLength(1);
      expect(result.autoApply.persons[0]?.name).toBe('Bob');
      expect(result.conflicts).toHaveLength(0);
    });

    it('auto-applies a new assignment not present on host', async () => {
      // Provide the referenced person and room on host
      mockHostPersons.push(makePerson());
      mockHostRooms.push(makeRoom());

      const newAssignment = makeAssignment({ id: 'assign-new' as RoomAssignmentId });
      const changeset = makeChangeset({
        added: { persons: [], assignments: [newAssignment], transports: [] },
      });

      const result = await computeMerge(changeset);

      expect(result.autoApply.assignments).toHaveLength(1);
      expect(result.conflicts).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('auto-applies a new transport not present on host', async () => {
      mockHostPersons.push(makePerson());

      const newTransport = makeTransport({ id: 'transport-new' as TransportId });
      const changeset = makeChangeset({
        added: { persons: [], assignments: [], transports: [newTransport] },
      });

      const result = await computeMerge(changeset);

      expect(result.autoApply.transports).toHaveLength(1);
      expect(result.conflicts).toHaveLength(0);
    });
  });

  describe('modifications — person (auto-apply)', () => {
    it('auto-applies guest person changes (guest is authority on their own data)', async () => {
      const hostPerson = makePerson({ name: 'Alice' });
      mockHostPersons.push(hostPerson);

      const guestPerson = makePerson({ name: 'Alice B.' });
      const changeset = makeChangeset({
        modified: { persons: [guestPerson], assignments: [], transports: [] },
      });

      const result = await computeMerge(changeset);

      // Person changes are always auto-applied (guest authority over their own data)
      expect(result.autoApply.persons).toHaveLength(1);
      expect(result.autoApply.persons[0]?.name).toBe('Alice B.');
      expect(result.conflicts).toHaveLength(0);
    });

    it('does nothing if person has no differences', async () => {
      const person = makePerson();
      mockHostPersons.push(person);

      const changeset = makeChangeset({
        modified: { persons: [{ ...person }], assignments: [], transports: [] },
      });

      const result = await computeMerge(changeset);

      expect(result.autoApply.persons).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
    });
  });

  describe('modifications — assignment (conflict)', () => {
    it('creates conflict when host assignment differs from guest', async () => {
      const hostAssignment = makeAssignment({ roomId: 'room-1' as RoomId });
      mockHostAssignments.push(hostAssignment);
      mockHostPersons.push(makePerson());
      mockHostRooms.push(makeRoom());

      const guestAssignment = makeAssignment({ roomId: 'room-2' as RoomId });
      const changeset = makeChangeset({
        modified: { persons: [], assignments: [guestAssignment], transports: [] },
      });

      const result = await computeMerge(changeset);

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]?.entityType).toBe('assignment');
      expect(result.conflicts[0]?.conflictingFields).toContain('roomId');
    });
  });

  describe('modifications — transport (conflict)', () => {
    it('creates conflict when host transport differs from guest', async () => {
      const hostTransport = makeTransport({ location: 'Gare de Vannes' });
      mockHostTransports.push(hostTransport);
      mockHostPersons.push(makePerson());

      const guestTransport = makeTransport({ location: 'Gare de Rennes' });
      const changeset = makeChangeset({
        modified: { persons: [], assignments: [], transports: [guestTransport] },
      });

      const result = await computeMerge(changeset);

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]?.entityType).toBe('transport');
      expect(result.conflicts[0]?.conflictingFields).toContain('location');
    });
  });

  describe('warnings — orphaned references', () => {
    it('warns when assignment references a deleted room', async () => {
      mockHostPersons.push(makePerson());
      // No rooms on host → room-1 is orphaned

      const assignment = makeAssignment();
      const changeset = makeChangeset({
        added: { persons: [], assignments: [assignment], transports: [] },
      });

      const result = await computeMerge(changeset);

      const roomWarnings = result.warnings.filter(w => w.type === 'orphaned-room-ref');
      expect(roomWarnings).toHaveLength(1);
    });

    it('warns when transport references a deleted person', async () => {
      // No persons on host → person-1 is orphaned

      const transport = makeTransport();
      const changeset = makeChangeset({
        added: { persons: [], assignments: [], transports: [transport] },
      });

      const result = await computeMerge(changeset);

      const personWarnings = result.warnings.filter(w => w.type === 'orphaned-person-ref');
      expect(personWarnings).toHaveLength(1);
    });

    it('warns when transport references a deleted driver', async () => {
      mockHostPersons.push(makePerson());
      // driverId references person-2 which does not exist on host

      const transport = makeTransport({ driverId: 'person-2' as PersonId });
      const changeset = makeChangeset({
        added: { persons: [], assignments: [], transports: [transport] },
      });

      const result = await computeMerge(changeset);

      const driverWarnings = result.warnings.filter(w =>
        w.type === 'orphaned-person-ref' && w.message.includes('driver'),
      );
      expect(driverWarnings).toHaveLength(1);
    });
  });

  describe('summary', () => {
    it('produces accurate summary counts', async () => {
      mockHostPersons.push(makePerson());
      mockHostRooms.push(makeRoom());

      const changeset = makeChangeset({
        added: {
          persons: [makePerson({ id: 'person-new' as PersonId, name: 'Bob' })],
          assignments: [makeAssignment({ id: 'assign-new' as RoomAssignmentId })],
          transports: [],
        },
        modified: {
          persons: [makePerson({ name: 'Alice Updated' })],
          assignments: [],
          transports: [],
        },
      });

      const result = await computeMerge(changeset);

      expect(result.summary.additions).toBe(2); // 1 person + 1 assignment
      expect(result.summary.autoUpdates).toBeGreaterThanOrEqual(2);
      expect(result.summary.conflicts).toBe(0);
    });
  });
});
