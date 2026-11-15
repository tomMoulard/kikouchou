/**
 * @fileoverview The link an enterprise hands out, and the state behind it.
 *
 * This is the publisher's half of trip templates. It answers one question for
 * the screen — is this trip published, and under which link — and offers the
 * two actions that change the answer.
 *
 * Publishing needs an account, because the payload is a row the trip's owner
 * writes and Row-Level Security decides who that is. Saying so is better than
 * offering a button that fails.
 *
 * The payload is built here rather than on the server, because the five fields
 * live in the local trip and its rooms: the server holds a name and two dates
 * and nothing else about a trip. Every publish rewrites it, and between two
 * publishes `useTemplateRefresh` rewrites it after each edit.
 *
 * @module features/sharing/hooks/useTripTemplateLink
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { ensureRemoteTrip } from '@/lib/sync/remote-trip';
import { readTemplateState } from '@/lib/sync/templates';
import type { Trip } from '@/types';

import {
  publishTripTemplate,
  templateCardUrlFor,
  templateUrlFor,
  unpublishTripTemplate,
} from '../utils/template-link';

// ============================================================================
// Type Definitions
// ============================================================================

export type TemplateLinkState =
  | { readonly kind: 'loading' }
  /**
   * Published: this is the link, and it does not change. `cardUrl` is the
   * image a chat unfurls it with, or null when no preview service draws one.
   */
  | {
      readonly kind: 'published';
      readonly url: string;
      readonly cardUrl: string | null;
      readonly token: string;
    }
  /** The trip can be published, and is not. */
  | { readonly kind: 'unpublished' }
  /**
   * Somebody else owns this trip on the server.
   *
   * Every member of a trip can read whether it is published, and only the owner
   * can change it. So a member is shown the link when there is one, and never a
   * button whose write the server would refuse.
   */
  | { readonly kind: 'not-owner'; readonly url: string | null; readonly cardUrl: string | null }
  /** Publishing needs an account; the screen offers to sign in. */
  | { readonly kind: 'needs-account' }
  /** No backend in this build: there is nothing to publish to. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'error'; readonly message: string };

export interface UseTripTemplateLinkResult {
  readonly state: TemplateLinkState;
  /** Publish the trip, or republish it with what it now says. */
  readonly publish: () => Promise<void>;
  /** Take the template down, keeping the link for later. */
  readonly unpublish: () => Promise<void>;
  /** Whether an action is in flight. */
  readonly isBusy: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/** The link for a token. */
const urlFor = templateUrlFor;

/** The link's card for a token, or null without a preview service. */
const cardUrlFor = templateCardUrlFor;

// ============================================================================
// Hook
// ============================================================================

/**
 * Whether a trip is published as a template, and how to change that.
 *
 * @param trip - The trip the screen is showing, or undefined while it loads
 * @param enabled - False keeps the hook idle, for a screen behind a flag
 * @returns The state to render and the two actions
 */
export function useTripTemplateLink(
  trip: Trip | undefined,
  enabled: boolean,
): UseTripTemplateLinkResult {
  const { user, isResolved } = useAuth();
  const [state, setState] = useState<TemplateLinkState>({ kind: 'loading' });
  const [isBusy, setIsBusy] = useState(false);
  const isMountedRef = useRef(true);

  const tripId = trip?.id;
  const userId = user?.id ?? null;

  useEffect(() => {
    isMountedRef.current = true;

    if (!enabled || tripId === undefined) {
      return () => {
        isMountedRef.current = false;
      };
    }
    if (!isSupabaseConfigured()) {
      setState({ kind: 'unavailable' });
      return () => {
        isMountedRef.current = false;
      };
    }
    if (!isResolved) {
      setState({ kind: 'loading' });
      return () => {
        isMountedRef.current = false;
      };
    }
    if (userId === null) {
      setState({ kind: 'needs-account' });
      return () => {
        isMountedRef.current = false;
      };
    }

    setState({ kind: 'loading' });

    void (async () => {
      const client = await getSupabaseClient();
      if (!isMountedRef.current) {
        return;
      }
      if (client === null) {
        setState({ kind: 'unavailable' });
        return;
      }

      // A trip that was never synced has no server row and therefore cannot be
      // published yet. Creating it here is the same step the share dialog takes
      // before it can mint an invite.
      const remote = await ensureRemoteTrip(client, userId, tripId);
      if (!isMountedRef.current) {
        return;
      }
      if (remote.status !== 'ready') {
        setState(
          remote.status === 'error'
            ? { kind: 'error', message: remote.message }
            : { kind: 'unpublished' },
        );
        return;
      }

      const result = await readTemplateState(client, remote.remoteTripId);
      if (!isMountedRef.current) {
        return;
      }
      if (result.status === 'error') {
        setState({ kind: 'error', message: result.message });
        return;
      }
      const { isTemplate, token, ownerId } = result.state;
      if (ownerId !== null && ownerId !== userId) {
        setState({
          kind: 'not-owner',
          url: isTemplate && token !== null ? urlFor(token) : null,
          cardUrl: isTemplate && token !== null ? cardUrlFor(token) : null,
        });
        return;
      }
      setState(
        isTemplate && token !== null
          ? { kind: 'published', url: urlFor(token), cardUrl: cardUrlFor(token), token }
          : { kind: 'unpublished' },
      );
    })();

    return () => {
      isMountedRef.current = false;
    };
  }, [enabled, isResolved, tripId, userId]);

  const publish = useCallback(async (): Promise<void> => {
    if (trip === undefined || userId === null) {
      return;
    }
    setIsBusy(true);
    try {
      const client = await getSupabaseClient();
      if (client === null) {
        if (isMountedRef.current) {
          setState({ kind: 'unavailable' });
        }
        return;
      }
      // Shared with the assistant's publishTemplate action.
      const result = await publishTripTemplate(client, userId, trip);
      if (!isMountedRef.current) {
        return;
      }
      setState(
        result.status === 'published'
          ? { kind: 'published', url: result.url, cardUrl: result.cardUrl, token: result.token }
          : { kind: 'error', message: result.message },
      );
    } catch (error: unknown) {
      console.error('Failed to publish the trip template:', error);
      if (isMountedRef.current) {
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (isMountedRef.current) {
        setIsBusy(false);
      }
    }
  }, [trip, userId]);

  const unpublish = useCallback(async (): Promise<void> => {
    if (trip === undefined || userId === null) {
      return;
    }
    setIsBusy(true);
    try {
      const client = await getSupabaseClient();
      if (client === null) {
        if (isMountedRef.current) {
          setState({ kind: 'unavailable' });
        }
        return;
      }
      // Shared with the assistant's unpublishTemplate action.
      const result = await unpublishTripTemplate(client, userId, trip.id);
      if (!isMountedRef.current || result.status === 'not-on-server') {
        return;
      }
      setState(
        result.status === 'error'
          ? { kind: 'error', message: result.message }
          : { kind: 'unpublished' },
      );
    } catch (error: unknown) {
      console.error('Failed to take the trip template down:', error);
      if (isMountedRef.current) {
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (isMountedRef.current) {
        setIsBusy(false);
      }
    }
  }, [trip, userId]);

  return { state, publish, unpublish, isBusy };
}
