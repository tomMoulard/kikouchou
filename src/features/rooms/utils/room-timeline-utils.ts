/**
 * @fileoverview Utilities for horizontal room occupancy timeline.
 *
 * @module features/rooms/utils/room-timeline-utils
 */

import { addDays, subDays } from 'date-fns';

import { deriveGuestStayDateBounds } from '@/features/persons/utils/guest-presence';
import { toLocalISODateString } from '@/lib/db/utils';
import { dedupeContainedTimelineSpansByGroup } from '@/lib/utils/dedupe-timeline-spans';
import {
  computeRoomTimelineViewportLayout,
  ROOM_TIMELINE_MIN_COMPRESSED_DAY_WIDTH_PX,
  ROOM_TIMELINE_PREFERRED_DAY_WIDTH_PX,
  type RoomTimelineViewportLayout,
} from '@/lib/utils/timeline-viewport-layout';
import { buildDayColumns, parseLocalDayKey, toDayKeys } from '@/lib/utils/trip-days';
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
  const start = parseLocalDayKey(assignment.startDate);
  const end = parseLocalDayKey(assignment.endDate);
  if (!start || !end) {
    return null;
  }

  const assignmentLastNight = subDays(end, 1);
  if (assignmentLastNight < start) {
    return null;
  }

  let fn = toLocalISODateString(start);
  let ln = toLocalISODateString(assignmentLastNight);

  if (person) {
    // The guest's *stated* dates only: the trip-wide default a dateless guest
    // gets elsewhere is a guess, and a guess must not trim a booking the host
    // typed in — it used to pull an assignment reaching past the trip's end
    // back to the last trip night.
    const { arrival, departure } = deriveGuestStayDateBounds(person, arrivals, departures);
    if (arrival && departure && arrival < departure) {
      const depParsed = parseLocalDayKey(departure);
      if (depParsed) {
        const stayLastNight = toLocalISODateString(subDays(depParsed, 1));
        const clipFn = fn > arrival ? fn : arrival;
        const clipLn = ln < stayLastNight ? ln : stayLastNight;
        if (clipFn <= clipLn) {
          fn = clipFn;
          ln = clipLn;
        } else {
          // No calendar overlap between assignment nights and guest stay window.
          // Hide only when the assignment is entirely *after* the guest left (stale row).
          // If nights end before guest arrival or dates are inconsistent, keep the assignment
          // so the room booking still shows on the timeline.
          if (fn > stayLastNight) {
            return null;
          }
        }
      }
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

  const visLnParsed = parseLocalDayKey(visLn);
  if (!visLnParsed) {
    return null;
  }

  return {
    startIndex,
    endIndex,
    displayStayStart: visFn,
    displayStayEnd: toLocalISODateString(addDays(visLnParsed, 1)),
  };
}

function indexRangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * When the same guest has overlapping room assignments in different rooms (duplicate or
 * forgotten move), show only one bar: prefer the longer stay, then lower room order, then id.
 */
type CrossRoomClip = {
  readonly assignment: RoomAssignment;
  readonly room: Room;
  readonly startIndex: number;
  readonly endIndex: number;
};

function selectVisibleAssignmentIdsForCrossRoomOverlap(
  clipped: readonly CrossRoomClip[],
): ReadonlySet<string> {
  const byPerson = new Map<string, CrossRoomClip[]>();
  for (const c of clipped) {
    const pid = c.assignment.personId;
    const list = byPerson.get(pid);
    if (list) {
      list.push(c);
    } else {
      byPerson.set(pid, [c]);
    }
  }

  const kept = new Set<string>();

  for (const [, entries] of byPerson) {
    if (entries.length <= 1) {
      for (const e of entries) {
        kept.add(e.assignment.id);
      }
      continue;
    }

    const sorted = [...entries].sort((a, b) => {
      const na = a.endIndex - a.startIndex + 1;
      const nb = b.endIndex - b.startIndex + 1;
      if (nb !== na) {
        return nb - na;
      }
      if (a.room.order !== b.room.order) {
        return a.room.order - b.room.order;
      }
      return a.assignment.id.localeCompare(b.assignment.id);
    });

    const picked: CrossRoomClip[] = [];
    for (const c of sorted) {
      const overlapsOtherRoom = picked.some(
        (p) =>
          p.room.id !== c.room.id &&
          indexRangesOverlap(p.startIndex, p.endIndex, c.startIndex, c.endIndex),
      );
      if (overlapsOtherRoom) {
        continue;
      }
      picked.push(c);
    }
    for (const p of picked) {
      kept.add(p.assignment.id);
    }
  }

  return kept;
}

/**
 * When the same guest has multiple room assignments in one room whose night ranges
 * overlap or touch (split rows / duplicate edits), show a single pill spanning the union.
 * Drag-and-drop keeps the widest underlying assignment as canonical.
 */
function pickCanonicalAssignmentForCluster(
  cluster: readonly RoomTimelineAssignmentItem[],
): RoomTimelineAssignmentItem {
  return [...cluster].sort((a, b) => {
    const widthA = a.endIndex - a.startIndex;
    const widthB = b.endIndex - b.startIndex;
    if (widthB !== widthA) {
      return widthB - widthA;
    }
    return a.assignment.id.localeCompare(b.assignment.id);
  })[0]!;
}

function mergeOverlappingOrAdjacentClusterForPerson(
  items: readonly RoomTimelineAssignmentItem[],
  dayKeys: readonly ISODateString[],
): RoomTimelineAssignmentItem[] {
  if (items.length <= 1) {
    return [...items];
  }

  const sorted = [...items].sort((a, b) => {
    if (a.startIndex !== b.startIndex) {
      return a.startIndex - b.startIndex;
    }
    return a.assignment.id.localeCompare(b.assignment.id);
  });

  const clusters: RoomTimelineAssignmentItem[][] = [];
  for (const item of sorted) {
    const lastCluster = clusters[clusters.length - 1];
    if (!lastCluster) {
      clusters.push([item]);
      continue;
    }
    const clusterMaxEnd = Math.max(...lastCluster.map((i) => i.endIndex));
    if (item.startIndex <= clusterMaxEnd + 1) {
      lastCluster.push(item);
    } else {
      clusters.push([item]);
    }
  }

  const result: RoomTimelineAssignmentItem[] = [];
  for (const cluster of clusters) {
    if (cluster.length === 1) {
      result.push(cluster[0]!);
      continue;
    }
    const startIndex = Math.min(...cluster.map((c) => c.startIndex));
    const endIndex = Math.max(...cluster.map((c) => c.endIndex));
    const canonical = pickCanonicalAssignmentForCluster(cluster);
    const visStartKey = dayKeys[startIndex];
    const visEndKey = dayKeys[endIndex];
    if (!visStartKey || !visEndKey) {
      continue;
    }
    const visLnParsed = parseLocalDayKey(visEndKey);
    if (!visLnParsed) {
      continue;
    }
    result.push({
      kind: 'assignment',
      id: canonical.assignment.id,
      startIndex,
      endIndex,
      assignment: canonical.assignment,
      person: canonical.person,
      label: canonical.label,
      color: canonical.color,
      displayStayStart: visStartKey,
      displayStayEnd: toLocalISODateString(addDays(visLnParsed, 1)),
    });
  }
  return result;
}

function mergeOverlappingOrAdjacentSamePersonRoomItems(
  items: readonly RoomTimelineAssignmentItem[],
  dayKeys: readonly ISODateString[],
): RoomTimelineAssignmentItem[] {
  const byPerson = new Map<string, RoomTimelineAssignmentItem[]>();
  for (const item of items) {
    const pid = item.assignment.personId;
    const list = byPerson.get(pid);
    if (list) {
      list.push(item);
    } else {
      byPerson.set(pid, [item]);
    }
  }

  const merged: RoomTimelineAssignmentItem[] = [];
  for (const group of byPerson.values()) {
    merged.push(...mergeOverlappingOrAdjacentClusterForPerson(group, dayKeys));
  }
  return merged;
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

  const days = buildDayColumns(range.startDate, range.endDate);
  const dayKeys = toDayKeys(days);
  const dayIndexByKey = new Map<ISODateString, number>();
  for (let i = 0; i < dayKeys.length; i++) {
    const key = dayKeys[i];
    if (key) dayIndexByKey.set(key, i);
  }

  const roomsById = new Map<string, Room>(rooms.map((r) => [r.id, r]));

  const clippedMetas: {
    readonly assignment: RoomAssignment;
    readonly room: Room;
    readonly person: Person | undefined;
    readonly clipped: {
      readonly startIndex: number;
      readonly endIndex: number;
      readonly displayStayStart: ISODateString;
      readonly displayStayEnd: ISODateString;
    };
  }[] = [];

  for (const assignment of assignments) {
    const room = roomsById.get(assignment.roomId);
    if (!room) {
      continue;
    }
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
    clippedMetas.push({ assignment, room, person, clipped });
  }

  const visibleAssignmentIds = selectVisibleAssignmentIdsForCrossRoomOverlap(
    clippedMetas.map((m) => ({
      assignment: m.assignment,
      room: m.room,
      startIndex: m.clipped.startIndex,
      endIndex: m.clipped.endIndex,
    })),
  );

  const rows: RoomTimelineRowModel[] = rooms.map((room) => {
    const baseItems: RoomTimelineItem[] = [];

    for (const meta of clippedMetas) {
      if (meta.assignment.roomId !== room.id) {
        continue;
      }
      if (!visibleAssignmentIds.has(meta.assignment.id)) {
        continue;
      }

      const { assignment, person, clipped } = meta;

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

    const mergedItems = mergeOverlappingOrAdjacentSamePersonRoomItems(dedupedItems, dayKeys);

    const itemsWithLanes = allocateLanes(mergedItems) as readonly RoomTimelineItemWithLane[];
    const laneCount = itemsWithLanes.reduce((max, i) => Math.max(max, i.laneIndex + 1), 1);

    return { room, items: itemsWithLanes, laneCount };
  });

  return { days, dayKeys, rows };
}

