/**
 * @fileoverview Sharing system types for QR code-based P2P trip synchronization.
 * Defines the merge result types, conflict representations, and resolution options.
 *
 * @module lib/sharing/types
 */

import type {
  ISODateString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  Transport,
  TransportId,
  TripId,
} from '@/types';

// ============================================================================
// Changeset Types
// ============================================================================

/**
 * Trip metadata embedded in a full host export — used to create or match a local trip.
 */
export interface TripSnapshotMeta {
  readonly name: string;
  readonly startDate: ISODateString;
  readonly endDate: ISODateString;
  readonly location?: string;
  readonly description?: string;
  readonly coordinates?: {
    readonly lat: number;
    readonly lon: number;
  };
}

/**
 * Application-level representation of a trip changeset.
 * This is the TypeScript-native version of the protobuf TripChangeset,
 * using branded types instead of raw strings.
 */
export interface AppChangeset {
  /** Schema version (currently 1) */
  readonly version: number;
  /** The trip this changeset applies to */
  readonly tripId: TripId;
  /** The share ID used to import the trip */
  readonly shareId: string;
  /** PersonId of the guest who exported */
  readonly exportedBy: PersonId;
  /** Unix timestamp (ms) when exported */
  readonly exportedAt: number;
  /** Unix timestamp (ms) when the guest originally imported the trip */
  readonly baseSnapshotAt: number;
  /** Entities the guest created */
  readonly added: EntityCollection;
  /** Entities the guest modified (relative to their baseline) */
  readonly modified: EntityCollection;
  /** Set on full host exports — used to import/merge on a device without the same trip id */
  readonly tripSnapshot?: TripSnapshotMeta;
}

/**
 * A collection of entities grouped by type.
 */
export interface EntityCollection {
  readonly persons: readonly Person[];
  readonly assignments: readonly RoomAssignment[];
  readonly transports: readonly Transport[];
  readonly rooms: readonly Room[];
}

/**
 * Empty entity collection constant for convenience.
 */
export const EMPTY_ENTITY_COLLECTION: EntityCollection = {
  persons: [],
  assignments: [],
  transports: [],
  rooms: [],
} as const;

// ============================================================================
// Merge Result Types
// ============================================================================

/**
 * The complete result of merging a changeset with the current host state.
 */
export interface MergeResult {
  /** Changeset metadata */
  readonly changeset: AppChangeset;
  /** Items that can be applied without conflict */
  readonly autoApply: EntityCollection;
  /** Items where both host and guest modified the same entity */
  readonly conflicts: readonly MergeConflict[];
  /** Warnings (e.g., references to deleted rooms) */
  readonly warnings: readonly MergeWarning[];
  /** Summary statistics */
  readonly summary: MergeSummary;
}

/**
 * A conflict where both host and guest modified the same entity.
 */
export interface MergeConflict {
  /** Type of entity in conflict */
  readonly entityType: 'person' | 'assignment' | 'transport';
  /** The entity ID */
  readonly entityId: PersonId | RoomAssignmentId | TransportId;
  /** Display label for the entity (e.g., person name) */
  readonly label: string;
  /** The host's current version */
  readonly hostVersion: Person | RoomAssignment | Transport;
  /** The guest's modified version */
  readonly guestVersion: Person | RoomAssignment | Transport;
  /** Which fields differ between host and guest */
  readonly conflictingFields: readonly string[];
  /** User's resolution choice (set during review) */
  resolution?: ConflictResolution;
}

/**
 * How to resolve a conflict.
 */
export type ConflictResolution = 'keep-host' | 'accept-guest' | 'manual';

/**
 * A warning about potential data integrity issues.
 */
export interface MergeWarning {
  /** Type of warning */
  readonly type: 'orphaned-room-ref' | 'orphaned-person-ref' | 'date-out-of-range';
  /** Human-readable description */
  readonly message: string;
  /** The entity that has the issue */
  readonly entityType: 'person' | 'assignment' | 'transport';
  /** The entity ID with the issue */
  readonly entityId: PersonId | RoomAssignmentId | TransportId;
}

/**
 * Summary statistics for a merge operation.
 */
export interface MergeSummary {
  /** Number of new entities to add */
  readonly additions: number;
  /** Number of entities auto-updated without conflict */
  readonly autoUpdates: number;
  /** Number of conflicts requiring resolution */
  readonly conflicts: number;
  /** Number of warnings */
  readonly warnings: number;
}

// ============================================================================
// Import Baseline Types
// ============================================================================

/**
 * Stored in localStorage when a guest imports a trip via the sharing wizard.
 * Records the state at import time to compute changesets later.
 */
export interface ImportBaseline {
  /** The trip ID that was imported */
  readonly tripId: TripId;
  /** The share ID used */
  readonly shareId: string;
  /** The guest's person ID */
  readonly personId: PersonId;
  /** Unix timestamp (ms) when the import happened */
  readonly importedAt: number;
  /** Snapshot of entities relevant to the guest at import time */
  readonly snapshot: EntitySnapshot;
}

/**
 * A snapshot of entity IDs that existed at import time.
 * Used to determine what was added vs modified.
 */
export interface EntitySnapshot {
  /** Person IDs that existed at import time */
  readonly personIds: readonly string[];
  /** Assignment IDs that existed at import time */
  readonly assignmentIds: readonly string[];
  /** Transport IDs that existed at import time */
  readonly transportIds: readonly string[];
}

// ============================================================================
// QR Code Types
// ============================================================================

/**
 * A frame in a multi-frame QR code sequence.
 */
export interface QRFrame {
  /** Frame index (0-based) */
  readonly index: number;
  /** Total number of frames */
  readonly total: number;
  /** The data payload for this frame */
  readonly data: string;
}

/**
 * Prefix byte for the binary QR payload.
 * Allows future format detection.
 */
export const QR_PAYLOAD_VERSION = 1;

/**
 * Maximum bytes per QR code at error correction level L.
 * Binary mode (8-bit) at version 40 holds 2953 bytes,
 * but we use a conservative limit for reliable scanning.
 */
export const MAX_QR_BYTES = 2200;

/**
 * localStorage key prefix for import baselines.
 */
export const BASELINE_STORAGE_PREFIX = 'kikouchou_import_baseline_';

/**
 * Gets the localStorage key for a trip's import baseline.
 */
export function getBaselineStorageKey(shareId: string): string {
  return `${BASELINE_STORAGE_PREFIX}${shareId}`;
}
