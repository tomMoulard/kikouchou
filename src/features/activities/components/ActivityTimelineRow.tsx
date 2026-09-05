/**
 * @fileoverview One category band of the activity timeline.
 *
 * @module features/activities/components/ActivityTimelineRow
 */

import { type ReactElement, memo, useCallback, useMemo } from 'react';
import type { Locale } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';

import { ActivityCategoryIcon } from '@/components/shared/ActivityCategoryIcon';
import { TIMELINE_LABEL_CELL_STYLE } from '@/components/shared/timeline-label-cell';
import type { TripTimelineViewportContext } from '@/components/shared/TripTimelineFrame';
import { cn } from '@/lib/utils';
import { getActivityCategoryColor } from '@/types';
import type { Activity } from '@/types';

import { getContrastTextColor } from '@/features/calendar/utils/calendar-utils';
import { formatActivityTimeRange } from '../utils/activity-utils';
import type { ActivityTimelineRowModel } from '../utils/activity-timeline-utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the ActivityTimelineRow component.
 */
export interface ActivityTimelineRowProps {
  /** The category band to render */
  readonly model: ActivityTimelineRowModel;
  /** Layout metrics from the surrounding timeline frame */
  readonly viewport: TripTimelineViewportContext;
  /** Date locale for the bar labels */
  readonly dateLocale: Locale;
  /** Callback when an activity bar is clicked */
  readonly onActivityClick: (activity: Activity) => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Renders every activity of one category as bars on the trip day axis.
 * Overlapping activities are stacked into lanes by the model builder.
 *
 * @param props - Component props
 * @returns The timeline row element
 */
const ActivityTimelineRow = memo(function ActivityTimelineRow({
  model,
  viewport,
  dateLocale,
  onActivityClick,
}: ActivityTimelineRowProps): ReactElement {
  const { t } = useTranslation();

  const {
    canvasWidth,
    cellWidthPx,
    dayCount,
    dayGridTemplateColumns,
    laneHeightPx,
    todayColumnIndex,
  } = viewport;

  const rowHeight = Math.max(1, model.laneCount) * laneHeightPx;
  const categoryColor = getActivityCategoryColor(model.category);
  const textColor = getContrastTextColor(categoryColor);
  const categoryLabel = t(`activities.categories.${model.category}`);

  const handleClick = useCallback(
    (activity: Activity) => {
      onActivityClick(activity);
    },
    [onActivityClick],
  );

  const renderedItems = useMemo(
    () =>
      model.items.map((item) => {
        const { activity } = item;
        const left = item.startIndex * cellWidthPx;
        const rawWidth = (item.endIndex - item.startIndex + 1) * cellWidthPx;
        const width = Math.max(12, Math.min(rawWidth, canvasWidth - left) - 4);
        const top = item.laneIndex * laneHeightPx + 2;

        const timeRange = activity.allDay
          ? t('activities.allDay')
          : formatActivityTimeRange(activity, dateLocale);

        const participantCount = activity.participantIds?.length ?? 0;
        const label = timeRange ? `${timeRange} · ${activity.title}` : activity.title;
        const description = t(
          'activities.timeline.barAria',
          '{{title}}. {{when}}. {{participants}} participants.',
          {
            title: activity.title,
            when: timeRange || categoryLabel,
            participants: participantCount,
          },
        );

        return (
          <button
            key={`${item.id}-${item.startIndex}-${item.laneIndex}`}
            type="button"
            onClick={() => handleClick(activity)}
            className={cn(
              'absolute z-[1] flex items-center gap-1.5 overflow-hidden rounded-md border px-2 text-xs',
              'transition-opacity hover:opacity-90',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            )}
            style={{
              left: left + 2,
              top,
              width,
              height: laneHeightPx - 6,
              backgroundColor: categoryColor,
              color: textColor,
            }}
            title={label}
            aria-label={description}
          >
            {timeRange && (
              <span className="shrink-0 font-semibold tabular-nums leading-none opacity-95">
                {timeRange}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-left font-medium leading-tight">
              {activity.title}
            </span>
            {participantCount > 0 && (
              <span
                className={cn(
                  'flex h-[18px] shrink-0 items-center justify-center rounded-full px-1',
                  'text-[9px] font-semibold leading-none tabular-nums',
                  /* eslint-disable kikouchou/no-raw-palette-class -- The pill sits on the activity's own colour, and `textColor` is the contrast decision made against it at runtime; a theme token knows nothing about that background. */
                  textColor === 'white'
                    ? 'bg-white/25 text-white'
                    : 'bg-black/12 text-black/80',
                  /* eslint-enable kikouchou/no-raw-palette-class */
                )}
                aria-hidden="true"
              >
                {participantCount}
              </span>
            )}
          </button>
        );
      }),
    [
      canvasWidth,
      categoryColor,
      categoryLabel,
      cellWidthPx,
      dateLocale,
      handleClick,
      laneHeightPx,
      model.items,
      t,
      textColor,
    ],
  );

  return (
    <div className="flex border-t border-muted">
      <div
        className={cn(
          'sticky left-0 z-10 flex items-center gap-2 border-r border-muted bg-background',
          viewport.labelsCollapsed ? 'justify-center px-1' : 'px-3',
        )}
        style={{
          ...TIMELINE_LABEL_CELL_STYLE,
          height: rowHeight,
        }}
        title={categoryLabel}
      >
        <ActivityCategoryIcon
          category={model.category}
          style={{ color: categoryColor }}
        />
        {/* Truncates with the fold rather than disappearing at a threshold —
            see the note in CalendarTimelineRow. */}
        <span className="min-w-0 truncate text-sm font-medium" title={categoryLabel}>
          {categoryLabel}
        </span>
        {!viewport.labelsCollapsed && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
            {model.items.length}
          </span>
        )}
      </div>

      <div
        className="relative min-w-0 overflow-hidden bg-background"
        style={{ width: canvasWidth, height: rowHeight }}
        aria-label={t('activities.timeline.categoryRow', '{{category}} timeline', {
          category: categoryLabel,
        })}
      >
        <div className="pointer-events-none absolute inset-0 z-0">
          <div
            className="grid h-full w-full min-w-0"
            style={
              dayGridTemplateColumns !== undefined
                ? { gridTemplateColumns: dayGridTemplateColumns }
                : undefined
            }
          >
            {Array.from({ length: dayCount }).map((_, index) => (
              <div
                key={`activity-grid-bg-${index}`}
                className={cn(
                  'h-full min-w-0 border-r border-muted/50',
                  todayColumnIndex === index
                    ? 'bg-primary/12'
                    : index % 2 === 0 && 'bg-muted/10',
                )}
              />
            ))}
          </div>
        </div>

        {renderedItems}
      </div>
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ActivityTimelineRow };
