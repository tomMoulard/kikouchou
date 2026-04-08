/**
 * @fileoverview Calendar timeline (horizontal) view.
 *
 * @module features/calendar/components/CalendarTimeline
 */

import { type ReactElement, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { TripTimelineFrame } from '@/components/shared/TripTimelineFrame';
import { toLocalISODateString } from '@/lib/db/utils';
import type { ISODateString } from '@/types';
import type { CalendarTimelineProps } from '../types';
import { buildCalendarTimelineModel } from '../utils/timeline-utils';
import { CalendarTimelineRow } from './CalendarTimelineRow';

// ============================================================================
// Constants
// ============================================================================

const TIMELINE_LABEL_COL_PX = 200;

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

  const todayKey = toLocalISODateString(props.today) as ISODateString;

  const showEmptyState =
    props.assignments.length === 0 &&
    props.arrivals.length === 0 &&
    props.departures.length === 0 &&
    model.rows.every((r) => r.staySpan === undefined);

  return (
    <TripTimelineFrame
      ariaLabel={t('calendar.timeline.ariaLabel', 'Timeline calendar')}
      labelColumnWidth={TIMELINE_LABEL_COL_PX}
      leftHeader={<span className="text-sm font-medium">{t('calendar.timeline.persons', 'Guests')}</span>}
      days={model.tripDays}
      dayKeys={model.dayKeys}
      dateLocale={props.dateLocale}
      todayKey={todayKey}
    >
      {(viewport) => (
        <>
          <div role="list" aria-label={t('calendar.timeline.rows', 'Timeline rows')}>
            {model.rows.map((row) => (
              <div key={row.person.id} role="listitem">
                <CalendarTimelineRow
                  model={row}
                  viewport={viewport}
                  dateLocale={props.dateLocale}
                  onAssignmentClick={props.onAssignmentClick}
                  onTransportClick={props.onTransportClick}
                />
              </div>
            ))}
          </div>

          {showEmptyState && (
            <div className="p-6 text-center text-muted-foreground">{t('calendar.noAssignments')}</div>
          )}
        </>
      )}
    </TripTimelineFrame>
  );
});

export { CalendarTimeline };
