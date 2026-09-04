/**
 * @fileoverview Merge engine — compares a guest changeset against the host's current state.
 * Produces a MergeResult with auto-applicable changes, conflicts, and warnings.
 *
 * Merge strategy:
 * - Added entities: auto-apply unless they reference deleted rooms/persons
 * - Modified entities: compare against host's current version
 *   - If host hasn't changed → auto-apply guest version
 *   - If host has also changed → conflict (requires user resolution)
 * - Host-is-truth: the host holds the authoritative copy
 *
 * @module lib/sharing/merge-engine
 */

import {
  getAssignmentsByTripId,
  getPersonsByTripId,
  getRoomsByTripId,
  getTransportsByTripId,
} from '@/lib/db';
import { getPersonHeadcount } from '@/types';
import type {
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  Transport,
  TransportId,
} from '@/types';
import type {
  AppChangeset,
  EntityCollection,
  MergeConflict,
  MergeResult,
  MergeWarning,
} from '@/lib/sharing/types';

// ============================================================================
// Public API
// ============================================================================

/**
 * Computes the merge result between a guest changeset and the host's current state.
 *
 * @param changeset - The decoded guest changeset
 * @returns MergeResult with auto-apply items, conflicts, and warnings
 */
export async function computeMerge(changeset: AppChangeset): Promise<MergeResult> {
  const tripId = changeset.tripId;

  // Load host's current state
  const [hostPersons, hostAssignments, hostTransports, hostRooms] = await Promise.all([
    getPersonsByTripId(tripId),
    getAssignmentsByTripId(tripId),
    getTransportsByTripId(tripId),
    getRoomsByTripId(tripId),
  ]);

  // Build lookup maps
  const hostPersonMap = new Map(hostPersons.map(p => [p.id, p]));
  const hostAssignmentMap = new Map(hostAssignments.map(a => [a.id, a]));
  const hostTransportMap = new Map(hostTransports.map(t => [t.id, t]));
  const hostRoomMap = new Map(hostRooms.map(r => [r.id, r]));
  const hostRoomIds = new Set(hostRooms.map(r => r.id));

  const incomingRoomIds = collectIncomingRoomIds(changeset);

  const autoApplyPersons: Person[] = [];
  const autoApplyAssignments: RoomAssignment[] = [];
  const autoApplyTransports: Transport[] = [];
  const autoApplyRooms: Room[] = [];
  const conflicts: MergeConflict[] = [];
  const warnings: MergeWarning[] = [];

  // ---- Process ADDED entities ----

  for (const person of changeset.added.persons) {
    if (hostPersonMap.has(person.id)) {
      // Already exists on host — treat as modification
      processPersonModification(person, hostPersonMap, autoApplyPersons);
    } else {
      autoApplyPersons.push(person);
    }
  }

  for (const assignment of changeset.added.assignments) {
    const assignmentWarnings = checkAssignmentRefs(
      assignment,
      hostPersonMap,
      hostRoomIds,
      incomingRoomIds,
    );
    warnings.push(...assignmentWarnings);

    if (hostAssignmentMap.has(assignment.id)) {
      processAssignmentModification(assignment, hostAssignmentMap, autoApplyAssignments, conflicts);
    } else {
      autoApplyAssignments.push(assignment);
    }
  }

  for (const transport of changeset.added.transports) {
    const transportWarnings = checkTransportRefs(transport, hostPersonMap);
    warnings.push(...transportWarnings);

    if (hostTransportMap.has(transport.id)) {
      processTransportModification(transport, hostTransportMap, autoApplyTransports, conflicts);
    } else {
      autoApplyTransports.push(transport);
    }
  }

  for (const room of changeset.added.rooms) {
    if (hostRoomMap.has(room.id)) {
      processRoomModification(room, hostRoomMap, autoApplyRooms);
    } else {
      autoApplyRooms.push(room);
    }
  }

  // ---- Process MODIFIED entities ----

  for (const person of changeset.modified.persons) {
    processPersonModification(person, hostPersonMap, autoApplyPersons);
  }

  for (const assignment of changeset.modified.assignments) {
    const assignmentWarnings = checkAssignmentRefs(
      assignment,
      hostPersonMap,
      hostRoomIds,
      incomingRoomIds,
    );
    warnings.push(...assignmentWarnings);
    processAssignmentModification(assignment, hostAssignmentMap, autoApplyAssignments, conflicts);
  }

  for (const transport of changeset.modified.transports) {
    const transportWarnings = checkTransportRefs(transport, hostPersonMap);
    warnings.push(...transportWarnings);
    processTransportModification(transport, hostTransportMap, autoApplyTransports, conflicts);
  }

  for (const room of changeset.modified.rooms) {
    processRoomModification(room, hostRoomMap, autoApplyRooms);
  }

  const autoApply: EntityCollection = {
    persons: autoApplyPersons,
    assignments: autoApplyAssignments,
    transports: autoApplyTransports,
    rooms: autoApplyRooms,
  };

  return {
    changeset,
    autoApply,
    conflicts,
    warnings,
    summary: {
      additions: changeset.added.persons.length +
        changeset.added.assignments.length +
        changeset.added.transports.length +
        changeset.added.rooms.length,
      autoUpdates:
        autoApplyPersons.length +
        autoApplyAssignments.length +
        autoApplyTransports.length +
        autoApplyRooms.length,
      conflicts: conflicts.length,
      warnings: warnings.length,
    },
  };
}

function collectIncomingRoomIds(changeset: AppChangeset): Set<RoomId> {
  const ids = new Set<RoomId>();
  for (const r of changeset.added.rooms) {
    ids.add(r.id);
  }
  for (const r of changeset.modified.rooms) {
    ids.add(r.id);
  }
  return ids;
}

// ============================================================================
// Modification Processing
// ============================================================================

function processPersonModification(
  guestPerson: Person,
  hostMap: Map<PersonId, Person>,
  autoApply: Person[],
): void {
  const hostPerson = hostMap.get(guestPerson.id);

  if (!hostPerson) {
    // Person was deleted on host — add as new
    autoApply.push(guestPerson);
    return;
  }

  const conflictingFields = getPersonConflictingFields(hostPerson, guestPerson);

  if (conflictingFields.length === 0) {
    // No differences — nothing to do
    return;
  }

  // Always auto-apply guest changes for their own person record
  // since the guest is the authority on their own data
  autoApply.push(guestPerson);
}

function processAssignmentModification(
  guestAssignment: RoomAssignment,
  hostMap: Map<RoomAssignmentId, RoomAssignment>,
  autoApply: RoomAssignment[],
  conflicts: MergeConflict[],
): void {
  const hostAssignment = hostMap.get(guestAssignment.id);

  if (!hostAssignment) {
    // Assignment was deleted on host — add it back from guest
    autoApply.push(guestAssignment);
    return;
  }

  const conflictingFields = getAssignmentConflictingFields(hostAssignment, guestAssignment);

  if (conflictingFields.length === 0) {
    return;
  }

  // For assignments, if both sides changed, it's a conflict
  conflicts.push({
    entityType: 'assignment',
    entityId: guestAssignment.id,
    label: `Room assignment ${guestAssignment.id.slice(0, 6)}...`,
    hostVersion: hostAssignment,
    guestVersion: guestAssignment,
    conflictingFields,
  });
}

function processRoomModification(
  guestRoom: Room,
  hostMap: Map<RoomId, Room>,
  autoApply: Room[],
): void {
  const hostRoom = hostMap.get(guestRoom.id);

  if (!hostRoom) {
    autoApply.push(guestRoom);
    return;
  }

  const conflictingFields = getRoomConflictingFields(hostRoom, guestRoom);

  if (conflictingFields.length === 0) {
    return;
  }

  autoApply.push(guestRoom);
}

function processTransportModification(
  guestTransport: Transport,
  hostMap: Map<TransportId, Transport>,
  autoApply: Transport[],
  conflicts: MergeConflict[],
): void {
  const hostTransport = hostMap.get(guestTransport.id);

  if (!hostTransport) {
    // Transport was deleted on host — add it back from guest
    autoApply.push(guestTransport);
    return;
  }

  const conflictingFields = getTransportConflictingFields(hostTransport, guestTransport);

  if (conflictingFields.length === 0) {
    return;
  }

  // For transports, if both sides changed, it's a conflict
  conflicts.push({
    entityType: 'transport',
    entityId: guestTransport.id,
    label: `${guestTransport.type} transport at ${guestTransport.location}`,
    hostVersion: hostTransport,
    guestVersion: guestTransport,
    conflictingFields,
  });
}

// ============================================================================
// Conflict Field Detection
// ============================================================================

function getPersonConflictingFields(host: Person, guest: Person): string[] {
  const fields: string[] = [];
  if (host.name !== guest.name) fields.push('name');
  if (host.color !== guest.color) fields.push('color');
  if (host.stayStartDate !== guest.stayStartDate) fields.push('stayStartDate');
  if (host.stayEndDate !== guest.stayEndDate) fields.push('stayEndDate');
  if (host.notes !== guest.notes) fields.push('notes');
  if (host.phone !== guest.phone) fields.push('phone');
  if (getPersonHeadcount(host) !== getPersonHeadcount(guest)) fields.push('headcount');
  return fields;
}

function getAssignmentConflictingFields(host: RoomAssignment, guest: RoomAssignment): string[] {
  const fields: string[] = [];
  if (host.roomId !== guest.roomId) fields.push('roomId');
  if (host.personId !== guest.personId) fields.push('personId');
  if (host.startDate !== guest.startDate) fields.push('startDate');
  if (host.endDate !== guest.endDate) fields.push('endDate');
  return fields;
}

function getTransportConflictingFields(host: Transport, guest: Transport): string[] {
  const fields: string[] = [];
  if (host.type !== guest.type) fields.push('type');
  if (host.datetime !== guest.datetime) fields.push('datetime');
  if (host.location !== guest.location) fields.push('location');
  if (host.transportMode !== guest.transportMode) fields.push('transportMode');
  if (host.transportNumber !== guest.transportNumber) fields.push('transportNumber');
  if (host.needsPickup !== guest.needsPickup) fields.push('needsPickup');
  if (host.driverId !== guest.driverId) fields.push('driverId');
  if (host.notes !== guest.notes) fields.push('notes');
  if (JSON.stringify(host.coordinates) !== JSON.stringify(guest.coordinates)) fields.push('coordinates');
  if (host.startLocation !== guest.startLocation) fields.push('startLocation');
  if (JSON.stringify(host.startCoordinates) !== JSON.stringify(guest.startCoordinates)) {
    fields.push('startCoordinates');
  }
  return fields;
}

function getRoomConflictingFields(host: Room, guest: Room): string[] {
  const fields: string[] = [];
  if (host.name !== guest.name) fields.push('name');
  if (host.capacity !== guest.capacity) fields.push('capacity');
  if (host.order !== guest.order) fields.push('order');
  if (host.description !== guest.description) fields.push('description');
  if (host.icon !== guest.icon) fields.push('icon');
  return fields;
}

// ============================================================================
// Reference Validation
// ============================================================================

function checkAssignmentRefs(
  assignment: RoomAssignment,
  hostPersonMap: Map<PersonId, Person>,
  hostRoomIds: Set<RoomId>,
  incomingRoomIds: Set<RoomId>,
): MergeWarning[] {
  const warnings: MergeWarning[] = [];

  if (!hostRoomIds.has(assignment.roomId) && !incomingRoomIds.has(assignment.roomId)) {
    warnings.push({
      type: 'orphaned-room-ref',
      message: `Assignment references room "${assignment.roomId}" which no longer exists`,
      entityType: 'assignment',
      entityId: assignment.id,
    });
  }

  if (!hostPersonMap.has(assignment.personId)) {
    warnings.push({
      type: 'orphaned-person-ref',
      message: `Assignment references person "${assignment.personId}" which no longer exists`,
      entityType: 'assignment',
      entityId: assignment.id,
    });
  }

  return warnings;
}

function checkTransportRefs(
  transport: Transport,
  hostPersonMap: Map<PersonId, Person>,
): MergeWarning[] {
  const warnings: MergeWarning[] = [];

  if (!hostPersonMap.has(transport.personId)) {
    warnings.push({
      type: 'orphaned-person-ref',
      message: `Transport references person "${transport.personId}" which no longer exists`,
      entityType: 'transport',
      entityId: transport.id,
    });
  }

  if (transport.driverId && !hostPersonMap.has(transport.driverId)) {
    warnings.push({
      type: 'orphaned-person-ref',
      message: `Transport references driver "${transport.driverId}" which no longer exists`,
      entityType: 'transport',
      entityId: transport.id,
    });
  }

  return warnings;
}
