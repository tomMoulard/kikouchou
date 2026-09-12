/**
 * @fileoverview `useTripAccess` — the one place that says "read-only".
 *
 * @module hooks/__tests__/useTripAccess.test
 */

import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useTripContext } from '@/contexts/TripContext';
import { tripAccessOf, useTripAccess } from '@/hooks/useTripAccess';

vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));

const mockedUseTripContext = vi.mocked(useTripContext);

function withTrip(trip: Record<string, unknown> | null): void {
  mockedUseTripContext.mockReturnValue({ currentTrip: trip } as never);
}

describe('useTripAccess', () => {
  it('treats a trip read through an invite token as a viewer trip', () => {
    withTrip({ id: 'trip-1', viewerToken: 'tokentokentoken1' });

    const { result } = renderHook(() => useTripAccess());

    expect(result.current).toEqual({
      access: 'viewer',
      canEdit: false,
      viewerToken: 'tokentokentoken1',
    });
  });

  it('treats every other trip as a member trip', () => {
    withTrip({ id: 'trip-1', remoteTripId: 'remote-1' });

    const { result } = renderHook(() => useTripAccess());

    expect(result.current).toMatchObject({ access: 'member', canEdit: true });
  });

  it('protects nothing when no trip is selected', () => {
    withTrip(null);

    const { result } = renderHook(() => useTripAccess());

    expect(result.current.canEdit).toBe(true);
  });

  it('keeps a stable result while the token does not change', () => {
    withTrip({ id: 'trip-1', viewerToken: 'tokentokentoken1' });

    const { result, rerender } = renderHook(() => useTripAccess());
    const first = result.current;
    // A fresh trip object, as a live query hands back on every remote update.
    withTrip({ id: 'trip-1', viewerToken: 'tokentokentoken1', name: 'renamed' });
    rerender();

    expect(result.current).toBe(first);
  });
});

describe('tripAccessOf', () => {
  it('answers for a trip row outside React', () => {
    expect(tripAccessOf({ viewerToken: 'x' })).toBe('viewer');
    expect(tripAccessOf({})).toBe('member');
    expect(tripAccessOf(null)).toBe('member');
    expect(tripAccessOf(undefined)).toBe('member');
  });
});
