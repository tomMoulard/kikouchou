/**
 * @fileoverview Per-account sync for guest groups.
 *
 * Groups belong to an account, not to a trip, so none of the Yjs machinery
 * applies: there is no document, no log and no cursor. A group is a small
 * personal record that one person edits from a handful of devices, and the
 * reconciliation that fits it is last-write-wins on `updatedAt`.
 *
 * Three rules carry the whole design:
 *
 * 1. **The client's nanoid is the key.** It travels as `local_id` and the
 *    upsert resolves on `(owner_id, local_id)`, so a retry, a second tab and a
 *    reinstall all land on the same row instead of littering duplicates — the
 *    same idempotency `remote-trip.ts` buys for trips.
 *
 * 2. **A deletion is only inferred from a row this device uploaded.** A pull
 *    drops a local group when it carries a `remoteGroupId` the server no longer
 *    lists, and never otherwise. A group created offline and not yet pushed is
 *    not evidence that anything was deleted — pruning on its absence is how the
 *    mirror-completeness rule in AGENTS.md gets violated, one table at a time.
 *
 * 3. **Everything arriving from the server is bounded before it is written.**
 *    The rows come back from Postgres, but they were *written* by another
 *    device, which makes them exactly as untrusted as any other remote input.
 *    An invalid member is dropped on its own; an invalid group is dropped
 *    without taking the rest of the pull with it.
 *
 * Known and deliberate: a group edited offline on one device while deleted on
 * another comes back on the next push. Last-write-wins on a personal record,
 * documented rather than papered over with tombstones.
 *
 * @module lib/sync/guest-groups
 */

import { db } from '@/lib/db/database';
import { MAX_LENGTHS, normalizeChildSeat } from '@/lib/db/sanitize';
import type { TypedSupabaseClient } from '@/lib/supabase/client';
import type { Database, Json } from '@/lib/supabase/database.types';
import {
  MAX_GUEST_GROUP_MEMBERS,
  MAX_PERSON_HEADCOUNT,
  MIN_PERSON_HEADCOUNT,
} from '@/types';
import type {
  GuestGroup,
  GuestGroupId,
  GuestGroupMember,
  GuestGroupMemberId,
  HexColor,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * The server row, as `database.types.ts` describes it.
 *
 * Taken from the generated types rather than restated: they are read from the
 * *linked* project, so this alias breaks the moment the deployed table stops
 * matching what this module expects — which is exactly when it should.
 */
type GuestGroupRow = Database['public']['Tables']['guest_groups']['Row'];

/** The columns {@link SELECTED_COLUMNS} asks for, and therefore all a read has. */
type SelectedGuestGroupRow = Pick<
  GuestGroupRow,
  'id' | 'local_id' | 'owner_id' | 'name' | 'members' | 'updated_at'
>;

/**
 * What a pull reads. `created_at` is deliberately absent: the local record
 * keeps its own creation time, so asking for the server's would be a column
 * fetched on every sync and used by nothing.
 */
const SELECTED_COLUMNS = 'id, local_id, owner_id, name, members, updated_at';

/** What a sync attempt did, so a caller can report it rather than guess. */
export type GuestGroupSyncResult =
  /** No backend, or nobody signed in. The ordinary local-only mode. */
  | { readonly status: 'skipped' }
  | {
      readonly status: 'synced';
      /** Groups written locally from the server copy. */
      readonly pulled: number;
      /** Groups uploaded. */
      readonly pushed: number;
      /** Local groups dropped because the server no longer lists them. */
      readonly pruned: number;
    }
  | { readonly status: 'error'; readonly message: string };

// ============================================================================
// Constants
// ============================================================================

/** The table name, in one place so a typo is one edit rather than two. */
const TABLE = 'guest_groups';

/** Matches the server's `check (name ~ …)` bound and the local sanitiser. */
const MAX_NAME_LENGTH = MAX_LENGTHS.guestGroupName;

/** A member's own bounds, shared with `sanitizePersonData`. */
const MAX_MEMBER_NAME_LENGTH = MAX_LENGTHS.personName;
const MAX_MEMBER_NOTES_LENGTH = MAX_LENGTHS.personNotes;
const MAX_MEMBER_PHONE_LENGTH = MAX_LENGTHS.personPhone;

/** `#rrggbb`, the only colour shape the app stores. */
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

// ============================================================================
// Validation of Remote Input
// ============================================================================

/**
 * A remote member, or `undefined` when it cannot be made into one.
 *
 * Every field is bounded rather than trusted. A member with no usable name or
 * colour is dropped: those two are what the guest list renders, and a blank row
 * in a group is worse than a missing one.
 *
 * @param value - One entry of the server's `members` array
 * @returns The member, or undefined to drop it
 */
function toMember(value: unknown): GuestGroupMember | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;

  if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 64) {
    return undefined;
  }
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
    return undefined;
  }
  if (typeof raw.color !== 'string' || !HEX_COLOR_PATTERN.test(raw.color)) {
    return undefined;
  }

  const headcount =
    typeof raw.headcount === 'number' &&
    Number.isFinite(raw.headcount) &&
    raw.headcount > MIN_PERSON_HEADCOUNT
      ? Math.min(Math.round(raw.headcount), MAX_PERSON_HEADCOUNT)
      : undefined;

  const notes =
    typeof raw.notes === 'string' && raw.notes.trim().length > 0
      ? raw.notes.trim().slice(0, MAX_MEMBER_NOTES_LENGTH)
      : undefined;

  const phone =
    typeof raw.phone === 'string' && raw.phone.trim().length > 0
      ? raw.phone.trim().slice(0, MAX_MEMBER_PHONE_LENGTH)
      : undefined;

  // Enum membership, not merely a string: this value is rendered as a badge and
  // copied straight onto an imported guest, so an unknown kind would travel
  // into the trip and out again through the next changeset.
  const childSeat =
    typeof raw.childSeat === 'string' ? normalizeChildSeat(raw.childSeat) : undefined;

  return {
    id: raw.id as GuestGroupMemberId,
    name: raw.name.trim().slice(0, MAX_MEMBER_NAME_LENGTH),
    color: raw.color as HexColor,
    ...(headcount === undefined ? {} : { headcount }),
    ...(notes === undefined ? {} : { notes }),
    ...(phone === undefined ? {} : { phone }),
    ...(childSeat === undefined ? {} : { childSeat }),
  };
}

/**
 * A remote row as a local group, or `undefined` when it is unusable.
 *
 * @param row - One row from the server
 * @returns The group, or undefined to drop it
 */
function toGuestGroup(row: SelectedGuestGroupRow): GuestGroup | undefined {
  if (typeof row.local_id !== 'string' || row.local_id.length === 0) {
    return undefined;
  }
  if (typeof row.name !== 'string' || row.name.trim().length === 0) {
    return undefined;
  }

  const updatedAt = Date.parse(row.updated_at);
  if (!Number.isFinite(updatedAt)) {
    return undefined;
  }

  const members = Array.isArray(row.members)
    ? row.members
        .map(toMember)
        .filter((member): member is GuestGroupMember => member !== undefined)
        .slice(0, MAX_GUEST_GROUP_MEMBERS)
    : [];

  return {
    id: row.local_id as GuestGroupId,
    name: row.name.trim().slice(0, MAX_NAME_LENGTH),
    members,
    remoteGroupId: row.id,
    // The server has no separate creation clock worth trusting over the local
    // one; a group first seen here was created when it was last updated as far
    // as this device can tell, and a genuine local row keeps its own value.
    createdAt: updatedAt,
    updatedAt,
  };
}

// ============================================================================
// Pull
// ============================================================================

/**
 * Applies the server's copy over the local one, last write winning.
 *
 * @param client - An authenticated Supabase client
 * @param userId - The signed-in account
 * @returns How many groups were written and how many were pruned
 */
async function pullGuestGroups(
  client: TypedSupabaseClient,
  userId: string,
): Promise<{ readonly pulled: number; readonly pruned: number }> {
  const { data, error } = await client.from(TABLE)
    .select(SELECTED_COLUMNS)
    .eq('owner_id', userId);

  if (error) {
    throw new Error(error.message);
  }

  const rows = data ?? [],
    remote = rows
      .map(toGuestGroup)
      .filter((group): group is GuestGroup => group !== undefined),
    remoteIds = new Set(rows.map((row) => row.id));

  let pulled = 0,
    pruned = 0;

  await db.transaction('rw', db.guestGroups, async () => {
    const local = await db.guestGroups.toArray(),
      localById = new Map(local.map((group) => [group.id, group]));

    for (const incoming of remote) {
      const current = localById.get(incoming.id);

      // Strictly newer wins. Equal timestamps keep the local copy: they are the
      // same write coming back, and rewriting it would churn every `useLiveQuery`
      // subscriber on every sync.
      if (current && current.updatedAt >= incoming.updatedAt) {
        // Still record where the row lives, so a device that created the group
        // offline learns it has been uploaded and becomes prunable.
        if (current.remoteGroupId !== incoming.remoteGroupId) {
          await db.guestGroups.update(current.id, {
            remoteGroupId: incoming.remoteGroupId,
          });
        }
        continue;
      }

      await db.guestGroups.put({
        ...incoming,
        // Keep the original local creation time when there is one.
        createdAt: current?.createdAt ?? incoming.createdAt,
      });
      pulled += 1;
    }

    // The narrow deletion rule: only a group this device uploaded, and that the
    // server no longer lists, is gone. Everything else is kept.
    const vanished = local.filter(
      (group) =>
        group.remoteGroupId !== undefined && !remoteIds.has(group.remoteGroupId),
    );

    if (vanished.length > 0) {
      await db.guestGroups.bulkDelete(vanished.map((group) => group.id));
      pruned = vanished.length;
    }
  });

  return { pulled, pruned };
}

// ============================================================================
// Push
// ============================================================================

/**
 * Uploads every local group, and records where each one landed.
 *
 * Sends all of them rather than a dirty subset: a group is a handful of rows of
 * a few hundred bytes, and a "what changed since" cursor is a second piece of
 * state to keep honest for no measurable saving.
 *
 * @param client - An authenticated Supabase client
 * @param userId - The signed-in account, written as `owner_id`
 * @returns How many groups were uploaded
 */
async function pushGuestGroups(
  client: TypedSupabaseClient,
  userId: string,
): Promise<number> {
  const local = await db.guestGroups.toArray();

  if (local.length === 0) {
    return 0;
  }

  const payload = local.map((group) => ({
    local_id: group.id,
    owner_id: userId,
    name: group.name,
    // Structurally JSON already — strings, numbers and plain objects — but an
    // interface has no index signature, so it does not satisfy `Json` on its
    // own. Asserted here, at the one boundary where the record leaves the app,
    // rather than by loosening the entity everything else is typed against.
    members: group.members as unknown as Json,
    updated_at: new Date(group.updatedAt).toISOString(),
  }));

  const { data, error } = await client.from(TABLE)
    .upsert(payload, { onConflict: 'owner_id,local_id' })
    .select('id, local_id');

  if (error) {
    throw new Error(error.message);
  }

  // Record the server ids. Until a group carries one, a pull can never prune it
  // — which is the safe direction, and why this is not fire-and-forget.
  for (const row of data ?? []) {
    await db.guestGroups.update(row.local_id, { remoteGroupId: row.id });
  }

  return payload.length;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Reconciles this device's guest groups with the account's.
 *
 * Pull first, then push: the pull settles which copy of each group wins, and
 * the push then uploads that settled state, so a device coming back online does
 * not overwrite a newer edit made elsewhere with its own stale one.
 *
 * Never throws. Sync is a background convenience — the groups page works
 * offline and signed out — so a failure is reported as a status the caller may
 * ignore rather than an exception that has to be caught at every call site.
 *
 * @param client - The Supabase client, or null when the app has no backend
 * @param userId - The signed-in account, or null/undefined when signed out
 * @returns What happened
 *
 * @example
 * ```typescript
 * const result = await syncGuestGroups(client, user?.id);
 * if (result.status === 'error') {
 *   console.warn('[guest-groups] sync failed:', result.message);
 * }
 * ```
 */
export async function syncGuestGroups(
  client: TypedSupabaseClient | null,
  userId: string | null | undefined,
): Promise<GuestGroupSyncResult> {
  if (!client || !userId) {
    return { status: 'skipped' };
  }

  try {
    const { pulled, pruned } = await pullGuestGroups(client, userId),
      pushed = await pushGuestGroups(client, userId);

    return { status: 'synced', pulled, pushed, pruned };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
