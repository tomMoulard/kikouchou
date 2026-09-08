/**
 * @fileoverview Groups transports into the dated sections both the transport
 * list and the run sheet render.
 *
 * The two screens show the same legs in the same order under the same date
 * headings, so they group them with one function. When this lived inside the
 * list page, the run sheet had to copy it, and a copy is how the two views
 * start disagreeing about which day a leg belongs to.
 *
 * @module features/transports/utils/transport-grouping
 */

import { type Locale, format, parseISO } from 'date-fns';

import { sortTransportsByInstant } from './pickup-utils';

import { formatFullDate } from '@/lib/utils/date-format';
import type { Transport } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * The transports of a single calendar day.
 */
export interface TransportDateGroup {
  /** Local calendar day, `yyyy-MM-dd`. */
  readonly dateKey: string;
  /** The same day written for the reader, in their locale. */
  readonly displayDate: string;
  /** The day's transports, earliest first. */
  readonly transports: readonly Transport[];
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Reads the local calendar day out of a transport datetime.
 *
 * @param datetime - ISO datetime string
 * @returns The day as `yyyy-MM-dd`, or an empty string when it cannot be read
 */
export function getTransportDateKey(datetime: string): string {
  try {
    const parsedDate = parseISO(datetime);
    if (isNaN(parsedDate.getTime())) {
      return '';
    }
    return format(parsedDate, 'yyyy-MM-dd');
  } catch {
    return '';
  }
}

/**
 * Groups transports by the day they happen on, earliest day first.
 *
 * A leg whose datetime cannot be read is dropped: it has no day to sit under.
 * Callers that print a count must count what these groups hold rather than
 * what they passed in.
 *
 * Date keys are all `yyyy-MM-dd`, so ordering them as strings is sound. The
 * legs inside one day are ordered by instant instead, because their datetimes
 * may carry different UTC offsets and would otherwise sort by wall clock
 * rather than by when they happen.
 *
 * @param transports - The transports to group (not mutated)
 * @param locale - date-fns locale used for the display date
 * @returns One group per day, earliest day first
 */
export function groupTransportsByDate(
  transports: readonly Transport[],
  locale: Locale,
): TransportDateGroup[] {
  const groupsMap = new Map<string, Transport[]>();

  for (const transport of transports) {
    const dateKey = getTransportDateKey(transport.datetime);
    if (!dateKey) {
      continue;
    }

    const existing = groupsMap.get(dateKey);
    if (existing) {
      existing.push(transport);
    } else {
      groupsMap.set(dateKey, [transport]);
    }
  }

  return Array.from(groupsMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, dayTransports]) => ({
      dateKey,
      displayDate: formatFullDate(dateKey, locale),
      transports: sortTransportsByInstant(dayTransports),
    }));
}

/**
 * Counts the transports a set of groups actually renders.
 *
 * @param groups - The groups to total up
 * @returns The number of legs inside them
 */
export function countGroupedTransports(
  groups: readonly TransportDateGroup[],
): number {
  return groups.reduce((total, group) => total + group.transports.length, 0);
}
