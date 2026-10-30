/**
 * @fileoverview `usePendingArrival`: the day a guest gave signed out is saved
 * once the trip can take it, and not a moment before.
 *
 * "Before" is the bug this guards: written while the trip is still a viewer
 * trip, or before the server's document reached Dexie, the projection puts the
 * document's value back and the answer is lost without a word.
 *
 * @module hooks/__tests__/usePendingArrival.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { usePendingArrival } from '@/hooks/usePendingArrival';
import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { notify } from '@/lib/notifications';
import { captureEvent } from '@/lib/posthog';
import { useSyncStatus } from '@/lib/sync/SupabaseTripSync';
import type { SyncState } from '@/lib/sync/SupabaseYjsProvider';
import type { Person, PersonId, TripId } from '@/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string; date?: string }) =>
      (options?.defaultValue ?? _key).replace('{{date}}', options?.date ?? ''),
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));
vi.mock('@/lib/sync/SupabaseTripSync', () => ({ useSyncStatus: vi.fn() }));
vi.mock('@/lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/posthog')>()),
  captureEvent: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

// A localStorage double: this environment ships none.
const entries = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    get length(): number {
      return entries.size;
    },
    clear: (): void => entries.clear(),
    getItem: (key: string): string | null => entries.get(key) ?? null,
    key: (index: number): string | null => [...entries.keys()][index] ?? null,
    removeItem: (key: string): void => {
      entries.delete(key);
    },
    setItem: (key: string, value: string): void => {
      entries.set(key, value);
    },
  } satisfies Storage,
});

const mockedUseTripContext = vi.mocked(useTripContext);
const mockedUseSyncStatus = vi.mocked(useSyncStatus);
const mockedCaptureEvent = vi.mocked(captureEvent);
const mockedSuccess = vi.mocked(notify.success);

const TRIP_ID = 'trip-1' as TripId;
const PERSON_ID = 'person-alice' as PersonId;
const PENDING_KEY = 'kikouchou-pending-arrival:trip-1';

const MEMBER_TRIP = { id: TRIP_ID, shareId: 'share-1', remoteTripId: 'remote-1' };

function withTrip(trip: Record<string, unknown> | null): void {
  mockedUseTripContext.mockReturnValue({ currentTrip: trip } as never);
}

function withSync(status: SyncState['status']): void {
  mockedUseSyncStatus.mockReturnValue({
    state: { status, pendingCount: 0, onlineCount: null },
    syncNow: vi.fn(),
  });
}

async function stayStartOf(personId: PersonId): Promise<string | undefined> {
  return (await db.persons.get(personId))?.stayStartDate;
}

describe('usePendingArrival', () => {
  beforeEach(async () => {
    entries.clear();
    vi.clearAllMocks();
    await db.persons.add({
      id: PERSON_ID,
      tripId: TRIP_ID,
      name: 'Alice',
      color: '#ff0000' as Person['color'],
    });
    entries.set(PENDING_KEY, JSON.stringify({ personId: PERSON_ID, date: '2026-07-17' }));
    withTrip(MEMBER_TRIP);
    withSync('synced');
  });

  it('saves the day on the guest once the member trip is synced, then forgets it', async () => {
    renderHook(() => {
      usePendingArrival();
    });

    await waitFor(async () => {
      expect(await stayStartOf(PERSON_ID)).toBe('2026-07-17');
    });
    await waitFor(() => {
      expect(entries.has(PENDING_KEY)).toBe(false);
    });
    expect(mockedCaptureEvent).toHaveBeenCalledWith('guest_arrival_saved', {
      via: 'after_sign_in',
    });
    expect(mockedSuccess).toHaveBeenCalledWith(
      'Your arrival on Friday, July 17th, 2026 is saved. The others can see it.',
    );
  });

  it('waits while the trip is still a viewer trip', async () => {
    withTrip({ ...MEMBER_TRIP, viewerToken: 'tokentokentoken1' });

    renderHook(() => {
      usePendingArrival();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await stayStartOf(PERSON_ID)).toBeUndefined();
    expect(entries.has(PENDING_KEY)).toBe(true);
  });

  it('waits for a trip that is only on this device', async () => {
    withTrip({ id: TRIP_ID, shareId: 'share-1' });

    renderHook(() => {
      usePendingArrival();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await stayStartOf(PERSON_ID)).toBeUndefined();
  });

  it('waits until sync has projected the document, then saves', async () => {
    withSync('syncing');
    const { rerender } = renderHook(() => {
      usePendingArrival();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await stayStartOf(PERSON_ID)).toBeUndefined();

    withSync('synced');
    rerender();

    await waitFor(async () => {
      expect(await stayStartOf(PERSON_ID)).toBe('2026-07-17');
    });
  });

  it('forgets an answer whose guest is gone from the trip', async () => {
    await db.persons.delete(PERSON_ID);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    renderHook(() => {
      usePendingArrival();
    });

    await waitFor(() => {
      expect(entries.has(PENDING_KEY)).toBe(false);
    });
    expect(mockedSuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('does nothing without a current trip', async () => {
    withTrip(null);

    renderHook(() => {
      usePendingArrival();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(entries.has(PENDING_KEY)).toBe(true);
  });
});
