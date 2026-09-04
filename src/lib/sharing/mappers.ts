/**
 * @fileoverview Mappers between application branded types and protobuf generated types.
 * Converts between the app's Person/Room/RoomAssignment/Transport and the proto equivalents.
 *
 * @module lib/sharing/mappers
 */

import { create } from '@bufbuild/protobuf';
import {
  CoordinatesSchema,
  RoomSchema,
  TransportMode as ProtoTransportMode,
  TransportType as ProtoTransportType,
  TripSnapshotSchema,
} from '@/gen/changeset_pb';
import type {
  EntityList as ProtoEntityList,
  Person as ProtoPerson,
  Room as ProtoRoom,
  RoomAssignment as ProtoRoomAssignment,
  Transport as ProtoTransport,
  TripChangeset as ProtoTripChangeset,
  TripSnapshot as ProtoTripSnapshot,
} from '@/gen/changeset_pb';
import {
  EntityListSchema,
  PersonSchema,
  RoomAssignmentSchema,
  TransportSchema,
  TripChangesetSchema,
} from '@/gen/changeset_pb';
import { MAX_LENGTHS, sanitizeOptionalText } from '@/lib/db/sanitize';
import { normalizePersonHeadcount } from '@/types';
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
import type { TransportMode, TransportType } from '@/types';
import type { AppChangeset, EntityCollection, TripSnapshotMeta } from '@/lib/sharing/types';

// ============================================================================
// Room icon validation (proto carries plain strings)
// ============================================================================

const VALID_ROOM_ICONS: ReadonlySet<string> = new Set<RoomIcon>([
  'bed-double',
  'bed-single',
  'bath',
  'sofa',
  'tent',
  'caravan',
  'warehouse',
  'home',
  'door-open',
  'baby',
  'armchair',
]);

function parseRoomIcon(raw: string | undefined): RoomIcon | undefined {
  if (!raw) return undefined;
  return VALID_ROOM_ICONS.has(raw) ? (raw as RoomIcon) : undefined;
}

// ============================================================================
// Transport Type Mapping
// ============================================================================

const TRANSPORT_TYPE_TO_PROTO: Record<TransportType, ProtoTransportType> = {
  arrival: ProtoTransportType.ARRIVAL,
  departure: ProtoTransportType.DEPARTURE,
};

const PROTO_TO_TRANSPORT_TYPE: Record<ProtoTransportType, TransportType | undefined> = {
  [ProtoTransportType.UNSPECIFIED]: undefined,
  [ProtoTransportType.ARRIVAL]: 'arrival',
  [ProtoTransportType.DEPARTURE]: 'departure',
};

// ============================================================================
// Transport Mode Mapping
// ============================================================================

const TRANSPORT_MODE_TO_PROTO: Record<TransportMode, ProtoTransportMode> = {
  train: ProtoTransportMode.TRAIN,
  plane: ProtoTransportMode.PLANE,
  car: ProtoTransportMode.CAR,
  bus: ProtoTransportMode.BUS,
  other: ProtoTransportMode.OTHER,
};

const PROTO_TO_TRANSPORT_MODE: Record<ProtoTransportMode, TransportMode | undefined> = {
  [ProtoTransportMode.UNSPECIFIED]: undefined,
  [ProtoTransportMode.TRAIN]: 'train',
  [ProtoTransportMode.PLANE]: 'plane',
  [ProtoTransportMode.CAR]: 'car',
  [ProtoTransportMode.BUS]: 'bus',
  [ProtoTransportMode.OTHER]: 'other',
};

// ============================================================================
// App → Proto Mappers
// ============================================================================

/**
 * Converts an app Person to a protobuf Person message.
 */
export function personToProto(person: Person): ProtoPerson {
  return create(PersonSchema, {
    id: person.id,
    tripId: person.tripId,
    name: person.name,
    color: person.color,
    stayStartDate: person.stayStartDate ?? undefined,
    stayEndDate: person.stayEndDate ?? undefined,
    notes: person.notes ?? undefined,
    phone: person.phone ?? undefined,
    headcount: person.headcount ?? undefined,
  });
}

/**
 * Converts an app RoomAssignment to a protobuf RoomAssignment message.
 */
export function assignmentToProto(assignment: RoomAssignment): ProtoRoomAssignment {
  return create(RoomAssignmentSchema, {
    id: assignment.id,
    tripId: assignment.tripId,
    roomId: assignment.roomId,
    personId: assignment.personId,
    startDate: assignment.startDate,
    endDate: assignment.endDate,
  });
}

/**
 * Converts an app Transport to a protobuf Transport message.
 */
export function transportToProto(transport: Transport): ProtoTransport {
  const protoTransport = create(TransportSchema, {
    id: transport.id,
    tripId: transport.tripId,
    personId: transport.personId,
    type: TRANSPORT_TYPE_TO_PROTO[transport.type] ?? ProtoTransportType.UNSPECIFIED,
    datetime: transport.datetime,
    location: transport.location,
    needsPickup: transport.needsPickup,
    notes: transport.notes ?? undefined,
    transportNumber: transport.transportNumber ?? undefined,
    driverId: transport.driverId ?? undefined,
  });

  if (transport.transportMode) {
    protoTransport.transportMode = TRANSPORT_MODE_TO_PROTO[transport.transportMode] ?? ProtoTransportMode.UNSPECIFIED;
  }

  if (transport.coordinates) {
    protoTransport.coordinates = create(CoordinatesSchema, {
      lat: transport.coordinates.lat,
      lon: transport.coordinates.lon,
    });
  }

  if (transport.startLocation) {
    protoTransport.startLocation = transport.startLocation;
  }
  if (transport.startCoordinates) {
    protoTransport.startCoordinates = create(CoordinatesSchema, {
      lat: transport.startCoordinates.lat,
      lon: transport.startCoordinates.lon,
    });
  }

  return protoTransport;
}

/**
 * Converts an app Room to a protobuf Room message.
 */
export function roomToProto(room: Room): ProtoRoom {
  return create(RoomSchema, {
    id: room.id,
    tripId: room.tripId,
    name: room.name,
    capacity: room.capacity,
    order: room.order,
    description: room.description,
    icon: room.icon,
  });
}

/**
 * Converts trip snapshot metadata to protobuf.
 */
export function tripSnapshotToProto(meta: TripSnapshotMeta): ProtoTripSnapshot {
  return create(TripSnapshotSchema, {
    name: meta.name,
    startDate: meta.startDate,
    endDate: meta.endDate,
    location: meta.location,
    description: meta.description,
    coordLat: meta.coordinates?.lat,
    coordLon: meta.coordinates?.lon,
  });
}

/**
 * Converts an EntityCollection to a protobuf EntityList.
 */
export function entityCollectionToProto(collection: EntityCollection): ProtoEntityList {
  return create(EntityListSchema, {
    persons: collection.persons.map(personToProto),
    assignments: collection.assignments.map(assignmentToProto),
    transports: collection.transports.map(transportToProto),
    rooms: collection.rooms.map(roomToProto),
  });
}

/**
 * Converts an AppChangeset to a protobuf TripChangeset.
 */
export function changesetToProto(changeset: AppChangeset): ProtoTripChangeset {
  return create(TripChangesetSchema, {
    version: changeset.version,
    tripId: changeset.tripId,
    shareId: changeset.shareId,
    exportedBy: changeset.exportedBy,
    exportedAt: BigInt(changeset.exportedAt),
    baseSnapshotAt: BigInt(changeset.baseSnapshotAt),
    added: entityCollectionToProto(changeset.added),
    modified: entityCollectionToProto(changeset.modified),
    tripSnapshot: changeset.tripSnapshot
      ? tripSnapshotToProto(changeset.tripSnapshot)
      : undefined,
  });
}

// ============================================================================
// Proto → App Mappers
// ============================================================================

/**
 * Converts a protobuf Person to an app Person.
 */
export function protoToPerson(proto: ProtoPerson): Person {
  const person: Person = {
    id: proto.id as PersonId,
    tripId: proto.tripId as TripId,
    name: proto.name,
    color: proto.color as HexColor,
    stayStartDate: proto.stayStartDate ? (proto.stayStartDate as ISODateString) : undefined,
    stayEndDate: proto.stayEndDate ? (proto.stayEndDate as ISODateString) : undefined,
  };
  if (proto.notes) {
    person.notes = proto.notes;
  }
  // Bounded here rather than trusted: a changeset is scanned off someone else's
  // screen, and nothing upstream of this point clips the string.
  const phone = sanitizeOptionalText(proto.phone, MAX_LENGTHS.personPhone);
  if (phone !== undefined) {
    person.phone = phone;
  }
  if (proto.headcount) {
    person.headcount = normalizePersonHeadcount(proto.headcount);
  }
  return person;
}

/**
 * Converts a protobuf RoomAssignment to an app RoomAssignment.
 */
export function protoToAssignment(proto: ProtoRoomAssignment): RoomAssignment {
  return {
    id: proto.id as RoomAssignmentId,
    tripId: proto.tripId as TripId,
    roomId: proto.roomId as RoomId,
    personId: proto.personId as PersonId,
    startDate: proto.startDate as ISODateString,
    endDate: proto.endDate as ISODateString,
  };
}

/**
 * Converts a protobuf Transport to an app Transport.
 */
export function protoToTransport(proto: ProtoTransport): Transport {
  const transportType = PROTO_TO_TRANSPORT_TYPE[proto.type];
  const transportMode = proto.transportMode !== undefined
    ? PROTO_TO_TRANSPORT_MODE[proto.transportMode]
    : undefined;

  return {
    id: proto.id as TransportId,
    tripId: proto.tripId as TripId,
    personId: proto.personId as PersonId,
    type: transportType ?? 'arrival',
    datetime: proto.datetime as ISODateTimeString,
    location: proto.location,
    coordinates: proto.coordinates
      ? { lat: proto.coordinates.lat, lon: proto.coordinates.lon }
      : undefined,
    startLocation: proto.startLocation ?? undefined,
    startCoordinates: proto.startCoordinates
      ? { lat: proto.startCoordinates.lat, lon: proto.startCoordinates.lon }
      : undefined,
    transportMode,
    transportNumber: proto.transportNumber ?? undefined,
    driverId: proto.driverId ? (proto.driverId as PersonId) : undefined,
    needsPickup: proto.needsPickup,
    notes: proto.notes ?? undefined,
  };
}

/**
 * Converts a protobuf Room to an app Room.
 */
export function protoToRoom(proto: ProtoRoom): Room {
  return {
    id: proto.id as RoomId,
    tripId: proto.tripId as TripId,
    name: proto.name,
    capacity: proto.capacity,
    order: proto.order,
    description: proto.description,
    icon: parseRoomIcon(proto.icon),
  };
}

/**
 * Converts a protobuf TripSnapshot to app metadata.
 */
export function protoToTripSnapshot(proto: ProtoTripSnapshot): TripSnapshotMeta {
  return {
    name: proto.name,
    startDate: proto.startDate as ISODateString,
    endDate: proto.endDate as ISODateString,
    location: proto.location,
    description: proto.description,
    coordinates:
      proto.coordLat !== undefined && proto.coordLon !== undefined
        ? { lat: proto.coordLat, lon: proto.coordLon }
        : undefined,
  };
}

/**
 * Converts a protobuf EntityList to an EntityCollection.
 */
export function protoToEntityCollection(proto: ProtoEntityList | undefined): EntityCollection {
  if (!proto) {
    return { persons: [], assignments: [], transports: [], rooms: [] };
  }
  return {
    persons: proto.persons.map(protoToPerson),
    assignments: proto.assignments.map(protoToAssignment),
    transports: proto.transports.map(protoToTransport),
    rooms: proto.rooms.map(protoToRoom),
  };
}

/**
 * Converts a protobuf TripChangeset to an AppChangeset.
 */
export function protoToChangeset(proto: ProtoTripChangeset): AppChangeset {
  return {
    version: proto.version,
    tripId: proto.tripId as TripId,
    shareId: proto.shareId,
    exportedBy: proto.exportedBy as PersonId,
    exportedAt: Number(proto.exportedAt),
    baseSnapshotAt: Number(proto.baseSnapshotAt),
    added: protoToEntityCollection(proto.added),
    modified: protoToEntityCollection(proto.modified),
    tripSnapshot: proto.tripSnapshot ? protoToTripSnapshot(proto.tripSnapshot) : undefined,
  };
}
