/**
 * @fileoverview Reads the template behind a link, for a visitor with no account.
 *
 * The whole point of the screen this feeds is that it asks for nothing. No sign
 * in, no invite, no app installed: a customer of a hotel clicks a link in a web
 * page and is three questions away from their own trip. So this hook talks to
 * one `security definer` function, which authorises its caller with the token
 * and answers with five published fields.
 *
 * Four outcomes, because the visitor deserves four different sentences: the
 * template is here, the link is dead, this build has no server to ask, or the
 * ask failed and is worth retrying.
 *
 * @module features/sharing/hooks/useTripTemplate
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { downloadPhoto, templatePhotoPath } from '@/lib/photos/storage';
import type { TypedSupabaseClient } from '@/lib/supabase/client';
import {
  readTripTemplate,
  templatePhotoIds,
  type TripTemplatePayload,
} from '@/lib/sync/templates';
import type { PhotoId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export type TemplatePhase =
  | { readonly kind: 'loading' }
  /**
   * The template is readable, and the wizard can be filled from it. `photos`
   * holds the template's photos that could be downloaded, by id; one that
   * could not is simply absent, and the trip is made without it.
   */
  | {
      readonly kind: 'ready';
      readonly template: TripTemplatePayload;
      readonly photos: ReadonlyMap<PhotoId, Blob>;
    }
  /** Unknown token, deleted trip, or a template taken down. One sentence covers all three. */
  | { readonly kind: 'not-found' }
  /** A build with no backend configured: there is nothing to ask. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed'; readonly message: string };

export interface UseTripTemplateResult {
  readonly phase: TemplatePhase;
  /** Ask again after a failure. */
  readonly retry: () => void;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * What a token looks like before anything is done with it.
 *
 * nanoid's URL-safe alphabet, and the length the server's check constraint
 * accepts. A path that is not one of these never becomes a request.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Downloads every photo a template names, side by side. The link is the
 * credential: the bucket serves `templates/<token>/` to anybody holding it.
 *
 * @param client - Any client, signed in or not
 * @param token - The template token
 * @param template - The payload just read
 * @returns The photos that came back, by id
 */
async function downloadTemplatePhotos(
  client: TypedSupabaseClient,
  token: string,
  template: TripTemplatePayload,
): Promise<ReadonlyMap<PhotoId, Blob>> {
  const ids = templatePhotoIds(template);
  const blobs = await Promise.all(
    ids.map((photoId) =>
      downloadPhoto(client, templatePhotoPath(token, photoId)).catch(() => null),
    ),
  );
  const photos = new Map<PhotoId, Blob>();
  ids.forEach((photoId, index) => {
    const blob = blobs[index];
    if (blob) {
      photos.set(photoId, blob);
    }
  });
  return photos;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * The template behind a link.
 *
 * @param token - The token out of the URL, or null when the route had none
 * @returns The phase to render, and a way to try again
 */
export function useTripTemplate(token: string | null): UseTripTemplateResult {
  const [phase, setPhase] = useState<TemplatePhase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    // Set on setup, not only in cleanup: a second run of this effect after an
    // unmount-remount would otherwise find the flag left false.
    isMountedRef.current = true;

    if (token === null || !TOKEN_PATTERN.test(token)) {
      setPhase({ kind: 'not-found' });
      return () => {
        isMountedRef.current = false;
      };
    }

    if (!isSupabaseConfigured()) {
      setPhase({ kind: 'unavailable' });
      return () => {
        isMountedRef.current = false;
      };
    }

    setPhase({ kind: 'loading' });

    void (async () => {
      const client = await getSupabaseClient();
      if (!isMountedRef.current) {
        return;
      }
      if (client === null) {
        setPhase({ kind: 'unavailable' });
        return;
      }

      const result = await readTripTemplate(client, token);
      if (!isMountedRef.current) {
        return;
      }
      switch (result.status) {
        case 'ok': {
          const photos = await downloadTemplatePhotos(client, token, result.template);
          if (isMountedRef.current) {
            setPhase({ kind: 'ready', template: result.template, photos });
          }
          return;
        }
        case 'not-found':
          setPhase({ kind: 'not-found' });
          return;
        default:
          setPhase({ kind: 'failed', message: result.message });
      }
    })();

    return () => {
      isMountedRef.current = false;
    };
  }, [attempt, token]);

  const retry = useCallback((): void => {
    setAttempt((current) => current + 1);
  }, []);

  return { phase, retry };
}
