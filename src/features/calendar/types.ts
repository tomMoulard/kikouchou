/**
 * @fileoverview Type definitions for the Calendar feature.
 * Shared types used across calendar components.
 *
 * @module features/calendar/types
 */

import type { KeyboardEvent } from 'react';
import type { Locale } from 'date-fns/locale';
import type { DailyHeadcount } from './utils/headcount-utils';
import type {
  Activity,
  HexColor,
  ISODateString,
  Person,
  Room,
  RoomAssignment,
  Transport,
  TransportType,
  Trip,
} from '@/types';

// ============================================================================
// Calendar Event Types
// ============================================================================

/**
 * Segment position within a multi-day event span.
 * - 'start': First day of the event (show label, rounded left corners)
 * - 'middle': Interior day (no label, no rounded corners)
 * - 'end': Last day of the event (no label, rounded right corners)
 * - 'single': Single-day event (show label, fully rounded)
 */
export type SegmentPosition = 'start' | 'middle' | 'end' | 'single';

/**
 * Enriched assignment data for calendar display.
 */
export interface CalendarEvent {
  /** The underlying assignment */
  readonly assignment: RoomAssignment;
  /** The person assigned (may be undefined if deleted) */
  readonly person: Person | undefined;
  /** The room (may be undefined if deleted) */
  readonly room: Room | undefined;
  /** Display label combining person and room name */
  readonly label: string;
  /** Background color from person */
  readonly color: HexColor;
  /** Text color for contrast */
  readonly textColor: 'white' | 'black';
  /** Position of this segment within the event span */
  readonly segmentPosition: SegmentPosition;
  /** Vertical slot index for stacking overlapping events (0 = top) */
  readonly slotIndex: number;
  /** Unique identifier for the event span (assignment ID) */
  readonly spanId: string;
  /** Total number of days this event spans */
  readonly totalDays: number;
  /** Day index within the week row (0-6, used for week boundary detection) */
  readonly dayOfWeek: number;
  /** Whether this segment is at the start of a week row (visual start) */
  readonly isRowStart: boolean;
  /** Whether this segment is at the end of a week row (visual end) */
  readonly isRowEnd: boolean;
}

/**
 * Transport indicator data for calendar display.
 */
export interface CalendarTransport {
  /** The underlying transport */
  readonly transport: Transport;
  /** The person traveling (may be undefined if deleted) */
  readonly person: Person | undefined;
  /** Display name for the person */
  readonly personName: string;
  /** Person's color for badge */
  readonly color: HexColor;
}

/**
 * Activity data enriched for calendar display.
 */
export interface CalendarActivity {
  /** The underlying activity */
  readonly activity: Activity;
  /** Category colour used for the pill */
  readonly color: HexColor;
  /** Whether this cell is the first day of a multi-day activity */
  readonly isSpanStart: boolean;
  /** Whether this cell is the last day of a multi-day activity */
  readonly isSpanEnd: boolean;
}

// ============================================================================
// Component Props Types
// ============================================================================

/**
 * Props for the CalendarHeader subcomponent.
 */
export interface CalendarHeaderProps {
  readonly currentMonth: Date;
  readonly onPrevMonth: () => void;
  readonly onNextMonth: () => void;
  readonly onToday: () => void;
  readonly dateLocale: Locale;
}

/**
 * Props for the CalendarDayHeader subcomponent.
 */
export interface CalendarDayHeaderProps {
  readonly dateLocale: Locale;
}

/**
 * Props for the CalendarDay subcomponent.
 */
export interface CalendarDayProps {
  readonly dateKey: ISODateString;
  readonly date: Date;
  readonly events: readonly CalendarEvent[];
  readonly transports: readonly CalendarTransport[];
  /** Activities overlapping this day */
  readonly activities: readonly CalendarActivity[];
  /** People on site that night (meal planning); omitted when nobody is there */
  readonly headcount?: DailyHeadcount;
  readonly isCurrentMonth: boolean;
  readonly isToday: boolean;
  readonly isWithinTrip: boolean;
  readonly dateLocale: Locale;
  readonly tabIndex?: number;
  readonly onEventClick: (assignment: RoomAssignment) => void;
  /** Callback when a transport event is clicked */
  readonly onTransportClick?: (transport: CalendarTransport) => void;
  /** Callback when an activity is clicked */
  readonly onActivityClick?: (activity: Activity) => void;
  readonly onDayFocus?: (dateKey: ISODateString) => void;
  readonly onDayKeyDown?: (
    event: KeyboardEvent<HTMLDivElement>,
    dateKey: ISODateString,
  ) => void;
  readonly dayRef?: (dateKey: ISODateString, node: HTMLDivElement | null) => void;
}

/**
 * Props for the CalendarEvent subcomponent.
 */
export interface CalendarEventProps {
  readonly event: CalendarEvent;
  readonly onClick: (assignment: RoomAssignment) => void;
}

/**
 * Props for the TransportIndicator subcomponent.
 */
export interface TransportIndicatorProps {
  readonly transport: CalendarTransport;
  readonly type: TransportType;
  /** Callback when the transport is clicked */
  readonly onClick?: (transport: CalendarTransport) => void;
}

/**
 * Props for the ActivityIndicator subcomponent.
 */
export interface ActivityIndicatorProps {
  readonly activity: CalendarActivity;
  /** Callback when the activity is clicked */
  readonly onClick?: (activity: Activity) => void;
}

// ============================================================================
// Timeline View Types
// ============================================================================

export type CalendarView = 'month' | 'timeline';

/**
 * Transport merged into a timeline assignment bar (same click target as the stay pill).
 */
export interface TimelineTransportMarker {
  readonly transport: Transport;
  /** Trip day column index for this transport's calendar date */
  readonly dayIndex: number;
}

export interface TimelineItemAssignment extends TimelineItemBase {
  readonly kind: 'assignment';
  readonly assignment: RoomAssignment;
  readonly person: Person | undefined;
  readonly room: Room | undefined;
  readonly label: string;
  readonly color: HexColor;
  readonly textColor: 'white' | 'black';
  /** Arrivals/departures on adjacent or covered nights, shown inside the pill */
  readonly timelineTransports?: readonly TimelineTransportMarker[];
}

export interface TimelineItemTransport extends TimelineItemBase {
  readonly kind: 'transport';
  readonly transport: Transport;
  readonly person: Person | undefined;
  readonly label: string;
}

export type TimelineItem = TimelineItemAssignment | TimelineItemTransport;

export interface TimelineItemBase {
  readonly id: string;
  readonly startIndex: number;
  readonly endIndex: number;
}

export type TimelineItemWithLane = TimelineItem & { readonly laneIndex: number };

export interface CalendarTimelineRowModel {
  readonly person: Person;
  readonly items: readonly TimelineItemWithLane[];
  readonly laneCount: number;
  readonly staySpan?: {
    readonly startIndex: number;
    readonly endIndex: number;
  };
  /**
   * Checkout day index (within tripDays) for this person.
   * Represents the day they leave and therefore do not sleep on that day.
   */
  readonly checkoutDayIndex?: number;
}

export interface CalendarTimelineModel {
  readonly tripDays: readonly Date[];
  readonly dayKeys: readonly ISODateString[];
  readonly rows: readonly CalendarTimelineRowModel[];
  readonly maxLaneCount: number;
}

export interface CalendarTimelineProps {
  readonly trip: Trip;
  readonly persons: readonly Person[];
  readonly rooms: readonly Room[];
  readonly assignments: readonly RoomAssignment[];
  readonly arrivals: readonly Transport[];
  readonly departures: readonly Transport[];
  /** Shared agenda, drawn as category bands under the guest rows */
  readonly activities: readonly Activity[];
  readonly dateLocale: Locale;
  readonly today: Date;
  readonly onAssignmentClick: (
    assignment: RoomAssignment,
    relatedTransports?: readonly Transport[],
  ) => void;
  readonly onTransportClick?: (transport: CalendarTransport) => void;
  readonly onActivityClick?: (activity: Activity) => void;
  /**
   * Sends the user off to create guests, from the "nothing scheduled" empty
   * state. Omitted, the empty state keeps its text-only form.
   */
  readonly onAddGuests?: () => void;
  /** Same, for rooms. */
  readonly onAddRooms?: () => void;
}
