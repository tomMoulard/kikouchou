/**
 * @fileoverview Tests for the achievements card of the settings page.
 *
 * @module features/achievements/components/__tests__/AchievementsCard.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db/database';
import { render, screen, userEvent, within } from '@/test/utils';

import { AchievementsCard } from '../AchievementsCard';

// ============================================================================
// Mocks
// ============================================================================

const auth = vi.hoisted(() => ({ session: null as { user: { id: string } } | null }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ session: auth.session }) }));

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn(async () => ({})) }));

const fetchAchievementStats = vi.hoisted(() => vi.fn());
vi.mock('@/lib/achievements/sync', () => ({
  fetchAchievementStats,
  syncAchievements: vi.fn(),
}));

// ============================================================================
// Tests
// ============================================================================

describe('AchievementsCard', () => {
  beforeEach(() => {
    auth.session = null;
    fetchAchievementStats.mockReset();
    fetchAchievementStats.mockResolvedValue(new Map([['trips_1', 14]]));
  });

  async function open() {
    const user = userEvent.setup();
    render(<AchievementsCard />, { withProviders: false });
    const toggle = await screen.findByRole('button', { name: /achievements\.title/ });
    await user.click(toggle);
    return toggle;
  }

  it('is folded by default and says how many are unlocked', async () => {
    await db.achievements.bulkAdd([
      { key: 'trips_1', unlockedAt: Date.now() },
      { key: 'polyglot', unlockedAt: Date.now() },
    ]);
    render(<AchievementsCard />, { withProviders: false });

    const toggle = await screen.findByRole('button', { name: /achievements\.title/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(fetchAchievementStats).not.toHaveBeenCalled();
    // The mocked `t` interpolates everything but the count.
    expect(await screen.findByText('achievements.summary')).toBeInTheDocument();
  });

  it('opens on a click, and lists every achievement in three groups', async () => {
    const toggle = await open();

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('list')).toHaveLength(3);
    expect(screen.getAllByRole('listitem')).toHaveLength(15);
    expect(screen.getByRole('heading', { name: 'achievements.groups.hidden' })).toBeInTheDocument();
  });

  it('keeps a locked hidden achievement secret, and names it once unlocked', async () => {
    await db.achievements.add({ key: 'midnight_pet', unlockedAt: Date.now() });
    await open();

    const hidden = screen.getByRole('heading', { name: 'achievements.groups.hidden' })
      .parentElement as HTMLElement;
    expect(within(hidden).getAllByText('achievements.hidden.name')).toHaveLength(4);
    expect(within(hidden).getByText('achievements.items.midnight_pet.name')).toBeInTheDocument();
    expect(within(hidden).queryByText('achievements.items.night_owl.name')).not.toBeInTheDocument();
  });

  it('asks signed-out people to sign in for the numbers, and asks the server nothing', async () => {
    await open();

    expect(screen.getByText('achievements.signInForStats')).toBeInTheDocument();
    expect(fetchAchievementStats).not.toHaveBeenCalled();
  });

  it('shows how many people hold an unlocked achievement, once signed in', async () => {
    auth.session = { user: { id: 'user-1' } };
    await db.achievements.add({ key: 'trips_1', unlockedAt: Date.now() });
    await open();

    expect(await screen.findByText(/achievements\.percent/)).toBeInTheDocument();
    expect(fetchAchievementStats).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('achievements.signInForStats')).not.toBeInTheDocument();
  });
});
