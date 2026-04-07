/**
 * @fileoverview Calendar timeline (horizontal) view.
 *
 * @module features/calendar/components/CalendarTimeline
 */

import { type ReactElement, memo, useMemo } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { toISODateString } from '@/lib/db/utils';
import type { CalendarTimelineProps } from '../types';
import { buildCalendarTimelineModel } from '../utils/timeline-utils';
import { CalendarTimelineRow } from './CalendarTimelineRow';

// ============================================================================
// Constants
// ============================================================================

const DAY_WIDTH_PX = 44;
const PERSON_COL_PX = 200;

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

  const dayCount = model.tripDays.length;
  const canvasWidth = dayCount * DAY_WIDTH_PX;

  const todayKey = toISODateString(props.today);
  const todayIndex = model.dayKeys.indexOf(todayKey);
  const showTodayLine = todayIndex >= 0;

  return (
    <div
      role="region"
      aria-label={t('calendar.timeline.ariaLabel', 'Timeline calendar')}
      className="border rounded-lg overflow-hidden"
    >
      <div className="max-h-[70vh] overflow-auto">
        <div style={{ width: PERSON_COL_PX + canvasWidth }}>
          {/* Sticky top header */}
          <div className="sticky top-0 z-20 flex border-b border-muted bg-background">
            <div
              className="sticky left-0 z-30 border-r border-muted bg-background px-3 py-2"
              style={{ width: PERSON_COL_PX, minWidth: PERSON_COL_PX }}
            >
              <span className="text-sm font-medium">
                {t('calendar.timeline.persons', 'Guests')}
              </span>
            </div>

            <div className="relative" style={{ width: canvasWidth }}>
              <div className="flex">
                {model.tripDays.map((day) => {
                  const key = toISODateString(day);
                  const monthLabel = format(day, 'MMM', { locale: props.dateLocale });
                  const dayLabel = format(day, 'dd', { locale: props.dateLocale });
                  const isToday = key === todayKey;

                  return (
                    <div
                      key={key}
                      className={cn(
                        'border-r border-muted px-1 py-2 text-xs text-muted-foreground',
                        isToday && 'text-foreground font-semibold',
                      )}
                      style={{ width: DAY_WIDTH_PX }}
                      title={format(day, 'PPPP', { locale: props.dateLocale })}
                    >
                      <div className="flex flex-col items-center leading-none">
                        <div className="text-[10px] text-muted-foreground/80 truncate">
                          {monthLabel}
                        </div>
                        <div className="font-medium text-foreground tabular-nums truncate">
                          {dayLabel}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {showTodayLine && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-primary"
                  style={{ left: todayIndex * DAY_WIDTH_PX + DAY_WIDTH_PX / 2 }}
                  aria-hidden="true"
                />
              )}
            </div>
          </div>

          {/* Rows */}
          <div role="list" aria-label={t('calendar.timeline.rows', 'Timeline rows')}>
            {model.rows.map((row) => (
              <div key={row.person.id} role="listitem">
                <CalendarTimelineRow
                  model={row}
                  dayCount={dayCount}
                  onAssignmentClick={props.onAssignmentClick}
                  onTransportClick={props.onTransportClick}
                />
              </div>
            ))}
          </div>

          {/* Empty state */}
          {props.assignments.length === 0 &&
            props.arrivals.length === 0 &&
            props.departures.length === 0 &&
            model.rows.every((r) => r.staySpan === undefined) && (
            <div className="p-6 text-center text-muted-foreground">
              {t('calendar.noAssignments')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export { CalendarTimeline };

