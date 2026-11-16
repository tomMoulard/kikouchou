/**
 * @fileoverview The accounts on a shared trip, for the share dialog.
 *
 * Reads the roster once the trip is on the server, names each account by the
 * guest it said it is, and lets the organiser take someone off the trip.
 *
 * @module features/sharing/hooks/useTripMembers
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { useAuth } from '@/features/auth/AuthContext';
import { getPersonsByTripId, getTripById } from '@/lib/db';
import { captureEvent } from '@/lib/posthog';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  listTripMembers,
  removeTripMember,
  type RemoveTripMemberResult,
} from '@/lib/sync/members';
import type { TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** One account on the roster, ready to show. */
export interface TripMemberEntry {
  readonly userId: string;
  /** The guest's name, or null when the account has not picked one yet. */
  readonly name: string | null;
  readonly isOwner: boolean;
  readonly isSelf: boolean;
}

export type TripMembersState =
  /** Not on the server, signed out, or a viewer: there is no roster to show. */
  | { readonly kind: 'hidden' }
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly members: readonly TripMemberEntry[];
      /** Whether the person looking is the organiser, who alone may remove. */
      readonly canRemove: boolean;
    }
  | { readonly kind: 'error'; readonly message: string };

// ============================================================================
// Hook
// ============================================================================

/**
 * @param tripId - The local trip
 * @param enabled - False while the dialog is closed or before its link exists
 */
export function useTripMembers(
  tripId: TripId | null,
  enabled: boolean,
): {
  readonly state: TripMembersState;
  readonly remove: (userId: string) => Promise<RemoveTripMemberResult>;
} {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [roster, setRoster] = useState<
    | { readonly kind: 'idle' | 'loading' }
    | { readonly kind: 'ready'; readonly ownerId: string | null; readonly members: readonly { userId: string; personId: string | null }[] }
    | { readonly kind: 'error'; readonly message: string }
  >({ kind: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const isMountedRef = useRef(true);

  // Read from Dexie rather than from a prop: the share dialog can be handed a
  // trip object from before `ensureRemoteTrip` stamped `remoteTripId` on it.
  const trip = useLiveQuery(
    () => (tripId === null ? undefined : getTripById(tripId)),
    [tripId],
  );
  const persons = useLiveQuery(
    () => (tripId === null ? [] : getPersonsByTripId(tripId)),
    [tripId],
  );
  const remoteTripId = trip?.remoteTripId ?? null;
  const isViewer = trip?.viewerToken !== undefined;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || remoteTripId === null || userId === null || isViewer) {
      return;
    }
    let cancelled = false;
    setRoster({ kind: 'loading' });

    const run = async (): Promise<void> => {
      const client = await getSupabaseClient();
      if (cancelled || !isMountedRef.current) return;
      if (!client) {
        setRoster({ kind: 'idle' });
        return;
      }
      const result = await listTripMembers(client, remoteTripId);
      if (cancelled || !isMountedRef.current) return;
      setRoster(
        result.status === 'ok'
          ? { kind: 'ready', ownerId: result.ownerId, members: result.members }
          : { kind: 'error', message: result.message },
      );
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [attempt, enabled, isViewer, remoteTripId, userId]);

  const state = useMemo((): TripMembersState => {
    if (!enabled || remoteTripId === null || userId === null || isViewer) {
      return { kind: 'hidden' };
    }
    if (roster.kind === 'error') {
      return { kind: 'error', message: roster.message };
    }
    if (roster.kind !== 'ready') {
      return { kind: 'loading' };
    }
    const names = new Map((persons ?? []).map((person) => [String(person.id), person.name]));
    return {
      kind: 'ready',
      canRemove: roster.ownerId === userId,
      members: roster.members.map((member) => ({
        userId: member.userId,
        name: member.personId === null ? null : (names.get(member.personId) ?? null),
        isOwner: member.userId === roster.ownerId,
        isSelf: member.userId === userId,
      })),
    };
  }, [enabled, isViewer, persons, remoteTripId, roster, userId]);

  const remove = useCallback(
    async (memberId: string): Promise<RemoveTripMemberResult> => {
      if (remoteTripId === null) {
        return { status: 'error', message: 'This trip is not shared.' };
      }
      const client = await getSupabaseClient();
      if (!client) {
        return { status: 'error', message: 'No sync server.' };
      }
      const result = await removeTripMember(client, remoteTripId, memberId);
      if (result.status === 'removed') {
        captureEvent('trip_member_removed');
        setAttempt((current) => current + 1);
      }
      return result;
    },
    [remoteTripId],
  );

  return { state, remove };
}
