/**
 * @fileoverview Horizontal room occupancy timeline (one row per room).
 *
 * @module features/rooms/components/RoomOccupancyTimeline
 */

import { type CSSProperties, type ReactElement, memo, useMemo } from 'react';
import { differenceInCalendarDays, format, parseISO, subDays } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { TripTimelineFrame } from '@/components/shared/TripTimelineFrame';
import { cn } from '@/lib/utils';
import { timelineAssignmentBarStyle, TIMELINE_LANE_HEIGHT_PX } from '@/lib/utils/timeline-bar-geometry';
import type { ISODateString, Person, Room, RoomAssignment, Transport, Trip } from '@/types';
import { DroppableRoom } from '@/features/rooms/components/DroppableRoom';
import { DraggableGuest } from '@/features/rooms/components/DraggableGuest';
import { DraggableRoomAssignment } from '@/features/rooms/components/DraggableRoomAssignment';
import { DroppableAssignment } from '@/features/rooms/components/DroppableAssignment';
import { buildRoomTimelineModel } from '@/features/rooms/utils/room-timeline-utils';
import { GripVertical } from 'lucide-react';

// ============================================================================
// Constants
// ============================================================================

const ROOM_COL_PX_COMPACT = 140;

function buildUnassignedSegments(
  unassignedGuests: RoomOccupancyTimelineProps['unassignedGuests'],
  tripStart: Date,
  tripEnd: Date,
): readonly {
  readonly person: Person;
  readonly startDate: string;
  readonly endDate: string;
  readonly startOffset: number;
  readonly spanNights: number;
}[] {
  if (!unassignedGuests?.length) {
    return [];
  }
  return unassignedGuests
    .map(({ person, startDate, endDate }) => {
      const start = parseISO(startDate);
      const end = parseISO(endDate);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return null;
      }
      const lastNight = subDays(end, 1);
      if (lastNight < start) {
        return null;
      }

      const clippedStart = start < tripStart ? tripStart : start;
      const clippedEnd = lastNight > tripEnd ? tripEnd : lastNight;
      if (clippedEnd < clippedStart) {
        return null;
      }

      const startOffset = Math.max(0, differenceInCalendarDays(clippedStart, tripStart));
      const spanNights = Math.max(1, differenceInCalendarDays(clippedEnd, clippedStart) + 1);

      return { person, startDate, endDate, startOffset, spanNights };
    })
    .filter(
      (x): x is NonNullable<typeof x> => x !== null,
    );
}

// ============================================================================
// Component
// ============================================================================

export interface RoomOccupancyTimelineProps {
  readonly trip: Trip;
  readonly rooms: readonly Room[];
  readonly assignments: readonly RoomAssignment[];
  readonly arrivals: readonly Transport[];
  readonly departures: readonly Transport[];
  readonly persons: readonly Person[];
  readonly unassignedGuests?: readonly {
    readonly person: Person;
    readonly startDate: string;
    readonly endDate: string;
  }[];
  readonly dateLocale: import('date-fns/locale').Locale;
  readonly range: { readonly startDate: ISODateString; readonly endDate: ISODateString };
  /** Local-date key for “today” column highlight (optional). */
  readonly todayKey?: ISODateString;
}

const RoomOccupancyTimeline = memo(function RoomOccupancyTimeline({
  trip,
  rooms,
  assignments,
  arrivals,
  departures,
  persons,
  unassignedGuests = [],
  dateLocale,
  range,
  todayKey,
}: RoomOccupancyTimelineProps): ReactElement {
  const { t } = useTranslation();

  const personsById = useMemo(() => new Map<string, Person>(persons.map((p) => [p.id, p])), [persons]);

  const model = useMemo(
    () =>
      buildRoomTimelineModel({
        trip,
        range,
        rooms,
        assignments,
        personsById,
        unknownLabel: t('common.unknown'),
        arrivals,
        departures,
      }),
    [trip, range, rooms, assignments, arrivals, departures, personsById, t],
  );

  const dayCount = model.days.length;

  const tripStart = parseISO(range.startDate);
  const tripEnd = parseISO(range.endDate);

  const unassignedSegments = useMemo(
    () => buildUnassignedSegments(unassignedGuests, tripStart, tripEnd),
    [unassignedGuests, tripStart, tripEnd],
  );

  return (
    <TripTimelineFrame
      ariaLabel={t('rooms.timeline.ariaLabel', 'Room occupancy timeline')}
      labelColumnWidth={ROOM_COL_PX_COMPACT}
      leftHeader={<span className="text-sm font-medium">{t('rooms.title')}</span>}
      days={model.days}
      dayKeys={model.dayKeys}
      dateLocale={dateLocale}
      todayKey={todayKey}
    >
      {(viewport) => {
        const { canvasWidth, dayGridTemplateColumns, dayWidthPx, useFractionalColumns } = viewport;
        const dayDen = Math.max(1, dayCount);

        return (
          <>
            <div role="list" aria-label={t('rooms.timeline.rows', 'Room rows')}>
              {unassignedSegments.map((row) => {
                const left = (row.startOffset / dayDen) * canvasWidth;
                const width = (row.spanNights / dayDen) * canvasWidth;
                return (
                <div key={`unassigned-${row.person.id}`} role="listitem" className="flex border-t border-muted">
                  <div
                    className={cn(
                      'sticky left-0 z-10 bg-background border-r border-muted px-3 flex items-center gap-2',
                    )}
                    style={{
                      width: ROOM_COL_PX_COMPACT,
                      minWidth: ROOM_COL_PX_COMPACT,
                      height: TIMELINE_LANE_HEIGHT_PX,
                    }}
                    title={row.person.name}
                  >
                    <GripVertical className="size-4 text-muted-foreground/50" aria-hidden="true" />
                    <DraggableGuest
                      person={row.person}
                      startDate={row.startDate}
                      endDate={row.endDate}
                      size="sm"
                    />
                    <span className="text-xs text-muted-foreground">
                      {t('rooms.needsRoom', 'needs room')}
                    </span>
                  </div>

                  <div
                    className="relative bg-background"
                    style={{ width: canvasWidth, height: TIMELINE_LANE_HEIGHT_PX }}
                  >
                    <div className="absolute inset-0 pointer-events-none">
                      <div
                        className="grid h-full min-w-0"
                        style={
                          dayGridTemplateColumns !== undefined
                            ? { gridTemplateColumns: dayGridTemplateColumns }
                            : undefined
                        }
                      >
                        {Array.from({ length: dayCount }).map((_, i) => (
                          <div
                            key={`grid-unassigned-${row.person.id}-${i}`}
                            className={cn(
                              'min-w-0 h-full border-r border-muted/50',
                              i % 2 === 0 && 'bg-muted/10',
                              viewport.todayColumnIndex === i && 'bg-primary/12',
                            )}
                          />
                        ))}
                      </div>
                    </div>

                    <div
                      className="absolute top-1 bottom-1 rounded-md border border-dashed"
                      style={{
                        left: Math.max(2, left + 2),
                        width: Math.max(12, width - 4),
                        borderColor: row.person.color,
                        backgroundColor: `${row.person.color}22`,
                      }}
                      aria-hidden="true"
                    />
                  </div>
                </div>
                );
              })}

              {model.rows.map((row) => {
                const visualLaneCount = Math.max(row.laneCount, row.room.capacity);
                const rowHeight = Math.max(1, visualLaneCount) * TIMELINE_LANE_HEIGHT_PX;
                const bedsFree = row.room.capacity - row.laneCount;
                const rowAriaLabel =
                  row.room.capacity > 1 && bedsFree > 0
                    ? `${row.room.name}. ${t('rooms.spotsOpen', { count: bedsFree })}`
                    : row.room.name;

                return (
                  <div
                    key={row.room.id}
                    role="listitem"
                    className="flex border-t border-muted"
                    aria-label={rowAriaLabel}
                  >
                    <div
                      className={cn(
                        'sticky left-0 z-10 bg-background border-r border-muted px-3 flex',
                        row.room.capacity > 1
                          ? 'flex-col items-stretch justify-center gap-0.5 py-1'
                          : 'items-center',
                      )}
                      style={{
                        width: ROOM_COL_PX_COMPACT,
                        minWidth: ROOM_COL_PX_COMPACT,
                        height: rowHeight,
                      }}
                      title={
                        row.room.capacity > 1
                          ? `${row.room.name} — ${t('rooms.beds_plural', { count: row.room.capacity })}`
                          : row.room.name
                      }
                    >
                      <span className="text-sm font-medium truncate">{row.room.name}</span>
                      {row.room.capacity > 1 &&
                        (bedsFree > 0 || row.laneCount > row.room.capacity) && (
                          <span className="text-[11px] text-muted-foreground leading-tight truncate">
                            {bedsFree > 0
                              ? t('rooms.spotsOpen', { count: bedsFree })
                              : t('rooms.capacityWarning')}
                          </span>
                        )}
                    </div>

                    <DroppableRoom roomId={row.room.id} className="relative bg-background" disabled={false}>
                      <div className="relative" style={{ width: canvasWidth, height: rowHeight }}>
                        <div className="absolute inset-0 pointer-events-none">
                          <div
                            className="grid h-full min-w-0"
                            style={
                              dayGridTemplateColumns !== undefined
                                ? { gridTemplateColumns: dayGridTemplateColumns }
                                : undefined
                            }
                          >
                            {Array.from({ length: dayCount }).map((_, i) => (
                              <div
                                key={`grid-${row.room.id}-${i}`}
                                className={cn(
                                  'min-w-0 h-full border-r border-muted/50',
                                  i % 2 === 0 && 'bg-muted/10',
                                  viewport.todayColumnIndex === i && 'bg-primary/12',
                                )}
                              />
                            ))}
                          </div>
                        </div>

                        {row.room.capacity > 1 &&
                          Array.from({ length: row.room.capacity - 1 }, (_, i) => i + 1).map((k) => (
                            <div
                              key={`bed-slot-line-${row.room.id}-${k}`}
                              className="pointer-events-none absolute right-0 left-0 border-t border-muted-foreground/25"
                              style={{ top: k * TIMELINE_LANE_HEIGHT_PX }}
                              aria-hidden="true"
                            />
                          ))}

                        {row.laneCount < row.room.capacity &&
                          Array.from(
                            { length: row.room.capacity - row.laneCount },
                            (_, i) => row.laneCount + i,
                          ).map((laneIndex) => (
                            <div
                              key={`free-bed-track-${row.room.id}-${laneIndex}`}
                              role="presentation"
                              className="pointer-events-none absolute right-1 left-1 rounded-md border border-dashed border-primary/35 bg-primary/5"
                              style={{
                                top: laneIndex * TIMELINE_LANE_HEIGHT_PX + 2,
                                height: TIMELINE_LANE_HEIGHT_PX - 4,
                              }}
                              title={t(
                                'rooms.timeline.freeBedHint',
                                'Another bed is free in this room — drag a guest onto this row',
                              )}
                            />
                          ))}

                        {row.items.map((item) => {
                          const rangeStr = `${format(parseISO(item.displayStayStart), 'MMM d', { locale: dateLocale })} – ${format(parseISO(item.displayStayEnd), 'MMM d', { locale: dateLocale })}`;
                          const accessibilityLabel = t('rooms.timeline.assignmentPillA11y', '{{name}} — stay {{range}}', {
                            name: item.label,
                            range: rangeStr,
                          });
                          const barStyle: CSSProperties = timelineAssignmentBarStyle(item, {
                            dayCount,
                            useFractionalColumns,
                            dayWidthPx,
                            laneIndex: item.laneIndex,
                            laneHeightPx: viewport.laneHeightPx,
                          });
                          return (
                            <DroppableAssignment key={item.id} assignmentId={item.assignment.id}>
                              <DraggableRoomAssignment
                                assignment={item.assignment}
                                label={item.label}
                                color={item.color}
                                accessibilityLabel={accessibilityLabel}
                                style={barStyle}
                              />
                            </DroppableAssignment>
                          );
                        })}
                      </div>
                    </DroppableRoom>
                  </div>
                );
              })}
            </div>
          </>
        );
      }}
    </TripTimelineFrame>
  );
});

export { RoomOccupancyTimeline };
