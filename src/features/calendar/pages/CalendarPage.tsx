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
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { TransportIcon } from '@/components/shared/TransportIcon';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  HexColor,
  Person,
  Room,
  RoomAssignment,
  Transport,
  TransportType,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

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
 * Formats a Date to ISO date string (YYYY-MM-DD).
 */
function toISODateString(date: Date): string {
  return format(date, 'yyyy-MM-dd');
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
 * Single event pill displayed within a calendar day.
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
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'w-full text-left text-xs rounded px-1.5 py-1 md:px-1 md:py-0.5 truncate',
        'min-h-[28px] md:min-h-0',
        'transition-opacity hover:opacity-80',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'cursor-pointer',
      )}
      style={{
        backgroundColor: event.color,
        color: event.textColor,
      }}
      title={event.label}
      aria-label={event.label}
    >
      {event.label}
    </button>
  );
});

CalendarEvent.displayName = 'CalendarEvent';

// ============================================================================
// TransportIndicator Subcomponent
// ============================================================================

/**
 * Formats a datetime string to show just the time (HH:mm).
 */
function formatTime(datetime: string): string {
  // datetime is ISO format: YYYY-MM-DDTHH:mm:ss or YYYY-MM-DDTHH:mm
  const timePart = datetime.split('T')[1];
  if (!timePart) return '';
  return timePart.substring(0, 5); // HH:mm
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

/**
 * Single day cell in the calendar grid.
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

  // Limit visible items (events + transports) to prevent overflow
   maxVisibleItems = 3,
   totalItems = events.length + transports.length,

  // Prioritize showing transports first (arrivals/departures are time-sensitive)
   visibleTransports = transports.slice(0, maxVisibleItems),
   remainingSlots = Math.max(0, maxVisibleItems - visibleTransports.length),
   visibleEvents = events.slice(0, remainingSlots),
   hiddenCount = totalItems - visibleTransports.length - visibleEvents.length;

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

      {/* Transports (arrivals/departures) */}
      <div className="flex-1 space-y-0.5 overflow-hidden">
        {visibleTransports.map((transport) => (
          <TransportIndicator
            key={transport.transport.id}
            transport={transport}
            type={transport.transport.type}
          />
        ))}

        {/* Room assignment events */}
        {visibleEvents.map((event) => (
          <CalendarEvent
            key={event.assignment.id}
            event={event}
            onClick={onEventClick}
          />
        ))}
        {hiddenCount > 0 && (
          <div className="text-xs text-muted-foreground text-center">
            +{hiddenCount}
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
   { assignments, isLoading: isAssignmentsLoading, error: assignmentsError } = useAssignmentContext(),
   { getPersonById, isLoading: isPersonsLoading, error: personsError } = usePersonContext(),
   { arrivals, departures, isLoading: isTransportsLoading, error: transportsError } = useTransportContext(),

  // Local state for current viewing month
  // Initialized to today - will sync with trip start date via useEffect when loaded
   [currentMonth, setCurrentMonth] = useState<Date>(() => startOfMonth(new Date())),

  // Track if user has manually navigated to avoid overwriting their selection
   hasUserNavigatedRef = useRef(false);

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

  // Build calendar events from assignments
  // Optimized algorithm: O(assignments × avgAssignmentLength) instead of O(assignments × calendarDays)
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

       event: CalendarEvent = {
        assignment,
        person,
        room,
        label,
        color,
        textColor,
      },

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
      // 
      // Example: Check-in Jan 15, Check-out Jan 17
      // - Person sleeps nights of Jan 15 and Jan 16
      // - Calendar shows assignment on Jan 15 and Jan 16 only
      const lastNight = subDays(assignmentEnd, 1);
      
      // If check-in and check-out are the same day, skip (no nights stayed)
      if (lastNight < assignmentStart) {
        continue;
      }

      // Calculate intersection with visible calendar range
      const effectiveStart = assignmentStart < firstDay ? firstDay : assignmentStart,
       effectiveEnd = lastNight > lastDay ? lastDay : lastNight,

      // Only iterate through days within the assignment range (not all 42 calendar days)
       assignmentDays = eachDayOfInterval({ start: effectiveStart, end: effectiveEnd });

      for (const day of assignmentDays) {
        const dateKey = toISODateString(day),
         existing = map.get(dateKey);
        if (existing) {
          existing.push(event);
        } else {
          map.set(dateKey, [event]);
        }
      }
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

  // Today's date for highlighting
  // Note: This value is captured on mount. For long-running sessions past midnight,
  // Users should refresh to get updated "today" highlighting.
  // Using useMemo with empty deps to match project pattern (see RoomListPage).
   today = useMemo(() => new Date(), []),

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
   * Handle event click - opens edit dialog.
   * TODO: Task 9.x - Implement edit dialog integration when available.
   *
   * @param _assignment - The assignment to edit (unused until feature implemented)
   */
   // eslint-disable-next-line @typescript-eslint/no-unused-vars
   handleEventClick = useCallback((_assignment: RoomAssignment) => {
    // TODO: Task 9.x - Integrate with RoomAssignmentSection's edit dialog
    // Feature not yet implemented - clicking events will be functional in future task
  }, []),

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
