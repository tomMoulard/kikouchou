/**
 * @fileoverview Horizontal timeline of the trip's activity agenda.
 * One band per category, activities drawn as bars across the trip days.
 *
 * @module features/activities/components/ActivityTimeline
 */

import { type ReactElement, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale } from 'date-fns/locale';
import { CalendarDays } from 'lucide-react';

import { EmptyState } from '@/components/shared/EmptyState';
import { TripTimelineFrame } from '@/components/shared/TripTimelineFrame';
import { toLocalISODateString } from '@/lib/db/utils';
import type { Activity, ISODateString, Trip } from '@/types';

import { buildActivityTimelineModel } from '../utils/activity-timeline-utils';
import { ActivityTimelineRow } from './ActivityTimelineRow';

// ============================================================================
// Constants
// ============================================================================

/** Width of the sticky category label column. */
const TIMELINE_LABEL_COL_PX = 160;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the ActivityTimeline component.
 */
export interface ActivityTimelineProps {
  /** The trip whose days form the axis */
  readonly trip: Trip;
  /** Activities to lay out */
  readonly activities: readonly Activity[];
  /** Date locale for headers and bar labels */
  readonly dateLocale: Locale;
  /** Today's date, highlighted in the header */
  readonly today: Date;
  /** Callback when an activity bar is clicked */
  readonly onActivityClick: (activity: Activity) => void;
  /**
   * Callback offered when every activity falls outside the trip dates, so the
   * timeline has nothing to draw but the list view still can. Without it that
   * state is a dead end.
   */
  readonly onShowAsList?: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Renders the trip agenda as a horizontal timeline.
 *
 * Activities are grouped into one row per category and stacked into lanes when
 * they overlap, so a busy day stays readable.
 *
 * @param props - Component props
 * @returns The activity timeline element
 *
 * @example
 * ```tsx
 * <ActivityTimeline
 *   trip={trip}
 *   activities={activities}
 *   dateLocale={dateLocale}
 *   today={today}
 *   onActivityClick={openDetails}
 * />
 * ```
 */
const ActivityTimeline = memo(function ActivityTimeline({
  trip,
  activities,
  dateLocale,
  today,
  onActivityClick,
  onShowAsList,
}: ActivityTimelineProps): ReactElement {
  const { t } = useTranslation();

  const model = useMemo(
    () => buildActivityTimelineModel({ trip, activities }),
    [trip, activities],
  );

  const todayKey = toLocalISODateString(today) as ISODateString;

  if (model.rows.length === 0) {
    // Activities exist, they just have no column on this trip's day axis.
    // Saying "no activity planned yet" here would be a plain lie. `hiddenCount`
    // alone is not enough: it also counts unparseable days, so only claim
    // "outside the trip dates" when it accounts for every activity there is.
    const isEverythingOutsideTrip =
      activities.length > 0 && model.hiddenCount === activities.length;

    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-lg border">
        <EmptyState
          icon={CalendarDays}
          title={
            isEverythingOutsideTrip
              ? t('activities.timeline.noneInRange', {
                  defaultValue: 'Nothing on the trip dates',
                })
              : t('activities.empty')
          }
          description={
            isEverythingOutsideTrip
              ? t('activities.timeline.allOutsideTrip', {
                  defaultValue:
                    'All {{count}} activities fall outside the trip dates.',
                  count: model.hiddenCount,
                })
              : t('activities.emptyDescription')
          }
          action={
            isEverythingOutsideTrip && onShowAsList
              ? {
                  label: t('activities.timeline.showAsList', {
                    defaultValue: 'Show as list',
                  }),
                  onClick: onShowAsList,
                }
              : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <TripTimelineFrame
        ariaLabel={t('activities.timeline.ariaLabel', 'Activity timeline')}
        labelColumnWidth={TIMELINE_LABEL_COL_PX}
        leftHeader={
          <span className="text-sm font-medium">
            {t('activities.timeline.categories', 'Categories')}
          </span>
        }
        days={model.tripDays}
        dayKeys={model.dayKeys}
        dateLocale={dateLocale}
        todayKey={todayKey}
      >
        {(viewport) => (
          <div role="list" aria-label={t('activities.timeline.rows', 'Timeline rows')}>
            {model.rows.map((row) => (
              <div key={row.category} role="listitem">
                <ActivityTimelineRow
                  model={row}
                  viewport={viewport}
                  dateLocale={dateLocale}
                  onActivityClick={onActivityClick}
                />
              </div>
            ))}
          </div>
        )}
      </TripTimelineFrame>

      {model.hiddenCount > 0 && (
        <p className="text-sm text-muted-foreground">
          {t('activities.timeline.hiddenCount', {
            defaultValue:
              '{{count}} activities fall outside the trip dates and are not shown.',
            count: model.hiddenCount,
          })}
        </p>
      )}
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ActivityTimeline };
