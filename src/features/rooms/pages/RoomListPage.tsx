/**
 * @fileoverview Room List Page - Displays and manages rooms within a trip.
 * Shows rooms as cards with occupancy status based on current assignments.
 *
 * Route: /trips/:tripId/rooms
 *
 * Features:
 * - Lists rooms as cards in responsive grid
 * - Shows real-time occupancy status based on today's date
 * - Add room action (FAB on mobile, header button on desktop)
 * - Empty state for trips with no rooms
 * - Edit/Delete actions via RoomCard dropdown menu
 * - Drag-and-drop room assignments from unassigned guests
 *
 * @module features/rooms/pages/RoomListPage
 * @see TripListPage.tsx for reference implementation pattern
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
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  format,
  parseISO,
  subDays,
} from 'date-fns';
import { AlertTriangle, DoorOpen, GripVertical, Plus, Sparkles } from 'lucide-react';
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
} from '@dnd-kit/core';

import { useTripContext } from '@/contexts/TripContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useToday } from '@/hooks';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ViewSwitcher } from '@/components/ui/view-switcher';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import { ASSISTANT_MODEL_PRESETS } from '@/features/assistant/models';
import { RoomCard } from '@/features/rooms/components/RoomCard';
import { RoomDialog } from '@/features/rooms/components/RoomDialog';
import { RoomAssignmentSection } from '@/features/rooms/components/RoomAssignmentSection';
import { DraggableGuest, type DraggableGuestData } from '@/features/rooms/components/DraggableGuest';
import { DroppableRoom, type DroppableRoomData } from '@/features/rooms/components/DroppableRoom';
import { QuickAssignmentDialog } from '@/features/rooms/components/QuickAssignmentDialog';
import { RoomOccupancyTimeline } from '@/features/rooms/components/RoomOccupancyTimeline';
import { type DateRange as PickerDateRange, DateRangePicker } from '@/components/shared/DateRangePicker';
import {
  calculatePeakOccupancy,
  createHeadcountResolver,
  isDateInStayRange,
} from '@/features/rooms/utils/capacity-utils';
import { getPersonHeadcount } from '@/types';
import type {
  ISODateString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomId,
  Transport,
} from '@/types';
import type { DraggableRoomAssignmentData } from '@/features/rooms/components/DraggableRoomAssignment';
import type { DroppableAssignmentData } from '@/features/rooms/components/DroppableAssignment';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Room with calculated occupancy information.
 */
interface RoomWithOccupancy {
  /** The room entity */
  readonly room: Room;
  /** Current occupants (persons assigned today) */
  readonly currentOccupants: readonly Person[];
  /** Peak occupancy across the selected date range */
  readonly peakOccupancy: number;
  /** Available spots (capacity - peakOccupancy) */
  readonly availableSpots: number;
  /** Whether the room is at or over capacity */
  readonly isFull: boolean;
}

/**
 * Guest with unassigned dates information.
 */
interface UnassignedGuest {
  /** The person */
  readonly person: Person;
  /** First date they need a room (arrival date) */
  readonly startDate: string;
  /** Last date they need a room (day before departure) */
  readonly endDate: string;
  /** Dates without room assignment (ISO strings) */
  readonly unassignedDates: readonly string[];
}

interface DateSegment {
  readonly startDate: string;
  readonly endDate: string;
  readonly dates: readonly string[];
}

interface RoomAssignmentPlan {
  readonly personId: Person['id'];
  readonly roomId: Room['id'];
  readonly startDate: string;
  readonly endDate: string;
}

/**
 * Calculates unassigned dates for a person based on their transports and room assignments.
 * 
 * @param personId - The person's ID
 * @param arrivals - All arrival transports in the trip
 * @param departures - All departure transports in the trip
 * @param assignments - All room assignments in the trip
 * @returns Array of ISO date strings where the person needs a room but has no assignment
 */
function calculateUnassignedDates(
  person: Person,
  arrivals: readonly Transport[],
  departures: readonly Transport[],
  assignments: readonly RoomAssignment[],
): { startDate: string; endDate: string; unassignedDates: string[] } | null {
  // Prefer explicit stay dates when available (covers "I'm here" without transports)
  let arrivalDate: string | null = person.stayStartDate ?? null;
  let departureDate: string | null = person.stayEndDate ?? null;

  // Otherwise derive from transports (earliest arrival / latest departure)
  const personArrivals = arrivals.filter((t) => t.personId === person.id);
  const personDepartures = departures.filter((t) => t.personId === person.id);

  if (!arrivalDate) {
    for (const arrival of personArrivals) {
      const date = arrival.datetime.substring(0, 10);
      if (!arrivalDate || date < arrivalDate) {
        arrivalDate = date;
      }
    }
  }

  if (!departureDate) {
    for (const departure of personDepartures) {
      const date = departure.datetime.substring(0, 10);
      if (!departureDate || date > departureDate) {
        departureDate = date;
      }
    }
  }

  // Still no range => we don't know when they need a room
  if (!arrivalDate || !departureDate) {
    return null;
  }

  // Generate all dates person needs a room (arrival night to day before departure)
  // Person arrives on arrivalDate, sleeps that night
  // Person departs on departureDate morning, so last night is (departureDate - 1)
  const start = parseISO(arrivalDate);
  const end = parseISO(departureDate);
  
  // If departure is same day as arrival, no nights stayed
  if (arrivalDate >= departureDate) {
    return null;
  }

  // Get all nights the person needs a room (arrival date to day before departure)
  // Using check-in/check-out model: they sleep from arrivalDate to departureDate-1
  const lastNight = new Date(end);
  lastNight.setDate(lastNight.getDate() - 1);
  
  const datesNeeded = eachDayOfInterval({ start, end: lastNight }).map(
    (d) => format(d, 'yyyy-MM-dd'),
  );

  // Get person's room assignments
  const personAssignments = assignments.filter((a) => a.personId === person.id);

  // Build set of dates covered by assignments
  const coveredDates = new Set<string>();
  for (const assignment of personAssignments) {
    const assignmentStart = parseISO(assignment.startDate);
    const assignmentEnd = parseISO(assignment.endDate);
    
    // Assignment covers nights from startDate to endDate-1 (check-out model)
    const lastCoveredNight = new Date(assignmentEnd);
    lastCoveredNight.setDate(lastCoveredNight.getDate() - 1);
    
    if (assignmentStart <= lastCoveredNight) {
      const coveredNights = eachDayOfInterval({ start: assignmentStart, end: lastCoveredNight });
      for (const night of coveredNights) {
        coveredDates.add(format(night, 'yyyy-MM-dd'));
      }
    }
  }

  // Find unassigned dates
  const unassignedDates = datesNeeded.filter((date) => !coveredDates.has(date));

  if (unassignedDates.length === 0) {
    return null;
  }

  return {
    startDate: arrivalDate,
    endDate: departureDate,
    unassignedDates,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

// isDateInStayRange and calculatePeakOccupancy imported from @/features/rooms/utils/capacity-utils

/**
 * Formats a Date object to ISO date string (YYYY-MM-DD).
 * Uses local timezone.
 *
 * @param date - The date to format
 * @returns ISO date string
 */
function formatToISODate(date: Date): string {
  const year = date.getFullYear(),
   month = String(date.getMonth() + 1).padStart(2, '0'),
   day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

async function hasAnyCachedAssistantModel(): Promise<boolean> {
  if (typeof caches === 'undefined') {
    return false;
  }

  try {
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    const keys = await cache.keys();

    return ASSISTANT_MODEL_PRESETS.some((preset) => {
      const encoded = preset.modelId.replace('/', '%2F');
      return keys.some(
        (req) => req.url.includes(encoded) || req.url.includes(preset.modelId),
      );
    });
  } catch {
    return false;
  }
}

function splitIntoDateSegments(dates: readonly string[]): readonly DateSegment[] {
  if (dates.length === 0) {
    return [];
  }

  const sorted = [...dates].sort((a, b) => a.localeCompare(b));
  const segments: DateSegment[] = [];
  let currentStart = sorted[0]!;
  let currentEnd = sorted[0]!;
  let currentDates: string[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i]!;
    const expectedNext = formatToISODate(addDays(parseISO(currentEnd), 1));

    if (next === expectedNext) {
      currentEnd = next;
      currentDates.push(next);
      continue;
    }

    segments.push({
      startDate: currentStart,
      endDate: currentEnd,
      dates: currentDates,
    });
    currentStart = next;
    currentEnd = next;
    currentDates = [next];
  }

  segments.push({
    startDate: currentStart,
    endDate: currentEnd,
    dates: currentDates,
  });

  return segments;
}

function buildRoomDateOccupancy(
  assignments: readonly RoomAssignment[],
  headcountOf: (personId: PersonId) => number,
): Map<Room['id'], Map<string, number>> {
  const occupancyByRoom = new Map<Room['id'], Map<string, number>>();

  for (const assignment of assignments) {
    let roomOccupancy = occupancyByRoom.get(assignment.roomId);
    if (!roomOccupancy) {
      roomOccupancy = new Map<string, number>();
      occupancyByRoom.set(assignment.roomId, roomOccupancy);
    }
    // Match check-in / check-out model (see capacity-utils): endDate is exclusive.
    const start = parseISO(assignment.startDate);
    const end = parseISO(assignment.endDate);
    const lastNight = new Date(end);
    lastNight.setDate(lastNight.getDate() - 1);
    if (start > lastNight) {
      continue;
    }
    const nights = eachDayOfInterval({ start, end: lastNight });
    for (const night of nights) {
      const key = formatToISODate(night);
      roomOccupancy.set(
        key,
        (roomOccupancy.get(key) ?? 0) + headcountOf(assignment.personId),
      );
    }
  }

  return occupancyByRoom;
}

function chooseRoomForSegment(
  rooms: readonly Room[],
  occupancyByRoom: Map<Room['id'], Map<string, number>>,
  segment: DateSegment,
): Room | undefined {
  const candidates: Array<{
    room: Room;
    isCompletelyEmpty: boolean;
    slackScore: number;
  }> = [];

  for (const room of rooms) {
    if (room.capacity < 1) {
      continue;
    }
    const roomOccupancy = occupancyByRoom.get(room.id) ?? new Map<string, number>();
    const occupancies = segment.dates.map((date) => roomOccupancy.get(date) ?? 0);
    if (occupancies.some((value) => value >= room.capacity)) {
      continue;
    }

    const isCompletelyEmpty = occupancies.every((value) => value === 0);
    const slackScore = occupancies.reduce(
      (sum, value) => sum + (room.capacity - (value + 1)),
      0,
    );
    candidates.push({
      room,
      isCompletelyEmpty,
      slackScore,
    });
  }

  candidates.sort((a, b) => {
    if (a.isCompletelyEmpty !== b.isCompletelyEmpty) {
      return a.isCompletelyEmpty ? -1 : 1;
    }
    if (a.slackScore !== b.slackScore) {
      return a.slackScore - b.slackScore;
    }
    return a.room.order - b.room.order;
  });

  return candidates[0]?.room;
}

function planAutoAssignments(
  guests: readonly UnassignedGuest[],
  rooms: readonly Room[],
  assignments: readonly RoomAssignment[],
  headcountOf: (personId: PersonId) => number,
): {
  readonly plans: readonly RoomAssignmentPlan[];
  readonly unplacedSegments: number;
} {
  const occupancyByRoom = buildRoomDateOccupancy(assignments, headcountOf);
  const plans: RoomAssignmentPlan[] = [];
  let unplacedSegments = 0;

  const guestsByConstraint = [...guests].sort(
    (a, b) => b.unassignedDates.length - a.unassignedDates.length,
  );

  for (const guest of guestsByConstraint) {
    const segments = splitIntoDateSegments(guest.unassignedDates);
    for (const segment of segments) {
      const room = chooseRoomForSegment(rooms, occupancyByRoom, segment);
      if (!room) {
        unplacedSegments += 1;
        continue;
      }

      let roomOccupancy = occupancyByRoom.get(room.id);
      if (!roomOccupancy) {
        roomOccupancy = new Map<string, number>();
        occupancyByRoom.set(room.id, roomOccupancy);
      }

      for (const date of segment.dates) {
        roomOccupancy.set(date, (roomOccupancy.get(date) ?? 0) + 1);
      }

      plans.push({
        personId: guest.person.id,
        roomId: room.id,
        startDate: segment.startDate,
        // Assignments store check-out day as exclusive endDate (not the last night).
        endDate: formatToISODate(addDays(parseISO(segment.endDate), 1)),
      });
    }
  }

  return { plans, unplacedSegments };
}

function getStaySpanPercent(args: {
  readonly tripStartDate: string | undefined;
  readonly tripEndDate: string | undefined;
  readonly stayStartDate: string;
  readonly stayEndDate: string;
}): { leftPercent: number; widthPercent: number } | null {
  const { tripStartDate, tripEndDate, stayStartDate, stayEndDate } = args;
  if (!tripStartDate || !tripEndDate) {
    return null;
  }

  const tripStart = parseISO(tripStartDate);
  const tripEnd = parseISO(tripEndDate);
  const stayStart = parseISO(stayStartDate);
  const stayEnd = parseISO(stayEndDate);

  if (
    Number.isNaN(tripStart.getTime()) ||
    Number.isNaN(tripEnd.getTime()) ||
    Number.isNaN(stayStart.getTime()) ||
    Number.isNaN(stayEnd.getTime())
  ) {
    return null;
  }

  // Nights model: guest needs a room from stayStart night to (stayEnd - 1) night.
  const lastNight = subDays(stayEnd, 1);
  if (lastNight < stayStart) {
    return null;
  }

  const clippedStart = stayStart < tripStart ? tripStart : stayStart;
  const clippedEnd = lastNight > tripEnd ? tripEnd : lastNight;
  if (clippedEnd < clippedStart) {
    return null;
  }

  const totalNights = Math.max(1, differenceInCalendarDays(tripEnd, tripStart));
  const startOffset = Math.max(0, differenceInCalendarDays(clippedStart, tripStart));
  const spanNights = Math.max(1, differenceInCalendarDays(clippedEnd, clippedStart) + 1);

  return {
    leftPercent: (startOffset / totalNights) * 100,
    widthPercent: (spanNights / totalNights) * 100,
  };
}

// ============================================================================
// RoomListPage Component
// ============================================================================

/**
 * Main room list page component.
 * Displays all rooms for the current trip with occupancy status.
 *
 * @example
 * ```tsx
 * // In router configuration
 * { path: '/trips/:tripId/rooms', element: <RoomListPage /> }
 * ```
 */
const RoomListPage = memo(function RoomListPage(): ReactElement {
  const { t, i18n } = useTranslation(),
   navigate = useNavigate(),
   { tripId: tripIdFromUrl } = useParams<'tripId'>(),
   [searchParams, setSearchParams] = useSearchParams(),

  // Context hooks
   { successToast } = useOfflineAwareToast(),

   { currentTrip, isLoading: isTripLoading, setCurrentTrip } = useTripContext(),
   {
    rooms,
    isLoading: isRoomsLoading,
    error: roomsError,
    deleteRoom,
  } = useRoomContext(),
   { assignments, getAssignmentsByRoom, createAssignment, updateAssignment } = useAssignmentContext(),
   { persons, getPersonById } = usePersonContext(),
   { arrivals, departures, isLoading: isTransportsLoading } = useTransportContext(),

  // Track if we're currently performing an action to prevent double-clicks
   isActionInProgressRef = useRef(false),
   [isActionInProgress] = useState(false),
   [hasCachedAssistantModel, setHasCachedAssistantModel] = useState(false),
   [isOptimizingAssignments, setIsOptimizingAssignments] = useState(false),

  // Date range filter for capacity calculation
   [selectedDateRange, setSelectedDateRange] = useState<PickerDateRange | undefined>(undefined),

  // Dialog state for create/edit room
   [isDialogOpen, setIsDialogOpen] = useState(false),
   [editingRoomId, setEditingRoomId] = useState<RoomId | undefined>(undefined),

  // Track which room is expanded to show assignments
   [expandedRoomId, setExpandedRoomId] = useState<RoomId | undefined>(undefined),

  // Drag-and-drop state
   [activeDragPerson, setActiveDragPerson] = useState<Person | null>(null),
   [activeDragAssignment, setActiveDragAssignment] = useState<RoomAssignment | null>(null),
   [quickAssignDialogOpen, setQuickAssignDialogOpen] = useState(false),
   [quickAssignData, setQuickAssignData] = useState<{
     person: Person | null;
     roomId: RoomId | null;
     startDate: string;
     endDate: string;
   }>({
     person: null,
     roomId: null,
     startDate: '',
     endDate: '',
   }),

  currentView = useMemo(() => {
    const raw = searchParams.get('view');
    if (raw === 'timeline') return 'timeline';
    // Back-compat with older links
    if (raw === 'cards') return 'card';
    return raw === 'card' ? 'card' : 'timeline';
  }, [searchParams]),

  handleViewChange = useCallback(
    (nextValue: string) => {
      const view = nextValue === 'timeline' ? 'timeline' : 'card';
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('view', view);
        return next;
      });
    },
    [setSearchParams],
  ),

  // Trip date constraints for DateRangePicker
   tripStartDate = useMemo(
    () => (currentTrip?.startDate ? parseISO(currentTrip.startDate) : undefined),
    [currentTrip?.startDate],
  ),
   tripEndDate = useMemo(
    () => (currentTrip?.endDate ? parseISO(currentTrip.endDate) : undefined),
    [currentTrip?.endDate],
  ),

  // Effective date range for capacity calculation (defaults to full trip range)
   effectiveDateRange = useMemo(() => {
    if (selectedDateRange?.from && selectedDateRange?.to) {
      return {
        startDate: formatToISODate(selectedDateRange.from),
        endDate: formatToISODate(selectedDateRange.to),
      };
    }
    // Default to full trip date range
    if (currentTrip?.startDate && currentTrip?.endDate) {
      return {
        startDate: currentTrip.startDate,
        endDate: currentTrip.endDate,
      };
    }
    return null;
  }, [selectedDateRange, currentTrip?.startDate, currentTrip?.endDate]),

  // Combined loading state
   isLoading = isTripLoading || isRoomsLoading || isTransportsLoading,

  // Date locale for formatting
   dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]),

  // DnD sensors - require a minimum drag distance before activating
   sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8, // 8px minimum drag distance
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200, // 200ms hold before drag starts on touch
        tolerance: 5, // 5px movement tolerance
      },
    }),
  );

  // Sync URL tripId with context - if URL has a tripId but context doesn't match, update context
  useEffect(() => {
    if (tripIdFromUrl && !isTripLoading && currentTrip?.id !== tripIdFromUrl) {
      setCurrentTrip(tripIdFromUrl).catch((err) => {
        console.error('Failed to set current trip from URL:', err);
      });
    }
  }, [tripIdFromUrl, currentTrip?.id, isTripLoading, setCurrentTrip]);

  useEffect(() => {
    void hasAnyCachedAssistantModel().then(setHasCachedAssistantModel);
  }, []);

  // Validate tripId matches current trip
  const tripMismatch = useMemo(() => {
    if (!tripIdFromUrl || !currentTrip) {return false;}
    return tripIdFromUrl !== currentTrip.id;
  }, [tripIdFromUrl, currentTrip]),

  // Today's date - auto-updates at midnight via useToday hook
   { today: todayDate } = useToday(),
   todayStr = useMemo(() => formatToISODate(todayDate), [todayDate]),

  // Calculate rooms with occupancy data
   headcountOf = useMemo(() => createHeadcountResolver(persons), [persons]),

   roomsWithOccupancy = useMemo((): readonly RoomWithOccupancy[] => rooms.map((room) => {
      // Get all assignments for this room
      const roomAssignments = getAssignmentsByRoom(room.id),

      // Filter to assignments active today (for current occupants display)
       activeAssignments = roomAssignments.filter((assignment) =>
        isDateInStayRange(assignment.startDate, assignment.endDate, todayStr),
      ),

      // Map person IDs to Person objects, filtering out any not found
       currentOccupants = activeAssignments
        .map((assignment) => getPersonById(assignment.personId))
        .filter((person): person is Person => person !== undefined);

      // Peak occupancy counts people, not assignment rows: one guest entry can
      // stand for a couple or a family.
      const peakOccupancy = effectiveDateRange
        ? calculatePeakOccupancy(
            roomAssignments,
            effectiveDateRange.startDate,
            effectiveDateRange.endDate,
            headcountOf,
          )
        : currentOccupants.reduce(
            (total, person) => total + getPersonHeadcount(person),
            0,
          );

      const availableSpots = Math.max(0, room.capacity - peakOccupancy);
      const isFull = peakOccupancy >= room.capacity;

      return {
        room,
        currentOccupants,
        peakOccupancy,
        availableSpots,
        isFull,
      };
    }), [rooms, getAssignmentsByRoom, getPersonById, todayStr, effectiveDateRange, headcountOf]),

  // Sort rooms: available first (by room.order), then full rooms (by room.order)
   sortedRoomsWithOccupancy = useMemo(() => {
    const available = roomsWithOccupancy.filter((r) => !r.isFull);
    const full = roomsWithOccupancy.filter((r) => r.isFull);
    return [...available, ...full];
  }, [roomsWithOccupancy]),

  // Calculate guests without room assignments
   unassignedGuests = useMemo((): readonly UnassignedGuest[] => {
    const result: UnassignedGuest[] = [];
    
    for (const person of persons) {
      const unassignedInfo = calculateUnassignedDates(
        person,
        arrivals,
        departures,
        assignments,
      );
      
      if (unassignedInfo) {
        result.push({
          person,
          ...unassignedInfo,
        });
      }
    }
    
    return result;
  }, [persons, arrivals, departures, assignments]),

  // Notify once when all guests become assigned
  hasNotifiedAllAssignedRef = useRef(false),

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Auto-assigns missing room allocations using a local optimization heuristic.
   * Visible only when at least one local assistant model is already cached.
   */
   handleOptimizeAssignments = useCallback(async () => {
    if (isOptimizingAssignments || unassignedGuests.length === 0) {
      return;
    }
    setIsOptimizingAssignments(true);

    try {
      const { plans, unplacedSegments } = planAutoAssignments(
        unassignedGuests,
        rooms,
        assignments,
        headcountOf,
      );

      if (plans.length === 0) {
        toast.error(
          t(
            'rooms.autoAssignNoSolution',
            'No available room slot found for these guests.',
          ),
        );
        return;
      }

      let createdCount = 0;
      for (const plan of plans) {
        await createAssignment({
          roomId: plan.roomId,
          personId: plan.personId,
          startDate: plan.startDate as ISODateString,
          endDate: plan.endDate as ISODateString,
        });
        createdCount += 1;
      }

      successToast(
        t('rooms.autoAssignSuccess', {
          count: createdCount,
          defaultValue: '{{count}} room allocation(s) optimized automatically',
        }),
      );

      if (unplacedSegments > 0) {
        toast.error(
          t('rooms.autoAssignPartial', {
            count: unplacedSegments,
            defaultValue:
              '{{count}} segment(s) could not be placed due to capacity limits',
          }),
        );
      }
    } catch (error) {
      console.error('Failed to optimize room assignments:', error);
      toast.error(
        t(
          'rooms.autoAssignFailed',
          'Could not optimize room assignments.',
        ),
      );
    } finally {
      setIsOptimizingAssignments(false);
    }
  }, [
    assignments,
    createAssignment,
    headcountOf,
    isOptimizingAssignments,
    rooms,
    successToast,
    t,
    unassignedGuests,
  ]),

  /**
   * Handles room card click - toggles the expanded state to show/hide assignments.
   */
   handleRoomClick = useCallback(
    (room: Room) => {
      if (isActionInProgressRef.current) {return;}
      setExpandedRoomId((prev) => (prev === room.id ? undefined : room.id));
    },
    [],
  ),

  /**
   * Handles room edit action from dropdown menu.
   */
   handleRoomEdit = useCallback(
    (room: Room) => {
      if (isActionInProgressRef.current) {return;}
      setEditingRoomId(room.id);
      setIsDialogOpen(true);
    },
    [],
  ),

  /**
   * Handles room delete action from dropdown menu.
   * This is called after the user confirms the deletion in ConfirmDialog.
   */
   handleRoomDelete = useCallback(
    async (room: Room) => {
      try {
        await deleteRoom(room.id);
        successToast(t('rooms.deleteSuccess', 'Room deleted successfully'));
      } catch (error) {
        console.error('Failed to delete room:', error);
        toast.error(t('errors.deleteFailed', 'Failed to delete room'));
        throw error; // Re-throw to keep ConfirmDialog open for retry
      }
    },
    [deleteRoom, t, successToast],
  ),

  /**
   * Handles add room button click - opens the create room dialog.
   */
   handleAddRoom = useCallback(() => {
    setEditingRoomId(undefined); // Clear editing room ID for create mode
    setIsDialogOpen(true);
  }, []),

  /**
   * Handles back navigation.
   */
   handleBack = useCallback(() => {
    navigate(`/trips/${tripIdFromUrl}/calendar`);
  }, [navigate, tripIdFromUrl]),

  /**
   * Handles dialog close - resets editing state.
   */
   handleDialogOpenChange = useCallback((open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setEditingRoomId(undefined);
    }
  }, []),

  /**
   * Handles start of drag operation.
   */
   handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const guestData = active.data.current as DraggableGuestData | undefined;
    const assignmentData = active.data.current as DraggableRoomAssignmentData | undefined;

    if (guestData?.person) {
      setActiveDragPerson(guestData.person);
      setActiveDragAssignment(null);
      return;
    }

    if (assignmentData?.assignment) {
      setActiveDragAssignment(assignmentData.assignment);
      setActiveDragPerson(null);
    }
  }, []),

  /**
   * Handles end of drag operation.
   */
  handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    
    // Clear active drag state
    setActiveDragPerson(null);
    setActiveDragAssignment(null);
    
    // If no drop target, do nothing
    if (!over) return;
    
    // Get the dragged guest data
    const guestData = active.data.current as DraggableGuestData | undefined;
    const roomData = over.data.current as DroppableRoomData | undefined;
    const draggedAssignmentData = active.data.current as DraggableRoomAssignmentData | undefined;
    const targetAssignmentData = over.data.current as DroppableAssignmentData | undefined;
    
    // Case 1: Guest -> Room (existing flow)
    if (guestData?.person && roomData?.roomId) {
      if (currentView === 'timeline') {
        void (async () => {
          try {
            await createAssignment({
              roomId: roomData.roomId,
              personId: guestData.person.id,
              startDate: guestData.startDate as import('@/types').ISODateString,
              endDate: guestData.endDate as import('@/types').ISODateString,
            });
            successToast(t('assignments.createSuccess'));
          } catch (error) {
            console.error('Failed to create assignment from timeline drag:', error);
            toast.error(t('errors.saveFailed'));
          }
        })();
        return;
      }

      // Cards view: keep confirmation dialog
      setQuickAssignData({
        person: guestData.person,
        roomId: roomData.roomId,
        startDate: guestData.startDate,
        endDate: guestData.endDate,
      });
      setQuickAssignDialogOpen(true);
      return;
    }
    
    // Case 2: Assignment -> Room (move)
    if (draggedAssignmentData?.assignment && roomData?.roomId) {
      const assignment = draggedAssignmentData.assignment;
      void (async () => {
        try {
          await updateAssignment(assignment.id, { roomId: roomData.roomId });
          successToast(t('assignments.updateSuccess'));
        } catch (error) {
          console.error('Failed to move assignment:', error);
          toast.error(t('errors.saveFailed'));
        }
      })();
      return;
    }

    // Case 3: Assignment -> Assignment (swap rooms)
    if (draggedAssignmentData?.assignment && targetAssignmentData?.assignmentId) {
      const a = draggedAssignmentData.assignment;
      const b = assignments.find((x) => x.id === targetAssignmentData.assignmentId);
      if (!b) return;

      void (async () => {
        try {
          await Promise.all([
            updateAssignment(a.id, { roomId: b.roomId }),
            updateAssignment(b.id, { roomId: a.roomId }),
          ]);
          successToast(t('rooms.swapSuccess', 'Rooms swapped'));
        } catch (error) {
          console.error('Failed to swap assignments:', error);
          toast.error(t('errors.saveFailed'));
        }
      })();
    }
  }, [assignments, createAssignment, currentView, successToast, t, updateAssignment]),

  /**
   * Handles drag cancel.
   */
   handleDragCancel = useCallback(() => {
    setActiveDragPerson(null);
    setActiveDragAssignment(null);
  }, []),

  /**
   * Handles quick assignment dialog close.
   */
   handleQuickAssignDialogClose = useCallback((open: boolean) => {
    setQuickAssignDialogOpen(open);
    if (!open) {
      setQuickAssignData({
        person: null,
        roomId: null,
        startDate: '',
        endDate: '',
      });
    }
  }, []),

  /**
   * Handles "Claim this room" button click.
   * Opens the QuickAssignmentDialog with the room pre-selected.
   */
   handleClaimRoom = useCallback((room: Room) => {
    // Re-check capacity at click time (room may have filled between render and click)
    const roomAssignments = getAssignmentsByRoom(room.id);
    const startDate = effectiveDateRange?.startDate ?? currentTrip?.startDate ?? '';
    const endDate = effectiveDateRange?.endDate ?? currentTrip?.endDate ?? '';

    if (startDate && endDate) {
      const peak = calculatePeakOccupancy(
        roomAssignments,
        startDate,
        endDate,
        headcountOf,
      );
      if (peak >= room.capacity) {
        toast.error(t('rooms.roomJustFilled'));
        return;
      }
    }

    setQuickAssignData({
      person: null, // Person will be selected in the dialog
      roomId: room.id,
      startDate,
      endDate,
    });
    setQuickAssignDialogOpen(true);
  }, [effectiveDateRange, currentTrip?.startDate, currentTrip?.endDate, getAssignmentsByRoom, headcountOf, t]),

  // ============================================================================
  // Header Action (desktop button)
  // ============================================================================

   headerAction = useMemo(
    () => (
      <Button onClick={handleAddRoom} className="hidden sm:flex">
        <Plus className="size-4 mr-2" aria-hidden="true" />
        {t('rooms.new')}
      </Button>
    ),
    [handleAddRoom, t],
  );

  useEffect(() => {
    if (hasNotifiedAllAssignedRef.current) {
      return;
    }

    const allAssigned = persons.length > 0 && unassignedGuests.length === 0;
    if (!allAssigned) {
      return;
    }

    const tripId = currentTrip?.id ?? tripIdFromUrl;
    if (!tripId) {
      return;
    }

    const storageKey = `rooms_all_assigned_notified_${tripId}`;
    try {
      if (localStorage.getItem(storageKey) === '1') {
        hasNotifiedAllAssignedRef.current = true;
        return;
      }

      successToast(t('rooms.allGuestsAssigned', 'All guests have rooms assigned'));
      localStorage.setItem(storageKey, '1');
      hasNotifiedAllAssignedRef.current = true;
    } catch {
      // If storage is unavailable (private mode), still avoid spamming within the session.
      successToast(t('rooms.allGuestsAssigned', 'All guests have rooms assigned'));
      hasNotifiedAllAssignedRef.current = true;
    }
  }, [currentTrip?.id, persons.length, successToast, t, tripIdFromUrl, unassignedGuests.length]);

  // ============================================================================
  // Render: Loading State
  // ============================================================================

  if (isLoading) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader
          title={t('rooms.title')}
          backLink={tripIdFromUrl ? `/trips/${tripIdFromUrl}/calendar` : '/trips'}
        />
        <div className="flex-1 flex items-center justify-center min-h-[200px]">
          <LoadingState variant="inline" size="lg" />
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render: Trip Mismatch or Not Found
  // ============================================================================

  if (!tripIdFromUrl || !currentTrip || tripMismatch) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader title={t('rooms.title')} backLink="/trips" />
        <div className="flex-1 flex items-center justify-center min-h-[200px]">
          <EmptyState
            icon={DoorOpen}
            title={t('errors.tripNotFound', 'Trip not found')}
            description={t(
              'errors.tripNotFoundDescription',
              'The trip you are looking for does not exist or you do not have access to it.',
            )}
            action={{
              label: t('common.back'),
              onClick: () => navigate('/trips'),
            }}
          />
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render: Error State
  // ============================================================================

  if (roomsError) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader
          title={t('rooms.title')}
          backLink={`/trips/${tripIdFromUrl}/calendar`}
        />
        <ErrorDisplay
          error={roomsError}
          onRetry={() => window.location.reload()}
          onBack={handleBack}
        />
      </div>
    );
  }

  // ============================================================================
  // Render: Empty State
  // ============================================================================

  if (rooms.length === 0) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader
          title={t('rooms.title')}
          backLink={`/trips/${tripIdFromUrl}/calendar`}
        />
        <div className="flex-1 flex items-center justify-center min-h-[200px]">
          <EmptyState
            icon={DoorOpen}
            title={t('rooms.empty')}
            description={t('rooms.emptyDescription')}
            action={{
              label: t('rooms.new'),
              onClick: handleAddRoom,
            }}
          />
        </div>

        {/* Room Create Dialog - needed even in empty state */}
        <RoomDialog
          roomId={editingRoomId}
          open={isDialogOpen}
          onOpenChange={handleDialogOpenChange}
        />
      </div>
    );
  }

  // ============================================================================
  // Render: Room List
  // ============================================================================

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        className={cn(
          'container py-6 md:py-8',
          currentView === 'timeline' ? 'max-w-7xl' : 'max-w-4xl',
        )}
      >
        <PageHeader
          title={t('rooms.title')}
          backLink={`/trips/${tripIdFromUrl}/calendar`}
          action={headerAction}
        />

      <ViewSwitcher
        className="mb-4"
        value={currentView}
        onValueChange={handleViewChange}
        ariaLabel={t('rooms.view.ariaLabel', 'Rooms view')}
        options={[
          { value: 'card', label: t('rooms.view.cards', 'Cards') },
          { value: 'timeline', label: t('rooms.view.timeline', 'Timeline') },
        ]}
      />

      {/* Date range filter for room availability (cards view only) */}
      {currentView === 'card' && rooms.length > 0 && currentTrip && (
        <div className="mb-4">
          <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
            {t('rooms.filterDates')}
          </label>
          <DateRangePicker
            value={selectedDateRange}
            onChange={setSelectedDateRange}
            minDate={tripStartDate}
            maxDate={tripEndDate}
            aria-label={t('rooms.filterDates')}
          />
        </div>
      )}

      {/* Unassigned guests section */}
      {persons.length > 0 && unassignedGuests.length > 0 && (
        <Card
          className={cn(
            'mb-6',
            'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20',
          )}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <span className="text-amber-800 dark:text-amber-200">
                  {t('rooms.unassignedGuests', 'Guests without rooms')} ({unassignedGuests.length})
                </span>
              </CardTitle>
              {hasCachedAssistantModel ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => {
                    void handleOptimizeAssignments();
                  }}
                  disabled={isOptimizingAssignments}
                >
                  <Sparkles className="mr-1.5 size-3.5" aria-hidden="true" />
                  {isOptimizingAssignments
                    ? t('rooms.autoAssignWorking', 'Optimizing...')
                    : t('rooms.autoAssignButton', 'Optimize automatically')}
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {unassignedGuests.map(({ person, startDate, endDate }) => {
                  const formattedStart = format(parseISO(startDate), 'MMM d', { locale: dateLocale });
                  const formattedEnd = format(parseISO(endDate), 'MMM d', { locale: dateLocale });
                  const staySpan = getStaySpanPercent({
                    tripStartDate: currentTrip?.startDate,
                    tripEndDate: currentTrip?.endDate,
                    stayStartDate: startDate,
                    stayEndDate: endDate,
                  });
                  return (
                    <div key={person.id} className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-1">
                        <GripVertical className="size-4 text-muted-foreground/50" aria-hidden="true" />
                        <DraggableGuest
                          person={person}
                          startDate={startDate}
                          endDate={endDate}
                          size="sm"
                        />
                      </div>
                      {staySpan && (
                        <div className="w-full sm:w-40">
                          <div className="h-2 rounded-full bg-muted/60 relative overflow-hidden">
                            <div
                              className="absolute top-0 bottom-0 rounded-full"
                              style={{
                                left: `${staySpan.leftPercent}%`,
                                width: `${staySpan.widthPercent}%`,
                                backgroundColor: person.color,
                              }}
                              aria-hidden="true"
                            />
                          </div>
                        </div>
                      )}
                      <span className="text-sm text-muted-foreground">
                        {formattedStart} - {formattedEnd} {t('rooms.needsRoom', 'needs room')}
                      </span>
                    </div>
                  );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
              <GripVertical className="size-3" aria-hidden="true" />
              {t('rooms.dragHint', 'Drag a guest to a room below to assign')}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Room grid */}
      {currentView === 'card' ? (
        <div
          role="list"
          aria-label={t('rooms.title')}
          className={cn(
            'grid gap-4',
            'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
            // Extra bottom padding for FAB on mobile
            'pb-20 sm:pb-4',
          )}
        >
          {sortedRoomsWithOccupancy.map(({ room, currentOccupants, peakOccupancy, availableSpots, isFull }) => (
            <div key={room.id} role="listitem">
              <DroppableRoom roomId={room.id}>
                <RoomCard
                  room={room}
                  occupants={currentOccupants}
                  peakOccupancy={peakOccupancy}
                  availableSpots={availableSpots}
                  isFull={isFull}
                  onClick={handleRoomClick}
                  onEdit={handleRoomEdit}
                  onDelete={handleRoomDelete}
                  onClaim={handleClaimRoom}
                  isDisabled={isActionInProgress}
                  isExpanded={expandedRoomId === room.id}
                  expandedContent={
                    <RoomAssignmentSection
                      roomId={room.id}
                      variant="compact"
                    />
                  }
                />
              </DroppableRoom>
            </div>
          ))}
        </div>
      ) : (
        <RoomOccupancyTimeline
          trip={currentTrip}
          rooms={sortedRoomsWithOccupancy.map((r) => r.room)}
          assignments={assignments}
          arrivals={arrivals}
          departures={departures}
          persons={persons}
          unassignedGuests={unassignedGuests}
          dateLocale={dateLocale}
          range={{
            startDate: currentTrip.startDate,
            endDate: currentTrip.endDate,
          }}
          todayKey={todayStr as ISODateString}
        />
      )}

      {/* Floating Action Button for mobile */}
      <Button
        onClick={handleAddRoom}
        size="lg"
        className={cn(
          'fixed bottom-20 right-4 z-10',
          'size-14 rounded-full shadow-lg',
          'sm:hidden',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
        aria-label={t('rooms.new')}
      >
        <Plus className="size-6" aria-hidden="true" />
      </Button>

      {/* Room Create/Edit Dialog */}
      <RoomDialog
        roomId={editingRoomId}
        open={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
      />

      {/* Quick Assignment Dialog (for drag-drop) */}
      <QuickAssignmentDialog
        open={quickAssignDialogOpen}
        onOpenChange={handleQuickAssignDialogClose}
        person={quickAssignData.person}
        roomId={quickAssignData.roomId}
        suggestedStartDate={quickAssignData.startDate}
        suggestedEndDate={quickAssignData.endDate}
      />
    </div>

    {/* Drag Overlay - shows dragged item while dragging */}
    <DragOverlay>
      {activeDragPerson && (
        <div className="opacity-80 shadow-lg">
          <PersonBadge person={activeDragPerson} size="sm" />
        </div>
      )}
      {activeDragAssignment && (
        <div className="opacity-80 shadow-lg">
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            {t('assignments.title')}
          </div>
        </div>
      )}
    </DragOverlay>
  </DndContext>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { RoomListPage };
export default RoomListPage;
