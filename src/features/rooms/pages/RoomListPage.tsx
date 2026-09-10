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
 * - Edit/Duplicate/Delete actions via RoomCard dropdown menu
 * - Claim a room for the guest this browser is, or assign any guest to it
 * - Double-click a room name (either view) to open its edit dialog
 * - Drag-and-drop room assignments (timeline unassigned rows)
 * - Room menu on each timeline chip, for assignment without a pointer
 * - "Suggest an allocation": fills every unhoused night at once, for review
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
import { useOfflineAwareNotify } from '@/hooks';
import { useTripAccess } from '@/hooks/useTripAccess';
import { parseISO } from 'date-fns';
import { BedDouble, DoorOpen, GripHorizontal, Plus, Sparkles } from 'lucide-react';
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  KeyboardSensor,
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
import { ViewSwitcher } from '@/components/ui/view-switcher';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import {
  AllocationSuggestionDialog,
  type ConfirmedStay,
} from '@/features/rooms/components/AllocationSuggestionDialog';
import { RoomCard } from '@/features/rooms/components/RoomCard';
import { RoomDialog } from '@/features/rooms/components/RoomDialog';
import { RoomAssignmentSection } from '@/features/rooms/components/RoomAssignmentSection';
import type { DraggableGuestData } from '@/features/rooms/components/DraggableGuest';
import { DroppableRoom, type DroppableRoomData } from '@/features/rooms/components/DroppableRoom';
import { QuickAssignmentDialog } from '@/features/rooms/components/QuickAssignmentDialog';
import {
  RoomOccupancyTimeline,
  ROOM_TIMELINE_LABEL_COLUMN_WIDTH_PX,
} from '@/features/rooms/components/RoomOccupancyTimeline';
import { type DateRange as PickerDateRange, DateRangePicker } from '@/components/shared/DateRangePicker';
import {
  planRoomAllocation,
  type SuggestedStay,
} from '@/features/rooms/utils/allocation-planner';
import {
  calculatePeakOccupancy,
  createHeadcountResolver,
  isDateInStayRange,
  isZeroNightWindow,
  summarizeRoomOccupancy,
} from '@/features/rooms/utils/capacity-utils';
import { createRoomDragAnnouncements } from '@/features/rooms/utils/dnd-announcements';
import { inferGuestParties } from '@/features/rooms/utils/guest-parties';
import { calculateUnassignedDates } from '@/features/rooms/utils/unassigned-guests';
import { getTripGuestPersonId } from '@/lib/sharing/guest-identity';
import { timelineNeedsFullPageWidth } from '@/lib/utils/timeline-viewport-layout';
import { buildDayColumns } from '@/lib/utils/trip-days';
import { notify } from '@/lib/notifications';
import { captureUsage } from '@/lib/posthog';
import { getPersonHeadcount } from '@/types';
import type {
  ISODateString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomId,
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
  /** Whether more people sleep in the room than it has beds */
  readonly isOverCapacity: boolean;
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

// ============================================================================
// Utility Functions
// ============================================================================

// isDateInStayRange and calculatePeakOccupancy come from
// `@/features/rooms/utils/capacity-utils`, and the allocation heuristic from
// `@/features/rooms/utils/allocation-planner`: the page proposes and reviews,
// it does not do the arithmetic.

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
   { notifySuccess } = useOfflineAwareNotify(),
   { canEdit } = useTripAccess(),

   { currentTrip, isLoading: isTripLoading, setCurrentTrip } = useTripContext(),
   {
    rooms,
    isLoading: isRoomsLoading,
    error: roomsError,
    deleteRoom,
    duplicateRoom,
  } = useRoomContext(),
   { assignments, getAssignmentsByRoom, createAssignment, updateAssignment } = useAssignmentContext(),
   { persons, getPersonById } = usePersonContext(),
   { arrivals, departures, isLoading: isTransportsLoading } = useTransportContext(),

  // Track if we're currently performing an action to prevent double-clicks
   isActionInProgressRef = useRef(false),
   [isActionInProgress] = useState(false),
   [suggestedStays, setSuggestedStays] = useState<readonly SuggestedStay[]>([]),
   [isSuggestionOpen, setIsSuggestionOpen] = useState(false),

  // Date range filter for capacity calculation
   [selectedDateRange, setSelectedDateRange] = useState<PickerDateRange | undefined>(undefined),

  // Dialog state for create/edit room.
  //
  // `?new=1` opens it on the first render rather than through an effect — it is
  // how the calendar's empty state sends people here to add their first room,
  // and a mount-then-open would flash the empty list first.
   [isDialogOpen, setIsDialogOpen] = useState(() => searchParams.get('new') !== null),
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

  /**
   * The guest this browser has become, if any.
   *
   * A trip's own host has no stored identity: they arrange rooms for other
   * people, so there is nobody for them to claim a room for and the button
   * says what it does instead.
   */
   selfPersonId = useMemo(
    (): PersonId | undefined => getTripGuestPersonId(currentTrip),
    [currentTrip],
  ),

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

  // Effective date range for capacity calculation (defaults to full trip range).
  //
  // Two guards keep the cards from disagreeing with the timeline:
  //  - the picker only applies in the cards view, which is the only view that
  //    renders it; the timeline measures the whole trip, so a filter left behind
  //    from an earlier visit must not silently change the numbers there.
  //  - a half-made selection is ignored. react-day-picker v9 reports
  //    `{from: D, to: D}` on the *first* click (see DateRangePicker), and a
  //    zero-night window makes every room read as empty and claimable.
   effectiveDateRange = useMemo(() => {
    const from = selectedDateRange?.from;
    const to = selectedDateRange?.to;
    if (currentView === 'card' && from && to) {
      const startDate = formatToISODate(from);
      const endDate = formatToISODate(to);
      if (startDate < endDate) {
        return { startDate, endDate };
      }
    }
    // Default to full trip date range
    if (currentTrip?.startDate && currentTrip?.endDate) {
      return {
        startDate: currentTrip.startDate,
        endDate: currentTrip.endDate,
      };
    }
    return null;
  }, [currentView, selectedDateRange, currentTrip?.startDate, currentTrip?.endDate]),

  // Combined loading state
   isLoading = isTripLoading || isRoomsLoading || isTransportsLoading,

  // Date locale for formatting
   dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]),

  // DnD sensors - require a minimum drag distance before activating.
  //
  // The keyboard sensor is not a nicety: the chips take focus and announce
  // themselves as draggable, so without it Space and the arrow keys promise a
  // move and deliver nothing. The chips' room menus are the shorter path, and
  // this makes the announced one true as well.
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
    useSensor(KeyboardSensor),
  );

  // Drop `?new=1` once it has done its job, so closing the dialog and reloading
  // — or coming back through history — does not pop it open again. `view` rides
  // along untouched.
  useEffect(() => {
    if (searchParams.get('new') === null) {
      return;
    }

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  // Sync URL tripId with context - if URL has a tripId but context doesn't match, update context
  useEffect(() => {
    if (tripIdFromUrl && !isTripLoading && currentTrip?.id !== tripIdFromUrl) {
      setCurrentTrip(tripIdFromUrl).catch((err) => {
        console.error('Failed to set current trip from URL:', err);
      });
    }
  }, [tripIdFromUrl, currentTrip?.id, isTripLoading, setCurrentTrip]);

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

      // The card draws "full" and "over capacity" differently, so both facts
      // come from the one helper rather than being re-derived here.
      const { availableSpots, isFull, isOverCapacity } = summarizeRoomOccupancy(
        room.capacity,
        peakOccupancy,
      );

      return {
        room,
        currentOccupants,
        peakOccupancy,
        availableSpots,
        isFull,
        isOverCapacity,
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
        { startDate: currentTrip?.startDate, endDate: currentTrip?.endDate },
      );
      
      if (unassignedInfo) {
        result.push({
          person,
          ...unassignedInfo,
        });
      }
    }
    
    return result;
  }, [persons, arrivals, departures, assignments, currentTrip?.startDate, currentTrip?.endDate]),

  /*
    A trip whose start and end fall on the same day holds no night. Nobody
    sleeps here, so no guest needs a bed and none can be given one: every
    "needs a room" answer is empty, which is why the timeline listed nobody and
    the suggest button went away. The page says so now, and the cards drop
    their assignment button — a stay of zero nights is not bookable.

    A trip with no dates at all is a different answer, "we do not know when
    this is", and `isZeroNightWindow` leaves it alone: those guests may still
    have stay dates of their own.
  */
   tripHasNoNights = isZeroNightWindow(currentTrip?.startDate, currentTrip?.endDate),

  // The frame's own day-axis builder, so the width decision counts exactly the
  // columns the timeline will draw.
   timelineDayCount = useMemo(
    () =>
      currentTrip?.startDate && currentTrip?.endDate
        ? buildDayColumns(currentTrip.startDate, currentTrip.endDate).length
        : 0,
    [currentTrip?.startDate, currentTrip?.endDate],
  ),

  // Notify once when all guests become assigned
  hasNotifiedAllAssignedRef = useRef(false),

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Fills the rooms in one go — as a proposal, not as a write.
   *
   * The planner is a plain local heuristic: no model, no network, no waiting,
   * which is why the button is offered to everybody rather than only to a
   * reader who happens to have an assistant model cached.
   */
   handleSuggestAllocation = useCallback(() => {
    if (unassignedGuests.length === 0) {
      return;
    }

    const partyOf = inferGuestParties({ persons, assignments, arrivals });
    const stays = planRoomAllocation({
      guests: unassignedGuests,
      rooms,
      assignments,
      headcountOf,
      partyOf,
    });

    if (stays.length === 0) {
      notify.error(t('rooms.suggest.nothingToPlace'));
      return;
    }

    setSuggestedStays(stays);
    setIsSuggestionOpen(true);
  }, [arrivals, assignments, headcountOf, persons, rooms, t, unassignedGuests]),

  /**
   * Writes the allocation the reader agreed to, one assignment at a time.
   *
   * Each stay is its own row, so a failure halfway leaves the earlier ones in
   * place: the notice reports what actually landed rather than what was asked
   * for, and the error re-throws so the dialog stays open on what is left.
   */
   applySuggestedStays = useCallback(
    async (stays: readonly ConfirmedStay[]) => {
      let created = 0;

      try {
        for (const stay of stays) {
          await createAssignment({
            roomId: stay.roomId,
            personId: stay.personId,
            startDate: stay.startDate as ISODateString,
            endDate: stay.endDate as ISODateString,
          });
          created += 1;
        }
      } catch (error) {
        console.error('Failed to apply the suggested allocation:', error);
        notify.error(t('rooms.suggest.failed'));
        throw error;
      } finally {
        if (created > 0) {
          notifySuccess(t('rooms.suggest.applied', { count: created }));
        }
      }
    },
    [createAssignment, notifySuccess, t],
  ),

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
        notifySuccess(t('rooms.deleteSuccess', 'Room deleted successfully'));
      } catch (error) {
        console.error('Failed to delete room:', error);
        notify.error(t('errors.deleteFailed', 'Failed to delete room'));
        throw error; // Re-throw to keep ConfirmDialog open for retry
      }
    },
    [deleteRoom, t, notifySuccess],
  ),

  /**
   * Handles room duplicate action from dropdown menu.
   *
   * A copy of a room that is already right is faster than the dialog, so this
   * makes the room and says which one it made rather than opening a form on it.
   */
   handleRoomDuplicate = useCallback(
    async (room: Room) => {
      if (isActionInProgressRef.current) {return;}
      try {
        const copy = await duplicateRoom(room.id);
        notifySuccess(
          t('rooms.duplicateSuccess', {
            name: copy.name,
            defaultValue: '{{name}} created',
          }),
        );
        captureUsage('room_saved', {
          operation: 'created',
          capacity: copy.capacity,
          count: 1,
        });
      } catch (error) {
        console.error('Failed to duplicate room:', error);
        notify.error(t('errors.saveFailed', 'Failed to save'));
      }
    },
    [duplicateRoom, t, notifySuccess],
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
   * Houses a guest in a room.
   *
   * The drop handler's own work, factored out because the chips' room menus
   * make the same assignment without a pointer — and a second copy of it would
   * be a second chance to disagree with the drop.
   */
   assignGuestToRoom = useCallback(
    (
      guest: {
        readonly person: Person;
        readonly startDate: string;
        readonly endDate: string;
      },
      roomId: RoomId,
    ) => {
      void (async () => {
        try {
          await createAssignment({
            roomId,
            personId: guest.person.id,
            startDate: guest.startDate as ISODateString,
            endDate: guest.endDate as ISODateString,
          });
          notifySuccess(t('assignments.createSuccess'));
        } catch (error) {
          console.error('Failed to create room assignment:', error);
          notify.error(t('errors.saveFailed'));
        }
      })();
    },
    [createAssignment, notifySuccess, t],
  ),

  /**
   * Moves an existing stay to another room.
   */
   moveAssignmentToRoom = useCallback(
    (assignment: RoomAssignment, roomId: RoomId) => {
      if (assignment.roomId === roomId) {
        return;
      }

      void (async () => {
        try {
          await updateAssignment(assignment.id, { roomId });
          notifySuccess(t('assignments.updateSuccess'));
        } catch (error) {
          console.error('Failed to move assignment:', error);
          notify.error(t('errors.saveFailed'));
        }
      })();
    },
    [notifySuccess, t, updateAssignment],
  ),

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
        assignGuestToRoom(
          {
            person: guestData.person,
            startDate: guestData.startDate,
            endDate: guestData.endDate,
          },
          roomData.roomId,
        );
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
      moveAssignmentToRoom(draggedAssignmentData.assignment, roomData.roomId);
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
          notifySuccess(t('rooms.swapSuccess', 'Rooms swapped'));
        } catch (error) {
          console.error('Failed to swap assignments:', error);
          notify.error(t('errors.saveFailed'));
        }
      })();
    }
  }, [
    assignGuestToRoom,
    assignments,
    currentView,
    moveAssignmentToRoom,
    notifySuccess,
    t,
    updateAssignment,
  ]),

  /**
   * Handles drag cancel.
   */
   handleDragCancel = useCallback(() => {
    setActiveDragPerson(null);
    setActiveDragAssignment(null);
  }, []),

  /**
   * What a screen reader hears during a drag.
   *
   * dnd-kit's default announcements are built from the ids it was handed, so a
   * drop used to read as "Draggable item guest-FH7oeUECm-… was dropped over
   * droppable area room-orvCHpZ2fFihDg9IxNikQ". These speak the same facts the
   * board shows: the guest, the room, and the spots left in it.
   */
   dragAnnouncements = useMemo(
    () =>
      createRoomDragAnnouncements({
        t,
        rooms: roomsWithOccupancy.map(({ room, availableSpots }) => ({
          id: room.id,
          name: room.name,
          availableSpots,
        })),
        assignments,
        personNameOf: (personId) => getPersonById(personId)?.name,
        headcountOf,
        // The cards view opens the quick-assign dialog instead of writing the
        // assignment, so nothing has moved yet when the drop lands there.
        confirmsBeforeAssigning: currentView !== 'timeline',
      }),
    [assignments, currentView, getPersonById, headcountOf, roomsWithOccupancy, t],
  ),

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
        notify.error(t('rooms.roomJustFilled'));
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

    // "Everyone has a room" has to mean rooms were given out. On a trip with no
    // nights nobody needed one, so the same empty list is not good news.
    const allAssigned =
      persons.length > 0 && unassignedGuests.length === 0 && !tripHasNoNights;
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

      notifySuccess(t('rooms.allGuestsAssigned', 'All guests have rooms assigned'));
      localStorage.setItem(storageKey, '1');
      hasNotifiedAllAssignedRef.current = true;
    } catch {
      // If storage is unavailable (private mode), still avoid spamming within the session.
      notifySuccess(t('rooms.allGuestsAssigned', 'All guests have rooms assigned'));
      hasNotifiedAllAssignedRef.current = true;
    }
  }, [
    currentTrip?.id,
    persons.length,
    notifySuccess,
    t,
    tripHasNoNights,
    tripIdFromUrl,
    unassignedGuests.length,
  ]);

  // ============================================================================
  // Render: Loading State
  // ============================================================================

  if (isLoading) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader title={t('rooms.title')} />
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
        <PageHeader title={t('rooms.title')} />
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
        <PageHeader title={t('rooms.title')} />
        <div className="flex-1 flex items-center justify-center min-h-[200px]">
          <EmptyState
            icon={DoorOpen}
            title={t('rooms.empty')}
            description={t('rooms.emptyDescription')}
            {...(canEdit
              ? {
                  action: {
                    label: t('rooms.new'),
                    onClick: handleAddRoom,
                  },
                }
              : {})}
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
      // No sensors on a read-only trip: nothing can be dragged, so nothing
      // announces itself as draggable.
      sensors={canEdit ? sensors : []}
      accessibility={{ announcements: dragAnnouncements }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        className={cn(
          'py-6 md:py-8',
          currentView !== 'timeline'
            ? 'container max-w-4xl'
            : // A trip too long to show at once should not also be paying for a
              // reading-width cap — that width is the day axis's to use. Even
              // `container` caps at 1536px, so it goes too: here it contributes
              // only that cap, no padding and no centring, which `main` owns.
              timelineNeedsFullPageWidth({
                  dayCount: timelineDayCount,
                  labelColumnWidth: ROOM_TIMELINE_LABEL_COLUMN_WIDTH_PX,
                })
              ? 'w-full'
              : 'container max-w-7xl',
        )}
      >
        <PageHeader
          title={t('rooms.title')}
          titleAccessory={
            <ViewSwitcher
              value={currentView}
              onValueChange={handleViewChange}
              ariaLabel={t('rooms.view.ariaLabel', 'Rooms view')}
              options={[
                { value: 'card', label: t('rooms.view.cards', 'Cards') },
                { value: 'timeline', label: t('rooms.view.timeline', 'Timeline') },
              ]}
            />
          }
          action={
            canEdit ? (
              <>
                {persons.length > 0 && unassignedGuests.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSuggestAllocation}
                  >
                    <Sparkles className="mr-2 size-4" aria-hidden="true" />
                    {t('rooms.suggest.button')}
                  </Button>
                )}
                {headerAction}
              </>
            ) : undefined
          }
        />

      {/*
        Why both views are showing rooms and no guests. It stands down as soon
        as somebody does need a bed — a guest whose own stay dates outlast the
        trip's single day still appears in the timeline, and telling them they
        need nothing would be the same lie the other way round.
      */}
      {tripHasNoNights && unassignedGuests.length === 0 && (
        <p
          role="status"
          className="mb-4 flex items-start gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground"
        >
          <BedDouble className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('rooms.noNights', 'No nights on this trip, so nobody needs a bed')}
        </p>
      )}

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

      {/* Room grid */}
      {currentView === 'card' ? (
        <div
          role="list"
          aria-label={t('rooms.title')}
          className={cn(
            'grid gap-4',
            'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
            // No bottom padding of its own: `<main>`'s `pb-bottom-stack` clears
            // the FAB and the nav bar for every page, and this grid's own
            // `pb-20 sm:pb-4` did not protect the timeline view next to it.
          )}
        >
          {sortedRoomsWithOccupancy.map(({ room, currentOccupants, peakOccupancy, availableSpots, isFull, isOverCapacity }) => (
            <div key={room.id} role="listitem">
              <DroppableRoom roomId={room.id}>
                <RoomCard
                  room={room}
                  occupants={currentOccupants}
                  peakOccupancy={peakOccupancy}
                  availableSpots={availableSpots}
                  isFull={isFull}
                  isOverCapacity={isOverCapacity}
                  onClick={handleRoomClick}
                  onEdit={handleRoomEdit}
                  onDelete={handleRoomDelete}
                  onDuplicate={handleRoomDuplicate}
                  {...(tripHasNoNights || !canEdit ? {} : { onClaim: handleClaimRoom })}
                  claimsForSelf={selfPersonId !== undefined}
                  isDisabled={isActionInProgress}
                  readOnly={!canEdit}
                  isExpanded={expandedRoomId === room.id}
                  expandedContent={
                    <RoomAssignmentSection
                      roomId={room.id}
                      variant="compact"
                      readOnly={!canEdit}
                    />
                  }
                />
              </DroppableRoom>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/*
            Nothing in a chip says it can be picked up, so the guests still
            waiting for a bed are the moment to say it. It goes as soon as
            everybody is housed, and stays away for a reader who cannot edit.
          */}
          {canEdit && unassignedGuests.length > 0 && (
            <p
              className="mb-4 flex items-start gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground"
            >
              <GripHorizontal className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t('rooms.dragHint', 'Drag a chip onto a room to give it a bed')}
            </p>
          )}
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
            {...(canEdit
              ? {
                  onEditRoom: handleRoomEdit,
                  onAssignGuestToRoom: assignGuestToRoom,
                  onMoveAssignmentToRoom: moveAssignmentToRoom,
                }
              : {})}
          />
        </>
      )}

      {/* Floating Action Button for mobile */}
      {canEdit && (
        <Button
          onClick={handleAddRoom}
          size="lg"
          className={cn(
            'fixed bottom-nav-safe right-4 z-10',
            'size-14 rounded-full shadow-lg',
            'sm:hidden',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
          aria-label={t('rooms.new')}
        >
          <Plus className="size-6" aria-hidden="true" />
        </Button>
      )}

      {/* Room Create/Edit Dialog */}
      <RoomDialog
        roomId={editingRoomId}
        open={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
      />

      {/* The suggested allocation, for review before anything is written */}
      <AllocationSuggestionDialog
        open={isSuggestionOpen}
        onOpenChange={setIsSuggestionOpen}
        stays={suggestedStays}
        rooms={rooms}
        persons={persons}
        assignments={assignments}
        onApply={applySuggestedStays}
      />

      {/* Quick Assignment Dialog (for drag-drop) */}
      <QuickAssignmentDialog
        open={quickAssignDialogOpen}
        onOpenChange={handleQuickAssignDialogClose}
        person={quickAssignData.person}
        roomId={quickAssignData.roomId}
        {...(quickAssignData.person === null && selfPersonId !== undefined
          ? { suggestedPersonId: selfPersonId }
          : {})}
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
