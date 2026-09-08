/**
 * Guest Group Repository
 *
 * CRUD for the one entity that is not trip-scoped, plus the two operations that
 * connect it to a trip: importing members as guests, and turning a trip's guests
 * back into a reusable group.
 *
 * Importing is a **copy**. A member becomes an ordinary `Person` with a fresh
 * `PersonId` and no reference back to the group, which is what lets an imported
 * guest sync to co-travellers, export to a QR changeset and be edited in the
 * trip without anything having to resolve a group those devices do not have.
 *
 * @module lib/db/repositories/guest-group-repository
 */

import { db } from '@/lib/db/database';
import { sanitizeGuestGroupData } from '@/lib/db/sanitize';
import {
  createGuestGroupId,
  createGuestGroupMemberId,
  createPersonId,
  createTimestamps,
  updateTimestamp,
} from '@/lib/db/utils';
import type {
  GuestGroup,
  GuestGroupFormData,
  GuestGroupId,
  GuestGroupMember,
  GuestGroupMemberFormData,
  GuestGroupMemberId,
  Person,
  TripId,
} from '@/types';
import { getPersonHeadcount } from '@/types';

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Gives each member form entry an id, preserving the order the user arranged.
 *
 * Ids are minted here rather than in the form so that a member being edited
 * keeps whichever id it already had — the import dialog's checkbox selection is
 * keyed on it, and re-minting on every save would clear a selection the user
 * made a moment earlier.
 *
 * @param members - Member form data, in display order
 * @param existing - Members already stored, matched positionally to keep ids
 * @returns Members with stable ids
 */
function withMemberIds(
  members: readonly GuestGroupMemberFormData[],
  existing: readonly GuestGroupMember[] = [],
): GuestGroupMember[] {
  return members.map((member, index) => ({
    ...member,
    id: existing[index]?.id ?? createGuestGroupMemberId(),
  }));
}

// ============================================================================
// CRUD
// ============================================================================

/**
 * Creates a new guest group.
 *
 * @param data - The group form data (name, members)
 * @returns The created GuestGroup
 *
 * @example
 * ```typescript
 * const group = await createGuestGroup({
 *   name: 'Family',
 *   members: [{ name: 'Tom + Léa', color: '#ef4444' as HexColor, headcount: 2 }],
 * });
 * ```
 */
export async function createGuestGroup(
  data: GuestGroupFormData,
): Promise<GuestGroup> {
  const sanitized = sanitizeGuestGroupData(data);

  try {
    const group: GuestGroup = {
      id: createGuestGroupId(),
      name: sanitized.name,
      members: withMemberIds(sanitized.members),
      ...createTimestamps(),
    };

    await db.guestGroups.add(group);
    return group;
  } catch (error) {
    throw new Error(`Failed to create guest group "${sanitized.name}"`, {
      cause: error,
    });
  }
}

/**
 * Retrieves every guest group, ordered by name.
 *
 * @returns All groups, sorted by name ascending
 *
 * @example
 * ```typescript
 * const groups = await getAllGuestGroups();
 * ```
 */
export async function getAllGuestGroups(): Promise<GuestGroup[]> {
  return db.guestGroups.orderBy('name').toArray();
}

/**
 * Retrieves a guest group by its unique ID.
 *
 * @param id - The group's unique identifier
 * @returns The group if found, undefined otherwise
 */
export async function getGuestGroupById(
  id: GuestGroupId,
): Promise<GuestGroup | undefined> {
  return db.guestGroups.get(id);
}

/**
 * Updates a guest group.
 *
 * Members are replaced wholesale rather than patched: the form edits the list as
 * one value (rows are added, removed and reordered together), so a partial
 * member update has no caller and would only invite a half-applied list.
 *
 * @param id - The group's unique identifier
 * @param data - The new name and member list
 * @throws {Error} If the group does not exist
 *
 * @example
 * ```typescript
 * await updateGuestGroup(groupId, { name: 'Family', members });
 * ```
 */
export async function updateGuestGroup(
  id: GuestGroupId,
  data: GuestGroupFormData,
): Promise<void> {
  const sanitized = sanitizeGuestGroupData(data);

  await db.transaction('rw', db.guestGroups, async () => {
    const existing = await db.guestGroups.get(id);

    if (!existing) {
      throw new Error(`Guest group with id "${id}" not found`);
    }

    await db.guestGroups.update(id, {
      name: sanitized.name,
      members: withMemberIds(sanitized.members, existing.members),
      ...updateTimestamp(),
    });
  });
}

/**
 * Deletes a guest group.
 *
 * Guests already imported from it are left alone — they are ordinary guests of
 * their trip and have been since the moment they were created.
 *
 * @param id - The group's unique identifier
 */
export async function deleteGuestGroup(id: GuestGroupId): Promise<void> {
  await db.guestGroups.delete(id);
}

// ============================================================================
// Trip Integration
// ============================================================================

/**
 * What an import did.
 *
 * `skippedMemberIds` is reported rather than swallowed: a member id that is not
 * in the group is the shape a stale dialog produces — the group was edited in
 * another tab between opening the selector and confirming it — and silently
 * importing fewer people than the user ticked is worse than saying so.
 */
export interface ImportGuestGroupResult {
  /** The guests created, in member order */
  readonly persons: readonly Person[];
  /** Requested member ids that the group no longer holds */
  readonly skippedMemberIds: readonly GuestGroupMemberId[];
}

/**
 * Imports members of a group into a trip as new guests.
 *
 * Every selected member becomes a `Person` carrying the member's name, colour,
 * headcount, notes, phone and child seat. Stay dates are deliberately not part
 * of a member: they belong to a trip, not to a person, so an imported guest
 * starts with none and the calendar treats them as present for the whole trip
 * until told otherwise.
 *
 * @param tripId - The trip receiving the guests
 * @param groupId - The group to import from
 * @param memberIds - Which members to import; all of them when omitted
 * @returns The created guests, and any requested member the group no longer has
 * @throws {Error} If the group does not exist
 *
 * @example
 * ```typescript
 * const { persons } = await importGuestGroupMembers(tripId, groupId, [aliceId]);
 * ```
 */
export async function importGuestGroupMembers(
  tripId: TripId,
  groupId: GuestGroupId,
  memberIds?: readonly GuestGroupMemberId[],
): Promise<ImportGuestGroupResult> {
  return db.transaction('rw', [db.guestGroups, db.persons], async () => {
    const group = await db.guestGroups.get(groupId);

    if (!group) {
      throw new Error(`Guest group with id "${groupId}" not found`);
    }

    const byId = new Map(group.members.map((member) => [member.id, member])),
      requested = memberIds ?? group.members.map((member) => member.id),
      skippedMemberIds: GuestGroupMemberId[] = [],
      persons: Person[] = [];

    for (const memberId of requested) {
      const member = byId.get(memberId);

      if (!member) {
        skippedMemberIds.push(memberId);
        continue;
      }

      persons.push({
        id: createPersonId(),
        tripId,
        name: member.name,
        color: member.color,
        // Only carry a headcount that means something. Writing 1 explicitly
        // would make every imported guest differ from a hand-typed one on a
        // field that reads the same, and `getPersonHeadcount` already answers 1
        // for the absent case.
        ...(getPersonHeadcount(member) > 1 ? { headcount: member.headcount } : {}),
        ...(member.notes ? { notes: member.notes } : {}),
        ...(member.phone ? { phone: member.phone } : {}),
        // Which seat a child needs outlives any one holiday, so it travels with
        // the member. Without it the family roster gives back an adult-shaped
        // guest every summer and the ride's seat tally quietly reads zero.
        ...(member.childSeat ? { childSeat: member.childSeat } : {}),
      });
    }

    if (persons.length > 0) {
      await db.persons.bulkAdd(persons);
    }

    return { persons, skippedMemberIds };
  });
}

/**
 * Creates a group from guests that already exist on a trip.
 *
 * The fastest way to a first group: the family is usually already typed into
 * this year's trip. Each guest contributes its name, colour, headcount, notes,
 * phone and child seat; nothing trip-specific (stay dates, rooms, transports)
 * comes along.
 *
 * @param name - Name for the new group
 * @param persons - The guests to capture
 * @returns The created group
 *
 * @example
 * ```typescript
 * const group = await createGuestGroupFromPersons('Family', selectedGuests);
 * ```
 */
export async function createGuestGroupFromPersons(
  name: string,
  persons: readonly Person[],
): Promise<GuestGroup> {
  return createGuestGroup({
    name,
    members: persons.map((person) => ({
      name: person.name,
      color: person.color,
      ...(getPersonHeadcount(person) > 1 ? { headcount: person.headcount } : {}),
      ...(person.notes ? { notes: person.notes } : {}),
      ...(person.phone ? { phone: person.phone } : {}),
      ...(person.childSeat ? { childSeat: person.childSeat } : {}),
    })),
  });
}
