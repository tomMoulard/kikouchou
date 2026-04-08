/**
 * @fileoverview Utilities for horizontal room occupancy timeline.
 *
 * @module features/rooms/utils/room-timeline-utils
 */

import { addDays, parseISO, subDays } from 'date-fns';

import { deriveGuestStayDateBounds } from '@/features/persons/utils/guest-presence';
import { parseISODateString, toISODateString } from '@/lib/db/utils';
import { dedupeContainedTimelineSpansByGroup } from '@/lib/utils/dedupe-timeline-spans';
import {
  computeRoomTimelineViewportLayout,
  ROOM_TIMELINE_MIN_COMPRESSED_DAY_WIDTH_PX,
  ROOM_TIMELINE_PREFERRED_DAY_WIDTH_PX,
  type RoomTimelineViewportLayout,
} from '@/lib/utils/timeline-viewport-layout';
import type { ISODateString, Person, Room, RoomAssignment, Transport, Trip } from '@/types';

export {
  computeRoomTimelineViewportLayout,
  ROOM_TIMELINE_MIN_COMPRESSED_DAY_WIDTH_PX,
  ROOM_TIMELINE_PREFERRED_DAY_WIDTH_PX,
  type RoomTimelineViewportLayout,
};

// ============================================================================
// Type Definitions
// ============================================================================

export interface RoomTimelineItemBase {
  readonly id: string;
  readonly startIndex: number;
  readonly endIndex: number;
}

export interface RoomTimelineAssignmentItem extends RoomTimelineItemBase {
  readonly kind: 'assignment';
  readonly assignment: RoomAssignment;
  readonly person: Person | undefined;
  readonly label: string;
  readonly color: string;
  /**
   * Bar and labels use this stay window (check-in … check-out), after clipping the DB
   * assignment to the guest’s current arrival/departure or stay dates.
   */
  readonly displayStayStart: ISODateString;
  readonly displayStayEnd: ISODateString;
}

export type RoomTimelineItem = RoomTimelineAssignmentItem;

export interface RoomTimelineItemWithLane extends RoomTimelineItem {
  readonly laneIndex: number;
}

export interface RoomTimelineRowModel {
  readonly room: Room;
  readonly items: readonly RoomTimelineItemWithLane[];
  readonly laneCount: number;
}

export interface RoomTimelineModel {
  readonly days: readonly Date[];
  readonly dayKeys: readonly ISODateString[];
  readonly rows: readonly RoomTimelineRowModel[];
}

// ============================================================================
// Helpers
// ============================================================================

function buildUtcDays(startKey: ISODateString, endKey: ISODateString): readonly Date[] {
  const start = parseISODateString(startKey);
  const end = parseISODateString(endKey);
  if (!start || !end) return [];

  const raw: Date[] = [];
  let cursor = new Date(start.getTime());
  const endTime = end.getTime();
  while (cursor.getTime() <= endTime) {
    raw.push(new Date(cursor.getTime()));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  const seen = new Set<ISODateString>();
  const days: Date[] = [];
  for (const d of raw) {
    const k = toISODateString(d);
    if (seen.has(k)) continue;
    seen.add(k);
    days.push(d);
  }
  return days;
}

function allocateLanes<TItem extends RoomTimelineItemBase>(
  items: readonly TItem[],
): readonly (TItem & { readonly laneIndex: number })[] {
  const sorted = [...items].sort((a, b) => {
    const startDiff = a.startIndex - b.startIndex;
    if (startDiff !== 0) return startDiff;
    return b.endIndex - a.endIndex;
  });

  const laneEndByIndex: number[] = [];
  const result: (TItem & { readonly laneIndex: number })[] = [];

  for (const item of sorted) {
    let laneIndex = laneEndByIndex.findIndex((laneEnd) => item.startIndex > laneEnd);
    if (laneIndex === -1) {
      laneIndex = laneEndByIndex.length;
      laneEndByIndex.push(item.endIndex);
    } else {
      laneEndByIndex[laneIndex] = Math.max(laneEndByIndex[laneIndex] ?? item.endIndex, item.endIndex);
    }
    result.push({ ...item, laneIndex } as TItem & { readonly laneIndex: number });
  }

  return result;
}

/**
 * Clips an assignment’s nights to the guest’s effective stay (stay dates + transports),
 * then to visible trip day columns. Returns null if nothing should be drawn.
 */
function clipAssignmentToPersonStayAndTripGrid(
  assignment: RoomAssignment,
  person: Person | undefined,
  arrivals: readonly Transport[],
  departures: readonly Transport[],
  dayKeys: readonly ISODateString[],
  dayIndexByKey: ReadonlyMap<ISODateString, number>,
): {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly displayStayStart: ISODateString;
  readonly displayStayEnd: ISODateString;
} | null {
  const start = parseISODateString(assignment.startDate);
  const end = parseISODateString(assignment.endDate);
  if (!start || !end) {
    return null;
  }

  const assignmentLastNight = subDays(end, 1);
  if (assignmentLastNight < start) {
    return null;
  }

  let fn = toISODateString(start);
  let ln = toISODateString(assignmentLastNight);

  if (person) {
    const { arrival, departure } = deriveGuestStayDateBounds(person, arrivals, departures);
    if (arrival && departure && arrival < departure) {
      const stayLastNight = toISODateString(subDays(parseISO(departure), 1));
      const clipFn = fn > arrival ? fn : arrival;
      const clipLn = ln < stayLastNight ? ln : stayLastNight;
      if (clipFn > clipLn) {
        return null;
      }
      fn = clipFn;
      ln = clipLn;
    }
  }

  const firstKey = dayKeys[0];
  const lastKey = dayKeys[dayKeys.length - 1];
  if (!firstKey || !lastKey) {
    return null;
  }

  if (fn > lastKey || ln < firstKey) {
    return null;
  }

  const visFn = fn < firstKey ? firstKey : fn;
  const visLn = ln > lastKey ? lastKey : ln;

  const startIndex = dayIndexByKey.get(visFn);
  const endIndex = dayIndexByKey.get(visLn);
  if (startIndex === undefined || endIndex === undefined) {
    return null;
  }

  return {
    startIndex,
    endIndex,
    displayStayStart: visFn,
    displayStayEnd: toISODateString(addDays(parseISO(visLn), 1)),
  };
}

// ============================================================================
// Public API
// ============================================================================

export function buildRoomTimelineModel(args: {
  readonly trip: Trip;
  readonly range: { readonly startDate: ISODateString; readonly endDate: ISODateString };
  readonly rooms: readonly Room[];
  readonly assignments: readonly RoomAssignment[];
  readonly personsById: ReadonlyMap<string, Person>;
  readonly unknownLabel: string;
  readonly arrivals: readonly Transport[];
  readonly departures: readonly Transport[];
}): RoomTimelineModel {
  const { range, rooms, assignments, personsById, unknownLabel, arrivals, departures } = args;

  const days = buildUtcDays(range.startDate, range.endDate);
  const dayKeys = days.map((d) => toISODateString(d));
  const dayIndexByKey = new Map<ISODateString, number>();
  for (let i = 0; i < dayKeys.length; i++) {
    const key = dayKeys[i];
    if (key) dayIndexByKey.set(key, i);
  }

  const rows: RoomTimelineRowModel[] = rooms.map((room) => {
    const baseItems: RoomTimelineItem[] = [];

    for (const assignment of assignments) {
      if (assignment.roomId !== room.id) continue;

      const person = personsById.get(assignment.personId);
      const clipped = clipAssignmentToPersonStayAndTripGrid(
        assignment,
        person,
        arrivals,
        departures,
        dayKeys,
        dayIndexByKey,
      );
      if (!clipped) {
        continue;
      }

      baseItems.push({
        kind: 'assignment',
        id: assignment.id,
        startIndex: clipped.startIndex,
        endIndex: clipped.endIndex,
        assignment,
        person,
        label: person?.name ?? unknownLabel,
        color: person?.color ?? '#6b7280',
        displayStayStart: clipped.displayStayStart,
        displayStayEnd: clipped.displayStayEnd,
      });
    }

    const dedupedItems = dedupeContainedTimelineSpansByGroup(
      baseItems as RoomTimelineAssignmentItem[],
      (item) => item.assignment.personId,
    );

    const itemsWithLanes = allocateLanes(dedupedItems) as readonly RoomTimelineItemWithLane[];
    const laneCount = itemsWithLanes.reduce((max, i) => Math.max(max, i.laneIndex + 1), 1);

    return { room, items: itemsWithLanes, laneCount };
  });

  return { days, dayKeys, rows };
}

