/**
 * @fileoverview Calendar Page - Month view calendar displaying room assignments.
 * Provides visual overview of room occupancy with color-coded events.
 *
 * Route: /trips/:tripId/calendar (default view when selecting a trip)
 *
 * Features:
 * - Month view calendar grid (7 columns, Mon-Sun)
 * - Navigation (prev/next month, today button)
 * - Room assignments displayed as colored events
 * - Events show person name + room name
 * - Click event to edit assignment
 * - Responsive design with horizontal scroll on mobile
 * - Visual indicators for today and trip date boundaries
 *
 * @module features/calendar/pages/CalendarPage
 */

import {
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isValid,
  isWithinInterval,
  parseISO,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from 'date-fns';
import { type Locale, enUS, fr } from 'date-fns/locale';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

import { useTripContext } from '@/contexts/TripContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useToday } from '@/hooks/useToday';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { TransportIcon } from '@/components/shared/TransportIcon';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  EventDetailDialog,
  type AssignmentEventData,
  type CalendarEventData,
} from '@/features/calendar/components/EventDetailDialog';
import type {
  HexColor,
  Person,
  Room,
  RoomAssignment,
  Transport,
  TransportType,
} from '@/types';
import { toISODateString } from '@/lib/db/utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Segment position within a multi-day event span.
 * - 'start': First day of the event (show label, rounded left corners)
 * - 'middle': Interior day (no label, no rounded corners)
 * - 'end': Last day of the event (no label, rounded right corners)
 * - 'single': Single-day event (show label, fully rounded)
 */
type SegmentPosition = 'start' | 'middle' | 'end' | 'single';

/**
 * Enriched assignment data for calendar display.
 */
interface CalendarEvent {
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
 * Props for the CalendarHeader subcomponent.
 */
interface CalendarHeaderProps {
  readonly currentMonth: Date;
  readonly onPrevMonth: () => void;
  readonly onNextMonth: () => void;
  readonly onToday: () => void;
  readonly dateLocale: Locale;
}

/**
 * Props for the CalendarDayHeader subcomponent.
 */
interface CalendarDayHeaderProps {
  readonly dateLocale: Locale;
}

/**
 * Props for the CalendarDay subcomponent.
 */
interface CalendarDayProps {
  readonly date: Date;
  readonly events: readonly CalendarEvent[];
  readonly transports: readonly CalendarTransport[];
  readonly isCurrentMonth: boolean;
  readonly isToday: boolean;
  readonly isWithinTrip: boolean;
  readonly dateLocale: Locale;
  readonly onEventClick: (assignment: RoomAssignment) => void;
}

/**
 * Props for the CalendarEvent subcomponent.
 */
interface CalendarEventProps {
  readonly event: CalendarEvent;
  readonly onClick: (assignment: RoomAssignment) => void;
}

/**
 * Transport indicator data for calendar display.
 */
interface CalendarTransport {
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
 * Props for the TransportIndicator subcomponent.
 */
interface TransportIndicatorProps {
  readonly transport: CalendarTransport;
  readonly type: TransportType;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Gets the date-fns locale based on the i18n language.
 */
function getDateLocale(language: string): Locale {
  return language === 'fr' ? fr : enUS;
}

/**
 * Calculates the relative luminance of a hex color.
 * Used to determine if text should be white or black for contrast.
 *
 * @param hex - Hex color string (with or without #)
 * @returns Relative luminance (0-1), defaults to 0.5 for invalid input
 */
function getLuminance(hex: string): number {
  // Remove # if present
  let cleanHex = hex.replace('#', '');

  // Handle shorthand hex colors (e.g., #fff -> #ffffff)
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split('')
      .map((c) => c + c)
      .join('');
  }

  // Validate hex format - must be exactly 6 hex characters
  if (!/^[0-9A-Fa-f]{6}$/.test(cleanHex)) {
    // Return middle luminance as safe default for invalid colors
    return 0.5;
  }

  // Parse RGB values
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255,
   g = parseInt(cleanHex.substring(2, 4), 16) / 255,
   b = parseInt(cleanHex.substring(4, 6), 16) / 255,

  // Calculate relative luminance using sRGB formula
   linearize = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055)**2.4;

  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Determines the optimal text color (white or black) for a given background.
 *
 * @param bgColor - Background hex color
 * @returns 'white' or 'black' for optimal contrast
 */
function getContrastTextColor(bgColor: HexColor): 'white' | 'black' {
  const luminance = getLuminance(bgColor);
  // WCAG recommends using white text on dark backgrounds (luminance < 0.179)
  return luminance < 0.179 ? 'white' : 'black';
}



/**
 * Checks if a date falls within an assignment's date range.
 */
/**
 * Stable empty array constant to prevent re-renders for days without events.
 * Using a module-level constant ensures referential equality across renders.
 */
const EMPTY_EVENTS: readonly CalendarEvent[] = [],

/**
 * Stable empty array constant to prevent re-renders for days without transports.
 */
 EMPTY_TRANSPORTS: readonly CalendarTransport[] = [],

// ============================================================================
// CalendarHeader Subcomponent
// ============================================================================

/**
 * Header with month/year display and navigation controls.
 */
 CalendarHeader = memo(({
  currentMonth,
  onPrevMonth,
  onNextMonth,
  onToday,
  dateLocale,
}: CalendarHeaderProps): ReactElement => {
  const { t } = useTranslation(),

   monthYearLabel = useMemo(
    () => format(currentMonth, 'LLLL yyyy', { locale: dateLocale }),
    [currentMonth, dateLocale],
  );

  return (
    <div className="flex items-center justify-between gap-4 mb-4">
      {/* Navigation buttons */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          onClick={onPrevMonth}
          aria-label={t('calendar.previousMonth', 'Previous month')}
          className="size-10 md:size-8"
        >
          <ChevronLeft className="size-5 md:size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onNextMonth}
          aria-label={t('calendar.nextMonth', 'Next month')}
          className="size-10 md:size-8"
        >
          <ChevronRight className="size-5 md:size-4" aria-hidden="true" />
        </Button>
      </div>

      {/* Month/Year display */}
      <h2 className="text-lg font-semibold capitalize flex-1 text-center">
        {monthYearLabel}
      </h2>

      {/* Today button */}
      <Button
        variant="outline"
        size="sm"
        onClick={onToday}
        className="hidden sm:flex"
      >
        {t('calendar.today')}
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={onToday}
        aria-label={t('calendar.today')}
        className="size-8 sm:hidden"
      >
        <CalendarIcon className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
});

CalendarHeader.displayName = 'CalendarHeader';

// ============================================================================
// CalendarDayHeader Subcomponent
// ============================================================================

/**
 * Row of day-of-week headers (Mon-Sun).
 */
const CalendarDayHeader = memo(({
  dateLocale,
}: CalendarDayHeaderProps): ReactElement => {
  // Generate day names starting from Monday
  const dayNames = useMemo(() => {
    const baseDate = new Date(2024, 0, 1); // Jan 1, 2024 is a Monday
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(baseDate);
      day.setDate(day.getDate() + i);
      return {
        short: format(day, 'EEE', { locale: dateLocale }),
        full: format(day, 'EEEE', { locale: dateLocale }),
      };
    });
  }, [dateLocale]);

  return (
    <div className="grid grid-cols-7 gap-px bg-muted">
      {dayNames.map((day) => (
        <div
          key={day.full}
          className="bg-background p-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider"
          aria-label={day.full}
        >
          <span className="hidden sm:inline">{day.short}</span>
          <span className="sm:hidden">{day.short.charAt(0)}</span>
        </div>
      ))}
    </div>
  );
});

CalendarDayHeader.displayName = 'CalendarDayHeader';

// ============================================================================
// CalendarEvent Subcomponent
// ============================================================================

/**
 * Get the CSS classes for segment border radius based on position.
 * Handles both logical segment position (start/middle/end/single) and
 * visual row boundaries (week breaks require rounded corners).
 */
function getSegmentBorderRadiusClasses(
  segmentPosition: SegmentPosition,
  isRowStart: boolean,
  isRowEnd: boolean,
): string {
  // Single-day event: fully rounded
  if (segmentPosition === 'single') {
    return 'rounded';
  }

  // For multi-day events, we need to consider both logical position and row boundaries
  // A 'middle' segment that's at row start needs rounded left corners
  // A 'middle' segment that's at row end needs rounded right corners

  const isLogicalStart = segmentPosition === 'start',
   isLogicalEnd = segmentPosition === 'end',
  
  // Rounded left corner if: logical start OR visual row start (week boundary)
   needsRoundedLeft = isLogicalStart || isRowStart,
  // Rounded right corner if: logical end OR visual row end (week boundary)
   needsRoundedRight = isLogicalEnd || isRowEnd;

  if (needsRoundedLeft && needsRoundedRight) {
    return 'rounded';
  }
  if (needsRoundedLeft) {
    return 'rounded-l';
  }
  if (needsRoundedRight) {
    return 'rounded-r';
  }
  return 'rounded-none';
}

/**
 * Single event pill displayed within a calendar day.
 * Supports multi-day spanning with proper segment styling.
 */
const CalendarEvent = memo(({
  event,
  onClick,
}: CalendarEventProps): ReactElement => {
  const handleClick = useCallback(() => {
    onClick(event.assignment);
  }, [onClick, event.assignment]),

   handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick(event.assignment);
      }
    },
    [onClick, event.assignment],
  ),

  // Determine if we should show the label
  // Show on: single-day events, start of span, or start of a new row (week continuation)
   showLabel = event.segmentPosition === 'single' || 
               event.segmentPosition === 'start' ||
               (event.isRowStart && event.segmentPosition !== 'end'),

  // Get border radius classes based on segment position and row boundaries
   borderRadiusClasses = getSegmentBorderRadiusClasses(
     event.segmentPosition,
     event.isRowStart && event.segmentPosition !== 'start',
     event.isRowEnd && event.segmentPosition !== 'end',
   ),

  // Determine left/right margins for visual spacing at boundaries
  // Add margin on interior boundaries to create visual gap between adjacent events
   marginClasses = cn(
     // Left margin only if NOT at row start and NOT logical start
     event.segmentPosition !== 'start' && !event.isRowStart && '-ml-px',
   );

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'w-full text-left text-xs px-1.5 py-1 md:px-1 md:py-0.5 truncate',
        'min-h-[28px] md:min-h-0',
        'transition-opacity hover:opacity-80',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'cursor-pointer',
        borderRadiusClasses,
        marginClasses,
      )}
      style={{
        backgroundColor: event.color,
        color: event.textColor,
      }}
      title={event.label}
      aria-label={event.label}
    >
      {showLabel ? event.label : '\u00A0'}
    </button>
  );
});

CalendarEvent.displayName = 'CalendarEvent';

// ============================================================================
// TransportIndicator Subcomponent
// ============================================================================

/**
 * Formats a datetime string to show just the time (HH:mm) in local timezone.
 * 
 * @param datetime - ISO datetime string (e.g., "2024-01-10T13:00:00.000Z")
 * @returns Time string in HH:mm format (local timezone)
 */
function formatTime(datetime: string): string {
  try {
    // Parse ISO datetime to Date object (preserves UTC instant)
    const date = parseISO(datetime);
    if (isNaN(date.getTime())) return '';
    // Format in local timezone using date-fns format
    return format(date, 'HH:mm');
  } catch {
    return '';
  }
}

/**
 * Transport indicator pill displayed within a calendar day.
 * Shows arrival (green) or departure (orange) with transport icon, time, person, and location.
 */
const TransportIndicator = memo(({
  transport,
  type,
}: TransportIndicatorProps): ReactElement => {
  const { t } = useTranslation(),

   isArrival = type === 'arrival',
   time = formatTime(transport.transport.datetime),
   location = transport.transport.location,
   transportMode = transport.transport.transportMode ?? 'other',
   
   // Build title for accessibility
   ariaLabel = isArrival
    ? t('calendar.personArriving', '{{name}} arriving', { name: transport.personName })
    : t('calendar.personDeparting', '{{name}} departing', { name: transport.personName }),
   
   // Full tooltip with all details
   tooltipText = `${time} ${transport.personName}${location ? ` - ${location}` : ''}`;

  return (
    <div
      className={cn(
        'flex items-center gap-1 text-xs rounded px-1.5 py-0.5 truncate',
        'border',
        isArrival
          ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800'
          : 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800',
      )}
      title={tooltipText}
      aria-label={ariaLabel}
    >
      <TransportIcon 
        mode={transportMode} 
        className="size-3" 
      />
      <span className="font-medium">{time}</span>
      <span
        className="size-2 rounded-full shrink-0"
        style={{ backgroundColor: transport.color }}
        aria-hidden="true"
      />
      <span className="truncate">{transport.personName}</span>
      {location && (
        <span className="truncate text-[10px] opacity-75">- {location}</span>
      )}
    </div>
  );
});

TransportIndicator.displayName = 'TransportIndicator';

// ============================================================================
// CalendarDay Subcomponent
// ============================================================================

/** Maximum number of visible event slots before showing "+N more" */
const MAX_VISIBLE_EVENT_SLOTS = 3;

/**
 * Single day cell in the calendar grid.
 * Events are rendered in slot-based positions to support multi-day spanning.
 */
const CalendarDay = memo(({
  date,
  events,
  transports,
  isCurrentMonth,
  isToday,
  isWithinTrip,
  dateLocale,
  onEventClick,
}: CalendarDayProps): ReactElement => {
  const dayNumber = format(date, 'd', { locale: dateLocale }),
   dateLabel = format(date, 'PPPP', { locale: dateLocale }),

  // Calculate max slot index for the slot indices array (memoized, no spread operator)
   maxSlotIndex = useMemo(() => {
     if (events.length === 0) {return -1;}
     let max = -1;
     for (const e of events) {
       if (e.slotIndex > max) {max = e.slotIndex;}
     }
     return max;
   }, [events]),

  // Limit visible items
   maxVisibleTransports = 2,
   visibleTransports = transports.slice(0, maxVisibleTransports),
   hiddenTransportCount = transports.length - visibleTransports.length,

  // For events, we show up to MAX_VISIBLE_EVENT_SLOTS slots
  // Events in higher slots get hidden (events are already sorted by slotIndex)
   visibleEvents = useMemo(() => {
     const visible: CalendarEvent[] = [];
     for (const e of events) {
       if (e.slotIndex >= MAX_VISIBLE_EVENT_SLOTS) {break;} // Early exit since sorted
       visible.push(e);
     }
     return visible;
   }, [events]),
   hiddenEventCount = events.length - visibleEvents.length,
   totalHiddenCount = hiddenTransportCount + hiddenEventCount,

  // Build an array of slot indices to render (including empty slots for alignment)
   slotIndices = useMemo(() => {
     const indices: (number | null)[] = [];
     const maxSlot = Math.min(maxSlotIndex, MAX_VISIBLE_EVENT_SLOTS - 1);
     for (let i = 0; i <= maxSlot; i++) {
       indices.push(i);
     }
     return indices;
   }, [maxSlotIndex]),

  // Map slot index to event for quick lookup
   eventsBySlot = useMemo(() => {
     const map = new Map<number, CalendarEvent>();
     for (const event of visibleEvents) {
       map.set(event.slotIndex, event);
     }
     return map;
   }, [visibleEvents]);

  return (
    <div
      className={cn(
        'bg-background min-h-[80px] sm:min-h-[100px] p-1 flex flex-col',
        'border-t border-muted',
        !isCurrentMonth && 'bg-muted/30',
        !isWithinTrip && isCurrentMonth && 'bg-muted/50',
      )}
      role="gridcell"
      aria-label={dateLabel}
    >
      {/* Day number */}
      <div className="flex items-center justify-center mb-1">
        <span
          className={cn(
            'text-sm font-medium size-6 flex items-center justify-center rounded-full',
            !isCurrentMonth && 'text-muted-foreground/50',
            isCurrentMonth && !isToday && 'text-foreground',
            isToday && 'bg-primary text-primary-foreground',
          )}
        >
          {dayNumber}
        </span>
      </div>

      {/* Content area with events and transports */}
      <div className="flex-1 flex flex-col gap-0.5 overflow-hidden">
        {/* Transports (arrivals/departures) - shown at top */}
        {visibleTransports.map((transport) => (
          <TransportIndicator
            key={transport.transport.id}
            transport={transport}
            type={transport.transport.type}
          />
        ))}

        {/* Room assignment events - slot-based positioning */}
        {slotIndices.map((slotIndex) => {
          if (slotIndex === null) {return null;}
          const event = eventsBySlot.get(slotIndex);
          
          if (event) {
            return (
              <CalendarEvent
                key={`${event.spanId}-${slotIndex}`}
                event={event}
                onClick={onEventClick}
              />
            );
          }
          
          // Render empty placeholder for this slot to maintain alignment
          // This happens when an event occupies this slot on adjacent days but not this day
          return (
            <div 
              key={`empty-${slotIndex}`} 
              className="h-[28px] md:h-[24px]"
              aria-hidden="true"
            />
          );
        })}

        {/* Hidden items indicator */}
        {totalHiddenCount > 0 && (
          <div className="text-xs text-muted-foreground text-center">
            +{totalHiddenCount}
          </div>
        )}
      </div>
    </div>
  );
});

CalendarDay.displayName = 'CalendarDay';

// ============================================================================
// Main Component
// ============================================================================

/**
 * Calendar Page component showing month view with room assignments.
 *
 * @example
 * ```tsx
 * // In router configuration
 * { path: '/trips/:tripId/calendar', element: <CalendarPage /> }
 * ```
 */
const CalendarPage = memo((): ReactElement => {
  const { t, i18n } = useTranslation(),
   { tripId: tripIdFromUrl } = useParams<'tripId'>(),

  // Context hooks
   { currentTrip, isLoading: isTripLoading, setCurrentTrip } = useTripContext(),
   { rooms, isLoading: isRoomsLoading, error: roomsError } = useRoomContext(),
   { assignments, isLoading: isAssignmentsLoading, error: assignmentsError, deleteAssignment } = useAssignmentContext(),
   { getPersonById, isLoading: isPersonsLoading, error: personsError } = usePersonContext(),
   { arrivals, departures, isLoading: isTransportsLoading, error: transportsError } = useTransportContext(),

  // Local state for current viewing month
  // Initialized to today - will sync with trip start date via useEffect when loaded
   [currentMonth, setCurrentMonth] = useState<Date>(() => startOfMonth(new Date())),

  // Track if user has manually navigated to avoid overwriting their selection
   hasUserNavigatedRef = useRef(false),

  // Event detail dialog state
   [selectedEvent, setSelectedEvent] = useState<CalendarEventData | null>(null),
   [isEventDialogOpen, setIsEventDialogOpen] = useState(false);

  // Sync URL tripId with context - if URL has a tripId but context doesn't match, update context
  useEffect(() => {
    if (tripIdFromUrl && !isTripLoading && currentTrip?.id !== tripIdFromUrl) {
      setCurrentTrip(tripIdFromUrl).catch((err) => {
        console.error('Failed to set current trip from URL:', err);
      });
    }
  }, [tripIdFromUrl, currentTrip?.id, isTripLoading, setCurrentTrip]);

  // Sync currentMonth with trip start date when trip loads (but not if user already navigated)
  useEffect(() => {
    if (!hasUserNavigatedRef.current && currentTrip?.startDate) {
      const tripStart = parseISO(currentTrip.startDate);
      if (isValid(tripStart)) {
        // Use timeout to avoid synchronous setState in effect
        const timer = setTimeout(() => {
          setCurrentMonth(startOfMonth(tripStart));
        }, 0);
        return () => clearTimeout(timer);
      }
    }
    return undefined;
  }, [currentTrip?.startDate]);

  // Combined loading state
  const isLoading = isTripLoading || isRoomsLoading || isAssignmentsLoading || isPersonsLoading || isTransportsLoading,

  // Date locale based on current language
   dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]),

  // Build room lookup map for O(1) access
   roomsMap = useMemo(
    () => new Map<string, Room>(rooms.map((room) => [room.id, room])),
    [rooms]
  ),

  // Trip date boundaries for visual indicators
   tripBoundaries = useMemo(() => {
    if (!currentTrip) {return null;}
    const start = parseISO(currentTrip.startDate),
     end = parseISO(currentTrip.endDate);
    if (!isValid(start) || !isValid(end)) {return null;}
    return { start, end };
  }, [currentTrip]),

  // Generate calendar days for the current month view
   calendarDays = useMemo(
    () => {
      const monthStart = startOfMonth(currentMonth),
       monthEnd = endOfMonth(currentMonth),
      // Week starts on Monday (weekStartsOn: 1)
       calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 }),
       calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

      return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
    },
    [currentMonth]
  ),

  // Extract translated fallback outside the expensive computation
  // This ensures stable dependency and avoids recalculation on language change
   unknownLabel = t('common.unknown'),

  // Build calendar events from assignments with multi-day spanning support
  // Algorithm:
  // 1. First pass: identify all valid assignments and their date ranges
  // 2. Sort by start date for consistent slot allocation
  // 3. Greedy slot allocation: assign each event to the lowest available slot
  // 4. Second pass: create per-day events with segment position metadata
   eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();

    // Early return if no days to display
    if (calendarDays.length === 0) {
      return map;
    }

    // Pre-compute calendar boundaries for efficient range checking
    const firstDay = calendarDays[0],
     lastDay = calendarDays[calendarDays.length - 1];

    // Safety check for array access (satisfies noUncheckedIndexedAccess)
    if (!firstDay || !lastDay) {
      return map;
    }

    const calendarStartStr = toISODateString(firstDay),
     calendarEndStr = toISODateString(lastDay);

    // ===== PHASE 1: Identify valid assignments and their visible ranges =====
    interface SpanInfo {
      assignment: RoomAssignment;
      person: Person | undefined;
      room: Room | undefined;
      label: string;
      color: string;
      textColor: 'white' | 'black';
      effectiveStart: Date;
      effectiveEnd: Date;
      totalDays: number;
      spanId: string;
    }

    const spans: SpanInfo[] = [];

    for (const assignment of assignments) {
      // Skip assignments completely outside visible calendar range
      if (assignment.endDate < calendarStartStr || assignment.startDate > calendarEndStr) {
        continue;
      }

      const person = getPersonById(assignment.personId),
       room = roomsMap.get(assignment.roomId),

      // Build display label
       personName = person?.name ?? unknownLabel,
       roomName = room?.name ?? unknownLabel,
       label = `${personName} - ${roomName}`,

      // Determine colors with fallback for invalid/missing colors
       color = (person?.color && person.color.length >= 4) ? person.color : '#6b7280',
       textColor = getContrastTextColor(color),

      // Parse assignment dates to determine the actual range to iterate
       assignmentStart = parseISO(assignment.startDate),
       assignmentEnd = parseISO(assignment.endDate);

      // Skip if dates are invalid
      if (!isValid(assignmentStart) || !isValid(assignmentEnd)) {
        continue;
      }

      // Room assignments use "check-in / check-out" model:
      // - startDate = check-in day (first night staying)
      // - endDate = check-out day (person leaves, does NOT sleep that night)
      // So we display from startDate to (endDate - 1 day)
      const lastNight = subDays(assignmentEnd, 1);
      
      // If check-in and check-out are the same day, skip (no nights stayed)
      if (lastNight < assignmentStart) {
        continue;
      }

      // Calculate intersection with visible calendar range
      const effectiveStart = assignmentStart < firstDay ? firstDay : assignmentStart,
       effectiveEnd = lastNight > lastDay ? lastDay : lastNight,
       totalDays = Math.round((effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

      spans.push({
        assignment,
        person,
        room,
        label,
        color,
        textColor,
        effectiveStart,
        effectiveEnd,
        totalDays,
        spanId: assignment.id,
      });
    }

    // ===== PHASE 2: Greedy slot allocation =====
    // Time complexity: O(spans × avgSlotChecks × avgSpanDays)
    // Space complexity: O(calendarDays × maxSlots)
    
    /** Maximum slot allocation attempts to prevent infinite loop in pathological cases */
    const MAX_SLOT_LIMIT = 100;

    // Sort spans by start date, then by duration (longer first for visual stability)
    spans.sort((a, b) => {
      const startDiff = a.effectiveStart.getTime() - b.effectiveStart.getTime();
      if (startDiff !== 0) {return startDiff;}
      // Longer events first to give them priority for lower slots
      return b.totalDays - a.totalDays;
    });

    // Map of spanId -> slot index
    const slotAssignments = new Map<string, number>();
    
    // Track slot occupancy by date: Map<dateKey, Set<slotIndex>>
    const slotOccupancy = new Map<string, Set<number>>();

    /**
     * Helper to mark a slot as occupied for all days in a span.
     * Extracted to reuse for both normal assignment and safety limit fallback.
     */
    const markSlotOccupied = (spanDays: readonly Date[], slot: number) => {
      for (const day of spanDays) {
        const dateKey = toISODateString(day);
        let occupiedSlots = slotOccupancy.get(dateKey);
        if (!occupiedSlots) {
          occupiedSlots = new Set<number>();
          slotOccupancy.set(dateKey, occupiedSlots);
        }
        occupiedSlots.add(slot);
      }
    };

    for (const span of spans) {
      // Pre-compute days array ONCE per span (performance optimization from review)
      const spanDays = eachDayOfInterval({ start: span.effectiveStart, end: span.effectiveEnd });
      
      // Find the lowest slot that's free for all days of this span
      let slot = 0,
       slotFound = false;

      while (!slotFound) {
        let slotAvailable = true;
        
        for (const day of spanDays) {
          const dateKey = toISODateString(day),
           occupiedSlots = slotOccupancy.get(dateKey);
          if (occupiedSlots?.has(slot)) {
            slotAvailable = false;
            break;
          }
        }
        
        if (slotAvailable) {
          slotFound = true;
          slotAssignments.set(span.spanId, slot);
          markSlotOccupied(spanDays, slot);
        } else {
          slot++;
          // Safety limit to prevent infinite loop in pathological cases
          if (slot > MAX_SLOT_LIMIT) {
            if (import.meta.env.DEV) {
              console.warn('Slot allocation exceeded limit for span:', span.spanId);
            }
            slotAssignments.set(span.spanId, slot);
            // Also mark occupancy to prevent other spans from stacking at same slot
            markSlotOccupied(spanDays, slot);
            break;
          }
        }
      }
    }

    // ===== PHASE 3: Create per-day events with segment metadata =====
    for (const span of spans) {
      const slotIndex = slotAssignments.get(span.spanId) ?? 0,
       spanDays = eachDayOfInterval({ start: span.effectiveStart, end: span.effectiveEnd });

      for (let i = 0; i < spanDays.length; i++) {
        const day = spanDays[i];
        if (!day) {continue;}

        const dateKey = toISODateString(day),
         dayOfWeek = day.getDay(), // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
         // Week starts Monday (1), ends Sunday (0). Sunday is the visual end of row.
         isRowStart = dayOfWeek === 1, // Monday
         isRowEnd = dayOfWeek === 0, // Sunday

        // Determine segment position based on actual position in span
         isFirst = i === 0,
         isLast = i === spanDays.length - 1;

        let segmentPosition: SegmentPosition;
        if (isFirst && isLast) {
          segmentPosition = 'single';
        } else if (isFirst) {
          segmentPosition = 'start';
        } else if (isLast) {
          segmentPosition = 'end';
        } else {
          segmentPosition = 'middle';
        }

        const event: CalendarEvent = {
          assignment: span.assignment,
          person: span.person,
          room: span.room,
          label: span.label,
          color: span.color as HexColor,
          textColor: span.textColor,
          segmentPosition,
          slotIndex,
          spanId: span.spanId,
          totalDays: span.totalDays,
          dayOfWeek,
          isRowStart,
          isRowEnd,
        };

        const existing = map.get(dateKey);
        if (existing) {
          existing.push(event);
        } else {
          map.set(dateKey, [event]);
        }
      }
    }

    // Sort events within each day by slotIndex for consistent rendering
    for (const events of map.values()) {
      events.sort((a, b) => a.slotIndex - b.slotIndex);
    }

    return map;
  }, [assignments, getPersonById, roomsMap, calendarDays, unknownLabel]),

  // Build transport events grouped by date for calendar display
  // Maps date strings (YYYY-MM-DD) to arrays of transports on that date
   transportsByDate = useMemo(() => {
    const map = new Map<string, CalendarTransport[]>();

    // Early return if no days to display
    if (calendarDays.length === 0) {
      return map;
    }

    // Pre-compute calendar boundaries for efficient range checking
    const firstDay = calendarDays[0],
     lastDay = calendarDays[calendarDays.length - 1];

    // Safety check for array access (satisfies noUncheckedIndexedAccess)
    if (!firstDay || !lastDay) {
      return map;
    }

    const calendarStartStr = toISODateString(firstDay),
     calendarEndStr = toISODateString(lastDay);

    // Process arrivals
    for (const transport of arrivals) {
      const transportDate = transport.datetime.substring(0, 10); // Extract YYYY-MM-DD
      // Skip transports outside visible calendar range
      if (transportDate < calendarStartStr || transportDate > calendarEndStr) {
        continue;
      }

      const person = getPersonById(transport.personId),
       color = (person?.color && person.color.length >= 4) ? person.color : '#6b7280',

       calTransport: CalendarTransport = {
        transport,
        person,
        personName: person?.name ?? unknownLabel,
        color: color as HexColor,
      },

       existing = map.get(transportDate);
      if (existing) {
        existing.push(calTransport);
      } else {
        map.set(transportDate, [calTransport]);
      }
    }

    // Process departures
    for (const transport of departures) {
      const transportDate = transport.datetime.substring(0, 10); // Extract YYYY-MM-DD
      // Skip transports outside visible calendar range
      if (transportDate < calendarStartStr || transportDate > calendarEndStr) {
        continue;
      }

      const person = getPersonById(transport.personId),
       color = (person?.color && person.color.length >= 4) ? person.color : '#6b7280',

       calTransport: CalendarTransport = {
        transport,
        person,
        personName: person?.name ?? unknownLabel,
        color: color as HexColor,
      },

       existing = map.get(transportDate);
      if (existing) {
        existing.push(calTransport);
      } else {
        map.set(transportDate, [calTransport]);
      }
    }

    return map;
  }, [arrivals, departures, getPersonById, calendarDays, unknownLabel]),

  // Today's date for highlighting - uses hook that auto-updates at midnight
  { today } = useToday(),

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Navigate to previous month.
   */
   handlePrevMonth = useCallback(() => {
    hasUserNavigatedRef.current = true;
    setCurrentMonth((prev) => subMonths(prev, 1));
  }, []),

  /**
   * Navigate to next month.
   */
   handleNextMonth = useCallback(() => {
    hasUserNavigatedRef.current = true;
    setCurrentMonth((prev) => addMonths(prev, 1));
  }, []),

  /**
   * Navigate to current month (today).
   */
   handleToday = useCallback(() => {
    hasUserNavigatedRef.current = true;
    setCurrentMonth(startOfMonth(new Date()));
  }, []),

  /**
   * Handle event click - opens event detail dialog.
   *
   * @param assignment - The assignment that was clicked
   */
   handleEventClick = useCallback((assignment: RoomAssignment) => {
    const person = getPersonById(assignment.personId);
    const room = roomsMap.get(assignment.roomId);
    
    const eventData: AssignmentEventData = {
      type: 'assignment',
      assignment,
      person,
      room,
    };
    
    setSelectedEvent(eventData);
    setIsEventDialogOpen(true);
  }, [getPersonById, roomsMap]),

  /**
   * Handle edit from event detail dialog.
   * Currently just shows a toast - full edit dialog integration is future work.
   */
   handleEventEdit = useCallback(() => {
    // TODO: Open edit dialog for the selected event
    // For now, just close the dialog
    toast.info('Edit functionality coming soon');
    setIsEventDialogOpen(false);
  }, []),

  /**
   * Handle delete from event detail dialog.
   */
   handleEventDelete = useCallback(async () => {
    if (!selectedEvent) return;
    
    if (selectedEvent.type === 'assignment') {
      try {
        await deleteAssignment(selectedEvent.assignment.id);
        toast.success(t('assignments.deleteSuccess', 'Assignment deleted'));
      } catch (error) {
        console.error('Failed to delete assignment:', error);
        toast.error(t('errors.deleteFailed', 'Failed to delete'));
        throw error;
      }
    }
    // Transport deletion would be handled similarly
  }, [selectedEvent, deleteAssignment, t]),

  // ============================================================================
  // Validate Trip Context
  // ============================================================================

   tripMismatch = useMemo(() => {
    if (!tripIdFromUrl || !currentTrip) {return false;}
    return tripIdFromUrl !== currentTrip.id;
  }, [tripIdFromUrl, currentTrip]);

  // ============================================================================
  // Render: Loading State
  // ============================================================================

  if (isLoading) {
    return (
      <div className="container max-w-6xl py-6 md:py-8">
        <PageHeader title={t('calendar.title')} />
        <div className="flex-1 flex items-center justify-center min-h-[400px]">
          <LoadingState variant="inline" size="lg" />
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render: Error State
  // ============================================================================

  if (roomsError || assignmentsError || personsError || transportsError) {
    const error = roomsError ?? assignmentsError ?? personsError ?? transportsError;
    return (
      <div className="container max-w-6xl py-6 md:py-8">
        <PageHeader title={t('calendar.title')} backLink="/trips" />
        <ErrorDisplay
          error={error}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  // ============================================================================
  // Render: Trip Not Found
  // ============================================================================

  if (!tripIdFromUrl || !currentTrip || tripMismatch) {
    return (
      <div className="container max-w-6xl py-6 md:py-8">
        <PageHeader title={t('calendar.title')} backLink="/trips" />
        <div className="flex-1 flex items-center justify-center min-h-[400px]">
          <EmptyState
            icon={CalendarIcon}
            title={t('errors.tripNotFound')}
            description={t(
              'errors.tripNotFoundDescription',
              'The trip you are looking for does not exist or you do not have access to it.',
            )}
          />
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render: Empty Assignments State
  // ============================================================================

  const hasAssignments = assignments.length > 0;

  // ============================================================================
  // Render: Calendar
  // ============================================================================

  return (
    <div className="container max-w-6xl py-6 md:py-8">
      <PageHeader
        title={t('calendar.title')}
        description={currentTrip.name}
      />

      {/* Calendar navigation header */}
      <CalendarHeader
        currentMonth={currentMonth}
        onPrevMonth={handlePrevMonth}
        onNextMonth={handleNextMonth}
        onToday={handleToday}
        dateLocale={dateLocale}
      />

      {/* Calendar grid wrapper with horizontal scroll on mobile */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="min-w-[600px] border rounded-lg overflow-hidden">
          {/* Day headers */}
          <CalendarDayHeader dateLocale={dateLocale} />

          {/* Calendar grid */}
          <div
            className="grid grid-cols-7 gap-px bg-muted"
            role="grid"
            aria-label={t('calendar.monthView', 'Month view calendar')}
          >
            {calendarDays.map((day) => {
              const dateKey = toISODateString(day),
              // Use stable EMPTY_EVENTS/EMPTY_TRANSPORTS constants to prevent CalendarDay re-renders
               events = eventsByDate.get(dateKey) ?? EMPTY_EVENTS,
               transports = transportsByDate.get(dateKey) ?? EMPTY_TRANSPORTS,
               isCurrentMonth = isSameMonth(day, currentMonth),
               isDayToday = isSameDay(day, today),
               isWithinTrip =
                tripBoundaries !== null &&
                isWithinInterval(day, tripBoundaries);

              return (
                <CalendarDay
                  key={dateKey}
                  date={day}
                  events={events}
                  transports={transports}
                  isCurrentMonth={isCurrentMonth}
                  isToday={isDayToday}
                  isWithinTrip={isWithinTrip}
                  dateLocale={dateLocale}
                  onEventClick={handleEventClick}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Empty state message when no assignments */}
      {!hasAssignments && (
        <div className="mt-6 text-center text-muted-foreground">
          <p>{t('calendar.noAssignments')}</p>
        </div>
      )}

      {/* Event Detail Dialog */}
      <EventDetailDialog
        open={isEventDialogOpen}
        onOpenChange={setIsEventDialogOpen}
        event={selectedEvent}
        onEdit={handleEventEdit}
        onDelete={handleEventDelete}
      />
    </div>
  );
});

CalendarPage.displayName = 'CalendarPage';

// ============================================================================
// Exports
// ============================================================================

export { CalendarPage };
export default CalendarPage;
export type {
  CalendarEvent,
  CalendarHeaderProps,
  CalendarDayHeaderProps,
  CalendarDayProps,
  CalendarEventProps,
};
