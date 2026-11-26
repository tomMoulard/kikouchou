/**
 * @fileoverview The achievements card in real English and French, where the
 * mocked `t` would hide a key that does not exist or a value that was never
 * interpolated.
 *
 * @module features/achievements/components/__tests__/AchievementsCard.i18n.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db/database';
import { renderWithRealI18n, screen, userEvent } from '@/test/utils';

import { ACHIEVEMENTS } from '@/lib/achievements/definitions';

import { AchievementsCard } from '../AchievementsCard';

vi.unmock('i18next');
vi.unmock('react-i18next');

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ session: { user: { id: 'user-1' } } }),
}));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn(async () => ({})) }));
vi.mock('@/lib/achievements/sync', () => ({
  fetchAchievementStats: vi.fn(async () => new Map([['trips_1', 14]])),
  syncAchievements: vi.fn(),
}));

describe('AchievementsCard in real copy', () => {
  beforeEach(async () => {
    await db.achievements.bulkAdd([
      { key: 'trips_1', unlockedAt: Date.UTC(2026, 10, 20, 12) },
      { key: 'polyglot', unlockedAt: Date.UTC(2026, 10, 21, 12) },
    ]);
    await db.achievementCounters.put({ key: 'tripsCreated', value: 4 });
  });

  it('reads in English: the count, the progress, the share of people', async () => {
    await renderWithRealI18n(<AchievementsCard />, { withProviders: false });

    expect(await screen.findByText('2 of 15 unlocked')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Achievements/ }));

    expect(screen.getByText('First trip')).toBeInTheDocument();
    expect(screen.getByText('4 / 10')).toBeInTheDocument();
    expect(screen.getByText('Polyglot')).toBeInTheDocument();
    expect(screen.getAllByText('Hidden achievement')).toHaveLength(4);
    expect(
      await screen.findByText(/You are in the 14% of people who have it/),
    ).toBeInTheDocument();
  });

  it('reads in French', async () => {
    await renderWithRealI18n(<AchievementsCard />, { withProviders: false, language: 'fr' });

    expect(await screen.findByText('2 sur 15 débloqués')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Succès/ }));

    expect(screen.getByText('Premier voyage')).toBeInTheDocument();
    expect(
      await screen.findByText(/Vous faites partie des 14 % de personnes qui l’ont/),
    ).toBeInTheDocument();
  });

  it('has a name and a description for every achievement in both languages', async () => {
    const { default: en } = await import('@/locales/en/translation.json');
    const { default: fr } = await import('@/locales/fr/translation.json');
    for (const bundle of [en, fr]) {
      const items = bundle.achievements.items as Record<
        string,
        { name?: string; description?: string } | undefined
      >;
      for (const { key } of ACHIEVEMENTS) {
        expect(items[key]?.name, key).toBeTruthy();
        expect(items[key]?.description, key).toBeTruthy();
      }
    }
  });
});
