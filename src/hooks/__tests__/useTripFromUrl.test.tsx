/**
 * @fileoverview `useTripFromUrl` — the URL's trip, or why it is not here.
 *
 * @module hooks/__tests__/useTripFromUrl.test
 */

import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { useTripFromUrl } from '@/hooks/useTripFromUrl';
import { useTripContext } from '@/contexts/TripContext';
import { TripNotFoundError } from '@/lib/db/trip-not-found-error';
import { captureEvent } from '@/lib/posthog';

vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));
vi.mock('@/lib/posthog', () => ({ captureEvent: vi.fn() }));

const mockedUseTripContext = vi.mocked(useTripContext);
const mockedCaptureEvent = vi.mocked(captureEvent);
const setCurrentTrip = vi.fn<(tripId: string | null) => Promise<void>>();

function withContext(currentTripId: string | null): void {
  mockedUseTripContext.mockReturnValue({
    currentTrip: currentTripId === null ? null : { id: currentTripId },
    isLoading: false,
    setCurrentTrip,
  } as never);
}

function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <MemoryRouter initialEntries={['/trips/trip-far/transports?new=1']}>
      {children}
    </MemoryRouter>
  );
}

describe('useTripFromUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('makes the URL trip current when it is not current yet', () => {
    setCurrentTrip.mockResolvedValue(undefined);
    withContext('trip-other');

    const { result } = renderHook(() => useTripFromUrl('trip-here'), { wrapper });

    expect(setCurrentTrip).toHaveBeenCalledWith('trip-here');
    expect(result.current.isTripMissing).toBe(false);
  });

  it('does nothing when the URL trip is already current', () => {
    withContext('trip-here');

    renderHook(() => useTripFromUrl('trip-here'), { wrapper });

    expect(setCurrentTrip).not.toHaveBeenCalled();
  });

  it('reports a trip that is not on this device, without a console error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setCurrentTrip.mockRejectedValue(new TripNotFoundError('trip-far'));
    withContext(null);

    const { result } = renderHook(() => useTripFromUrl('trip-far'), { wrapper });

    await waitFor(() => {
      expect(result.current.isTripMissing).toBe(true);
    });
    expect(mockedCaptureEvent).toHaveBeenCalledWith('trip_missing_on_device', {
      page: 'transports',
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('still logs any other failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('DatabaseClosedError');
    setCurrentTrip.mockRejectedValue(failure);
    withContext(null);

    const { result } = renderHook(() => useTripFromUrl('trip-here'), { wrapper });

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Failed to set current trip from URL:', failure);
    });
    expect(result.current.isTripMissing).toBe(false);
    expect(mockedCaptureEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
