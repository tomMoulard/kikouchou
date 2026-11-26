/**
 * @fileoverview The achievements, on the settings page, folded by default.
 *
 * The header always says how many are unlocked. Opened, the card shows one
 * tile per family: a ring for the way to the next stage, the stage reached,
 * and how many more the next one needs. A tile unfolds into its five stages,
 * each with its target and the day it was reached. Below the families, the
 * specials: three milestones, and five secrets that keep their name and their
 * hint to themselves until they are unlocked.
 *
 * Signed in, the stage a family has reached, and each special held, says how
 * many people hold it. The numbers come from `achievement_stats()` and are
 * asked for when the card opens, not before: a folded card costs no request.
 *
 * @module features/achievements/components/AchievementsCard
 */

import { memo, useCallback, useEffect, useId, useState, type ReactElement } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import {
  BedDouble,
  CalendarCheck,
  CalendarDays,
  Car,
  Check,
  ChevronDown,
  ChevronRight,
  Coins,
  Languages,
  Lock,
  Luggage,
  MessageCircle,
  Moon,
  MoonStar,
  PawPrint,
  Plane,
  Share2,
  Tent,
  Trophy,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { useAuth } from '@/features/auth/AuthContext';

import {
  ACHIEVEMENT_FAMILIES,
  ACHIEVEMENT_KEYS,
  ACHIEVEMENT_SPECIALS,
  familyProgress,
  fetchAchievementStats,
  isAchievementKey,
  type AchievementFamily,
  type AchievementFamilyId,
  type AchievementSpecial,
  type AchievementSpecialKey,
  type AchievementStats,
} from '@/lib/achievements';
import { db } from '@/lib/db/database';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { getSupabaseClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

// ============================================================================
// Constants
// ============================================================================

const FAMILY_ICONS: Readonly<Record<AchievementFamilyId, LucideIcon>> = {
  trips: Luggage,
  guests: UserPlus,
  activities: Tent,
  transports: Plane,
  rides: Car,
  rooms: BedDouble,
  money: Coins,
  assistant: MessageCircle,
  loyalty: CalendarCheck,
};

const SPECIAL_ICONS: Readonly<Record<AchievementSpecialKey, LucideIcon>> = {
  full_room: BedDouble,
  group_activity: Users,
  trip_shared: Share2,
  midnight_pet: Moon,
  petting_zoo: PawPrint,
  leap_day: CalendarDays,
  polyglot: Languages,
  night_owl: MoonStar,
};

const LIST_ID = 'achievements-list';

/** The ring's geometry, in its own 64-unit box. */
const RING_RADIUS = 28;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// ============================================================================
// Ring
// ============================================================================

interface ProgressRingProps {
  readonly fraction: number;
  readonly complete: boolean;
  readonly started: boolean;
  readonly icon: LucideIcon;
}

/** The way to the next stage, around the family's icon. Decorative. */
const ProgressRing = memo(function ProgressRing({
  fraction,
  complete,
  started,
  icon: Icon,
}: ProgressRingProps): ReactElement {
  return (
    <div className="relative size-16 shrink-0" aria-hidden="true">
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle
          cx="32"
          cy="32"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="5"
          className="stroke-muted"
        />
        {fraction > 0 && (
          <circle
            cx="32"
            cy="32"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
            className={complete ? 'stroke-success' : 'stroke-primary'}
          />
        )}
      </svg>
      <span
        className={cn(
          'absolute inset-2 flex items-center justify-center rounded-full',
          started ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          complete && 'bg-success-surface text-success-on-surface',
        )}
      >
        <Icon className="size-6" />
      </span>
    </div>
  );
});

// ============================================================================
// Family
// ============================================================================

interface FamilyTileProps {
  readonly family: AchievementFamily;
  readonly value: number;
  readonly unlocked: ReadonlyMap<string, number>;
  readonly stats: AchievementStats | null;
  readonly language: string;
}

const FamilyTile = memo(function FamilyTile({
  family,
  value,
  unlocked,
  stats,
  language,
}: FamilyTileProps): ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const stagesId = useId();
  const held = new Set(unlocked.keys());
  const progress = familyProgress(family, value, held);
  const current = progress.reached >= 0 ? family.stages[progress.reached] : undefined;
  const complete = progress.next === null;
  const percent = current ? stats?.get(current.key) : undefined;
  const familyName = t(`achievements.families.${family.id}.name`);

  const handleToggle = useCallback((): void => {
    setIsOpen((previous) => !previous);
  }, []);

  return (
    <li className="rounded-lg border p-3">
      <div className="flex items-start gap-3">
        <ProgressRing
          fraction={progress.fraction}
          complete={complete}
          started={current !== undefined}
          icon={FAMILY_ICONS[family.id]}
        />
        <div className="min-w-0 flex-1">
          <h4 className="font-display text-base font-semibold leading-tight">{familyName}</h4>
          <p
            className={cn(
              'text-sm font-medium',
              current ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {current
              ? t(`achievements.stages.${current.key}`)
              : t('achievements.notStarted', 'Not started yet')}
          </p>
          <p className="text-sm text-muted-foreground">
            {progress.next
              ? t(`achievements.families.${family.id}.next`, {
                  count: progress.remaining,
                  stage: t(`achievements.stages.${progress.next.key}`),
                })
              : t('achievements.complete', 'Every stage reached')}
          </p>
          {percent !== undefined && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('achievements.percent', {
                percent,
                defaultValue: 'You are in the {{percent}}% of people who have it',
              })}
            </p>
          )}
        </div>
        <button
          type="button"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={handleToggle}
          aria-expanded={isOpen}
          aria-controls={stagesId}
          aria-label={t('achievements.showStages', {
            family: familyName,
            defaultValue: 'Stages of {{family}}',
          })}
        >
          <ChevronDown
            className={cn('size-4 transition-transform', isOpen && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
      </div>

      {isOpen && (
        <div id={stagesId} className="mt-3 border-t pt-3">
          <p className="mb-2 text-xs text-muted-foreground">
            {t(`achievements.families.${family.id}.description`)}
          </p>
          <ol className="space-y-1.5">
            {family.stages.map((stage, index) => {
              const reached = index <= progress.reached,
                isNext = index === progress.reached + 1,
                unlockedAt = unlocked.get(stage.key),
                StateIcon = reached ? Check : isNext ? ChevronRight : Lock;
              return (
                <li
                  key={stage.key}
                  className={cn(
                    'grid grid-cols-[1rem_1fr_auto_auto] items-center gap-x-2 gap-y-1 text-sm',
                    !reached && !isNext && 'text-muted-foreground',
                    isNext && 'font-semibold',
                  )}
                >
                  <StateIcon
                    className={cn('size-4', reached && 'text-success-on-surface')}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 break-words">
                    {t(`achievements.stages.${stage.key}`)}
                    <span className="sr-only">
                      {' · '}
                      {reached
                        ? t('achievements.status.unlocked', 'Unlocked')
                        : isNext
                          ? t('achievements.status.next', 'Next')
                          : t('achievements.status.locked', 'Locked')}
                    </span>
                  </span>
                  <span className="tabular-nums">{stage.target}</span>
                  <span className="min-w-12 text-right text-xs text-muted-foreground">
                    {reached && unlockedAt !== undefined
                      ? format(unlockedAt, 'd MMM', { locale: getDateLocale(language) })
                      : ''}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </li>
  );
});

// ============================================================================
// Special
// ============================================================================

interface SpecialRowProps {
  readonly special: AchievementSpecial;
  readonly unlockedAt: number | undefined;
  readonly progress: number;
  readonly percent: number | undefined;
  readonly language: string;
}

const SpecialRow = memo(function SpecialRow({
  special,
  unlockedAt,
  progress,
  percent,
  language,
}: SpecialRowProps): ReactElement {
  const { t } = useTranslation();
  const unlocked = unlockedAt !== undefined;
  const secret = special.kind === 'hidden' && !unlocked;
  const Icon = secret ? Lock : SPECIAL_ICONS[special.key];
  const goal = special.goal;

  const name = secret
    ? t('achievements.hidden.name', 'Hidden achievement')
    : t(`achievements.items.${special.key}.name`);
  const description = secret
    ? t('achievements.hidden.description', 'Keep using the app to find it.')
    : t(`achievements.items.${special.key}.description`);

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
    return new Map<string, number>(
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

  const held = unlocked ?? new Map<string, number>();

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
                  count: held.size,
                  total: ACHIEVEMENT_KEYS.length,
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
          <section aria-labelledby="achievements-group-families">
            <h3
              id="achievements-group-families"
              className="mb-2 font-display text-sm font-semibold"
            >
              {t('achievements.groups.families', 'Families')}
            </h3>
            <ul className="grid items-start gap-3 md:grid-cols-2">
              {ACHIEVEMENT_FAMILIES.map((family) => (
                <FamilyTile
                  key={family.id}
                  family={family}
                  value={counters?.get(family.counter) ?? 0}
                  unlocked={held}
                  stats={stats}
                  language={i18n.language}
                />
              ))}
            </ul>
          </section>

          <section aria-labelledby="achievements-group-specials">
            <h3 id="achievements-group-specials" className="font-display text-sm font-semibold">
              {t('achievements.groups.specials', 'Specials')}
            </h3>
            <ul className="divide-y">
              {ACHIEVEMENT_SPECIALS.map((special) => (
                <SpecialRow
                  key={special.key}
                  special={special}
                  unlockedAt={held.get(special.key)}
                  progress={special.goal ? (counters?.get(special.goal.counter) ?? 0) : 0}
                  percent={stats?.get(special.key)}
                  language={i18n.language}
                />
              ))}
            </ul>
          </section>

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
