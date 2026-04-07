/**
 * @fileoverview Utilities for the Calendar timeline (horizontal) view.
 *
 * @module features/calendar/utils/timeline-utils
 */

import { subDays } from 'date-fns';

import { parseISODateString, toISODateString } from '@/lib/db/utils';
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
  TimelineItemBase,
  TimelineItemWithLane,
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
  const days: Date[] = [];
  let cursor = new Date(start.getTime());
  const endTime = end.getTime();

  while (cursor.getTime() <= endTime) {
    days.push(new Date(cursor.getTime()));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
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

    // Presence range: derive from transports first (most accurate), fallback to person stay dates.
    // We treat the stay as nights: start=arrival day, end=day before departure.
    for (const arrival of arrivals) {
      if (arrival.personId !== person.id) continue;
      const key = arrival.datetime.substring(0, 10) as ISODateString;
      if (!stayStartKey || key < stayStartKey) {
        stayStartKey = key;
      }
    }
    for (const departure of departures) {
      if (departure.personId !== person.id) continue;
      const key = departure.datetime.substring(0, 10) as ISODateString;
      if (!stayEndKey || key > stayEndKey) {
        stayEndKey = key;
      }
    }

    if (!stayStartKey && person.stayStartDate) {
      stayStartKey = person.stayStartDate;
    }
    if (!stayEndKey && person.stayEndDate) {
      stayEndKey = person.stayEndDate;
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

      const room = roomsMap.get(assignment.roomId);
      const label = room?.name ?? unknownLabel;
      const color = person.color;
      const textColor = getContrastTextColor(color);

      baseItems.push({
        kind: 'assignment',
        id: assignment.id,
        startIndex,
        endIndex,
        label,
        color,
        textColor,
        assignment,
        person: personsMap.get(assignment.personId),
        room,
      });
    }

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

    const lanes = allocateLanes(baseItems) as readonly TimelineItemWithLane[];
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

