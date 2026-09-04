/**
 * @fileoverview Reads and writes the account's guest groups.
 *
 * Groups get a hook rather than a context, unlike every trip-scoped entity.
 * The reason is scope: a context exists so a whole subtree can share one
 * subscription to the *current trip's* rows, and groups have no current
 * anything — three screens read them, none of them nested inside another, and
 * `useLiveQuery` already de-duplicates the underlying Dexie subscription.
 *
 * Every mutation asks the sync layer to push afterwards. That call is a no-op
 * when signed out, which is why it can sit unconditionally at the end of each
 * write rather than behind a check at every call site.
 *
 * @module features/guest-groups/hooks/useGuestGroups
 */

import { useCallback, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import {
  createGuestGroup as createGuestGroupRecord,
  createGuestGroupFromPersons as createGuestGroupFromPersonsRecord,
  deleteGuestGroup as deleteGuestGroupRecord,
  getAllGuestGroups,
  importGuestGroupMembers as importGuestGroupMembersRecord,
  updateGuestGroup as updateGuestGroupRecord,
  type ImportGuestGroupResult,
} from '@/lib/db/repositories/guest-group-repository';
import { useGuestGroupSync } from '@/lib/sync/GuestGroupSync';
import type {
  GuestGroup,
  GuestGroupFormData,
  GuestGroupId,
  GuestGroupMemberId,
  Person,
  TripId,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export interface UseGuestGroupsResult {
  /** Every group, ordered by name. Empty while the first read is in flight. */
  readonly groups: readonly GuestGroup[];
  /** Whether the first read has not come back yet. */
  readonly isLoading: boolean;
  /** Creates a group and pushes it. */
  readonly createGroup: (data: GuestGroupFormData) => Promise<GuestGroup>;
  /** Replaces a group's name and members, then pushes. */
  readonly updateGroup: (id: GuestGroupId, data: GuestGroupFormData) => Promise<void>;
  /** Deletes a group, then pushes so other devices drop it too. */
  readonly deleteGroup: (id: GuestGroupId) => Promise<void>;
  /** Copies members into a trip as guests. Local only — no push needed. */
  readonly importMembers: (
    tripId: TripId,
    groupId: GuestGroupId,
    memberIds?: readonly GuestGroupMemberId[],
  ) => Promise<ImportGuestGroupResult>;
  /** Captures existing guests as a new group, then pushes. */
  readonly createGroupFromPersons: (
    name: string,
    persons: readonly Person[],
  ) => Promise<GuestGroup>;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * The account's guest groups, and the operations on them.
 *
 * @returns The groups and their mutations
 *
 * @example
 * ```tsx
 * const { groups, isLoading, createGroup } = useGuestGroups();
 * ```
 */
export function useGuestGroups(): UseGuestGroupsResult {
  const { syncNow } = useGuestGroupSync();

  // `undefined` until the first read resolves, which is what distinguishes
  // "loading" from "this account has no groups".
  const stored = useLiveQuery(() => getAllGuestGroups(), []);

  const createGroup = useCallback(
    async (data: GuestGroupFormData): Promise<GuestGroup> => {
      const group = await createGuestGroupRecord(data);
      syncNow();
      return group;
    },
    [syncNow],
  );

  const updateGroup = useCallback(
    async (id: GuestGroupId, data: GuestGroupFormData): Promise<void> => {
      await updateGuestGroupRecord(id, data);
      syncNow();
    },
    [syncNow],
  );

  const deleteGroup = useCallback(
    async (id: GuestGroupId): Promise<void> => {
      await deleteGuestGroupRecord(id);
      // The push is what carries the deletion: the row goes from the server on
      // the owner's next sync, and other devices prune it from there.
      syncNow();
    },
    [syncNow],
  );

  const importMembers = useCallback(
    async (
      tripId: TripId,
      groupId: GuestGroupId,
      memberIds?: readonly GuestGroupMemberId[],
    ): Promise<ImportGuestGroupResult> =>
      // Writes guests, not groups. The trip's own sync carries them.
      importGuestGroupMembersRecord(tripId, groupId, memberIds),
    [],
  );

  const createGroupFromPersons = useCallback(
    async (name: string, persons: readonly Person[]): Promise<GuestGroup> => {
      const group = await createGuestGroupFromPersonsRecord(name, persons);
      syncNow();
      return group;
    },
    [syncNow],
  );

  return useMemo(
    () => ({
      groups: stored ?? [],
      isLoading: stored === undefined,
      createGroup,
      updateGroup,
      deleteGroup,
      importMembers,
      createGroupFromPersons,
    }),
    [
      createGroup,
      createGroupFromPersons,
      deleteGroup,
      importMembers,
      stored,
      updateGroup,
    ],
  );
}
