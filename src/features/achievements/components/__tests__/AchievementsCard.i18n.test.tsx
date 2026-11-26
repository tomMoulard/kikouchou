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

import {
  ACHIEVEMENT_FAMILIES,
  ACHIEVEMENT_KEYS,
  ACHIEVEMENT_SPECIALS,
} from '@/lib/achievements/definitions';

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
    await db.achievementCounters.put({ key: 'tripsCreated', value: 2 });
  });

  it('reads in English: the count, the progress, the share of people', async () => {
    await renderWithRealI18n(<AchievementsCard />, { withProviders: false });

    expect(
      await screen.findByText(`2 of ${ACHIEVEMENT_KEYS.length} unlocked`),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Achievements/ }));

    expect(screen.getByText('Trip maker')).toBeInTheDocument();
    expect(screen.getByText('First trip')).toBeInTheDocument();
    expect(
      screen.getByText('Create 1 more trip to reach “Getting the hang of it”'),
    ).toBeInTheDocument();
    expect(screen.getByText('Add 1 more guest to reach “The more the merrier”')).toBeInTheDocument();
    expect(screen.getByText('Come back 5 more days to reach “Back again”')).toBeInTheDocument();
    expect(screen.getByText('Polyglot')).toBeInTheDocument();
    expect(screen.getByText('Specials')).toBeInTheDocument();
    expect(screen.getAllByText('Hidden achievement')).toHaveLength(4);
    expect(
      await screen.findByText(/You are in the 14% of people who have it/),
    ).toBeInTheDocument();
  });

  it('reads in French', async () => {
    await renderWithRealI18n(<AchievementsCard />, { withProviders: false, language: 'fr' });

    expect(
      await screen.findByText(`2 sur ${ACHIEVEMENT_KEYS.length} débloqués`),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Succès/ }));

    expect(screen.getByText('Organisation')).toBeInTheDocument();
    expect(screen.getByText('Premier voyage')).toBeInTheDocument();
    expect(
      screen.getByText('Créez encore 1 voyage pour atteindre « On prend le pli »'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Revenez encore 5 jours pour atteindre « De retour »'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/Vous faites partie des 14 % de personnes qui l’ont/),
    ).toBeInTheDocument();
  });

  it('has the words for every family, stage and special in both languages', async () => {
    const { default: en } = await import('@/locales/en/translation.json');
    const { default: fr } = await import('@/locales/fr/translation.json');
    for (const bundle of [en, fr]) {
      const block = bundle.achievements as unknown as {
        families: Record<string, Record<string, string> | undefined>;
        stages: Record<string, string | undefined>;
        items: Record<string, { name?: string; description?: string } | undefined>;
      };
      for (const family of ACHIEVEMENT_FAMILIES) {
        for (const field of ['name', 'description', 'next_one', 'next_other']) {
          expect(block.families[family.id]?.[field], `${family.id}.${field}`).toBeTruthy();
        }
        for (const stage of family.stages) {
          expect(block.stages[stage.key], stage.key).toBeTruthy();
        }
      }
      for (const { key } of ACHIEVEMENT_SPECIALS) {
        expect(block.items[key]?.name, key).toBeTruthy();
        expect(block.items[key]?.description, key).toBeTruthy();
      }
    }
  });
});
