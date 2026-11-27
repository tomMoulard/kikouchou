/**
 * @fileoverview Tests for the app-wide half of achievements: the start-up
 * checks, the one message per burst of unlocks, and when the sync runs.
 *
 * @module lib/achievements/__tests__/AchievementSync.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db/database';
import { act, render, waitFor } from '@/test/utils';

import { AchievementSync } from '../AchievementSync';
import { holdRewards } from '../reward-hold';
import { unlockAchievement, unlockAchievements } from '../store';

// ============================================================================
// Mocks
// ============================================================================

const auth = vi.hoisted(() => ({ session: null as { user: { id: string } } | null }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ session: auth.session }) }));

vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => ({ isOnline: true }) }));

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn(async () => ({})) }));

const syncAchievements = vi.hoisted(() => vi.fn());
vi.mock('../sync', () => ({ syncAchievements }));

const reward = vi.hoisted(() => vi.fn());
vi.mock('@/lib/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notifications')>()),
  notify: { reward, success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// ============================================================================
// Tests
// ============================================================================

describe('AchievementSync', () => {
  beforeEach(() => {
    auth.session = null;
    reward.mockReset();
    syncAchievements.mockReset();
    syncAchievements.mockResolvedValue({ status: 'synced', pulled: 0, pushed: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows one message for one unlock, naming it', async () => {
    render(<AchievementSync />, { withProviders: false });

    await act(async () => {
      await unlockAchievement('polyglot');
    });

    await waitFor(() => {
      expect(reward).toHaveBeenCalledWith(
        'achievements.unlocked',
        'achievements.items.polyglot.name',
        expect.objectContaining({ label: 'achievements.see' }),
      );
    });
    expect(reward).toHaveBeenCalledTimes(1);
  });

  it('folds a burst of unlocks into one message', async () => {
    render(<AchievementSync />, { withProviders: false });

    await act(async () => {
      await unlockAchievements(['trips_1']);
      await unlockAchievements(['trips_3', 'trips_10']);
    });

    await waitFor(() => {
      expect(reward).toHaveBeenCalledTimes(1);
    });
    expect(reward).toHaveBeenCalledWith(
      'achievements.unlockedMany',
      'achievements.stages.trips_1 · achievements.stages.trips_3 · achievements.stages.trips_10',
      expect.objectContaining({ label: 'achievements.see' }),
    );
  });

  // The list is folded on the settings page, where the tester never found it.
  it("offers a button that opens the achievements list", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/router', () => ({ router: { navigate } }));
    render(<AchievementSync />, { withProviders: false });

    await act(async () => {
      await unlockAchievement('polyglot');
    });
    await waitFor(() => {
      expect(reward).toHaveBeenCalledTimes(1);
    });

    const action = reward.mock.calls[0]?.[2] as { onClick: () => void };
    action.onClick();

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/settings#achievements');
    });
    vi.doUnmock('@/router');
  });

  // Regression: the first-trip wizard unlocks `trips_1` on its sign-in
  // screen, and the toast covered the sign-in buttons.
  it('holds the message while a screen holds rewards, then shows it once released', async () => {
    const release = holdRewards();
    render(<AchievementSync />, { withProviders: false });

    await act(async () => {
      await unlockAchievement('polyglot');
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(reward).not.toHaveBeenCalled();

    act(() => {
      release();
    });

    await waitFor(() => {
      expect(reward).toHaveBeenCalledWith(
        'achievements.unlocked',
        'achievements.items.polyglot.name',
        expect.objectContaining({ label: 'achievements.see' }),
      );
    });
    expect(reward).toHaveBeenCalledTimes(1);
  });

  it('counts a new day when the tab comes back', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 5, 1, 9, 0));
    render(<AchievementSync />, { withProviders: false });
    await waitFor(async () => {
      expect((await db.achievementCounters.get('daysOpened'))?.value).toBe(1);
    });

    vi.setSystemTime(new Date(2026, 5, 2, 9, 0));
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(async () => {
      expect((await db.achievementCounters.get('daysOpened'))?.value).toBe(2);
    });
  });

  it('counts the trips already on the device when it starts', async () => {
    await db.trips.add({
      id: 'trip-1' as never,
      name: 'Old trip',
      shareId: 'share-1' as never,
      createdAt: 1 as never,
      updatedAt: 1 as never,
    });

    render(<AchievementSync />, { withProviders: false });

    await waitFor(async () => {
      expect(await db.achievements.get('trips_1')).toBeDefined();
    });
  });

  it('does not sync signed out', async () => {
    render(<AchievementSync />, { withProviders: false });
    await act(async () => {
      await unlockAchievement('polyglot');
    });
    expect(syncAchievements).not.toHaveBeenCalled();
  });

  it('syncs signed in, again for a new unlock, and stops asking a server without the table', async () => {
    auth.session = { user: { id: 'user-1' } };
    render(<AchievementSync />, { withProviders: false });

    await waitFor(() => {
      expect(syncAchievements).toHaveBeenCalledWith(expect.anything(), 'user-1');
    });

    syncAchievements.mockResolvedValue({
      status: 'error',
      message: 'missing',
      reason: 'unavailable',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const before = syncAchievements.mock.calls.length;
    await act(async () => {
      await unlockAchievement('polyglot');
    });
    await waitFor(() => {
      expect(syncAchievements.mock.calls.length).toBeGreaterThan(before);
    });

    const after = syncAchievements.mock.calls.length;
    await act(async () => {
      await unlockAchievement('first_guest');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(syncAchievements.mock.calls.length).toBe(after);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
