/**
 * @fileoverview The achievements, on the settings page, folded by default.
 *
 * The header always says how many are unlocked. Opened, the card lists every
 * achievement in three groups: the trip tiers with the way to the next one,
 * the milestones, and the hidden ones, which keep their name and their hint to
 * themselves until they are unlocked.
 *
 * Signed in, each unlocked achievement says how many people hold it. The
 * numbers come from `achievement_stats()` and are asked for when the card
 * opens, not before: a folded card costs no request.
 *
 * @module features/achievements/components/AchievementsCard
 */

import { memo, useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import {
  BedDouble,
  CalendarDays,
  ChevronDown,
  Languages,
  Lock,
  Luggage,
  MessageCircle,
  Moon,
  MoonStar,
  PawPrint,
  Share2,
  Trophy,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { useAuth } from '@/features/auth/AuthContext';

import {
  ACHIEVEMENTS,
  fetchAchievementStats,
  isAchievementKey,
  type AchievementDefinition,
  type AchievementKey,
  type AchievementKind,
  type AchievementStats,
} from '@/lib/achievements';
import { db } from '@/lib/db/database';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { getSupabaseClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

// ============================================================================
// Constants
// ============================================================================

const ICONS: Readonly<Record<AchievementKey, LucideIcon>> = {
  trips_1: Luggage,
  trips_3: Luggage,
  trips_10: Luggage,
  trips_100: Luggage,
  trips_1000: Luggage,
  first_guest: UserPlus,
  full_room: BedDouble,
  group_activity: Users,
  first_question: MessageCircle,
  trip_shared: Share2,
  midnight_pet: Moon,
  petting_zoo: PawPrint,
  leap_day: CalendarDays,
  polyglot: Languages,
  night_owl: MoonStar,
};

const GROUPS: readonly AchievementKind[] = ['tier', 'milestone', 'hidden'];

const LIST_ID = 'achievements-list';

// ============================================================================
// Row
// ============================================================================

interface AchievementRowProps {
  readonly definition: AchievementDefinition;
  readonly unlockedAt: number | undefined;
  readonly progress: number;
  readonly percent: number | undefined;
  readonly language: string;
}

const AchievementRow = memo(function AchievementRow({
  definition,
  unlockedAt,
  progress,
  percent,
  language,
}: AchievementRowProps): ReactElement {
  const { t } = useTranslation();
  const unlocked = unlockedAt !== undefined;
  const secret = definition.kind === 'hidden' && !unlocked;
  const Icon = secret ? Lock : ICONS[definition.key];
  const goal = definition.goal;

  const name = secret
    ? t('achievements.hidden.name', 'Hidden achievement')
    : t(`achievements.items.${definition.key}.name`);
  const description = secret
    ? t('achievements.hidden.description', 'Keep using the app to find it.')
    : t(`achievements.items.${definition.key}.description`);

  return (
    <li className="flex items-start gap-3 py-3">
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          unlocked ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium', !unlocked && 'text-muted-foreground')}>
          {name}
        </p>
        <p className="text-sm text-muted-foreground">{description}</p>
        {unlocked ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('achievements.unlockedOn', {
              date: format(unlockedAt, 'PP', { locale: getDateLocale(language) }),
              defaultValue: 'Unlocked on {{date}}',
            })}
            {percent !== undefined && (
              <>
                {' · '}
                {t('achievements.percent', {
                  percent,
                  defaultValue: 'You are in the {{percent}}% of people who have it',
                })}
              </>
            )}
          </p>
        ) : (
          goal !== undefined &&
          !secret && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('achievements.progress', {
                current: Math.min(progress, goal.target),
                target: goal.target,
                defaultValue: '{{current}} / {{target}}',
              })}
            </p>
          )
        )}
      </div>
      <span className="sr-only">
        {unlocked
          ? t('achievements.status.unlocked', 'Unlocked')
          : t('achievements.status.locked', 'Locked')}
      </span>
    </li>
  );
});

// ============================================================================
// Component
// ============================================================================

/**
 * The achievements card of the settings page.
 *
 * @returns The card, folded until the user opens it.
 */
export const AchievementsCard = memo(function AchievementsCard(): ReactElement {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState<AchievementStats | null>(null);

  const unlocked = useLiveQuery(async () => {
    const rows = await db.achievements.toArray();
    return new Map(
      rows.flatMap((row) =>
        isAchievementKey(row.key) ? [[row.key, row.unlockedAt] as const] : [],
      ),
    );
  }, []);

  const counters = useLiveQuery(async () => {
    const rows = await db.achievementCounters.toArray();
    return new Map(rows.map((row) => [row.key, row.value]));
  }, []);

  const handleToggle = useCallback((): void => {
    setIsOpen((previous) => !previous);
  }, []);

  // The numbers are asked for once the card is open, and again for another
  // account. A failure leaves them out rather than showing a wrong one.
  useEffect(() => {
    if (!isOpen || !userId) {
      setStats(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const client = await getSupabaseClient();
      const next = client ? await fetchAchievementStats(client) : null;
      if (!cancelled) {
        setStats(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, userId]);

  const unlockedCount = unlocked?.size ?? 0;

  const groups = useMemo(
    () =>
      GROUPS.map((kind) => ({
        kind,
        items: ACHIEVEMENTS.filter((a) => a.kind === kind),
      })),
    [],
  );

  return (
    <Card>
      <CardHeader>
        <h2>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={handleToggle}
            aria-expanded={isOpen}
            aria-controls={LIST_ID}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Trophy className="size-5 text-primary" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <CardTitle className="text-base">
                {t('achievements.title', 'Achievements')}
              </CardTitle>
              <CardDescription>
                {t('achievements.summary', {
                  count: unlockedCount,
                  total: ACHIEVEMENTS.length,
                  defaultValue: '{{count}} of {{total}} unlocked',
                })}
              </CardDescription>
            </span>
            <ChevronDown
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform',
                isOpen && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </button>
        </h2>
      </CardHeader>

      {isOpen && (
        <CardContent id={LIST_ID} className="space-y-5">
          {groups.map(({ kind, items }) => (
            <section key={kind} aria-labelledby={`achievements-group-${kind}`}>
              <h3
                id={`achievements-group-${kind}`}
                className="font-display text-sm font-semibold"
              >
                {t(`achievements.groups.${kind}`)}
              </h3>
              <ul className="divide-y">
                {items.map((definition) => (
                  <AchievementRow
                    key={definition.key}
                    definition={definition}
                    unlockedAt={unlocked?.get(definition.key)}
                    progress={
                      definition.goal ? (counters?.get(definition.goal.counter) ?? 0) : 0
                    }
                    percent={stats?.get(definition.key)}
                    language={i18n.language}
                  />
                ))}
              </ul>
            </section>
          ))}
          {!userId && (
            <p className="text-xs text-muted-foreground">
              {t(
                'achievements.signInForStats',
                'Sign in to see how many people have each achievement.',
              )}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
});
