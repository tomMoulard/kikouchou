/**
 * @fileoverview Utilities for horizontal room occupancy timeline.
 *
 * @module features/rooms/utils/room-timeline-utils
 */

import { subDays } from 'date-fns';

import { parseISODateString, toISODateString } from '@/lib/db/utils';
import type { ISODateString, Person, Room, RoomAssignment, Trip } from '@/types';

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

  const days: Date[] = [];
  let cursor = new Date(start.getTime());
  const endTime = end.getTime();
  while (cursor.getTime() <= endTime) {
    days.push(new Date(cursor.getTime()));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
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
}): RoomTimelineModel {
  const { range, rooms, assignments, personsById, unknownLabel } = args;

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
      if (assignment.endDate < range.startDate || assignment.startDate > range.endDate) continue;

      const start = parseISODateString(assignment.startDate);
      const end = parseISODateString(assignment.endDate);
      if (!start || !end) continue;

      const lastNight = subDays(end, 1);
      if (lastNight < start) continue;

      const startKey = toISODateString(start);
      const endKey = toISODateString(lastNight);

      const startIndex = dayIndexByKey.get(startKey);
      const endIndex = dayIndexByKey.get(endKey);
      if (startIndex === undefined || endIndex === undefined) continue;

      const person = personsById.get(assignment.personId);
      baseItems.push({
        kind: 'assignment',
        id: assignment.id,
        startIndex,
        endIndex,
        assignment,
        person,
        label: person?.name ?? unknownLabel,
        color: person?.color ?? '#6b7280',
      });
    }

    const itemsWithLanes = allocateLanes(baseItems) as readonly RoomTimelineItemWithLane[];
    const laneCount = itemsWithLanes.reduce((max, i) => Math.max(max, i.laneIndex + 1), 1);

    return { room, items: itemsWithLanes, laneCount };
  });

  return { days, dayKeys, rows };
}

