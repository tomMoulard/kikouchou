/**
 * @fileoverview Horizontal room occupancy timeline (one row per room).
 *
 * @module features/rooms/components/RoomOccupancyTimeline
 */

import { type CSSProperties, type ReactElement, memo, useMemo } from 'react';
import { differenceInCalendarDays, format, parseISO, subDays } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';

import { TripTimelineFrame } from '@/components/shared/TripTimelineFrame';
import { TIMELINE_LABEL_CELL_STYLE } from '@/components/shared/timeline-label-cell';
import { getRoomIconComponent } from '@/components/shared/RoomIconPicker';
import { cn } from '@/lib/utils';
import { timelineAssignmentBarStyle, TIMELINE_LANE_HEIGHT_PX } from '@/lib/utils/timeline-bar-geometry';
import { allocateTimelineLanes } from '@/lib/utils/timeline-lanes';
import type { ISODateString, Person, Room, RoomAssignment, Transport, Trip } from '@/types';
import { DroppableRoom } from '@/features/rooms/components/DroppableRoom';
import { DraggableGuest } from '@/features/rooms/components/DraggableGuest';
import { DraggableRoomAssignment } from '@/features/rooms/components/DraggableRoomAssignment';
import { DroppableAssignment } from '@/features/rooms/components/DroppableAssignment';
import { buildRoomTimelineModel } from '@/features/rooms/utils/room-timeline-utils';
import { groupUnassignedNightsIntoStays } from '@/features/rooms/utils/unassigned-guests';
import {
  calculatePeakOccupancyByRoom,
  createHeadcountResolver,
  summarizeRoomOccupancy,
} from '@/features/rooms/utils/capacity-utils';

// ============================================================================
// Constants
// ============================================================================

/**
 * Width of the sticky room-name column.
 *
 * Exported because the page's own width decision has to count the same number
 * of pixels this frame reserves — see `timelineNeedsFullPageWidth`.
 */
export const ROOM_TIMELINE_LABEL_COLUMN_WIDTH_PX = 140;

function buildUnassignedSegments(
  unassignedGuests: RoomOccupancyTimelineProps['unassignedGuests'],
  tripStart: Date,
  tripEnd: Date,
): readonly {
  readonly person: Person;
  readonly startDate: string;
  readonly endDate: string;
  readonly startIndex: number;
  readonly endIndex: number;
}[] {
  if (!unassignedGuests?.length) {
    return [];
  }
  return unassignedGuests
    .flatMap(({ person, startDate, endDate, unassignedDates }) => {
      // One bar per unbroken run of nights with no bed. A guest with nothing
      // recorded falls back to their whole window, which is what a guest with
      // no room at all has always been drawn as.
      const stays =
        unassignedDates && unassignedDates.length > 0
          ? groupUnassignedNightsIntoStays(unassignedDates)
          : [{ startDate, endDate }];

      return stays.map((stay) => {
        const start = parseISO(stay.startDate);
        const end = parseISO(stay.endDate);
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

        const startIndex = Math.max(0, differenceInCalendarDays(clippedStart, tripStart));
        const spanNights = Math.max(1, differenceInCalendarDays(clippedEnd, clippedStart) + 1);

        return {
          person,
          startDate: stay.startDate,
          endDate: stay.endDate,
          startIndex,
          endIndex: startIndex + spanNights - 1,
        };
      });
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
    /**
     * The nights inside the window that actually have no room.
     *
     * The pills are drawn from these, not from the window: a guest housed for
     * part of their stay must not claim the nights they already have a bed for.
     * Omitted, the whole window is taken to be uncovered.
     */
    readonly unassignedDates?: readonly string[];
  }[];
  readonly dateLocale: import('date-fns/locale').Locale;
  readonly range: { readonly startDate: ISODateString; readonly endDate: ISODateString };
  /** Local-date key for “today” column highlight (optional). */
  readonly todayKey?: ISODateString;
  /**
   * Opens the room's edit dialog, wired to a double click on the room name.
   *
   * Omitted, the names carry no interaction at all — which is why the handler
   * is a prop rather than a route this component builds for itself. It is a
   * mouse shortcut on top of the cards view's menu item, never the only way to
   * reach the dialog.
   */
  readonly onEditRoom?: (room: Room) => void;
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
  onEditRoom,
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

  // Lanes describe the *layout* (how many bars stack in a row); they say nothing
  // about how many people are in the room, because one bar can be a couple and
  // two bars for the same guest are merged into one. Occupancy therefore comes
  // from the shared capacity helper, exactly as the room cards get it.
  const headcountOf = useMemo(() => createHeadcountResolver(persons), [persons]);

  const peakOccupancyByRoom = useMemo(
    () =>
      calculatePeakOccupancyByRoom(assignments, range.startDate, range.endDate, headcountOf),
    [assignments, range.startDate, range.endDate, headcountOf],
  );

  const dayCount = model.days.length;

  const tripStart = parseISO(range.startDate);
  const tripEnd = parseISO(range.endDate);

  // One row for everyone still without a bed, packed into lanes exactly like a
  // room's — guests who overlap stack instead of drawing over each other.
  const unassignedLanes = useMemo(
    () => allocateTimelineLanes(buildUnassignedSegments(unassignedGuests, tripStart, tripEnd)),
    [unassignedGuests, tripStart, tripEnd],
  );
  const unassignedLaneCount = unassignedLanes.reduce(
    (max, lane) => Math.max(max, lane.laneIndex + 1),
    0,
  );

  return (
    <TripTimelineFrame
      ariaLabel={t('rooms.timeline.ariaLabel', 'Room occupancy timeline')}
      labelColumnWidth={ROOM_TIMELINE_LABEL_COLUMN_WIDTH_PX}
      leftHeader={<span className="text-sm font-medium">{t('rooms.title')}</span>}
      days={model.days}
      dayKeys={model.dayKeys}
      dateLocale={dateLocale}
      todayKey={todayKey}
    >
      {(viewport) => {
        const {
          canvasWidth,
          dayGridTemplateColumns,
          dayWidthPx,
          useFractionalColumns,
          labelsCollapsed,
        } = viewport;

        return (
          <>
            <div role="list" aria-label={t('rooms.timeline.rows', 'Room rows')}>
              {unassignedLaneCount > 0 && (
                <div
                  role="listitem"
                  className="flex border-t border-muted"
                  aria-label={t('rooms.needsRoom', 'needs room')}
                >
                  <div
                    className={cn(
                      'sticky left-0 z-10 min-w-0 bg-background border-r border-muted flex items-center',
                      labelsCollapsed ? 'justify-center px-1' : 'px-3',
                    )}
                    style={{
                      ...TIMELINE_LABEL_CELL_STYLE,
                      height: unassignedLaneCount * TIMELINE_LANE_HEIGHT_PX,
                    }}
                    title={t('rooms.needsRoom', 'needs room')}
                  >
                    {/* Icon only. The pills beside it already carry the names,
                        and the label read as a truncated "a besoin d'u…" in a
                        140px column — a caption nobody can finish is worse than
                        no caption. The sentence stays on hover and on the row's
                        accessible name. */}
                    <TriangleAlert
                      className="size-3.5 shrink-0 text-destructive"
                      aria-hidden="true"
                    />
                    <span className="sr-only">{t('rooms.needsRoom', 'needs room')}</span>
                  </div>

                  <div
                    className="relative bg-background"
                    style={{
                      width: canvasWidth,
                      height: unassignedLaneCount * TIMELINE_LANE_HEIGHT_PX,
                    }}
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
                            key={`grid-unassigned-${i}`}
                            className={cn(
                              'min-w-0 h-full border-r border-muted/50',
                              i % 2 === 0 && 'bg-muted/10',
                              viewport.todayColumnIndex === i && 'bg-primary/12',
                            )}
                          />
                        ))}
                      </div>
                    </div>

                    {/* The same pill an assigned guest gets, on the same day
                        axis and through the same bar geometry. Only the row
                        says they have no bed — the guest does not have to be
                        drawn as an absence to make that readable, and the empty
                        dashed outline it replaces carried no name at all. */}
                    {unassignedLanes.map((lane) => (
                      <DraggableGuest
                        // A partially housed guest has one bar per gap, so the
                        // person alone no longer identifies a bar.
                        key={`unassigned-${lane.person.id}-${lane.startDate}`}
                        person={lane.person}
                        startDate={lane.startDate}
                        endDate={lane.endDate}
                        bar
                        style={timelineAssignmentBarStyle(lane, {
                          dayCount,
                          useFractionalColumns,
                          dayWidthPx,
                          laneIndex: lane.laneIndex,
                          laneHeightPx: viewport.laneHeightPx,
                        })}
                      />
                    ))}
                  </div>
                </div>
              )}

              {model.rows.map((row) => {
                const visualLaneCount = Math.max(row.laneCount, row.room.capacity);
                const rowHeight = Math.max(1, visualLaneCount) * TIMELINE_LANE_HEIGHT_PX;
                const occupancy = summarizeRoomOccupancy(
                  row.room.capacity,
                  peakOccupancyByRoom.get(row.room.id) ?? 0,
                );
                const spotsOpen = occupancy.availableSpots;
                // Never promise a free bed the occupancy maths says is taken: a
                // couple fills two beds from a single lane.
                const freeBedTracks = Math.max(
                  0,
                  Math.min(row.room.capacity - row.laneCount, spotsOpen),
                );
                // Over capacity is a warning, not a caption: as a second line
                // it was truncated to "This room may be ove…", which says
                // nothing. It reads as an icon beside the name, with the full
                // sentence on hover and for screen readers.
                const hasSpotsNote = spotsOpen > 0;
                const rowAriaLabel = occupancy.isOverCapacity
                  ? `${row.room.name}. ${t('rooms.capacityWarning')}`
                  : spotsOpen > 0
                    ? `${row.room.name}. ${t('rooms.spotsOpen', { count: spotsOpen })}`
                    : row.room.name;
                const RoomGlyph = getRoomIconComponent(row.room.icon);
                // The hint only belongs in the tooltip when the gesture is
                // actually wired up — the timeline renders without `onEditRoom`
                // in a few places, and promising an editor there is a lie.
                const labelTitle = [
                  row.room.name,
                  t('rooms.beds', { count: row.room.capacity }),
                  ...(onEditRoom ? [t('rooms.doubleClickToEdit')] : []),
                ].join(' — ');

                return (
                  <div
                    key={row.room.id}
                    role="listitem"
                    className="flex border-t border-muted"
                    aria-label={rowAriaLabel}
                  >
                    {/*
                      Double click on the label opens the room's edit dialog —
                      the timeline carries no menu of its own, so this saves the
                      trip through the cards view, where the same action sits in
                      each card's menu and stays keyboard-reachable.

                      The handler is on the whole label cell rather than the
                      name span so a row with a "spots open" second line has one
                      target and not two. `select-none` keeps the second click
                      from leaving the name highlighted behind the dialog it
                      just opened.

                      No keyboard pair goes with it, and none is owed: a double
                      click has no keyboard equivalent, and `dblclick` is not a
                      handler `jsx-a11y/no-static-element-interactions` counts
                      as making an element interactive — precisely because it
                      cannot be the only way to reach an action. Here it is not.
                    */}
                    <div
                      className={cn(
                        'sticky left-0 z-10 bg-background border-r border-muted flex',
                        labelsCollapsed
                          ? 'items-center justify-center px-1'
                          : hasSpotsNote
                            ? 'flex-col items-stretch justify-center gap-0.5 px-3 py-1'
                            : 'items-center px-3',
                        onEditRoom && 'cursor-pointer select-none',
                      )}
                      style={{ ...TIMELINE_LABEL_CELL_STYLE, height: rowHeight }}
                      title={labelTitle}
                      onDoubleClick={onEditRoom ? () => onEditRoom(row.room) : undefined}
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <RoomGlyph
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        {/* Truncates with the fold rather than disappearing at
                            a threshold — see the note in CalendarTimelineRow. */}
                        <span className="min-w-0 truncate text-sm font-medium">
                          {row.room.name}
                        </span>
                        {occupancy.isOverCapacity && (
                          <span
                            className="inline-flex shrink-0 text-destructive"
                            title={t('rooms.capacityWarning')}
                            data-testid={`room-capacity-warning-${row.room.id}`}
                          >
                            <TriangleAlert className="size-3.5" aria-hidden="true" />
                            <span className="sr-only">{t('rooms.capacityWarning')}</span>
                          </span>
                        )}
                      </div>
                      {!labelsCollapsed && hasSpotsNote && (
                        <span className="text-xs text-muted-foreground leading-tight truncate">
                          {t('rooms.spotsOpen', { count: spotsOpen })}
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

                        {freeBedTracks > 0 &&
                          Array.from(
                            { length: freeBedTracks },
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
