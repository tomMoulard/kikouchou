/**
 * @fileoverview The lifetime of a trip's document: when it counts as loaded,
 * and when it is destroyed.
 *
 * `loaded` is what every consumer gates a write on, so it must be false for the
 * placeholder, false for the previous trip's document across a switch, and true
 * only once the document describes the trip asked about.
 *
 * @module lib/yjs/__tests__/useTripDoc.test
 */

import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import { useTripDoc } from '@/lib/yjs/useTripDoc';
import { YjsProvider, useRequiredYjsContext } from '@/lib/yjs/YjsProvider';
import { renderHook, waitFor } from '@/test/utils';
import type { TripId } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

async function persistUpdate(tripId: TripId, key: string): Promise<void> {
  const source = new Y.Doc();
  source.getMap('scratch').set(key, true);
  await db.yjsUpdates.add({ tripId, update: Y.encodeStateAsUpdate(source) });
}

const TRIP_A = 'trip-a' as TripId;
const TRIP_B = 'trip-b' as TripId;

// ============================================================================
// Tests
// ============================================================================

describe('useTripDoc', () => {
  it('opens nothing without a trip', async () => {
    const error = vi.spyOn(console, 'error');
    const where = vi.spyOn(db.yjsUpdates, 'where');

    const { result } = renderHook(() => useTripDoc(null));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.loaded).toBe(false);
    expect(where).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('is not loaded before the persisted updates are replayed, then is', async () => {
    await persistUpdate(TRIP_A, 'a');

    const { result } = renderHook(() => useTripDoc(TRIP_A));

    expect(result.current.loaded).toBe(false);
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    expect(result.current.doc.getMap('scratch').get('a')).toBe(true);
  });

  it('is not loaded across a switch until the next trip\'s document is', async () => {
    await persistUpdate(TRIP_A, 'a');
    await persistUpdate(TRIP_B, 'b');
    const { result, rerender } = renderHook(({ tripId }) => useTripDoc(tripId), {
      initialProps: { tripId: TRIP_A },
    });
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    rerender({ tripId: TRIP_B });

    expect(result.current.loaded).toBe(false);
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    expect(result.current.doc.getMap('scratch').get('b')).toBe(true);
  });

  it('destroys the document when the trip closes', async () => {
    const { result, unmount } = renderHook(() => useTripDoc(TRIP_A));
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    const { doc } = result.current;

    unmount();

    expect(doc.isDestroyed).toBe(true);
  });

  it('destroys a document closed before it loaded exactly once', async () => {
    const destroy = vi.spyOn(Y.Doc.prototype, 'destroy');

    const { unmount } = renderHook(() => useTripDoc(TRIP_A));
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('logs and destroys a document that could not be opened', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const destroy = vi.spyOn(Y.Doc.prototype, 'destroy');
    vi.spyOn(db.yjsUpdates, 'where').mockImplementationOnce(() => {
      throw new Error('IndexedDB unavailable');
    });

    const { result } = renderHook(() => useTripDoc(TRIP_A));

    await waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        '[yjs] failed to open the trip document:',
        expect.any(Error),
      );
    });
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(result.current.loaded).toBe(false);
  });
});

describe('useRequiredYjsContext', () => {
  it('refuses to run outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(() => useRequiredYjsContext())).toThrow(
      'useRequiredYjsContext must be used within a YjsProvider',
    );
  });

  it('hands back the provider\'s trip', () => {
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <YjsProvider tripId={TRIP_A}>{children}</YjsProvider>
    );

    const { result } = renderHook(() => useRequiredYjsContext(), { wrapper });

    expect(result.current.tripId).toBe(TRIP_A);
  });
});
