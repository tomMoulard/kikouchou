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
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DoorOpen, Plus } from 'lucide-react';

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
import { RoomCard } from '@/features/rooms/components/RoomCard';
import { RoomDialog } from '@/features/rooms/components/RoomDialog';
import { RoomAssignmentSection } from '@/features/rooms/components/RoomAssignmentSection';
import type { Person, Room, RoomId } from '@/types';

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
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Checks if a reference date falls within a room assignment's stay period.
 * Uses the "check-in / check-out" model:
 * - startDate = check-in day (first night)
 * - endDate = check-out day (person leaves, NOT a stay night)
 * 
 * ISO date strings (YYYY-MM-DD) sort lexicographically, making this efficient.
 *
 * @param startDate - Check-in date in ISO format (YYYY-MM-DD)
 * @param endDate - Check-out date in ISO format (YYYY-MM-DD)
 * @param referenceDate - Reference date in ISO format (YYYY-MM-DD)
 * @returns True if referenceDate is a night the person is staying (check-in <= ref < check-out)
 */
function isDateInStayRange(
  startDate: string,
  endDate: string,
  referenceDate: string,
): boolean {
  // Validate inputs are non-empty strings
  if (!startDate || !endDate || !referenceDate) {
    return false;
  }

  // Person stays from check-in (inclusive) to check-out (exclusive)
  // Example: check-in Jan 15, check-out Jan 17 → stays nights of Jan 15, Jan 16
  return startDate <= referenceDate && referenceDate < endDate;
}

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
const RoomListPage = memo((): ReactElement => {
  const { t } = useTranslation(),
   navigate = useNavigate(),
   { tripId: tripIdFromUrl } = useParams<'tripId'>(),

  // Context hooks
   { currentTrip, isLoading: isTripLoading, setCurrentTrip } = useTripContext(),
   {
    rooms,
    isLoading: isRoomsLoading,
    error: roomsError,
    deleteRoom,
  } = useRoomContext(),
   { getAssignmentsByRoom } = useAssignmentContext(),
   { getPersonById } = usePersonContext(),

  // Track if we're currently performing an action to prevent double-clicks
   isActionInProgressRef = useRef(false),
   [isActionInProgress] = useState(false),

  // Dialog state for create/edit room
   [isDialogOpen, setIsDialogOpen] = useState(false),
   [editingRoomId, setEditingRoomId] = useState<RoomId | undefined>(undefined),

  // Track which room is expanded to show assignments
   [expandedRoomId, setExpandedRoomId] = useState<RoomId | undefined>(undefined),

  // Combined loading state
   isLoading = isTripLoading || isRoomsLoading;

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

  // Calculate today's date as ISO string (YYYY-MM-DD)
  // Note: This value is captured on mount. For long-running sessions past midnight,
  // Users should refresh to get updated occupancy data.
   todayStr = useMemo(() => formatToISODate(new Date()), []),

  // Calculate rooms with occupancy data
   roomsWithOccupancy = useMemo((): readonly RoomWithOccupancy[] => rooms.map((room) => {
      // Get all assignments for this room
      const assignments = getAssignmentsByRoom(room.id),

      // Filter to assignments active today
       activeAssignments = assignments.filter((assignment) =>
        isDateInStayRange(assignment.startDate, assignment.endDate, todayStr),
      ),

      // Map person IDs to Person objects, filtering out any not found
       currentOccupants = activeAssignments
        .map((assignment) => getPersonById(assignment.personId))
        .filter((person): person is Person => person !== undefined);

      return {
        room,
        currentOccupants,
      };
    }), [rooms, getAssignmentsByRoom, getPersonById, todayStr]),

  // ============================================================================
  // Event Handlers
  // ============================================================================

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
        toast.success(t('rooms.deleteSuccess', 'Room deleted successfully'));
      } catch (error) {
        console.error('Failed to delete room:', error);
        toast.error(t('errors.deleteFailed', 'Failed to delete room'));
        throw error; // Re-throw to keep ConfirmDialog open for retry
      }
    },
    [deleteRoom, t],
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
    <div className="container max-w-4xl py-6 md:py-8">
      <PageHeader
        title={t('rooms.title')}
        backLink={`/trips/${tripIdFromUrl}/calendar`}
        action={headerAction}
      />

      {/* Room grid */}
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
        {roomsWithOccupancy.map(({ room, currentOccupants }) => (
          <div key={room.id} role="listitem">
            <RoomCard
              room={room}
              occupants={currentOccupants}
              onClick={handleRoomClick}
              onEdit={handleRoomEdit}
              onDelete={handleRoomDelete}
              isDisabled={isActionInProgress}
              isExpanded={expandedRoomId === room.id}
              expandedContent={
                <RoomAssignmentSection
                  roomId={room.id}
                  variant="compact"
                />
              }
            />
          </div>
        ))}
      </div>

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
    </div>
  );
});

RoomListPage.displayName = 'RoomListPage';

// ============================================================================
// Exports
// ============================================================================

export { RoomListPage };
export default RoomListPage;
