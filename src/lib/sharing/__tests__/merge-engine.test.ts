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
  Ride,
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
const mockHostRides: Ride[] = [];

vi.mock('@/lib/db', () => ({
  getPersonsByTripId: vi.fn(async () => mockHostPersons),
  getAssignmentsByTripId: vi.fn(async () => mockHostAssignments),
  getTransportsByTripId: vi.fn(async () => mockHostTransports),
  getRoomsByTripId: vi.fn(async () => mockHostRooms),
  // Rides do not travel in a changeset, but the host's own decide whether an
  // incoming `rideId` still resolves — "the host put you in this car" against
  // "that car is gone".
  getRidesByTripId: vi.fn(async () => mockHostRides),
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
    added: { persons: [], assignments: [], transports: [], rooms: [] },
    modified: { persons: [], assignments: [], transports: [], rooms: [] },
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
        added: { persons: [newPerson], assignments: [], transports: [], rooms: [] },
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
        added: { persons: [], assignments: [newAssignment], transports: [], rooms: [] },
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
        added: { persons: [], assignments: [], transports: [newTransport], rooms: [] },
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
        modified: { persons: [guestPerson], assignments: [], transports: [], rooms: [] },
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
        modified: { persons: [{ ...person }], assignments: [], transports: [], rooms: [] },
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
        modified: { persons: [], assignments: [guestAssignment], transports: [], rooms: [] },
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
        modified: { persons: [], assignments: [], transports: [guestTransport], rooms: [] },
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
        added: { persons: [], assignments: [assignment], transports: [], rooms: [] },
      });

      const result = await computeMerge(changeset);

      const roomWarnings = result.warnings.filter(w => w.type === 'orphaned-room-ref');
      expect(roomWarnings).toHaveLength(1);
    });

    it('warns when transport references a deleted person', async () => {
      // No persons on host → person-1 is orphaned

      const transport = makeTransport();
      const changeset = makeChangeset({
        added: { persons: [], assignments: [], transports: [transport], rooms: [] },
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
        added: { persons: [], assignments: [], transports: [transport], rooms: [] },
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
          rooms: [],
        },
        modified: {
          persons: [makePerson({ name: 'Alice Updated' })],
          assignments: [],
          transports: [],
          rooms: [],
        },
      });

      const result = await computeMerge(changeset);

      expect(result.summary.additions).toBe(2); // 1 person + 1 assignment
      expect(result.summary.autoUpdates).toBeGreaterThanOrEqual(2);
      expect(result.summary.conflicts).toBe(0);
    });
  });

  // ---- Room additions and modifications ----

  describe('additions — rooms', () => {
    it('auto-applies a new room not present on host', async () => {
      const newRoom = makeRoom({ id: 'room-new' as RoomId, name: 'Penthouse' });
      const changeset = makeChangeset({
        added: { persons: [], assignments: [], transports: [], rooms: [newRoom] },
      });

      const result = await computeMerge(changeset);

      expect(result.autoApply.rooms).toHaveLength(1);
      expect(result.autoApply.rooms[0]?.name).toBe('Penthouse');
      expect(result.conflicts).toHaveLength(0);
    });

    it('treats added room that already exists as modification', async () => {
      const hostRoom = makeRoom({ name: 'Room 1', capacity: 2 });
      mockHostRooms.push(hostRoom);

      // Guest adds a room with the same id but different capacity
      const guestRoom = makeRoom({ name: 'Room 1', capacity: 4 });
      const changeset = makeChangeset({
        added: { persons: [], assignments: [], transports: [], rooms: [guestRoom] },
      });

      const result = await computeMerge(changeset);

      // Room modifications are always auto-applied (no conflict)
      expect(result.autoApply.rooms).toHaveLength(1);
      expect(result.autoApply.rooms[0]?.capacity).toBe(4);
    });

    it('skips room modification when no fields changed', async () => {
      const hostRoom = makeRoom();
      mockHostRooms.push(hostRoom);

      // Identical room as "added"
      const changeset = makeChangeset({
        added: { persons: [], assignments: [], transports: [], rooms: [{ ...hostRoom }] },
      });

      const result = await computeMerge(changeset);

      expect(result.autoApply.rooms).toHaveLength(0);
    });

    it('includes room additions in summary count', async () => {
      const newRoom = makeRoom({ id: 'room-new' as RoomId, name: 'Attic' });
      const changeset = makeChangeset({
        added: { persons: [], assignments: [], transports: [], rooms: [newRoom] },
      });

      const result = await computeMerge(changeset);

      expect(result.summary.additions).toBe(1);
    });
  });

  describe('modifications — rooms', () => {
    it('auto-applies guest room changes when host room exists', async () => {
      const hostRoom = makeRoom({ name: 'Room 1', capacity: 2 });
      mockHostRooms.push(hostRoom);

      const guestRoom = makeRoom({ name: 'Master Suite', capacity: 3 });
      const changeset = makeChangeset({
        modified: { persons: [], assignments: [], transports: [], rooms: [guestRoom] },
      });

      const result = await computeMerge(changeset);

      expect(result.autoApply.rooms).toHaveLength(1);
      expect(result.autoApply.rooms[0]?.name).toBe('Master Suite');
      expect(result.autoApply.rooms[0]?.capacity).toBe(3);
      // Rooms do not generate conflicts
      expect(result.conflicts).toHaveLength(0);
    });

    it('auto-applies room as new when host room was deleted', async () => {
      // No rooms on host
      const guestRoom = makeRoom({ name: 'Deleted Room' });
      const changeset = makeChangeset({
        modified: { persons: [], assignments: [], transports: [], rooms: [guestRoom] },
      });

      const result = await computeMerge(changeset);

      // Room was deleted on host, guest wants to modify → added back
      expect(result.autoApply.rooms).toHaveLength(1);
      expect(result.autoApply.rooms[0]?.name).toBe('Deleted Room');
    });

    it('does nothing when modified room has no differences', async () => {
      const hostRoom = makeRoom();
      mockHostRooms.push(hostRoom);

      const changeset = makeChangeset({
        modified: { persons: [], assignments: [], transports: [], rooms: [{ ...hostRoom }] },
      });

      const result = await computeMerge(changeset);

      expect(result.autoApply.rooms).toHaveLength(0);
    });

    it('detects conflicting room fields: description, icon, order', async () => {
      const hostRoom = makeRoom({ description: 'Old', icon: 'bed-double', order: 1 });
      mockHostRooms.push(hostRoom);

      const guestRoom = makeRoom({ description: 'New', icon: 'bed-single', order: 2 });
      const changeset = makeChangeset({
        modified: { persons: [], assignments: [], transports: [], rooms: [guestRoom] },
      });

      const result = await computeMerge(changeset);

      // Rooms auto-apply even with differences (no conflict for rooms)
      expect(result.autoApply.rooms).toHaveLength(1);
      expect(result.conflicts).toHaveLength(0);
    });
  });

  describe('no assignment orphan warning when incoming room exists', () => {
    it('does not warn when assignment room is in incoming added rooms', async () => {
      mockHostPersons.push(makePerson());
      // Room not on host, but included in changeset added rooms
      const newRoom = makeRoom({ id: 'room-new' as RoomId });
      const assignment = makeAssignment({ roomId: 'room-new' as RoomId });
      const changeset = makeChangeset({
        added: {
          persons: [],
          assignments: [assignment],
          transports: [],
          rooms: [newRoom],
        },
      });

      const result = await computeMerge(changeset);

      const orphanWarnings = result.warnings.filter(w => w.type === 'orphaned-room-ref');
      expect(orphanWarnings).toHaveLength(0);
    });
  });

  describe('added entity already exists — treated as modification', () => {
    it('creates conflict when added assignment already exists on host and differs', async () => {
      const hostAssignment = makeAssignment({ roomId: 'room-1' as RoomId });
      mockHostAssignments.push(hostAssignment);
      mockHostPersons.push(makePerson());
      mockHostRooms.push(makeRoom());

      // Same id but different room
      const guestAssignment = makeAssignment({ roomId: 'room-2' as RoomId });
      const changeset = makeChangeset({
        added: { persons: [], assignments: [guestAssignment], transports: [], rooms: [] },
      });

      const result = await computeMerge(changeset);

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]?.entityType).toBe('assignment');
    });

    it('creates conflict when added transport already exists on host and differs', async () => {
      const hostTransport = makeTransport({ location: 'Paris' });
      mockHostTransports.push(hostTransport);
      mockHostPersons.push(makePerson());

      const guestTransport = makeTransport({ location: 'Lyon' });
      const changeset = makeChangeset({
        added: { persons: [], assignments: [], transports: [guestTransport], rooms: [] },
      });

      const result = await computeMerge(changeset);

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]?.entityType).toBe('transport');
    });
  });

  describe('modification with deleted host entity', () => {
    it('re-adds person when host deleted it', async () => {
      // Person not on host
      const guestPerson = makePerson({ name: 'Ghost' });
      const changeset = makeChangeset({
        modified: { persons: [guestPerson], assignments: [], transports: [], rooms: [] },
      });

      const result = await computeMerge(changeset);

      expect(result.autoApply.persons).toHaveLength(1);
      expect(result.autoApply.persons[0]?.name).toBe('Ghost');
    });

    it('re-adds assignment when host deleted it', async () => {
      // Assignment not on host
      mockHostPersons.push(makePerson());
      mockHostRooms.push(makeRoom());

      const guestAssignment = makeAssignment();
      const changeset = makeChangeset({
        modified: { persons: [], assignments: [guestAssignment], transports: [], rooms: [] },
      });

      const result = await computeMerge(changeset);

      expect(result.autoApply.assignments).toHaveLength(1);
    });

    it('re-adds transport when host deleted it', async () => {
      mockHostPersons.push(makePerson());

      const guestTransport = makeTransport();
      const changeset = makeChangeset({
        modified: { persons: [], assignments: [], transports: [guestTransport], rooms: [] },
      });

      const result = await computeMerge(changeset);

      expect(result.autoApply.transports).toHaveLength(1);
    });
  });

  // ============================================================================
  // Additional branch coverage
  // ============================================================================

  describe('additional branch coverage', () => {
    it('treats added person that already exists on host as modification', async () => {
      const hostPerson = makePerson({ name: 'Alice' });
      mockHostPersons.push(hostPerson);

      const guestPerson = makePerson({ name: 'Alice Updated' });
      const changeset = makeChangeset({
        added: { persons: [guestPerson], assignments: [], transports: [], rooms: [] },
      });

      const result = await computeMerge(changeset);

      // Should be treated as modification since person already exists on host
      expect(result.autoApply.persons).toHaveLength(1);
      expect(result.autoApply.persons[0]!.name).toBe('Alice Updated');
    });

    it('does nothing when modified assignment is identical to host', async () => {
      const hostAssignment = makeAssignment();
      mockHostAssignments.push(hostAssignment);
      mockHostPersons.push(makePerson());
      mockHostRooms.push(makeRoom());

      // Same assignment with no changes
      const changeset = makeChangeset({
        modified: { persons: [], assignments: [{ ...hostAssignment }], transports: [], rooms: [] },
      });

      const result = await computeMerge(changeset);

      expect(result.autoApply.assignments).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
    });

    it('does nothing when modified transport is identical to host', async () => {
      const hostTransport = makeTransport();
      mockHostTransports.push(hostTransport);
      mockHostPersons.push(makePerson());

      // Same transport with no changes
      const changeset = makeChangeset({
        modified: { persons: [], assignments: [], transports: [{ ...hostTransport }], rooms: [] },
      });

      const result = await computeMerge(changeset);

      expect(result.autoApply.transports).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
    });

    it('warns when assignment references a person not on host', async () => {
      mockHostRooms.push(makeRoom());
      // No host persons - person-1 is missing

      const assignment = makeAssignment();
      const changeset = makeChangeset({
        added: { persons: [], assignments: [assignment], transports: [], rooms: [] },
      });

      const result = await computeMerge(changeset);

      const personWarning = result.warnings.find(
        (w) => w.type === 'orphaned-person-ref' && w.entityType === 'assignment',
      );
      expect(personWarning).toBeDefined();
    });
  });
});
