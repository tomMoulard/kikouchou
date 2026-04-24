/**
 * @fileoverview Utilities for the Calendar timeline (horizontal) view.
 *
 * @module features/calendar/utils/timeline-utils
 */

import { subDays } from 'date-fns';

import { parseISODateString, toISODateString } from '@/lib/db/utils';
import { dedupeContainedTimelineSpans } from '@/lib/utils/dedupe-timeline-spans';
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
  TimelineItemBase,
  TimelineItemTransport,
  TimelineItemWithLane,
  TimelineTransportMarker,
} from '../types';
import { getContrastTextColor } from './calendar-utils';

// ============================================================================
// Internal helpers
// ============================================================================

function buildTripDays(trip: Trip): readonly Date[] {
  const start = parseISODateString(trip.startDate);
  const end = parseISODateString(trip.endDate);
  if (!start || !end) {
    return [];
  }

  // Build days by stepping in UTC to avoid DST-related off-by-one issues.
  const raw: Date[] = [];
  let cursor = new Date(start.getTime());
  const endTime = end.getTime();

  while (cursor.getTime() <= endTime) {
    raw.push(new Date(cursor.getTime()));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  // Defensive: if two steps ever map to the same UTC calendar day, collapse so header
  // column count matches row grids (duplicate React keys would drop a header cell).
  const seen = new Set<ISODateString>();
  const days: Date[] = [];
  for (const d of raw) {
    const k = toISODateString(d);
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    days.push(d);
  }

  return days;
}

function allocateLanes<TItem extends TimelineItemBase>(items: readonly TItem[]): readonly (TItem & { readonly laneIndex: number })[] {
  if (items.length === 0) {
    return [];
  }

  const sorted = [...items].sort((a, b) => {
    const startDiff = a.startIndex - b.startIndex;
    if (startDiff !== 0) {
      return startDiff;
    }
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
  tripStart: ISODateString,
  tripEnd: ISODateString,
): boolean {
  return assignment.endDate >= tripStart && assignment.startDate <= tripEnd;
}

function isTransportVisible(transport: Transport, tripStart: ISODateString, tripEnd: ISODateString): boolean {
  const dateKey = transport.datetime.substring(0, 10) as ISODateString;
  return dateKey >= tripStart && dateKey <= tripEnd;
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

export function buildCalendarTimelineModel(args: {
  readonly trip: Trip;
  readonly persons: readonly Person[];
  readonly rooms: readonly Room[];
  readonly assignments: readonly RoomAssignment[];
  readonly arrivals: readonly Transport[];
  readonly departures: readonly Transport[];
  readonly unknownLabel: string;
}): CalendarTimelineModel {
  const { trip, persons, rooms, assignments, arrivals, departures, unknownLabel } = args;

  const tripDays = buildTripDays(trip);
  const dayKeys = tripDays.map((d) => toISODateString(d));

  const tripStartKey = trip.startDate;
  const tripEndKey = trip.endDate;

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
    let stayStartKey: ISODateString | null = null;
    let stayEndKey: ISODateString | null = null;

    // Presence range: explicit stay dates take precedence over transports.
    // This keeps timeline behavior consistent with the rest of the app when
    // users manually edit a guest's stay window.
    if (person.stayStartDate) {
      stayStartKey = person.stayStartDate;
    }
    if (person.stayEndDate) {
      stayEndKey = person.stayEndDate;
    }

    // Fallback to transports only when explicit stay bounds are missing.
    // We treat the stay as nights: start=arrival day, end=day before departure.
    if (!stayStartKey) {
      for (const arrival of arrivals) {
        if (arrival.personId !== person.id) continue;
        const key = arrival.datetime.substring(0, 10) as ISODateString;
        if (!stayStartKey || key < stayStartKey) {
          stayStartKey = key;
        }
      }
    }
    if (!stayEndKey) {
      for (const departure of departures) {
        if (departure.personId !== person.id) continue;
        const key = departure.datetime.substring(0, 10) as ISODateString;
        if (!stayEndKey || key > stayEndKey) {
          stayEndKey = key;
        }
      }
    }

    const staySpan = (() => {
      if (!stayStartKey || !stayEndKey) return undefined;
      if (stayStartKey >= stayEndKey) return undefined;

      const start = parseISODateString(stayStartKey);
      const end = parseISODateString(stayEndKey);
      if (!start || !end) return undefined;

      const lastNight = subDays(end, 1);
      if (lastNight < start) return undefined;

      const clippedStartKey = stayStartKey < tripStartKey ? tripStartKey : stayStartKey;
      const lastNightKey = toISODateString(lastNight);
      const clippedEndKey = lastNightKey > tripEndKey ? tripEndKey : lastNightKey;

      const startIndex = dayIndexByKey.get(clippedStartKey);
      const endIndex = dayIndexByKey.get(clippedEndKey);
      if (startIndex === undefined || endIndex === undefined) return undefined;

      return { startIndex, endIndex };
    })();

    const checkoutDayIndex = (() => {
      if (!stayEndKey) return undefined;
      const clippedCheckoutKey = stayEndKey > tripEndKey ? tripEndKey : stayEndKey;
      return dayIndexByKey.get(clippedCheckoutKey);
    })();

    // Room assignment spans (nights model like month view: endDate is checkout -> subtract 1 day)
    const assignmentItems: TimelineItemAssignment[] = [];
    for (const assignment of assignments) {
      if (assignment.personId !== person.id) {
        continue;
      }
      if (!isAssignmentVisible(assignment, tripStartKey, tripEndKey)) {
        continue;
      }

      const assignmentStart = parseISODateString(assignment.startDate);
      const assignmentEnd = parseISODateString(assignment.endDate);
      if (!assignmentStart || !assignmentEnd) {
        continue;
      }

      const lastNight = subDays(assignmentEnd, 1);
      if (lastNight < assignmentStart) {
        continue;
      }

      const startKey = toISODateString(assignmentStart);
      const endKey = toISODateString(lastNight);

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
      if (!isTransportVisible(transport, tripStartKey, tripEndKey)) {
        continue;
      }

      const dateKey = transport.datetime.substring(0, 10) as ISODateString;
      const index = dayIndexByKey.get(dateKey);
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
    const lanes = allocateLanes(mergedItems) as readonly TimelineItemWithLane[];
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

