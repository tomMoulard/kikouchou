/**
 * @fileoverview Day-by-day planning of a trip's activities.
 *
 * One section per day, and in each day the activities in the order they
 * happen: what the group does in the morning, at noon, in the evening. It
 * replaced the category bands ("Meals", "Sport"…) that both the calendar and
 * the activities page used to draw, because a row per kind of activity did not
 * answer "what are we doing on Saturday?".
 *
 * @module features/activities/components/ActivityAgenda
 */

import { type ReactElement, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { format, isValid, parseISO } from 'date-fns';
import type { Locale } from 'date-fns/locale';
import { MapPin, Users } from 'lucide-react';

import { ActivityCategoryIcon } from '@/components/shared/ActivityCategoryIcon';
import { toLocalISODateString } from '@/lib/db/utils';
import { cn } from '@/lib/utils';
import { getActivityCategoryColor } from '@/types';
import type { Activity } from '@/types';

import {
  type ActivityAgendaDay,
  type ActivityAgendaEntry,
  buildActivityAgenda,
} from '../utils/activity-agenda-utils';
import { getActivityEndDayKey, getActivityStartDayKey } from '../utils/activity-utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the ActivityAgenda component.
 */
export interface ActivityAgendaProps {
  /** Activities to lay out */
  readonly activities: readonly Activity[];
  /** Date locale for the day headers and the times */
  readonly dateLocale: Locale;
  /** Today's date, marked on its day */
  readonly today: Date;
  /** Callback when an activity is clicked */
  readonly onActivityClick: (activity: Activity) => void;
  /**
   * Level of the day headings. The activities page has nothing between its
   * title and the days, the calendar has its own "Planning" heading.
   */
  readonly headingLevel?: 2 | 3;
  /** Additional CSS classes */
  readonly className?: string;
}

interface AgendaEntryRowProps {
  readonly entry: ActivityAgendaEntry;
  readonly dateLocale: Locale;
  readonly onActivityClick: (activity: Activity) => void;
}

interface AgendaDaySectionProps {
  readonly day: ActivityAgendaDay;
  readonly isToday: boolean;
  readonly isPast: boolean;
  readonly headingLevel: 2 | 3;
  readonly dateLocale: Locale;
  readonly onActivityClick: (activity: Activity) => void;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Formats a time of an instant, or returns undefined when it does not parse.
 */
function formatTime(instant: string | undefined, locale: Locale): string | undefined {
  if (!instant) {
    return undefined;
  }
  const parsed = parseISO(instant);
  return isValid(parsed) ? format(parsed, 'HH:mm', { locale }) : undefined;
}

// ============================================================================
// AgendaEntryRow Component
// ============================================================================

/**
 * One activity on one day: its time, what it is, where, and who goes.
 */
const AgendaEntryRow = memo(function AgendaEntryRow({
  entry,
  dateLocale,
  onActivityClick,
}: AgendaEntryRowProps): ReactElement {
  const { t } = useTranslation();
  const { activity, dayNumber, dayCount } = entry;

  const categoryColor = getActivityCategoryColor(activity.category);
  const categoryLabel = t(`activities.categories.${activity.category}`);
  const participantCount = activity.participantIds?.length ?? 0;
  const cap = activity.maxParticipants;

  // The first line of the time column. A multi-day activity says which of its
  // days this is wherever a clock time would mean nothing: on the days after
  // the first, and on every day of a whole-day one.
  const isSpanDay = dayCount > 1 && (dayNumber > 1 || activity.allDay);
  const startLabel = isSpanDay
    ? t('activities.agenda.dayOfSpan', {
        defaultValue: 'Day {{day}} of {{count}}',
        day: dayNumber,
        count: dayCount,
      })
    : activity.allDay
      ? t('activities.allDay')
      : formatTime(activity.startDatetime, dateLocale);

  // The end time, only when it is on the same day: a multi-day activity's end
  // is the last of its days in this planning.
  const endLabel =
    !activity.allDay &&
    dayCount === 1 &&
    getActivityStartDayKey(activity) === getActivityEndDayKey(activity)
      ? formatTime(activity.endDatetime, dateLocale)
      : undefined;

  const participantLabel =
    cap === undefined
      ? t('activities.participantCount', {
          count: participantCount,
          defaultValue_one: '{{count}} participant',
          defaultValue_other: '{{count}} participants',
        })
      : t('activities.participantCountCapped', {
          count: participantCount,
          max: cap,
          defaultValue_one: '{{count}}/{{max}} participant',
          defaultValue_other: '{{count}}/{{max}} participants',
        });

  return (
    <li>
      <button
        type="button"
        onClick={() => onActivityClick(activity)}
        className={cn(
          'flex w-full items-start gap-3 px-3 py-2.5 text-left',
          'transition-colors hover:bg-muted/50',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        )}
      >
        <span className="flex w-16 shrink-0 flex-col pt-0.5 text-xs tabular-nums sm:w-20">
          <span className="font-semibold text-foreground">{startLabel}</span>
          {endLabel && <span className="text-muted-foreground">{endLabel}</span>}
        </span>

        <ActivityCategoryIcon
          category={activity.category}
          className="mt-0.5 size-4 shrink-0"
          style={{ color: categoryColor }}
          aria-label={categoryLabel}
        />

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{activity.title}</span>
          {activity.location && (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{activity.location}</span>
            </span>
          )}
        </span>

        {(participantCount > 0 || cap !== undefined) && (
          <span
            className="flex shrink-0 items-center gap-1 pt-0.5 text-xs tabular-nums text-muted-foreground"
            title={participantLabel}
          >
            <Users className="size-3" aria-hidden="true" />
            <span aria-hidden="true">
              {cap === undefined ? participantCount : `${participantCount}/${cap}`}
            </span>
            <span className="sr-only">{participantLabel}</span>
          </span>
        )}
      </button>
    </li>
  );
});

// ============================================================================
// AgendaDaySection Component
// ============================================================================

/**
 * One day of the planning, with its heading.
 */
const AgendaDaySection = memo(function AgendaDaySection({
  day,
  isToday,
  isPast,
  headingLevel,
  dateLocale,
  onActivityClick,
}: AgendaDaySectionProps): ReactElement {
  const { t } = useTranslation();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const headingId = `activity-agenda-day-${day.dateKey}`;

  return (
    <section aria-labelledby={headingId} data-testid={`activity-agenda-day-${day.dateKey}`}>
      <Heading
        id={headingId}
        className={cn(
          'mb-2 flex items-center gap-2 px-1 text-sm font-semibold first-letter:uppercase',
          isPast ? 'text-muted-foreground/60' : 'text-muted-foreground',
          isToday && 'text-foreground',
        )}
      >
        {day.displayDate}
        {isToday && (
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            {t('calendar.today')}
          </span>
        )}
      </Heading>

      <ul
        className={cn(
          'divide-y overflow-hidden rounded-lg border bg-card',
          isToday && 'border-primary/50',
        )}
      >
        {day.entries.map((entry) => (
          <AgendaEntryRow
            key={entry.id}
            entry={entry}
            dateLocale={dateLocale}
            onActivityClick={onActivityClick}
          />
        ))}
      </ul>
    </section>
  );
});

// ============================================================================
// ActivityAgenda Component
// ============================================================================

/**
 * Renders the trip's activities as a day-by-day planning.
 *
 * Renders nothing when no activity has a readable day: the caller owns the
 * empty state, because only it knows what to offer.
 *
 * @param props - Component props
 * @returns The planning element, or null when there is nothing to list
 *
 * @example
 * ```tsx
 * <ActivityAgenda
 *   activities={activities}
 *   dateLocale={dateLocale}
 *   today={today}
 *   onActivityClick={openDetails}
 * />
 * ```
 */
const ActivityAgenda = memo(function ActivityAgenda({
  activities,
  dateLocale,
  today,
  onActivityClick,
  headingLevel = 2,
  className,
}: ActivityAgendaProps): ReactElement | null {
  const days = useMemo(
    () => buildActivityAgenda(activities, dateLocale),
    [activities, dateLocale],
  );

  const todayKey = toLocalISODateString(today);

  if (days.length === 0) {
    return null;
  }

  return (
    <div className={cn('space-y-5', className)}>
      {days.map((day) => (
        <AgendaDaySection
          key={day.dateKey}
          day={day}
          isToday={day.dateKey === todayKey}
          isPast={day.dateKey < todayKey}
          headingLevel={headingLevel}
          dateLocale={dateLocale}
          onActivityClick={onActivityClick}
        />
      ))}
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ActivityAgenda };
