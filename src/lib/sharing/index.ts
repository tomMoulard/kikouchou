/**
 * @fileoverview Sharing system barrel export.
 * Provides QR code-based P2P trip synchronization infrastructure.
 *
 * @module lib/sharing
 */

// Types
export type {
  AppChangeset,
  EntityCollection,
  ImportBaseline,
  EntitySnapshot,
  MergeResult,
  MergeConflict,
  MergeWarning,
  MergeSummary,
  ConflictResolution,
  QRFrame,
  TripSnapshotMeta,
} from './types';

export {
  EMPTY_ENTITY_COLLECTION,
  QR_PAYLOAD_VERSION,
  MAX_QR_BYTES,
  BASELINE_STORAGE_PREFIX,
  getBaselineStorageKey,
} from './types';

// Codec
export {
  encodeChangeset,
  decodeChangeset,
  splitIntoFrames,
  parseFrame,
  reassembleFrames,
} from './codec';

// Mappers
export {
  personToProto,
  assignmentToProto,
  transportToProto,
  roomToProto,
  tripSnapshotToProto,
  changesetToProto,
  protoToPerson,
  protoToAssignment,
  protoToTransport,
  protoToRoom,
  protoToTripSnapshot,
  protoToChangeset,
  entityCollectionToProto,
  protoToEntityCollection,
} from './mappers';

// Export service
export {
  buildChangeset,
  buildHostChangeset,
  createBaselineForGuest,
  saveBaseline,
  loadBaseline,
} from './export-service';

// Merge engine
export { computeMerge } from './merge-engine';

// Merge applicator
export { applyMerge } from './merge-applicator';
export type { ApplyResult } from './merge-applicator';

// Local import (trips list QR)
export {
  IMPORT_SNAPSHOT_REQUIRED,
  ImportChangesetError,
  prepareChangesetForLocalImport,
  buildRoomIdMapByName,
  rewriteChangesetForTargetTrip,
  rewriteChangesetTripId,
} from './import-from-changeset';

// Guest identity (who this browser is on a shared trip)
export {
  GUEST_IDENTITY_STORAGE_PREFIX,
  getGuestIdentityStorageKey,
  readGuestIdentity,
  getTripGuestPersonId,
  writeGuestIdentity,
  clearGuestIdentity,
  type StoredGuestIdentity,
} from './guest-identity';
