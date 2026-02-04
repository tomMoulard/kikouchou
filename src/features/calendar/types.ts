/**
 * @fileoverview Type definitions for the Calendar feature.
 * Shared types used across calendar components.
 *
 * @module features/calendar/types
 */

import type { Locale } from 'date-fns/locale';
import type {
  HexColor,
  Person,
  Room,
  RoomAssignment,
  Transport,
  TransportType,
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
  readonly date: Date;
  readonly events: readonly CalendarEvent[];
  readonly transports: readonly CalendarTransport[];
  readonly isCurrentMonth: boolean;
  readonly isToday: boolean;
  readonly isWithinTrip: boolean;
  readonly dateLocale: Locale;
  readonly onEventClick: (assignment: RoomAssignment) => void;
  /** Callback when a transport event is clicked */
  readonly onTransportClick?: (transport: CalendarTransport) => void;
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
