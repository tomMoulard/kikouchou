/**
 * @fileoverview Horizontal room occupancy timeline (one row per room).
 *
 * @module features/rooms/components/RoomOccupancyTimeline
 */

import { type ReactElement, memo, useMemo } from 'react';
import { differenceInCalendarDays, format, parseISO, subDays } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { toISODateString } from '@/lib/db/utils';
import type { ISODateString, Person, Room, RoomAssignment, Trip } from '@/types';
import { DroppableRoom } from '@/features/rooms/components/DroppableRoom';
import { DraggableGuest } from '@/features/rooms/components/DraggableGuest';
import { DraggableRoomAssignment } from '@/features/rooms/components/DraggableRoomAssignment';
import { DroppableAssignment } from '@/features/rooms/components/DroppableAssignment';
import { buildRoomTimelineModel } from '@/features/rooms/utils/room-timeline-utils';
import { GripVertical } from 'lucide-react';

// ============================================================================
// Constants
// ============================================================================

const DAY_WIDTH_PX = 44;
const LANE_HEIGHT_PX = 28;
const ROOM_COL_PX = 200;
const ROOM_COL_PX_COMPACT = 140;

// ============================================================================
// Component
// ============================================================================

export interface RoomOccupancyTimelineProps {
  readonly trip: Trip;
  readonly rooms: readonly Room[];
  readonly assignments: readonly RoomAssignment[];
  readonly persons: readonly Person[];
  readonly unassignedGuests?: readonly {
    readonly person: Person;
    readonly startDate: string;
    readonly endDate: string;
  }[];
  readonly dateLocale: import('date-fns/locale').Locale;
  readonly range: { readonly startDate: ISODateString; readonly endDate: ISODateString };
}

const RoomOccupancyTimeline = memo(function RoomOccupancyTimeline({
  trip,
  rooms,
  assignments,
  persons,
  unassignedGuests = [],
  dateLocale,
  range,
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
      }),
    [trip, range, rooms, assignments, personsById, t],
  );

  const dayCount = model.days.length;
  const canvasWidth = dayCount * DAY_WIDTH_PX;

  // Fixed room column width to avoid scroll artifacts/jitter.
  const roomColWidth = ROOM_COL_PX_COMPACT;

  const tripStart = parseISO(range.startDate);
  const tripEnd = parseISO(range.endDate);
  const totalNights = Math.max(1, differenceInCalendarDays(tripEnd, tripStart));

  const unassignedRows = useMemo(() => {
    if (unassignedGuests.length === 0) {
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

        const left = (startOffset / totalNights) * canvasWidth;
        const width = (spanNights / totalNights) * canvasWidth;

        return { person, startDate, endDate, left, width };
      })
      .filter(
        (x): x is { person: Person; startDate: string; endDate: string; left: number; width: number } =>
          x !== null,
      );
  }, [canvasWidth, totalNights, tripEnd, tripStart, unassignedGuests]);

  return (
    <div role="region" aria-label={t('rooms.timeline.ariaLabel', 'Room occupancy timeline')} className="border rounded-lg overflow-hidden">
      <div
        className={cn(
          'w-full max-h-[70vh]',
          'overflow-x-auto overflow-y-auto',
        )}
      >
        <div style={{ width: roomColWidth + canvasWidth }}>
          {/* Header */}
          <div className="sticky top-0 z-20 flex border-b border-muted bg-background">
            <div
              className={cn(
                'sticky left-0 z-30 border-r border-muted bg-background px-3 py-2',
              )}
              style={{ width: roomColWidth, minWidth: roomColWidth }}
            >
              <span className="text-sm font-medium">{t('rooms.title')}</span>
            </div>

            <div className="relative" style={{ width: canvasWidth }}>
              <div className="flex">
                {model.days.map((day) => {
                  const key = toISODateString(day);
                  const monthLabel = format(day, 'MMM', { locale: dateLocale });
                  const dayLabel = format(day, 'dd', { locale: dateLocale });
                  return (
                    <div
                      key={key}
                      className="border-r border-muted px-1 py-2 text-xs text-muted-foreground"
                      style={{ width: DAY_WIDTH_PX }}
                      title={format(day, 'PPPP', { locale: dateLocale })}
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
            </div>
          </div>

          {/* Rows */}
          <div role="list" aria-label={t('rooms.timeline.rows', 'Room rows')}>
            {unassignedRows.map((row) => (
              <div key={`unassigned-${row.person.id}`} role="listitem" className="flex border-t border-muted">
                <div
                  className={cn(
                    'sticky left-0 z-10 bg-background border-r border-muted px-3 flex items-center gap-2',
                  )}
                  style={{ width: roomColWidth, minWidth: roomColWidth, height: LANE_HEIGHT_PX }}
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

                <div className="relative bg-background" style={{ width: canvasWidth, height: LANE_HEIGHT_PX }}>
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="flex h-full">
                      {Array.from({ length: dayCount }).map((_, i) => (
                        <div
                          key={`grid-unassigned-${row.person.id}-${i}`}
                          className={cn('h-full border-r border-muted/50', i % 2 === 0 && 'bg-muted/10')}
                          style={{ width: DAY_WIDTH_PX }}
                        />
                      ))}
                    </div>
                  </div>

                  <div
                    className="absolute top-1 bottom-1 rounded-md border border-dashed"
                    style={{
                      left: Math.max(2, row.left + 2),
                      width: Math.max(12, row.width - 4),
                      borderColor: row.person.color,
                      backgroundColor: `${row.person.color}22`,
                    }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            ))}

            {model.rows.map((row) => {
              const rowHeight = Math.max(1, row.laneCount) * LANE_HEIGHT_PX;

              return (
                <div key={row.room.id} role="listitem" className="flex border-t border-muted">
                  <div
                    className={cn(
                      'sticky left-0 z-10 bg-background border-r border-muted px-3 flex items-center',
                    )}
                    style={{ width: roomColWidth, minWidth: roomColWidth, height: rowHeight }}
                    title={row.room.name}
                  >
                    <span className="text-sm font-medium truncate">{row.room.name}</span>
                  </div>

                  <DroppableRoom roomId={row.room.id} className="relative bg-background" disabled={false}>
                    <div className="relative" style={{ width: canvasWidth, height: rowHeight }}>
                      {/* Grid */}
                      <div className="absolute inset-0 pointer-events-none">
                        <div className="flex h-full">
                          {Array.from({ length: dayCount }).map((_, i) => (
                            <div
                              key={`grid-${row.room.id}-${i}`}
                              className={cn('h-full border-r border-muted/50', i % 2 === 0 && 'bg-muted/10')}
                              style={{ width: DAY_WIDTH_PX }}
                            />
                          ))}
                        </div>
                      </div>

                      {/* Items */}
                      {row.items.map((item) => {
                        const left = item.startIndex * DAY_WIDTH_PX + 2;
                        const width = (item.endIndex - item.startIndex + 1) * DAY_WIDTH_PX - 4;
                        const top = item.laneIndex * LANE_HEIGHT_PX + 2;

                        return (
                          <DroppableAssignment key={item.id} assignmentId={item.assignment.id}>
                            <DraggableRoomAssignment
                              assignment={item.assignment}
                              label={item.label}
                              color={item.color}
                              style={{
                                left,
                                top,
                                width: Math.max(12, width),
                                height: LANE_HEIGHT_PX - 6,
                              }}
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
        </div>
      </div>
    </div>
  );
});

export { RoomOccupancyTimeline };

