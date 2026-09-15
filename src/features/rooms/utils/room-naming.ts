/**
 * @fileoverview Names for rooms that are created several at a time, or copied
 * from an existing one.
 *
 * A gîte with six identical doubles is one name and a count, not six trips
 * through the dialog, so the count decides the names: "Double bed" ×3 becomes
 * "Double bed 1", "Double bed 2", "Double bed 3". A copy joins the same series,
 * which is why duplicating "Double bed 3" gives "Double bed 4" rather than a
 * translated "(copy)" suffix — the number needs no locale and stays sortable.
 *
 * Names are not unique in the database, so nothing here enforces uniqueness. It
 * only avoids handing the user two rooms they cannot tell apart.
 *
 * @module features/rooms/utils/room-naming
 */

import { MAX_LENGTHS } from '@/lib/db/sanitize';

// ============================================================================
// Constants
// ============================================================================

/**
 * A number at the end of a name, with the space that separates it.
 */
const TRAILING_NUMBER = /\s+\d+$/u;

/**
 * The largest number this walks up to before it gives up and reuses a name.
 * A trip cannot hold more rooms than this in any realistic house, and the loop
 * must terminate on input it did not choose.
 */
const MAX_SUFFIX = 10_000;

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Joins a stem and a number, trimming the stem so the result still fits the
 * column. Without the trim, two 100-character names would be truncated to the
 * same stored value and the numbering would be lost.
 */
function withSuffix(stem: string, index: number): string {
  const suffix = ` ${index}`,
   room = MAX_LENGTHS.roomName - suffix.length;

  return `${stem.slice(0, Math.max(0, room)).trimEnd()}${suffix}`;
}

/**
 * Returns the first `${stem} N` that `taken` does not hold, starting at `from`.
 */
function nextFreeName(
  stem: string,
  taken: ReadonlySet<string>,
  from: number,
): string {
  for (let index = from; index < from + MAX_SUFFIX; index++) {
    const candidate = withSuffix(stem, index);
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return withSuffix(stem, from);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Strips a trailing number from a room name, so "Double bed 3" and "Double bed"
 * both number from the same stem.
 *
 * A name that is nothing but a number keeps it: "12" is the room's name, not a
 * numbered variant of an empty one.
 *
 * @param name - The room name to reduce
 * @returns The name without its trailing number
 */
export function roomNameStem(name: string): string {
  const trimmed = name.trim(),
   stem = trimmed.replace(TRAILING_NUMBER, '');

  return stem.length > 0 ? stem : trimmed;
}

/**
 * Names the rooms one save creates.
 *
 * One room keeps the name exactly as it was typed. Several rooms are numbered
 * from the typed name's stem, skipping every number the trip already uses.
 *
 * @param baseName - The name the user typed
 * @param count - How many rooms to name
 * @param existingNames - Names already in the trip
 * @returns One name per room, in creation order
 *
 * @example
 * ```typescript
 * buildBulkRoomNames('Double bed', 3, []);
 * // ['Double bed 1', 'Double bed 2', 'Double bed 3']
 * ```
 */
export function buildBulkRoomNames(
  baseName: string,
  count: number,
  existingNames: Iterable<string>,
): string[] {
  if (count < 1) {
    return [];
  }

  const trimmed = baseName.trim();
  if (count === 1) {
    return [trimmed];
  }

  const taken = new Set(existingNames),
   stem = roomNameStem(trimmed),
   names: string[] = [];

  for (let created = 0; created < count; created++) {
    const name = nextFreeName(stem, taken, 1);
    taken.add(name);
    names.push(name);
  }

  return names;
}

/**
 * Names a copy of an existing room.
 *
 * The copy continues the original's number series, so it reads as one more of
 * the same room rather than a variant of it.
 *
 * @param sourceName - The name of the room being copied
 * @param existingNames - Names already in the trip, the original included
 * @returns The name for the copy
 *
 * @example
 * ```typescript
 * buildDuplicateRoomName('Double bed 1', ['Double bed 1']);
 * // 'Double bed 2'
 * ```
 */
export function buildDuplicateRoomName(
  sourceName: string,
  existingNames: Iterable<string>,
): string {
  return nextFreeName(roomNameStem(sourceName), new Set(existingNames), 2);
}
