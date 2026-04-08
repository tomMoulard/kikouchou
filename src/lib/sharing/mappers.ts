/**
 * @fileoverview Mappers between application branded types and protobuf generated types.
 * Converts between the app's Person/RoomAssignment/Transport and the proto equivalents.
 *
 * @module lib/sharing/mappers
 */

import { create } from '@bufbuild/protobuf';
import {
  CoordinatesSchema,
  TransportMode as ProtoTransportMode,
  TransportType as ProtoTransportType,
} from '@/gen/changeset_pb';
import type {
  EntityList as ProtoEntityList,
  Person as ProtoPerson,
  RoomAssignment as ProtoRoomAssignment,
  Transport as ProtoTransport,
  TripChangeset as ProtoTripChangeset,
} from '@/gen/changeset_pb';
import {
  EntityListSchema,
  PersonSchema,
  RoomAssignmentSchema,
  TransportSchema,
  TripChangesetSchema,
} from '@/gen/changeset_pb';
import type {
  HexColor,
  ISODateString,
  ISODateTimeString,
  Person,
  PersonId,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  Transport,
  TransportId,
  TripId,
} from '@/types';
import type { TransportMode, TransportType } from '@/types';
import type { AppChangeset, EntityCollection } from '@/lib/sharing/types';

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

  return protoTransport;
}

/**
 * Converts an EntityCollection to a protobuf EntityList.
 */
export function entityCollectionToProto(collection: EntityCollection): ProtoEntityList {
  return create(EntityListSchema, {
    persons: collection.persons.map(personToProto),
    assignments: collection.assignments.map(assignmentToProto),
    transports: collection.transports.map(transportToProto),
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
  });
}

// ============================================================================
// Proto → App Mappers
// ============================================================================

/**
 * Converts a protobuf Person to an app Person.
 */
export function protoToPerson(proto: ProtoPerson): Person {
  return {
    id: proto.id as PersonId,
    tripId: proto.tripId as TripId,
    name: proto.name,
    color: proto.color as HexColor,
    stayStartDate: proto.stayStartDate ? (proto.stayStartDate as ISODateString) : undefined,
    stayEndDate: proto.stayEndDate ? (proto.stayEndDate as ISODateString) : undefined,
  };
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
    transportMode,
    transportNumber: proto.transportNumber ?? undefined,
    driverId: proto.driverId ? (proto.driverId as PersonId) : undefined,
    needsPickup: proto.needsPickup,
    notes: proto.notes ?? undefined,
  };
}

/**
 * Converts a protobuf EntityList to an EntityCollection.
 */
export function protoToEntityCollection(proto: ProtoEntityList | undefined): EntityCollection {
  if (!proto) {
    return { persons: [], assignments: [], transports: [] };
  }
  return {
    persons: proto.persons.map(protoToPerson),
    assignments: proto.assignments.map(protoToAssignment),
    transports: proto.transports.map(protoToTransport),
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
  };
}
