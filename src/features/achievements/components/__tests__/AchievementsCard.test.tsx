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

  // The unlock toast's "See" lands on /settings#achievements.
  it('opens by itself when the address names it', async () => {
    render(<AchievementsCard />, {
      withProviders: false,
      initialEntries: ['/settings#achievements'],
    });

    const toggle = await screen.findByRole('button', { name: /achievements\.title/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('achievements')).not.toBeNull();
  });

  it('opens on a click: nine family tiles, then eight specials', async () => {
    const toggle = await open();

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const families = screen.getByRole('heading', { name: 'achievements.groups.families' })
      .parentElement as HTMLElement;
    const specials = screen.getByRole('heading', { name: 'achievements.groups.specials' })
      .parentElement as HTMLElement;
    expect(within(families).getAllByRole('listitem')).toHaveLength(9);
    expect(within(specials).getAllByRole('listitem')).toHaveLength(8);
    // A tile stays folded: no stage is listed until it is opened.
    expect(screen.queryByText('achievements.stages.guests_50')).not.toBeInTheDocument();
  });

  it('shows the stage reached and the way to the next one', async () => {
    await db.achievementCounters.put({ key: 'guestsAdded', value: 12 });
    await db.achievements.bulkAdd([
      { key: 'first_guest', unlockedAt: Date.now() },
      { key: 'guests_10', unlockedAt: Date.now() },
    ]);
    await open();

    const tile = (await screen.findByText('achievements.families.guests.name')).closest(
      'li',
    ) as HTMLElement;
    expect(within(tile).getByText('achievements.stages.guests_10')).toBeInTheDocument();
    expect(within(tile).getByText('achievements.families.guests.next')).toBeInTheDocument();

    const trips = screen.getByText('achievements.families.trips.name').closest('li') as HTMLElement;
    expect(within(trips).getByText('achievements.notStarted')).toBeInTheDocument();
  });

  it('unfolds a tile into its five stages: reached, next, locked', async () => {
    await db.achievementCounters.put({ key: 'daysOpened', value: 20 });
    await db.achievements.bulkAdd([
      { key: 'days_5', unlockedAt: Date.now() },
      { key: 'days_15', unlockedAt: Date.now() },
    ]);
    const user = userEvent.setup();
    await open();

    const tile = (await screen.findByText('achievements.families.loyalty.name')).closest(
      'li',
    ) as HTMLElement;
    const unfold = within(tile).getByRole('button', { name: 'achievements.showStages' });
    expect(unfold).toHaveAttribute('aria-expanded', 'false');
    await user.click(unfold);

    expect(unfold).toHaveAttribute('aria-expanded', 'true');
    const stages = within(tile).getAllByRole('listitem');
    expect(stages).toHaveLength(5);
    expect(stages[0]).toHaveTextContent('achievements.stages.days_5');
    expect(stages[0]).toHaveTextContent('achievements.status.unlocked');
    expect(stages[2]).toHaveTextContent('achievements.status.next');
    expect(stages[4]).toHaveTextContent('achievements.status.locked');
    expect(within(tile).getByText('achievements.families.loyalty.description')).toBeInTheDocument();
  });

  it('says a complete family is complete', async () => {
    await db.achievementCounters.put({ key: 'questionsAsked', value: 600 });
    await open();

    const tile = (await screen.findByText('achievements.families.assistant.name')).closest(
      'li',
    ) as HTMLElement;
    expect(within(tile).getByText('achievements.stages.questions_500')).toBeInTheDocument();
    expect(within(tile).getByText('achievements.complete')).toBeInTheDocument();
  });

  it('keeps a locked hidden achievement secret, and names it once unlocked', async () => {
    await db.achievements.add({ key: 'midnight_pet', unlockedAt: Date.now() });
    await open();

    const specials = screen.getByRole('heading', { name: 'achievements.groups.specials' })
      .parentElement as HTMLElement;
    expect(within(specials).getAllByText('achievements.hidden.name')).toHaveLength(4);
    expect(within(specials).getByText('achievements.items.midnight_pet.name')).toBeInTheDocument();
    expect(
      within(specials).queryByText('achievements.items.night_owl.name'),
    ).not.toBeInTheDocument();
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
