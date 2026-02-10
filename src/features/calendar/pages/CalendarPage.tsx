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
import { useOfflineAwareToast } from '@/hooks';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
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
import { Calendar as CalendarIcon } from 'lucide-react';

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
import { toISODateString } from '@/lib/db/utils';
import type { HexColor, Room, RoomAssignment, TransportId } from '@/types';

// Import extracted components
import {
  CalendarHeader,
  CalendarDayHeader,
  CalendarDay,
  EventDetailDialog,
  type AssignmentEventData,
  type TransportEventData,
  type CalendarEventData,
} from '../components';

// Import TransportDialog for editing transports
import { TransportDialog } from '@/features/transports';

// Import types and utilities
import type { CalendarEvent, CalendarTransport, SegmentPosition } from '../types';
import {
  EMPTY_EVENTS,
  EMPTY_TRANSPORTS,
  getDateLocale,
  getContrastTextColor,
} from '../utils/calendar-utils';

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
  const { successToast } = useOfflineAwareToast();

  // Context hooks
  const { currentTrip, isLoading: isTripLoading, setCurrentTrip } = useTripContext();
  const { rooms, isLoading: isRoomsLoading, error: roomsError } = useRoomContext();
  const {
    assignments,
    isLoading: isAssignmentsLoading,
    error: assignmentsError,
    deleteAssignment,
  } = useAssignmentContext();
  const { getPersonById, isLoading: isPersonsLoading, error: personsError } = usePersonContext();
  const {
    arrivals,
    departures,
    isLoading: isTransportsLoading,
    error: transportsError,
    deleteTransport,
  } = useTransportContext();

  // Local state for current viewing month
  // Initialized to today - will sync with trip start date via useEffect when loaded
  const [currentMonth, setCurrentMonth] = useState<Date>(() => startOfMonth(new Date()));

  // Track if user has manually navigated to avoid overwriting their selection
  const hasUserNavigatedRef = useRef(false);

  // Event detail dialog state
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventData | null>(null);
  const [isEventDialogOpen, setIsEventDialogOpen] = useState(false);

  // Transport edit dialog state
  const [isTransportDialogOpen, setIsTransportDialogOpen] = useState(false);
  const [selectedTransportId, setSelectedTransportId] = useState<TransportId | undefined>();

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
  const isLoading =
    isTripLoading ||
    isRoomsLoading ||
    isAssignmentsLoading ||
    isPersonsLoading ||
    isTransportsLoading;

  // Date locale based on current language
  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  // Build room lookup map for O(1) access
  const roomsMap = useMemo(
    () => new Map<string, Room>(rooms.map((room) => [room.id, room])),
    [rooms],
  );

  // Trip date boundaries for visual indicators
  const tripBoundaries = useMemo(() => {
    if (!currentTrip) {
      return null;
    }
    const start = parseISO(currentTrip.startDate);
    const end = parseISO(currentTrip.endDate);
    if (!isValid(start) || !isValid(end)) {
      return null;
    }
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
  const unknownLabel = t('common.unknown');

  // Build calendar events from assignments with multi-day spanning support
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();

    if (calendarDays.length === 0) {
      return map;
    }

    const firstDay = calendarDays[0];
    const lastDay = calendarDays[calendarDays.length - 1];

    if (!firstDay || !lastDay) {
      return map;
    }

    const calendarStartStr = toISODateString(firstDay);
    const calendarEndStr = toISODateString(lastDay);

    // Phase 1: Identify valid assignments and their visible ranges
    interface SpanInfo {
      assignment: RoomAssignment;
      person: ReturnType<typeof getPersonById>;
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
      if (assignment.endDate < calendarStartStr || assignment.startDate > calendarEndStr) {
        continue;
      }

      const person = getPersonById(assignment.personId);
      const room = roomsMap.get(assignment.roomId);

      const personName = person?.name ?? unknownLabel;
      const roomName = room?.name ?? unknownLabel;
      const label = `${personName} - ${roomName}`;

      const color = person?.color && person.color.length >= 4 ? person.color : '#6b7280';
      const textColor = getContrastTextColor(color as HexColor);

      const assignmentStart = parseISO(assignment.startDate);
      const assignmentEnd = parseISO(assignment.endDate);

      if (!isValid(assignmentStart) || !isValid(assignmentEnd)) {
        continue;
      }

      // Room assignments use "check-in / check-out" model
      const lastNight = subDays(assignmentEnd, 1);

      if (lastNight < assignmentStart) {
        continue;
      }

      const effectiveStart = assignmentStart < firstDay ? firstDay : assignmentStart;
      const effectiveEnd = lastNight > lastDay ? lastDay : lastNight;
      const totalDays =
        Math.round((effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

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

    // Phase 2: Greedy slot allocation
    const MAX_SLOT_LIMIT = 100;

    spans.sort((a, b) => {
      const startDiff = a.effectiveStart.getTime() - b.effectiveStart.getTime();
      if (startDiff !== 0) {
        return startDiff;
      }
      return b.totalDays - a.totalDays;
    });

    const slotAssignments = new Map<string, number>();
    const slotOccupancy = new Map<string, Set<number>>();

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
      const spanDays = eachDayOfInterval({ start: span.effectiveStart, end: span.effectiveEnd });

      let slot = 0;
      let slotFound = false;

      while (!slotFound) {
        let slotAvailable = true;

        for (const day of spanDays) {
          const dateKey = toISODateString(day);
          const occupiedSlots = slotOccupancy.get(dateKey);
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
          if (slot > MAX_SLOT_LIMIT) {
            if (import.meta.env.DEV) {
              console.warn('Slot allocation exceeded limit for span:', span.spanId);
            }
            slotAssignments.set(span.spanId, slot);
            markSlotOccupied(spanDays, slot);
            break;
          }
        }
      }
    }

    // Phase 3: Create per-day events with segment metadata
    for (const span of spans) {
      const slotIndex = slotAssignments.get(span.spanId) ?? 0;
      const spanDays = eachDayOfInterval({ start: span.effectiveStart, end: span.effectiveEnd });

      for (let i = 0; i < spanDays.length; i++) {
        const day = spanDays[i];
        if (!day) {
          continue;
        }

        const dateKey = toISODateString(day);
        const dayOfWeek = day.getDay();
        const isRowStart = dayOfWeek === 1; // Monday
        const isRowEnd = dayOfWeek === 0; // Sunday

        const isFirst = i === 0;
        const isLast = i === spanDays.length - 1;

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

    // Sort events within each day by slotIndex
    for (const events of map.values()) {
      events.sort((a, b) => a.slotIndex - b.slotIndex);
    }

    return map;
  }, [assignments, getPersonById, roomsMap, calendarDays, unknownLabel]);

  // Build transport events grouped by date
  const transportsByDate = useMemo(() => {
    const map = new Map<string, CalendarTransport[]>();

    if (calendarDays.length === 0) {
      return map;
    }

    const firstDay = calendarDays[0];
    const lastDay = calendarDays[calendarDays.length - 1];

    if (!firstDay || !lastDay) {
      return map;
    }

    const calendarStartStr = toISODateString(firstDay);
    const calendarEndStr = toISODateString(lastDay);

    // Process arrivals
    for (const transport of arrivals) {
      const transportDate = transport.datetime.substring(0, 10);
      if (transportDate < calendarStartStr || transportDate > calendarEndStr) {
        continue;
      }

      const person = getPersonById(transport.personId);
      const color = person?.color && person.color.length >= 4 ? person.color : '#6b7280';

      const calTransport: CalendarTransport = {
        transport,
        person,
        personName: person?.name ?? unknownLabel,
        color: color as HexColor,
      };

      const existing = map.get(transportDate);
      if (existing) {
        existing.push(calTransport);
      } else {
        map.set(transportDate, [calTransport]);
      }
    }

    // Process departures
    for (const transport of departures) {
      const transportDate = transport.datetime.substring(0, 10);
      if (transportDate < calendarStartStr || transportDate > calendarEndStr) {
        continue;
      }

      const person = getPersonById(transport.personId);
      const color = person?.color && person.color.length >= 4 ? person.color : '#6b7280';

      const calTransport: CalendarTransport = {
        transport,
        person,
        personName: person?.name ?? unknownLabel,
        color: color as HexColor,
      };

      const existing = map.get(transportDate);
      if (existing) {
        existing.push(calTransport);
      } else {
        map.set(transportDate, [calTransport]);
      }
    }

    return map;
  }, [arrivals, departures, getPersonById, calendarDays, unknownLabel]);

  // Today's date for highlighting
  const { today } = useToday();

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handlePrevMonth = useCallback(() => {
    hasUserNavigatedRef.current = true;
    setCurrentMonth((prev) => subMonths(prev, 1));
  }, []);

  const handleNextMonth = useCallback(() => {
    hasUserNavigatedRef.current = true;
    setCurrentMonth((prev) => addMonths(prev, 1));
  }, []);

  const handleToday = useCallback(() => {
    hasUserNavigatedRef.current = true;
    setCurrentMonth(startOfMonth(new Date()));
  }, []);

  const handleEventClick = useCallback(
    (assignment: RoomAssignment) => {
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
    },
    [getPersonById, roomsMap],
  );

  const handleTransportClick = useCallback(
    (calTransport: CalendarTransport) => {
      // Look up driver person if driverId exists
      const driver = calTransport.transport.driverId
        ? getPersonById(calTransport.transport.driverId)
        : undefined;

      const eventData: TransportEventData = {
        type: 'transport',
        transport: calTransport.transport,
        person: calTransport.person,
        driver,
      };

      setSelectedEvent(eventData);
      setIsEventDialogOpen(true);
    },
    [getPersonById],
  );

  const handleEventEdit = useCallback(() => {
    if (!selectedEvent) return;

    if (selectedEvent.type === 'transport') {
      // Close the detail dialog and open the transport edit dialog
      setIsEventDialogOpen(false);
      setSelectedTransportId(selectedEvent.transport.id);
      setIsTransportDialogOpen(true);
    } else {
      // Assignment edit - not yet implemented
      toast.info('Edit functionality coming soon');
      setIsEventDialogOpen(false);
    }
  }, [selectedEvent]);

  const handleEventDelete = useCallback(async () => {
    if (!selectedEvent) return;

    if (selectedEvent.type === 'assignment') {
      try {
        await deleteAssignment(selectedEvent.assignment.id);
        successToast(t('assignments.deleteSuccess', 'Assignment deleted'));
      } catch (error) {
        console.error('Failed to delete assignment:', error);
        toast.error(t('errors.deleteFailed', 'Failed to delete'));
        throw error;
      }
    } else if (selectedEvent.type === 'transport') {
      try {
        await deleteTransport(selectedEvent.transport.id);
        successToast(t('calendar.transportDeleted', 'Transport deleted successfully'));
      } catch (error) {
        console.error('Failed to delete transport:', error);
        toast.error(t('errors.deleteFailed', 'Failed to delete'));
        throw error;
      }
    }
  }, [selectedEvent, deleteAssignment, deleteTransport, t, successToast]);

  const handleTransportDialogClose = useCallback((open: boolean) => {
    setIsTransportDialogOpen(open);
    if (!open) {
      setSelectedTransportId(undefined);
    }
  }, []);

  // Validate Trip Context
  const tripMismatch = useMemo(() => {
    if (!tripIdFromUrl || !currentTrip) {
      return false;
    }
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
        <ErrorDisplay error={error} onRetry={() => window.location.reload()} />
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
  // Render: Calendar
  // ============================================================================

  const hasAssignments = assignments.length > 0;

  return (
    <div className="container max-w-6xl py-6 md:py-8">
      <PageHeader title={t('calendar.title')} description={currentTrip.name} />

      {/* Calendar navigation header */}
      <CalendarHeader
        currentMonth={currentMonth}
        onPrevMonth={handlePrevMonth}
        onNextMonth={handleNextMonth}
        onToday={handleToday}
        dateLocale={dateLocale}
      />

      {/* Calendar grid wrapper with horizontal scroll on mobile */}
      <div
        className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0"
        tabIndex={0}
        role="region"
        aria-label={t('calendar.scrollableCalendar', 'Scrollable calendar')}
      >
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
              const events = eventsByDate.get(dateKey) ?? EMPTY_EVENTS;
              const transports = transportsByDate.get(dateKey) ?? EMPTY_TRANSPORTS;
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const isDayToday = isSameDay(day, today);
              const isWithinTrip =
                tripBoundaries !== null && isWithinInterval(day, tripBoundaries);

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
                  onTransportClick={handleTransportClick}
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

      {/* Transport Edit Dialog */}
      <TransportDialog
        open={isTransportDialogOpen}
        onOpenChange={handleTransportDialogClose}
        transportId={selectedTransportId}
      />
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { CalendarPage };
export default CalendarPage;
