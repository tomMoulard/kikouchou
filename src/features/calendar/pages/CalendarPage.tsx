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
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  format,
  parseISO,
  isValid,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isWithinInterval,
  addMonths,
  subMonths,
} from 'date-fns';
import { fr, enUS, type Locale } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';

import { useTripContext } from '@/contexts/TripContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  RoomAssignment,
  Person,
  Room,
  HexColor,
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
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

  // Calculate relative luminance using sRGB formula
  const linearize = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

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
const EMPTY_EVENTS: readonly CalendarEvent[] = [];

// ============================================================================
// CalendarHeader Subcomponent
// ============================================================================

/**
 * Header with month/year display and navigation controls.
 */
const CalendarHeader = memo(function CalendarHeader({
  currentMonth,
  onPrevMonth,
  onNextMonth,
  onToday,
  dateLocale,
}: CalendarHeaderProps): ReactElement {
  const { t } = useTranslation();

  const monthYearLabel = useMemo(
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
const CalendarDayHeader = memo(function CalendarDayHeader({
  dateLocale,
}: CalendarDayHeaderProps): ReactElement {
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
const CalendarEvent = memo(function CalendarEvent({
  event,
  onClick,
}: CalendarEventProps): ReactElement {
  const handleClick = useCallback(() => {
    onClick(event.assignment);
  }, [onClick, event.assignment]);

  const handleKeyDown = useCallback(
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
// CalendarDay Subcomponent
// ============================================================================

/**
 * Single day cell in the calendar grid.
 */
const CalendarDay = memo(function CalendarDay({
  date,
  events,
  isCurrentMonth,
  isToday,
  isWithinTrip,
  dateLocale,
  onEventClick,
}: CalendarDayProps): ReactElement {
  const dayNumber = format(date, 'd', { locale: dateLocale });
  const dateLabel = format(date, 'PPPP', { locale: dateLocale });

  // Limit visible events to prevent overflow
  const maxVisibleEvents = 3;
  const visibleEvents = events.slice(0, maxVisibleEvents);
  const hiddenCount = events.length - maxVisibleEvents;

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

      {/* Events */}
      <div className="flex-1 space-y-0.5 overflow-hidden">
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
const CalendarPage = memo(function CalendarPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const { tripId: tripIdFromUrl } = useParams<'tripId'>();

  // Context hooks
  const { currentTrip, isLoading: isTripLoading } = useTripContext();
  const { rooms, isLoading: isRoomsLoading, error: roomsError } = useRoomContext();
  const { assignments, isLoading: isAssignmentsLoading, error: assignmentsError } = useAssignmentContext();
  const { getPersonById, isLoading: isPersonsLoading, error: personsError } = usePersonContext();

  // Local state for current viewing month
  // Initialized to today - will sync with trip start date via useEffect when loaded
  const [currentMonth, setCurrentMonth] = useState<Date>(() => startOfMonth(new Date()));

  // Track if user has manually navigated to avoid overwriting their selection
  const hasUserNavigatedRef = useRef(false);

  // Sync currentMonth with trip start date when trip loads (but not if user already navigated)
  useEffect(() => {
    if (!hasUserNavigatedRef.current && currentTrip?.startDate) {
      const tripStart = parseISO(currentTrip.startDate);
      if (isValid(tripStart)) {
        setCurrentMonth(startOfMonth(tripStart));
      }
    }
  }, [currentTrip?.startDate]);

  // Combined loading state
  const isLoading = isTripLoading || isRoomsLoading || isAssignmentsLoading || isPersonsLoading;

  // Date locale based on current language
  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  // Build room lookup map for O(1) access
  const roomsMap = useMemo(() => {
    const map = new Map<string, Room>();
    for (const room of rooms) {
      map.set(room.id, room);
    }
    return map;
  }, [rooms]);

  // Trip date boundaries for visual indicators
  const tripBoundaries = useMemo(() => {
    if (!currentTrip) return null;
    const start = parseISO(currentTrip.startDate);
    const end = parseISO(currentTrip.endDate);
    if (!isValid(start) || !isValid(end)) return null;
    return { start, end };
  }, [currentTrip]);

  // Generate calendar days for the current month view
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    // Week starts on Monday (weekStartsOn: 1)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentMonth]);

  // Extract translated fallback outside the expensive computation
  // This ensures stable dependency and avoids recalculation on language change
  const unknownLabel = t('common.unknown');

  // Build calendar events from assignments
  // Optimized algorithm: O(assignments × avgAssignmentLength) instead of O(assignments × calendarDays)
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();

    // Early return if no days to display
    if (calendarDays.length === 0) {
      return map;
    }

    // Pre-compute calendar boundaries for efficient range checking
    const firstDay = calendarDays[0];
    const lastDay = calendarDays[calendarDays.length - 1];

    // Safety check for array access (satisfies noUncheckedIndexedAccess)
    if (!firstDay || !lastDay) {
      return map;
    }

    const calendarStartStr = toISODateString(firstDay);
    const calendarEndStr = toISODateString(lastDay);

    for (const assignment of assignments) {
      // Skip assignments completely outside visible calendar range
      if (assignment.endDate < calendarStartStr || assignment.startDate > calendarEndStr) {
        continue;
      }

      const person = getPersonById(assignment.personId);
      const room = roomsMap.get(assignment.roomId);

      // Build display label
      const personName = person?.name ?? unknownLabel;
      const roomName = room?.name ?? unknownLabel;
      const label = `${personName} - ${roomName}`;

      // Determine colors with fallback for invalid/missing colors
      const color = (person?.color && person.color.length >= 4) ? person.color : '#6b7280';
      const textColor = getContrastTextColor(color);

      const event: CalendarEvent = {
        assignment,
        person,
        room,
        label,
        color,
        textColor,
      };

      // Parse assignment dates to determine the actual range to iterate
      const assignmentStart = parseISO(assignment.startDate);
      const assignmentEnd = parseISO(assignment.endDate);

      // Skip if dates are invalid
      if (!isValid(assignmentStart) || !isValid(assignmentEnd)) {
        continue;
      }

      // Calculate intersection with visible calendar range
      const effectiveStart = assignmentStart < firstDay ? firstDay : assignmentStart;
      const effectiveEnd = assignmentEnd > lastDay ? lastDay : assignmentEnd;

      // Only iterate through days within the assignment range (not all 42 calendar days)
      const assignmentDays = eachDayOfInterval({ start: effectiveStart, end: effectiveEnd });

      for (const day of assignmentDays) {
        const dateKey = toISODateString(day);
        const existing = map.get(dateKey);
        if (existing) {
          existing.push(event);
        } else {
          map.set(dateKey, [event]);
        }
      }
    }

    return map;
  }, [assignments, getPersonById, roomsMap, calendarDays, unknownLabel]);

  // Today's date for highlighting
  // Note: This value is captured on mount. For long-running sessions past midnight,
  // users should refresh to get updated "today" highlighting.
  // Using useMemo with empty deps to match project pattern (see RoomListPage).
  const today = useMemo(() => new Date(), []);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Navigate to previous month.
   */
  const handlePrevMonth = useCallback(() => {
    hasUserNavigatedRef.current = true;
    setCurrentMonth((prev) => subMonths(prev, 1));
  }, []);

  /**
   * Navigate to next month.
   */
  const handleNextMonth = useCallback(() => {
    hasUserNavigatedRef.current = true;
    setCurrentMonth((prev) => addMonths(prev, 1));
  }, []);

  /**
   * Navigate to current month (today).
   */
  const handleToday = useCallback(() => {
    hasUserNavigatedRef.current = true;
    setCurrentMonth(startOfMonth(new Date()));
  }, []);

  /**
   * Handle event click - opens edit dialog.
   * TODO: Task 9.x - Implement edit dialog integration when available.
   *
   * @param _assignment - The assignment to edit (unused until feature implemented)
   */
  const handleEventClick = useCallback((_assignment: RoomAssignment) => {
    // TODO: Task 9.x - Integrate with RoomAssignmentSection's edit dialog
    // Feature not yet implemented - clicking events will be functional in future task
  }, []);

  // ============================================================================
  // Validate Trip Context
  // ============================================================================

  const tripMismatch = useMemo(() => {
    if (!tripIdFromUrl || !currentTrip) return false;
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

  if (roomsError || assignmentsError || personsError) {
    const error = roomsError ?? assignmentsError ?? personsError;
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
              const dateKey = toISODateString(day);
              // Use stable EMPTY_EVENTS constant to prevent CalendarDay re-renders
              const events = eventsByDate.get(dateKey) ?? EMPTY_EVENTS;
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const isDayToday = isSameDay(day, today);
              const isWithinTrip =
                tripBoundaries !== null &&
                isWithinInterval(day, tripBoundaries);

              return (
                <CalendarDay
                  key={dateKey}
                  date={day}
                  events={events}
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
