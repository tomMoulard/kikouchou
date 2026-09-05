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
 * - Shared activities shown as category-coloured pills
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
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import { useActivityContext } from '@/contexts/ActivityContext';
import { useToday } from '@/hooks/useToday';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { ViewSwitcher } from '@/components/ui/view-switcher';
import { AssignmentFormDialog } from '@/features/rooms/components/RoomAssignmentSection';
import { toLocalISODateString } from '@/lib/db/utils';
import { localDayKeyOfInstant } from '@/lib/utils/trip-days';
import { getActivityCategoryColor } from '@/types';
import type {
  Activity,
  ActivityId,
  HexColor,
  ISODateString,
  Person,
  Room,
  RoomAssignment,
  Transport,
  TransportId,
} from '@/types';

// Import extracted components
import {
  CalendarHeader,
  CalendarDayHeader,
  CalendarDay,
  EventDetailDialog,
  CalendarTimeline,
  CALENDAR_TIMELINE_LABEL_COLUMN_WIDTH_PX,
  type ActivityEventData,
  type AssignmentEventData,
  type TransportEventData,
  type CalendarEventData,
} from '../components';

// Import TransportDialog for editing transports
import { TransportDialog } from '@/features/transports';

// Import ActivityDialog + helpers for the shared agenda
import { ActivityDialog } from '@/features/activities/components/ActivityDialog';
import {
  getActivityEndDayKey,
  getActivityStartDayKey,
} from '@/features/activities/utils/activity-utils';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import { timelineNeedsFullPageWidth } from '@/lib/utils/timeline-viewport-layout';
import { buildDayColumns } from '@/lib/utils/trip-days';

// Import types and utilities
import type {
  CalendarActivity,
  CalendarEvent,
  CalendarTransport,
  SegmentPosition,
} from '../types';
import {
  EMPTY_EVENTS,
  EMPTY_TRANSPORTS,
  getContrastTextColor,
} from '../utils/calendar-utils';
import { buildDailyHeadcounts } from '../utils/headcount-utils';

// ============================================================================
// Constants
// ============================================================================

/**
 * Stable empty array so days without activities keep referential equality
 * across renders (CalendarDay is memoized).
 */
const EMPTY_CALENDAR_ACTIVITIES: readonly CalendarActivity[] = [];

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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { successToast } = useOfflineAwareToast();

  // Context hooks
  const { currentTrip, isLoading: isTripLoading, setCurrentTrip } = useTripContext();
  const { rooms, isLoading: isRoomsLoading, error: roomsError } = useRoomContext();
  const {
    assignments,
    isLoading: isAssignmentsLoading,
    error: assignmentsError,
    checkConflict,
    deleteAssignment,
    getAssignmentsByRoom,
    updateAssignment,
  } = useAssignmentContext();
  const {
    persons,
    getPersonById,
    isLoading: isPersonsLoading,
    error: personsError,
  } = usePersonContext();
  const {
    arrivals,
    departures,
    isLoading: isTransportsLoading,
    error: transportsError,
    deleteTransport,
  } = useTransportContext();
  const {
    activities,
    isLoading: isActivitiesLoading,
    error: activitiesError,
    deleteActivity,
  } = useActivityContext();

  // Local state for current viewing month
  // Initialized to today - will sync with trip start date via useEffect when loaded
  const [currentMonth, setCurrentMonth] = useState<Date>(() => startOfMonth(new Date()));

  const currentView = useMemo(() => {
    const rawView = searchParams.get('view');
    if (rawView === 'timeline') return 'timeline';
    // Back-compat with older links
    if (rawView === 'month') return 'card';
    return rawView === 'card' ? 'card' : 'timeline';
  }, [searchParams]);

  const handleViewChange = useCallback(
    (nextValue: string) => {
      const nextView = nextValue === 'timeline' ? 'timeline' : 'card';
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('view', nextView);
        return next;
      });
    },
    [setSearchParams],
  );

  // An empty calendar is usually an empty *trip* — there is nothing to schedule
  // until it has guests and rooms. Both list pages open their create dialog on
  // `?new=1`, so these land on the form rather than on another empty list.
  const handleAddGuests = useCallback(() => {
    navigate(`/trips/${tripIdFromUrl}/persons?new=1`);
  }, [navigate, tripIdFromUrl]);

  const handleAddRooms = useCallback(() => {
    navigate(`/trips/${tripIdFromUrl}/rooms?new=1`);
  }, [navigate, tripIdFromUrl]);

  // The frame's own day-axis builder, so the width decision counts exactly the
  // columns the timeline will draw.
  const timelineDayCount = useMemo(
    () =>
      currentTrip?.startDate && currentTrip?.endDate
        ? buildDayColumns(currentTrip.startDate, currentTrip.endDate).length
        : 0,
    [currentTrip?.startDate, currentTrip?.endDate],
  );

  // Track if user has manually navigated to avoid overwriting their selection
  const hasUserNavigatedRef = useRef(false);

  // Event detail dialog state
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventData | null>(null);
  const [isEventDialogOpen, setIsEventDialogOpen] = useState(false);

  // Transport edit dialog state
  const [isTransportDialogOpen, setIsTransportDialogOpen] = useState(false);
  const [selectedTransportId, setSelectedTransportId] = useState<TransportId | undefined>();
  const [editingAssignment, setEditingAssignment] = useState<RoomAssignment | undefined>(undefined);
  const [isAssignmentDialogOpen, setIsAssignmentDialogOpen] = useState(false);

  // Activity edit dialog state
  const [isActivityDialogOpen, setIsActivityDialogOpen] = useState(false);
  const [selectedActivityId, setSelectedActivityId] = useState<ActivityId | undefined>();

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
    isTransportsLoading ||
    isActivitiesLoading;

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
    // Use the same "nights" model as room assignments: last visible night is endDate - 1.
    const lastNight = subDays(end, 1);
    if (lastNight < start) {
      return null;
    }
    return { start, end: lastNight };
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

    const calendarStartStr = toLocalISODateString(firstDay);
    const calendarEndStr = toLocalISODateString(lastDay);
    const tripStart = tripBoundaries?.start;
    const tripEnd = tripBoundaries?.end;

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

      // Clamp spans to the visible calendar range AND the trip nights range
      const effectiveStartCandidate = assignmentStart < firstDay ? firstDay : assignmentStart;
      const effectiveEndCandidate = lastNight > lastDay ? lastDay : lastNight;

      const effectiveStart =
        tripStart && effectiveStartCandidate < tripStart ? tripStart : effectiveStartCandidate;
      const effectiveEnd =
        tripEnd && effectiveEndCandidate > tripEnd ? tripEnd : effectiveEndCandidate;

      if (effectiveEnd < effectiveStart) {
        continue;
      }

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
        const dateKey = toLocalISODateString(day);
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
          const dateKey = toLocalISODateString(day);
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

        const dateKey = toLocalISODateString(day);
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
  }, [assignments, getPersonById, roomsMap, calendarDays, unknownLabel, tripBoundaries]);

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

    const calendarStartStr = toLocalISODateString(firstDay);
    const calendarEndStr = toLocalISODateString(lastDay);

    // Process arrivals
    for (const transport of arrivals) {
      const transportDate = localDayKeyOfInstant(transport.datetime);
      if (
        transportDate === null ||
        transportDate < calendarStartStr ||
        transportDate > calendarEndStr
      ) {
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
      const transportDate = localDayKeyOfInstant(transport.datetime);
      if (
        transportDate === null ||
        transportDate < calendarStartStr ||
        transportDate > calendarEndStr
      ) {
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
  const dayRefs = useRef(new Map<ISODateString, HTMLDivElement>());

  const calendarWeeks = useMemo(() => {
    const weeks: Date[][] = [];

    for (let index = 0; index < calendarDays.length; index += 7) {
      weeks.push(calendarDays.slice(index, index + 7));
    }

    return weeks;
  }, [calendarDays]);

  // `calendarDays` are local midnights (`eachDayOfInterval`), so they are keyed
  // the local way — the same converter `RoomAssignmentSection` writes stay dates
  // with. One key set for the whole page: events, headcounts and activities all
  // land in the cell whose date the user is reading.
  const visibleDateKeys = useMemo(
    () => calendarDays.map((day) => toLocalISODateString(day)),
    [calendarDays],
  );

  // People on site per night, used to plan meals. A guest entry can stand for
  // several people (`headcount`), so this is not the number of calendar pills.
  const headcountsByDate = useMemo(
    () =>
      buildDailyHeadcounts({
        persons,
        arrivals,
        departures,
        assignments,
        tripWindow: { startDate: currentTrip?.startDate, endDate: currentTrip?.endDate },
        dayKeys: visibleDateKeys,
      }),
    [
      assignments,
      arrivals,
      currentTrip?.endDate,
      currentTrip?.startDate,
      departures,
      persons,
      visibleDateKeys,
    ],
  );

  // Multi-day activities repeat across every day they cover.
  const activitiesByDate = useMemo(() => {
    const map = new Map<string, CalendarActivity[]>();

    if (visibleDateKeys.length === 0 || activities.length === 0) {
      return map;
    }

    const firstKey = visibleDateKeys[0]!;
    const lastKey = visibleDateKeys[visibleDateKeys.length - 1]!;

    for (const activity of activities) {
      const startKey = getActivityStartDayKey(activity);
      const endKey = getActivityEndDayKey(activity) ?? startKey;

      if (!startKey || !endKey || endKey < firstKey || startKey > lastKey) {
        continue;
      }

      const color = getActivityCategoryColor(activity.category);

      for (const dayKey of visibleDateKeys) {
        if (dayKey < startKey || dayKey > endKey) {
          continue;
        }

        const calendarActivity: CalendarActivity = {
          activity,
          color,
          isSpanStart: dayKey === startKey,
          isSpanEnd: dayKey === endKey,
        };

        const existing = map.get(dayKey);
        if (existing) {
          existing.push(calendarActivity);
        } else {
          map.set(dayKey, [calendarActivity]);
        }
      }
    }

    // Keep a stable chronological order within each day
    for (const dayActivities of map.values()) {
      dayActivities.sort((a, b) =>
        a.activity.startDatetime.localeCompare(b.activity.startDatetime),
      );
    }

    return map;
  }, [activities, visibleDateKeys]);

  const defaultFocusedDateKey = useMemo(() => {
    if (calendarDays.length === 0) {
      return null;
    }

    const todayKey = toLocalISODateString(today);
    if (visibleDateKeys.includes(todayKey)) {
      return todayKey;
    }

    const firstDayInCurrentMonth = calendarDays.find((day) =>
      isSameMonth(day, currentMonth),
    );

    if (firstDayInCurrentMonth) {
      return toLocalISODateString(firstDayInCurrentMonth);
    }

    return visibleDateKeys[0] ?? null;
  }, [calendarDays, currentMonth, today, visibleDateKeys]);

  const [focusedDateKey, setFocusedDateKey] = useState<ISODateString | null>(null);

  useEffect(() => {
    if (defaultFocusedDateKey === null) {
      setFocusedDateKey(null);
      return;
    }

    if (focusedDateKey === null || !visibleDateKeys.includes(focusedDateKey)) {
      setFocusedDateKey(defaultFocusedDateKey);
    }
  }, [defaultFocusedDateKey, focusedDateKey, visibleDateKeys]);

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
    (assignment: RoomAssignment, relatedTransports?: readonly Transport[]) => {
      const person = getPersonById(assignment.personId);
      const room = roomsMap.get(assignment.roomId);

      const eventData: AssignmentEventData = {
        type: 'assignment',
        assignment,
        person,
        room,
        relatedTransports:
          relatedTransports && relatedTransports.length > 0 ? relatedTransports : undefined,
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

  const handleActivityClick = useCallback(
    (activity: Activity) => {
      const participants = (activity.participantIds ?? [])
        .map((personId) => getPersonById(personId))
        .filter((person): person is Person => person !== undefined);

      const eventData: ActivityEventData = {
        type: 'activity',
        activity,
        participants,
        organizer: activity.organizerId
          ? getPersonById(activity.organizerId)
          : undefined,
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
    } else if (selectedEvent.type === 'activity') {
      setIsEventDialogOpen(false);
      setSelectedActivityId(selectedEvent.activity.id);
      setIsActivityDialogOpen(true);
    } else {
      setIsEventDialogOpen(false);
      setEditingAssignment(selectedEvent.assignment);
      setIsAssignmentDialogOpen(true);
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
    } else if (selectedEvent.type === 'activity') {
      try {
        await deleteActivity(selectedEvent.activity.id);
        successToast(t('activities.deleteSuccess'));
      } catch (error) {
        console.error('Failed to delete activity:', error);
        toast.error(t('errors.deleteFailed', 'Failed to delete'));
        throw error;
      }
    }
  }, [selectedEvent, deleteAssignment, deleteTransport, deleteActivity, t, successToast]);

  const handleTransportDialogClose = useCallback((open: boolean) => {
    setIsTransportDialogOpen(open);
    if (!open) {
      setSelectedTransportId(undefined);
    }
  }, []);

  const handleActivityDialogClose = useCallback((open: boolean) => {
    setIsActivityDialogOpen(open);
    if (!open) {
      setSelectedActivityId(undefined);
    }
  }, []);

  const handleAssignmentDialogClose = useCallback((open: boolean) => {
    setIsAssignmentDialogOpen(open);
    if (!open) {
      setEditingAssignment(undefined);
    }
  }, []);

  const handleAssignmentSubmit = useCallback(
    async (data: {
      readonly roomId: RoomAssignment['roomId'];
      readonly personId: RoomAssignment['personId'];
      readonly startDate: RoomAssignment['startDate'];
      readonly endDate: RoomAssignment['endDate'];
    }) => {
      if (!editingAssignment) {
        return;
      }

      try {
        await updateAssignment(editingAssignment.id, data);
        successToast(t('assignments.updateSuccess', 'Assignment updated successfully'));
        setIsAssignmentDialogOpen(false);
        setEditingAssignment(undefined);
      } catch (error) {
        console.error('Failed to update assignment from calendar:', error);
        throw error;
      }
    },
    [editingAssignment, successToast, t, updateAssignment],
  );

  const handleDayRef = useCallback(
    (dateKey: ISODateString, node: HTMLDivElement | null) => {
      if (node) {
        dayRefs.current.set(dateKey, node);
        return;
      }

      dayRefs.current.delete(dateKey);
    },
    [],
  );

  const focusDay = useCallback((dateKey: ISODateString) => {
    setFocusedDateKey(dateKey);
    dayRefs.current.get(dateKey)?.focus();
  }, []);

  const handleDayFocus = useCallback((dateKey: ISODateString) => {
    setFocusedDateKey(dateKey);
  }, []);

  const handleDayKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, dateKey: ISODateString) => {
      const currentIndex = visibleDateKeys.indexOf(dateKey);
      if (currentIndex === -1) {
        return;
      }

      let nextIndex: number;

      switch (event.key) {
        case 'ArrowRight':
          nextIndex = Math.min(currentIndex + 1, visibleDateKeys.length - 1);
          break;
        case 'ArrowLeft':
          nextIndex = Math.max(currentIndex - 1, 0);
          break;
        case 'ArrowDown':
          nextIndex = Math.min(currentIndex + 7, visibleDateKeys.length - 1);
          break;
        case 'ArrowUp':
          nextIndex = Math.max(currentIndex - 7, 0);
          break;
        case 'Home':
          nextIndex = currentIndex - (currentIndex % 7);
          break;
        case 'End': {
          const rowStart = currentIndex - (currentIndex % 7);
          nextIndex = Math.min(rowStart + 6, visibleDateKeys.length - 1);
          break;
        }
        default:
          return;
      }

      event.preventDefault();

      const nextDateKey = visibleDateKeys[nextIndex];
      if (nextDateKey) {
        focusDay(nextDateKey);
      }
    },
    [focusDay, visibleDateKeys],
  );

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

  if (
    roomsError ||
    assignmentsError ||
    personsError ||
    transportsError ||
    activitiesError
  ) {
    const error =
      roomsError ?? assignmentsError ?? personsError ?? transportsError ?? activitiesError;
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

  const hasVisibleCalendarItems =
    eventsByDate.size > 0 || transportsByDate.size > 0 || activitiesByDate.size > 0;

  return (
    <div
      className={cn(
        'py-6 md:py-8',
        // A trip too long to show at once should not also be paying for a
        // reading-width cap — that width is the day axis's to use. The month
        // view is a fixed seven-column grid, so it keeps its cap. `container`
        // goes with the cap: here it contributes only a 1536px max-width, no
        // padding and no centring, which `main` owns.
        currentView === 'timeline' &&
          timelineNeedsFullPageWidth({
            dayCount: timelineDayCount,
            labelColumnWidth: CALENDAR_TIMELINE_LABEL_COLUMN_WIDTH_PX,
          })
          ? 'w-full'
          : 'container max-w-6xl',
      )}
    >
      <PageHeader
        title={t('calendar.title')}
        description={currentTrip.name}
        titleAccessory={
          <ViewSwitcher
            value={currentView}
            onValueChange={handleViewChange}
            ariaLabel={t('calendar.view.ariaLabel', 'Calendar view')}
            options={[
              { value: 'card', label: t('calendar.view.month', 'Month') },
              { value: 'timeline', label: t('calendar.view.timeline', 'Timeline') },
            ]}
          />
        }
      />

      {/* Calendar navigation header */}
      {currentView === 'card' && (
        <CalendarHeader
          currentMonth={currentMonth}
          onPrevMonth={handlePrevMonth}
          onNextMonth={handleNextMonth}
          onToday={handleToday}
          dateLocale={dateLocale}
        />
      )}

      <p id="calendar-keyboard-help" className="sr-only">
        {t(
          'calendar.keyboardHelp',
          'Use the arrow keys to move between days in the calendar grid.',
        )}
      </p>

      {currentView === 'card' ? (
        // Calendar grid wrapper with horizontal scroll on mobile
        <div
          className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0"
          role="region"
          aria-label={t('calendar.scrollableCalendar', 'Scrollable calendar')}
        >
          <div className="min-w-[600px] border rounded-lg overflow-hidden">
            <div
              role="grid"
              aria-label={t('calendar.monthView', 'Month view calendar')}
              aria-describedby="calendar-keyboard-help"
            >
              {/* Day headers */}
              <CalendarDayHeader dateLocale={dateLocale} />

              {/* Calendar grid body */}
              <div role="rowgroup">
                {calendarWeeks.map((week, weekIndex) => (
                  <div
                    key={`week-${weekIndex}`}
                    className="grid grid-cols-7 gap-px bg-muted"
                    role="row"
                  >
                    {week.map((day) => {
                      const dateKey = toLocalISODateString(day);
                      const events = eventsByDate.get(dateKey) ?? EMPTY_EVENTS;
                      const transports = transportsByDate.get(dateKey) ?? EMPTY_TRANSPORTS;
                      const dayActivities =
                        activitiesByDate.get(dateKey) ?? EMPTY_CALENDAR_ACTIVITIES;
                      const isCurrentMonth = isSameMonth(day, currentMonth);
                      const isDayToday = isSameDay(day, today);
                      const isWithinTrip =
                        tripBoundaries !== null && isWithinInterval(day, tripBoundaries);

                      return (
                        <CalendarDay
                          key={dateKey}
                          dateKey={dateKey}
                          date={day}
                          events={events}
                          transports={transports}
                          activities={dayActivities}
                          headcount={headcountsByDate.get(dateKey)}
                          isCurrentMonth={isCurrentMonth}
                          isToday={isDayToday}
                          isWithinTrip={isWithinTrip}
                          dateLocale={dateLocale}
                          tabIndex={focusedDateKey === dateKey ? 0 : -1}
                          onEventClick={handleEventClick}
                          onTransportClick={handleTransportClick}
                          onActivityClick={handleActivityClick}
                          onDayFocus={handleDayFocus}
                          onDayKeyDown={handleDayKeyDown}
                          dayRef={handleDayRef}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <CalendarTimeline
          trip={currentTrip}
          persons={persons}
          rooms={rooms}
          assignments={assignments}
          arrivals={arrivals}
          departures={departures}
          activities={activities}
          dateLocale={dateLocale}
          today={today}
          onAssignmentClick={handleEventClick}
          onTransportClick={handleTransportClick}
          onActivityClick={handleActivityClick}
          onAddGuests={handleAddGuests}
          onAddRooms={handleAddRooms}
        />
      )}

      {/* Empty state when nothing is scheduled. Same component, same copy and
          same icon as the timeline view's empty state, so switching views does
          not change how "nothing here yet" is presented. */}
      {currentView === 'card' && !hasVisibleCalendarItems && (
        <EmptyState
          className="mt-6"
          icon={CalendarIcon}
          title={t('calendar.noAssignmentsTitle', 'Nothing scheduled yet')}
          description={t('calendar.noAssignments')}
          action={{
            label: t('calendar.addGuests', 'Add guests'),
            onClick: handleAddGuests,
          }}
          secondaryAction={{
            label: t('calendar.addRooms', 'Add rooms'),
            onClick: handleAddRooms,
          }}
        />
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

      {/* Activity Edit Dialog */}
      <ActivityDialog
        open={isActivityDialogOpen}
        onOpenChange={handleActivityDialogClose}
        activityId={selectedActivityId}
      />

      {/* Assignment Edit Dialog */}
      {editingAssignment ? (
        <AssignmentFormDialog
          open={isAssignmentDialogOpen}
          onOpenChange={handleAssignmentDialogClose}
          roomId={editingAssignment.roomId}
          existingAssignment={editingAssignment}
          persons={persons}
          tripStartDate={currentTrip ? parseISO(currentTrip.startDate) : undefined}
          tripEndDate={currentTrip ? parseISO(currentTrip.endDate) : undefined}
          onSubmit={handleAssignmentSubmit}
          checkConflict={checkConflict}
          existingAssignments={getAssignmentsByRoom(editingAssignment.roomId)}
          roomCapacity={roomsMap.get(editingAssignment.roomId)?.capacity}
        />
      ) : null}
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { CalendarPage };
export default CalendarPage;
