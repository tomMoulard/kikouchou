/**
 * @fileoverview Merge applicator — applies a resolved MergeResult to the database.
 * Uses a single Dexie transaction for atomic all-or-nothing commit.
 *
 * @module lib/sharing/merge-applicator
 */

import { db } from '@/lib/db/database';
import type {
  Person,
  RoomAssignment,
  Transport,
} from '@/types';
import type { MergeConflict, MergeResult } from '@/lib/sharing/types';

// ============================================================================
// Public API
// ============================================================================

/**
 * Applies a resolved merge result to the database in a single atomic transaction.
 *
 * For each entity:
 * - If it doesn't exist in the DB → insert (put)
 * - If it exists → update (put overwrites)
 *
 * Conflicts are applied based on their resolution:
 * - 'keep-host' → skip (no change)
 * - 'accept-guest' → apply guest version
 * - 'manual' → should have been resolved before calling this
 *
 * @param mergeResult - The merge result with resolved conflicts
 * @throws Error if any conflict is unresolved or if the transaction fails
 */
export async function applyMerge(mergeResult: MergeResult): Promise<ApplyResult> {
  // Validate all conflicts are resolved
  const unresolvedConflicts = mergeResult.conflicts.filter(c => !c.resolution);
  if (unresolvedConflicts.length > 0) {
    throw new Error(
      `Cannot apply merge: ${unresolvedConflicts.length} unresolved conflict(s)`,
    );
  }

  let personsUpserted = 0;
  let assignmentsUpserted = 0;
  let transportsUpserted = 0;
  let conflictsAccepted = 0;
  let conflictsKept = 0;

  await db.transaction(
    'rw',
    [db.persons, db.roomAssignments, db.transports],
    async () => {
      // Apply auto-apply entities
      for (const person of mergeResult.autoApply.persons) {
        await upsertPerson(person);
        personsUpserted++;
      }

      for (const assignment of mergeResult.autoApply.assignments) {
        await upsertAssignment(assignment);
        assignmentsUpserted++;
      }

      for (const transport of mergeResult.autoApply.transports) {
        await upsertTransport(transport);
        transportsUpserted++;
      }

      // Apply resolved conflicts
      for (const conflict of mergeResult.conflicts) {
        if (conflict.resolution === 'accept-guest') {
          await applyConflictResolution(conflict);
          conflictsAccepted++;
        } else {
          conflictsKept++;
        }
      }
    },
  );

  return {
    personsUpserted,
    assignmentsUpserted,
    transportsUpserted,
    conflictsAccepted,
    conflictsKept,
  };
}

// ============================================================================
// Result Type
// ============================================================================

/**
 * Summary of what was applied during the merge.
 */
export interface ApplyResult {
  readonly personsUpserted: number;
  readonly assignmentsUpserted: number;
  readonly transportsUpserted: number;
  readonly conflictsAccepted: number;
  readonly conflictsKept: number;
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function upsertPerson(person: Person): Promise<void> {
  await db.persons.put(person);
}

async function upsertAssignment(assignment: RoomAssignment): Promise<void> {
  await db.roomAssignments.put(assignment);
}

async function upsertTransport(transport: Transport): Promise<void> {
  await db.transports.put(transport);
}

async function applyConflictResolution(conflict: MergeConflict): Promise<void> {
  switch (conflict.entityType) {
    case 'person':
      await upsertPerson(conflict.guestVersion as Person);
      break;
    case 'assignment':
      await upsertAssignment(conflict.guestVersion as RoomAssignment);
      break;
    case 'transport':
      await upsertTransport(conflict.guestVersion as Transport);
      break;
  }
}
