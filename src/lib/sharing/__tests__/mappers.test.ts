/**
 * @fileoverview Tests for the protobuf mappers (app <-> proto conversions).
 * @module lib/sharing/__tests__/mappers.test
 */

import { describe, expect, it } from 'vitest';
import {
  personToProto,
  protoToPerson,
  roomToProto,
  protoToRoom,
  assignmentToProto,
  protoToAssignment,
  transportToProto,
  protoToTransport,
  tripSnapshotToProto,
  protoToTripSnapshot,
  entityCollectionToProto,
  protoToEntityCollection,
  changesetToProto,
  protoToChangeset,
} from '@/lib/sharing/mappers';
import type {
  HexColor,
  ISODateString,
  ISODateTimeString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  RoomIcon,
  RoomId,
  Transport,
  TransportId,
  TripId,
} from '@/types';
import type { AppChangeset, EntityCollection, TripSnapshotMeta } from '@/lib/sharing/types';

// ============================================================================
// Test Data
// ============================================================================

const testPerson: Person = {
  id: 'person-1' as PersonId,
  tripId: 'trip-1' as TripId,
  name: 'Alice',
  color: '#3b82f6' as HexColor,
  stayStartDate: '2026-07-15' as ISODateString,
  stayEndDate: '2026-07-20' as ISODateString,
};

const testRoom: Room = {
  id: 'room-1' as RoomId,
  tripId: 'trip-1' as TripId,
  name: 'Master Bedroom',
  capacity: 2,
  order: 0,
  description: 'Main room',
  icon: 'bed-double' as RoomIcon,
};

const testAssignment: RoomAssignment = {
  id: 'assign-1' as RoomAssignmentId,
  tripId: 'trip-1' as TripId,
  roomId: 'room-1' as RoomId,
  personId: 'person-1' as PersonId,
  startDate: '2026-07-15' as ISODateString,
  endDate: '2026-07-20' as ISODateString,
};

const testTransport: Transport = {
  id: 'transport-1' as TransportId,
  tripId: 'trip-1' as TripId,
  personId: 'person-1' as PersonId,
  type: 'arrival',
  datetime: '2026-07-15T14:30:00Z' as ISODateTimeString,
  location: 'Paris CDG',
  needsPickup: true,
  transportMode: 'plane',
  transportNumber: 'AF123',
  notes: 'Terminal 2E',
  driverId: 'person-2' as PersonId,
  coordinates: { lat: 49.0097, lon: 2.5479 },
};

// ============================================================================
// Tests
// ============================================================================

describe('Person mappers', () => {
  it('round-trips a person through proto and back', () => {
    const proto = personToProto(testPerson);
    const result = protoToPerson(proto);
    expect(result).toEqual(testPerson);
  });

  it('handles person without stay dates', () => {
    const person: Person = { ...testPerson, stayStartDate: undefined, stayEndDate: undefined };
    const proto = personToProto(person);
    const result = protoToPerson(proto);
    expect(result.stayStartDate).toBeUndefined();
    expect(result.stayEndDate).toBeUndefined();
  });

  it('round-trips person notes', () => {
    const person: Person = { ...testPerson, notes: 'Vegan, no nuts' };
    const proto = personToProto(person);
    const result = protoToPerson(proto);
    expect(result.notes).toBe('Vegan, no nuts');
  });

  it('round-trips a guest phone number', () => {
    const person: Person = { ...testPerson, phone: '+33 6 12 34 56 78' };
    const proto = personToProto(person);
    const result = protoToPerson(proto);
    expect(result.phone).toBe('+33 6 12 34 56 78');
  });

  it('leaves phone unset for a guest without one', () => {
    const proto = personToProto(testPerson);
    const result = protoToPerson(proto);
    expect(result.phone).toBeUndefined();
  });

  it('bounds a phone that arrives oversized from a scanned changeset', () => {
    // A changeset is read off someone else's screen and passes no form, so the
    // mapper is the last place to clip it before it reaches Dexie.
    const proto = personToProto({ ...testPerson, phone: '9'.repeat(200) });
    const result = protoToPerson(proto);
    expect(result.phone).toBe('9'.repeat(32));
  });

  it('drops a whitespace-only phone rather than storing a blank', () => {
    const proto = personToProto({ ...testPerson, phone: '   ' });
    const result = protoToPerson(proto);
    expect(result.phone).toBeUndefined();
  });

  it('round-trips a multi-person guest headcount', () => {
    const person: Person = { ...testPerson, name: 'Alice+Auré', headcount: 2 };
    const proto = personToProto(person);
    const result = protoToPerson(proto);
    expect(result.headcount).toBe(2);
  });

  it('leaves headcount unset for guests that stand for one person', () => {
    const proto = personToProto(testPerson);
    const result = protoToPerson(proto);
    expect(result.headcount).toBeUndefined();
  });
});

describe('Room mappers', () => {
  it('round-trips a room through proto and back', () => {
    const proto = roomToProto(testRoom);
    const result = protoToRoom(proto);
    expect(result).toEqual(testRoom);
  });

  it('handles room without icon', () => {
    const room: Room = { ...testRoom, icon: undefined };
    const proto = roomToProto(room);
    const result = protoToRoom(proto);
    expect(result.icon).toBeUndefined();
  });

  it('rejects invalid room icons', () => {
    const room: Room = { ...testRoom, icon: 'invalid-icon' as RoomIcon };
    const proto = roomToProto(room);
    const result = protoToRoom(proto);
    expect(result.icon).toBeUndefined();
  });
});

describe('Assignment mappers', () => {
  it('round-trips an assignment through proto and back', () => {
    const proto = assignmentToProto(testAssignment);
    const result = protoToAssignment(proto);
    expect(result).toEqual(testAssignment);
  });
});

describe('Transport mappers', () => {
  it('round-trips a transport through proto and back', () => {
    const proto = transportToProto(testTransport);
    const result = protoToTransport(proto);
    expect(result).toEqual(testTransport);
  });

  it('handles transport without optional fields', () => {
    const transport: Transport = {
      ...testTransport,
      transportMode: undefined,
      transportNumber: undefined,
      notes: undefined,
      driverId: undefined,
      coordinates: undefined,
    };
    const proto = transportToProto(transport);
    const result = protoToTransport(proto);
    expect(result.transportMode).toBeUndefined();
    expect(result.transportNumber).toBeUndefined();
    expect(result.notes).toBeUndefined();
    expect(result.driverId).toBeUndefined();
    expect(result.coordinates).toBeUndefined();
  });

  it('maps departure type correctly', () => {
    const transport: Transport = { ...testTransport, type: 'departure' };
    const proto = transportToProto(transport);
    const result = protoToTransport(proto);
    expect(result.type).toBe('departure');
  });

  it('maps all transport modes', () => {
    const modes = ['train', 'plane', 'car', 'bus', 'other'] as const;
    for (const mode of modes) {
      const transport: Transport = { ...testTransport, transportMode: mode };
      const proto = transportToProto(transport);
      const result = protoToTransport(proto);
      expect(result.transportMode).toBe(mode);
    }
  });

  it('falls back to arrival type for unknown transport type', () => {
    // Cast to bypass TypeScript type restriction - simulates receiving unknown proto value
    const transport: Transport = { ...testTransport, type: 'unknown' as Transport['type'] };
    const proto = transportToProto(transport);
    const result = protoToTransport(proto);
    // Unknown type maps to UNSPECIFIED proto which maps back to 'arrival'
    expect(result.type).toBe('arrival');
  });

  it('falls back to undefined mode for unknown transport mode', () => {
    const transport: Transport = { ...testTransport, transportMode: 'hovercraft' as Transport['transportMode'] };
    const proto = transportToProto(transport);
    const result = protoToTransport(proto);
    // Unknown mode maps to UNSPECIFIED proto which maps back to undefined
    expect(result.transportMode).toBeUndefined();
  });
});

describe('TripSnapshot mappers', () => {
  const snapshot: TripSnapshotMeta = {
    name: 'Summer Trip',
    startDate: '2026-07-15' as ISODateString,
    endDate: '2026-07-20' as ISODateString,
    location: 'Nice',
    description: 'Beach vacation',
    coordinates: { lat: 43.7102, lon: 7.262 },
  };

  it('round-trips a snapshot through proto and back', () => {
    const proto = tripSnapshotToProto(snapshot);
    const result = protoToTripSnapshot(proto);
    expect(result).toEqual(snapshot);
  });

  it('handles snapshot without coordinates', () => {
    const noCoords: TripSnapshotMeta = { ...snapshot, coordinates: undefined };
    const proto = tripSnapshotToProto(noCoords);
    const result = protoToTripSnapshot(proto);
    expect(result.coordinates).toBeUndefined();
  });
});

describe('EntityCollection mappers', () => {
  const collection: EntityCollection = {
    persons: [testPerson],
    assignments: [testAssignment],
    transports: [testTransport],
    rooms: [testRoom],
  };

  it('round-trips an entity collection', () => {
    const proto = entityCollectionToProto(collection);
    const result = protoToEntityCollection(proto);
    expect(result.persons).toHaveLength(1);
    expect(result.assignments).toHaveLength(1);
    expect(result.transports).toHaveLength(1);
    expect(result.rooms).toHaveLength(1);
  });

  it('returns empty collection for undefined proto', () => {
    const result = protoToEntityCollection(undefined);
    expect(result).toEqual({ persons: [], assignments: [], transports: [], rooms: [] });
  });
});

describe('Changeset mappers', () => {
  const changeset: AppChangeset = {
    version: 1,
    tripId: 'trip-1' as TripId,
    shareId: 'share-abc',
    exportedBy: 'person-1' as PersonId,
    exportedAt: Date.now(),
    baseSnapshotAt: Date.now() - 10000,
    added: {
      persons: [testPerson],
      assignments: [testAssignment],
      transports: [testTransport],
      rooms: [testRoom],
    },
    modified: {
      persons: [],
      assignments: [],
      transports: [],
      rooms: [],
    },
    tripSnapshot: {
      name: 'Trip',
      startDate: '2026-07-15' as ISODateString,
      endDate: '2026-07-20' as ISODateString,
      location: 'Nice',
      description: '',
    },
  };

  it('round-trips a changeset through proto and back', () => {
    const proto = changesetToProto(changeset);
    const result = protoToChangeset(proto);
    expect(result.version).toBe(changeset.version);
    expect(result.tripId).toBe(changeset.tripId);
    expect(result.shareId).toBe(changeset.shareId);
    expect(result.exportedBy).toBe(changeset.exportedBy);
    expect(result.exportedAt).toBe(changeset.exportedAt);
    expect(result.added.persons).toHaveLength(1);
    expect(result.added.rooms).toHaveLength(1);
    expect(result.modified.persons).toHaveLength(0);
  });

  it('handles changeset without tripSnapshot', () => {
    const noSnapshot: AppChangeset = { ...changeset, tripSnapshot: undefined };
    const proto = changesetToProto(noSnapshot);
    const result = protoToChangeset(proto);
    expect(result.tripSnapshot).toBeUndefined();
  });
});
