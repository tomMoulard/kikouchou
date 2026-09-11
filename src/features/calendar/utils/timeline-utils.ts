/**
 * @fileoverview Utilities for the Calendar timeline (horizontal) view.
 *
 * @module features/calendar/utils/timeline-utils
 */

import { subDays } from 'date-fns';

import { toLocalISODateString } from '@/lib/db/utils';
import { resolveGuestStayWindow } from '@/features/persons/utils/guest-presence';
import { dedupeContainedTimelineSpans } from '@/lib/utils/dedupe-timeline-spans';
import { allocateTimelineLanes } from '@/lib/utils/timeline-lanes';
import {
  buildDayColumnsCovering,
  localDayKeyOfInstant,
  parseLocalDayKey,
  toDayKeys,
} from '@/lib/utils/trip-days';
import type {
  ISODateString,
  Person,
  Room,
  RoomAssignment,
  Transport,
  Trip,
} from '@/types';

import type {
  CalendarTimelineModel,
  CalendarTimelineRowModel,
  TimelineItem,
  TimelineItemAssignment,
  TimelineItemTransport,
  TimelineItemWithLane,
  TimelineTransportMarker,
} from '../types';
import { getContrastTextColor } from './calendar-utils';

// ============================================================================
// Internal helpers
// ============================================================================


/**
 * Picks the room assignment that should host a transport in the same stay pill
 * (same calendar night, checkout-day departure, or day-before-stay arrival).
 */
function findHostAssignmentForTransport(
  transportItem: TimelineItemTransport,
  assignments: readonly TimelineItemAssignment[],
): TimelineItemAssignment | undefined {
  const day = transportItem.startIndex;
  const tType = transportItem.transport.type;

  const matches = assignments.filter((a) => {
    if (day >= a.startIndex && day <= a.endIndex) {
      return true;
    }
    if (tType === 'departure' && day === a.endIndex + 1) {
      return true;
    }
    if (tType === 'arrival' && day === a.startIndex - 1) {
      return true;
    }
    return false;
  });

  if (matches.length === 0) {
    return undefined;
  }

  return [...matches].sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex)[0];
}

/**
 * Merges transport points into assignment items so the timeline renders a single pill.
 * Transports without a host assignment stay as standalone items (e.g. no room yet).
 */
function mergeTransportsIntoAssignments(items: readonly TimelineItem[]): TimelineItem[] {
  const assignments = items.filter((i): i is TimelineItemAssignment => i.kind === 'assignment');
  const transports = items.filter((i): i is TimelineItemTransport => i.kind === 'transport');

  if (transports.length === 0) {
    return [...items];
  }

  const markersByAssignmentId = new Map<string, TimelineTransportMarker[]>();
  for (const a of assignments) {
    markersByAssignmentId.set(a.id, []);
  }

  const orphans: TimelineItemTransport[] = [];

  for (const tr of transports) {
    const host = findHostAssignmentForTransport(tr, assignments);
    if (host) {
      const bucket = markersByAssignmentId.get(host.id);
      if (bucket) {
        bucket.push({ transport: tr.transport, dayIndex: tr.startIndex });
      }
    } else {
      orphans.push(tr);
    }
  }

  const mergedAssignments: TimelineItem[] = assignments.map((a) => {
    const markers = markersByAssignmentId.get(a.id);
    const sorted =
      markers && markers.length > 0
        ? [...markers].sort((m1, m2) => m1.transport.datetime.localeCompare(m2.transport.datetime))
        : undefined;
    return {
      ...a,
      timelineTransports: sorted,
    };
  });

  return [...mergedAssignments, ...orphans];
}

function isAssignmentVisible(
  assignment: RoomAssignment,
  axisStart: ISODateString,
  axisEnd: ISODateString,
): boolean {
  return assignment.endDate >= axisStart && assignment.startDate <= axisEnd;
}

function isTransportVisible(
  transport: Transport,
  axisStart: ISODateString,
  axisEnd: ISODateString,
): boolean {
  const dateKey = localDayKeyOfInstant(transport.datetime);
  return dateKey !== null && dateKey >= axisStart && dateKey <= axisEnd;
}

/**
 * Merges touching or overlapping assignment bars for the same room on one guest row.
 * Two DB rows (e.g. checkout + re-check-in the same calendar night) become one pill.
 */
function mergeAdjacentSameRoomAssignmentSpans(
  items: readonly TimelineItemAssignment[],
): TimelineItemAssignment[] {
  if (items.length <= 1) {
    return [...items];
  }

  const sorted = [...items].sort((a, b) => {
    const d = a.startIndex - b.startIndex;
    if (d !== 0) {
      return d;
    }
    return a.endIndex - b.endIndex;
  });

  const out: TimelineItemAssignment[] = [];
  for (const item of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.assignment.roomId === item.assignment.roomId &&
      item.startIndex <= prev.endIndex + 1
    ) {
      out[out.length - 1] = {
        ...prev,
        startIndex: Math.min(prev.startIndex, item.startIndex),
        endIndex: Math.max(prev.endIndex, item.endIndex),
        id: `${prev.id}+${item.id}`,
      };
    } else {
      out.push(item);
    }
  }

  return out;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * The day keys a set of transports needs columns for.
 *
 * Feed these to `buildDayColumnsCovering` — a transport dated outside the trip
 * still has to be on the axis, or the timeline simply does not draw it.
 *
 * @param transports - Arrivals and departures, in any order
 * @returns One local day key per transport whose datetime parses
 */
export function collectTransportDayKeys(
  transports: readonly Transport[],
): readonly ISODateString[] {
  const keys: ISODateString[] = [];
  for (const transport of transports) {
    const key = localDayKeyOfInstant(transport.datetime);
    if (key !== null) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * The day keys a set of room assignments needs columns for.
 *
 * Assignments follow the nights model — `endDate` is the checkout day, so the
 * last night drawn is the day before it, and that is the key the axis has to
 * reach rather than the checkout itself.
 *
 * @param assignments - Room assignments, in any order
 * @returns The first night and last night key of each assignment
 */
export function collectAssignmentDayKeys(
  assignments: readonly RoomAssignment[],
): readonly ISODateString[] {
  const keys: ISODateString[] = [];
  for (const assignment of assignments) {
    const start = parseLocalDayKey(assignment.startDate);
    const end = parseLocalDayKey(assignment.endDate);
    if (!start || !end) {
      continue;
    }
    const lastNight = subDays(end, 1);
    if (lastNight < start) {
      continue;
    }
    keys.push(toLocalISODateString(start), toLocalISODateString(lastNight));
  }
  return keys;
}

export function buildCalendarTimelineModel(args: {
  readonly trip: Trip;
  readonly persons: readonly Person[];
  readonly rooms: readonly Room[];
  readonly assignments: readonly RoomAssignment[];
  readonly arrivals: readonly Transport[];
  readonly departures: readonly Transport[];
  readonly unknownLabel: string;
  /**
   * Extra day keys the axis must cover, on top of this model's own events.
   *
   * The calendar timeline draws the activity bands under the guest rows on the
   * same axis, so both models have to be built over the same day range or the
   * two halves stop lining up. The caller hands each builder the other's keys.
   */
  readonly extraDayKeys?: readonly ISODateString[];
}): CalendarTimelineModel {
  const { trip, persons, rooms, assignments, arrivals, departures, unknownLabel } = args;

  // The axis covers the trip *and* everything drawn on it. A guest who flies in
  // the day before the trip starts, or home the day after it ends, has no column
  // on a trip-only axis — and a pill with no column is a pill nobody can see.
  const tripDays = buildDayColumnsCovering({
    startKey: trip.startDate,
    endKey: trip.endDate,
    mustInclude: [
      ...collectTransportDayKeys([...arrivals, ...departures]),
      ...collectAssignmentDayKeys(assignments),
      ...(args.extraDayKeys ?? []),
    ],
  });
  const dayKeys = toDayKeys(tripDays);

  // Clipping is against the axis, not the trip: the trip range is what the
  // header marks out, and the axis is what has columns to draw in.
  const axisStartKey = dayKeys[0] ?? trip.startDate;
  const axisEndKey = dayKeys[dayKeys.length - 1] ?? trip.endDate;

  const dayIndexByKey = new Map<ISODateString, number>();
  for (let i = 0; i < dayKeys.length; i++) {
    const key = dayKeys[i];
    if (key) {
      dayIndexByKey.set(key, i);
    }
  }

  const roomsMap = new Map<string, Room>(rooms.map((r) => [r.id, r]));
  const personsMap = new Map<string, Person>(persons.map((p) => [p.id, p]));

  const rows: CalendarTimelineRowModel[] = persons.map((person) => {
    const baseItems: TimelineItem[] = [];

    // Presence range: explicit stay dates take precedence over transports,
    // falling back to earliest arrival / latest departure. Shared with the rest
    // of the app so the timeline never disagrees about when a guest is here.
    const { arrival: stayStartKey, departure: stayEndKey } = resolveGuestStayWindow(
      person,
      arrivals,
      departures,
      { startDate: trip.startDate, endDate: trip.endDate },
    );

    const staySpan = (() => {
      if (!stayStartKey || !stayEndKey) return undefined;
      if (stayStartKey >= stayEndKey) return undefined;

      const start = parseLocalDayKey(stayStartKey);
      const end = parseLocalDayKey(stayEndKey);
      if (!start || !end) return undefined;

      const lastNight = subDays(end, 1);
      if (lastNight < start) return undefined;

      const clippedStartKey = stayStartKey < axisStartKey ? axisStartKey : stayStartKey;
      const lastNightKey = toLocalISODateString(lastNight);
      const clippedEndKey = lastNightKey > axisEndKey ? axisEndKey : lastNightKey;

      const startIndex = dayIndexByKey.get(clippedStartKey);
      const endIndex = dayIndexByKey.get(clippedEndKey);
      if (startIndex === undefined || endIndex === undefined) return undefined;

      return { startIndex, endIndex };
    })();

    const checkoutDayIndex = (() => {
      if (!stayEndKey) return undefined;
      const clippedCheckoutKey = stayEndKey > axisEndKey ? axisEndKey : stayEndKey;
      return dayIndexByKey.get(clippedCheckoutKey);
    })();

    // Room assignment spans (nights model like month view: endDate is checkout -> subtract 1 day)
    const assignmentItems: TimelineItemAssignment[] = [];
    for (const assignment of assignments) {
      if (assignment.personId !== person.id) {
        continue;
      }
      if (!isAssignmentVisible(assignment, axisStartKey, axisEndKey)) {
        continue;
      }

      const assignmentStart = parseLocalDayKey(assignment.startDate);
      const assignmentEnd = parseLocalDayKey(assignment.endDate);
      if (!assignmentStart || !assignmentEnd) {
        continue;
      }

      const lastNight = subDays(assignmentEnd, 1);
      if (lastNight < assignmentStart) {
        continue;
      }

      const startKey = toLocalISODateString(assignmentStart);
      const endKey = toLocalISODateString(lastNight);

      const startIndex = dayIndexByKey.get(startKey);
      const endIndex = dayIndexByKey.get(endKey);
      if (startIndex === undefined || endIndex === undefined) {
        continue;
      }

      const clippedStartIndex = staySpan
        ? Math.max(startIndex, staySpan.startIndex)
        : startIndex;
      const clippedEndIndex = staySpan
        ? Math.min(endIndex, staySpan.endIndex)
        : endIndex;
      if (clippedStartIndex > clippedEndIndex) {
        continue;
      }

      const room = roomsMap.get(assignment.roomId);
      const label = room?.name ?? unknownLabel;
      const color = person.color;
      const textColor = getContrastTextColor(color);

      assignmentItems.push({
        kind: 'assignment',
        id: assignment.id,
        startIndex: clippedStartIndex,
        endIndex: clippedEndIndex,
        label,
        color,
        textColor,
        assignment,
        person: personsMap.get(assignment.personId),
        room,
      });
    }

    if (staySpan && assignmentItems.length === 1 && person.stayStartDate && person.stayEndDate) {
      const [singleAssignment] = assignmentItems;
      if (singleAssignment) {
        assignmentItems[0] = {
          ...singleAssignment,
          startIndex: staySpan.startIndex,
          endIndex: staySpan.endIndex,
        };
      }
    }

    const dedupedAssignments = dedupeContainedTimelineSpans(assignmentItems);
    const mergedAssignments = mergeAdjacentSameRoomAssignmentSpans(dedupedAssignments);

    // After merging consecutive same-room rows, we may have one pill but multiple DB
    // assignments skipped the pre-merge "expand to stay" branch — align bar with stay.
    let finalAssignments: TimelineItemAssignment[];
    if (
      staySpan &&
      mergedAssignments.length === 1 &&
      person.stayStartDate &&
      person.stayEndDate
    ) {
      const [only] = mergedAssignments;
      finalAssignments = only
        ? [
            {
              ...only,
              startIndex: staySpan.startIndex,
              endIndex: staySpan.endIndex,
            },
          ]
        : [];
    } else {
      finalAssignments = mergedAssignments;
    }

    baseItems.push(...finalAssignments);

    const effectiveStaySpan = (() => {
      if (!staySpan) return undefined;

      const assignmentRanges = baseItems
        .filter((i): i is Extract<TimelineItem, { kind: 'assignment' }> => i.kind === 'assignment')
        .map((i) => ({ startIndex: i.startIndex, endIndex: i.endIndex }))
        .sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex);

      if (assignmentRanges.length === 0) return staySpan;

      // Merge intervals and verify coverage over the full stay span.
      let coveredStart = staySpan.startIndex;
      for (const r of assignmentRanges) {
        if (r.endIndex < coveredStart) {
          continue;
        }
        if (r.startIndex > coveredStart) {
          // Gap found
          return staySpan;
        }
        coveredStart = Math.max(coveredStart, r.endIndex + 1);
        if (coveredStart > staySpan.endIndex) {
          // Fully covered
          return undefined;
        }
      }

      return staySpan;
    })();

    // Transport points (arrivals + departures)
    const allTransports = [...arrivals, ...departures];
    for (const transport of allTransports) {
      if (transport.personId !== person.id) {
        continue;
      }
      if (!isTransportVisible(transport, axisStartKey, axisEndKey)) {
        continue;
      }

      const dateKey = localDayKeyOfInstant(transport.datetime);
      const index = dateKey === null ? undefined : dayIndexByKey.get(dateKey);
      if (index === undefined) {
        continue;
      }

      baseItems.push({
        kind: 'transport',
        id: transport.id,
        startIndex: index,
        endIndex: index,
        label: transport.location || unknownLabel,
        transport,
        person: personsMap.get(transport.personId),
      });
    }

    const mergedItems = mergeTransportsIntoAssignments(baseItems);
    const lanes = allocateTimelineLanes(mergedItems) as readonly TimelineItemWithLane[];
    const maxLaneIndex = lanes.reduce((max, i) => Math.max(max, i.laneIndex), -1);
    const maxLaneCount = maxLaneIndex + 1;

    return {
      person,
      items: lanes,
      laneCount: maxLaneCount,
      staySpan: effectiveStaySpan,
      checkoutDayIndex,
    };
  });

  const maxLaneCount = rows.reduce((max, r) => Math.max(max, r.laneCount), 1);

  return {
    tripDays,
    dayKeys,
    rows,
    maxLaneCount,
  };
}

