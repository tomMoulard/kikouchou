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
 * and nothing else about a trip. Every publish rewrites it, so pressing Publish
 * again after editing the trip is what refreshes what customers see.
 *
 * @module features/sharing/hooks/useTripTemplateLink
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import { getRoomsByTripId } from '@/lib/db';
import { getCurrentLanguage } from '@/lib/i18n';
import { captureEvent } from '@/lib/posthog';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { ensureRemoteTrip } from '@/lib/sync/remote-trip';
import {
  buildTemplateUrl,
  publishTemplate,
  readTemplateState,
  unpublishTemplate,
  type TripTemplatePayload,
} from '@/lib/sync/templates';
import { DEFAULT_ROOM_ICON } from '@/types';
import type { Trip } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export type TemplateLinkState =
  | { readonly kind: 'loading' }
  /** Published: this is the link, and it does not change. */
  | { readonly kind: 'published'; readonly url: string; readonly token: string }
  /** The trip can be published, and is not. */
  | { readonly kind: 'unpublished' }
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

/**
 * The five published fields, read out of the local trip.
 *
 * The rooms come from Dexie in display order, so the customer's copy lists them
 * the way the enterprise arranged them.
 *
 * @param trip - The trip being published
 * @returns What an anonymous reader will see
 */
async function buildPayload(trip: Trip): Promise<TripTemplatePayload> {
  const rooms = await getRoomsByTripId(trip.id);
  return {
    name: trip.name,
    description: trip.description ?? null,
    location: trip.location ?? null,
    coordinates: trip.coordinates ?? null,
    currency: trip.currency ?? null,
    rooms: rooms.map((room) => ({
      name: room.name,
      capacity: room.capacity,
      icon: room.icon ?? DEFAULT_ROOM_ICON,
    })),
  };
}

/** The link for a token, in the language the publisher is reading in. */
function urlFor(token: string): string {
  return buildTemplateUrl(window.location.origin, import.meta.env.BASE_URL || '/', token, {
    origin: import.meta.env.VITE_SHARE_ORIGIN ?? '',
    language: getCurrentLanguage(),
  });
}

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
      const { isTemplate, token } = result.state;
      setState(
        isTemplate && token !== null
          ? { kind: 'published', url: urlFor(token), token }
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
      const remote = await ensureRemoteTrip(client, userId, trip.id);
      if (remote.status !== 'ready') {
        if (isMountedRef.current) {
          setState({
            kind: 'error',
            message: remote.status === 'error' ? remote.message : 'the trip is not on the server',
          });
        }
        captureEvent('trip_template_publish_failed', { reason: remote.status });
        return;
      }

      const existing = await readTemplateState(client, remote.remoteTripId);
      const payload = await buildPayload(trip);
      const result = await publishTemplate(
        client,
        remote.remoteTripId,
        payload,
        existing.status === 'ok' ? existing.state.token : null,
      );

      if (result.status === 'error') {
        if (isMountedRef.current) {
          setState({ kind: 'error', message: result.message });
        }
        captureEvent('trip_template_publish_failed', { reason: 'write' });
        return;
      }
      captureEvent('trip_template_published', {
        room_count: payload.rooms.length,
        has_description: payload.description !== null,
        republished: existing.status === 'ok' && existing.state.isTemplate,
      });
      if (isMountedRef.current) {
        setState({ kind: 'published', url: urlFor(result.token), token: result.token });
      }
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
      const remote = await ensureRemoteTrip(client, userId, trip.id);
      if (remote.status !== 'ready') {
        return;
      }
      const result = await unpublishTemplate(client, remote.remoteTripId);
      if (!isMountedRef.current) {
        return;
      }
      if (result.status === 'error') {
        setState({ kind: 'error', message: result.message });
        return;
      }
      captureEvent('trip_template_unpublished');
      setState({ kind: 'unpublished' });
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
