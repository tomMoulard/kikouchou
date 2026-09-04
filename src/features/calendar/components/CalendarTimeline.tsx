/**
 * @fileoverview Calendar timeline (horizontal) view.
 *
 * @module features/calendar/components/CalendarTimeline
 */

import { type ReactElement, type ReactNode, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar as CalendarIcon, Users } from 'lucide-react';

import { EmptyState } from '@/components/shared/EmptyState';
import { TripTimelineFrame } from '@/components/shared/TripTimelineFrame';
import { ActivityTimelineRow } from '@/features/activities/components/ActivityTimelineRow';
import { buildActivityTimelineModel } from '@/features/activities/utils/activity-timeline-utils';
import { toLocalISODateString } from '@/lib/db/utils';
import type { ISODateString } from '@/types';
import type { CalendarTimelineProps } from '../types';
import { buildDailyHeadcounts } from '../utils/headcount-utils';
import { buildCalendarTimelineModel } from '../utils/timeline-utils';
import { CalendarTimelineRow } from './CalendarTimelineRow';

// ============================================================================
// Constants
// ============================================================================

/**
 * Width of the sticky guest-name column.
 *
 * Exported because the page's own width decision has to count the same number
 * of pixels this frame reserves — see `timelineNeedsFullPageWidth`.
 */
export const CALENDAR_TIMELINE_LABEL_COLUMN_WIDTH_PX = 200;

// ============================================================================
// Component
// ============================================================================

const CalendarTimeline = memo(function CalendarTimeline(props: CalendarTimelineProps): ReactElement {
  const { t } = useTranslation();

  const model = useMemo(
    () =>
      buildCalendarTimelineModel({
        trip: props.trip,
        persons: props.persons,
        rooms: props.rooms,
        assignments: props.assignments,
        arrivals: props.arrivals,
        departures: props.departures,
        unknownLabel: t('common.unknown'),
      }),
    [
      props.trip,
      props.persons,
      props.rooms,
      props.assignments,
      props.arrivals,
      props.departures,
      t,
    ],
  );

  // The shared agenda gets its own bands under the guest rows; it reuses the
  // same day axis, so the two halves of the timeline always line up.
  const activityModel = useMemo(
    () =>
      buildActivityTimelineModel({
        trip: props.trip,
        activities: props.activities,
      }),
    [props.trip, props.activities],
  );

  const todayKey = toLocalISODateString(props.today) as ISODateString;

  // People on site each night — hosts read this row to plan meals.
  const headcountsByDate = useMemo(
    () =>
      buildDailyHeadcounts({
        persons: props.persons,
        arrivals: props.arrivals,
        departures: props.departures,
        assignments: props.assignments,
        tripWindow: { startDate: props.trip.startDate, endDate: props.trip.endDate },
        dayKeys: model.dayKeys,
      }),
    [
      model.dayKeys,
      props.arrivals,
      props.assignments,
      props.departures,
      props.persons,
      props.trip.endDate,
      props.trip.startDate,
    ],
  );

  const renderDayHeadcount = useCallback(
    (dayKey: ISODateString): ReactNode => {
      const people = headcountsByDate.get(dayKey)?.people ?? 0;
      if (people === 0) {
        return null;
      }

      const label = t('calendar.peopleOnSite', '{{count}} people on site', { count: people });

      return (
        <div
          className="mt-1 flex items-center gap-0.5 text-xs text-muted-foreground"
          title={label}
          data-testid={`timeline-headcount-${dayKey}`}
        >
          <Users className="size-2.5 shrink-0" aria-hidden="true" />
          <span className="tabular-nums" aria-hidden="true">
            {people}
          </span>
          <span className="sr-only">{label}</span>
        </div>
      );
    },
    [headcountsByDate, t],
  );

  const showEmptyState =
    props.assignments.length === 0 &&
    props.arrivals.length === 0 &&
    props.departures.length === 0 &&
    activityModel.rows.length === 0 &&
    model.rows.every((r) => r.staySpan === undefined);

  const handleActivityClick = props.onActivityClick;

  const frame = (
    <TripTimelineFrame
      ariaLabel={t('calendar.timeline.ariaLabel', 'Timeline calendar')}
      labelColumnWidth={CALENDAR_TIMELINE_LABEL_COLUMN_WIDTH_PX}
      leftHeader={<span className="text-sm font-medium">{t('calendar.timeline.persons', 'Guests')}</span>}
      days={model.tripDays}
      dayKeys={model.dayKeys}
      dateLocale={props.dateLocale}
      todayKey={todayKey}
      renderDayMeta={renderDayHeadcount}
    >
      {(viewport) => (
        <>
          <div role="list" aria-label={t('calendar.timeline.rows', 'Timeline rows')}>
            {model.rows.map((row) => (
              <div key={row.person.id} role="listitem">
                <CalendarTimelineRow
                  model={row}
                  viewport={viewport}
                  tripDays={model.tripDays}
                  dateLocale={props.dateLocale}
                  onAssignmentClick={props.onAssignmentClick}
                  onTransportClick={props.onTransportClick}
                />
              </div>
            ))}
          </div>

          {activityModel.rows.length > 0 && handleActivityClick && (
            <>
              <div
                className="sticky left-0 border-t-2 border-muted bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                style={{ width: viewport.labelColumnWidth + viewport.canvasWidth }}
              >
                {t('activities.title')}
              </div>
              <div role="list" aria-label={t('activities.timeline.rows', 'Timeline rows')}>
                {activityModel.rows.map((row) => (
                  <div key={`activity-${row.category}`} role="listitem">
                    <ActivityTimelineRow
                      model={row}
                      viewport={viewport}
                      dateLocale={props.dateLocale}
                      onActivityClick={handleActivityClick}
                    />
                  </div>
                ))}
              </div>
            </>
          )}

        </>
      )}
    </TripTimelineFrame>
  );

  if (!showEmptyState) {
    return frame;
  }

  return (
    <>
      {frame}
      {/* Outside the frame on purpose. The frame's canvas is as wide as the
          trip is long — 32 days is ~1450px — and it scrolls horizontally
          inside the viewport. An `mx-auto` empty state in there centres on the
          canvas, not on the screen, so on a phone it sat several hundred
          pixels off to the right and simply could not be seen. Out here it
          centres on the page, which is where a "nothing here yet" message and
          its two buttons belong anyway.

          Same EmptyState, copy and icon as the month view's, so switching
          views does not change how "nothing here yet" is presented. */}
      <EmptyState
        icon={CalendarIcon}
        title={t('calendar.noAssignmentsTitle', 'Nothing scheduled yet')}
        description={t('calendar.noAssignments')}
        action={
          props.onAddGuests
            ? {
                label: t('calendar.addGuests', 'Add guests'),
                onClick: props.onAddGuests,
              }
            : undefined
        }
        secondaryAction={
          props.onAddRooms
            ? {
                label: t('calendar.addRooms', 'Add rooms'),
                onClick: props.onAddRooms,
              }
            : undefined
        }
      />
    </>
  );
});

export { CalendarTimeline };
