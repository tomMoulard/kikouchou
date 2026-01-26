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
 *
 * @module features/rooms/pages/RoomListPage
 * @see TripListPage.tsx for reference implementation pattern
 */

import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, DoorOpen, Users, BedDouble } from 'lucide-react';

import { useTripContext } from '@/contexts/TripContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { LoadingState } from '@/components/shared/LoadingState';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Room, Person, RoomId } from '@/types';

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
  /** Number of current occupants */
  readonly occupancyCount: number;
  /** Whether the room is at or over capacity */
  readonly isAtCapacity: boolean;
}

/**
 * Props for the RoomCard component.
 */
interface RoomCardProps {
  /** Room with occupancy data */
  readonly roomData: RoomWithOccupancy;
  /** Callback when the room card is clicked */
  readonly onClick: (roomId: RoomId) => void;
  /** Whether interaction is disabled */
  readonly isDisabled?: boolean;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Checks if a reference date falls within a date range using string comparison.
 * ISO date strings (YYYY-MM-DD) sort lexicographically, making this efficient.
 *
 * @param startDate - Start date in ISO format (YYYY-MM-DD)
 * @param endDate - End date in ISO format (YYYY-MM-DD)
 * @param referenceDate - Reference date in ISO format (YYYY-MM-DD)
 * @returns True if referenceDate is within the range (inclusive)
 */
function isDateInRange(
  startDate: string,
  endDate: string,
  referenceDate: string,
): boolean {
  // Validate inputs are non-empty strings
  if (!startDate || !endDate || !referenceDate) {
    return false;
  }

  // ISO date strings (YYYY-MM-DD) can be compared lexicographically
  return startDate <= referenceDate && referenceDate <= endDate;
}

/**
 * Formats a Date object to ISO date string (YYYY-MM-DD).
 * Uses local timezone.
 *
 * @param date - The date to format
 * @returns ISO date string
 */
function formatToISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ============================================================================
// RoomCard Component
// ============================================================================

/**
 * Individual room card displaying room information and occupancy.
 * Supports click and keyboard interaction for accessibility.
 */
const RoomCard = memo(function RoomCard({
  roomData,
  onClick,
  isDisabled = false,
}: RoomCardProps): ReactElement {
  const { t } = useTranslation();
  const { room, currentOccupants, occupancyCount, isAtCapacity } = roomData;

  // Handle keyboard activation (Enter or Space)
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (isDisabled) return;

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick(room.id);
      }
    },
    [room.id, onClick, isDisabled],
  );

  // Handle click
  const handleClick = useCallback(() => {
    if (isDisabled) return;
    onClick(room.id);
  }, [room.id, onClick, isDisabled]);

  // Build aria-label for screen readers (direct computation - cheaper than useMemo overhead)
  const ariaLabel = `${room.name}, ${t('rooms.beds', { count: room.capacity })}, ${occupancyCount}/${room.capacity} ${t('rooms.occupied').toLowerCase()}`;

  // Determine occupancy status badge variant (trivial computation - no memoization needed)
  const occupancyVariant = occupancyCount === 0
    ? 'secondary'
    : isAtCapacity
      ? 'destructive'
      : 'default';

  return (
    <Card
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={isDisabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'cursor-pointer transition-all duration-200',
        'hover:shadow-md hover:border-primary/20',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isDisabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg truncate" title={room.name}>
            {room.name}
          </CardTitle>
          <Badge variant="outline" className="shrink-0">
            <BedDouble className="size-3 mr-1" aria-hidden="true" />
            {room.capacity}
          </Badge>
        </div>
        {room.description && (
          <CardDescription className="line-clamp-2" title={room.description}>
            {room.description}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="pb-2">
        {/* Occupancy Status */}
        <div className="flex items-center gap-2 mb-3">
          <Users className="size-4 text-muted-foreground" aria-hidden="true" />
          <Badge variant={occupancyVariant}>
            {occupancyCount} / {room.capacity}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {occupancyCount === 0 ? t('rooms.available') : t('rooms.occupied')}
          </span>
        </div>

        {/* Current Occupants */}
        {currentOccupants.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {currentOccupants.map((person) => (
              <PersonBadge key={person.id} person={person} size="sm" />
            ))}
          </div>
        )}
      </CardContent>

      <CardFooter className="pt-0">
        <p className="text-xs text-muted-foreground">
          {t('rooms.beds', { count: room.capacity })}
        </p>
      </CardFooter>
    </Card>
  );
});

RoomCard.displayName = 'RoomCard';

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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tripId: tripIdFromUrl } = useParams<'tripId'>();

  // Context hooks
  const { currentTrip, isLoading: isTripLoading } = useTripContext();
  const { rooms, isLoading: isRoomsLoading, error: roomsError } = useRoomContext();
  const { getAssignmentsByRoom } = useAssignmentContext();
  const { getPersonById } = usePersonContext();

  // Track if we're currently navigating to prevent double-clicks
  const isNavigatingRef = useRef(false);
  const [isNavigating, setIsNavigating] = useState(false);

  // Combined loading state
  const isLoading = isTripLoading || isRoomsLoading;

  // Validate tripId matches current trip
  const tripMismatch = useMemo(() => {
    if (!tripIdFromUrl || !currentTrip) return false;
    return tripIdFromUrl !== currentTrip.id;
  }, [tripIdFromUrl, currentTrip]);

  // Calculate today's date as ISO string (YYYY-MM-DD)
  // Note: This value is captured on mount. For long-running sessions past midnight,
  // users should refresh to get updated occupancy data.
  const todayStr = useMemo(() => formatToISODate(new Date()), []);

  // Calculate rooms with occupancy data
  const roomsWithOccupancy = useMemo((): readonly RoomWithOccupancy[] => {
    return rooms.map((room) => {
      // Get all assignments for this room
      const assignments = getAssignmentsByRoom(room.id);

      // Filter to assignments active today
      const activeAssignments = assignments.filter((assignment) =>
        isDateInRange(assignment.startDate, assignment.endDate, todayStr),
      );

      // Map person IDs to Person objects, filtering out any not found
      const currentOccupants = activeAssignments
        .map((assignment) => getPersonById(assignment.personId))
        .filter((person): person is Person => person !== undefined);

      const occupancyCount = currentOccupants.length;

      return {
        room,
        currentOccupants,
        occupancyCount,
        isAtCapacity: occupancyCount >= room.capacity,
      };
    });
  }, [rooms, getAssignmentsByRoom, getPersonById, todayStr]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles room card click - navigates to room detail/edit page.
   * Note: Navigation guard prevents double-clicks. State is NOT reset after navigation
   * because the component will typically unmount when navigating away.
   */
  const handleRoomClick = useCallback(
    (roomId: RoomId) => {
      if (isNavigatingRef.current) return;

      isNavigatingRef.current = true;
      setIsNavigating(true);

      // TODO: Navigate to room detail page when implemented
      // For now, navigate to a placeholder route
      navigate(`/trips/${tripIdFromUrl}/rooms/${roomId}/edit`);
      // Don't reset state - let component unmount naturally
    },
    [navigate, tripIdFromUrl],
  );

  /**
   * Handles add room button click.
   */
  const handleAddRoom = useCallback(() => {
    // TODO: Replace with RoomDialog when available (Task 6.4)
    // For now, navigate to room creation route
    navigate(`/trips/${tripIdFromUrl}/rooms/new`);
  }, [navigate, tripIdFromUrl]);

  /**
   * Handles back navigation.
   */
  const handleBack = useCallback(() => {
    navigate(`/trips/${tripIdFromUrl}/calendar`);
  }, [navigate, tripIdFromUrl]);

  // ============================================================================
  // Header Action (desktop button)
  // ============================================================================

  const headerAction = useMemo(
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
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4 min-h-[200px]">
          <div className="text-center">
            <p className="text-lg font-semibold text-destructive">
              {t('errors.loadingFailed')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {roomsError.message}
            </p>
          </div>
          <Button onClick={handleBack} variant="outline">
            {t('common.back')}
          </Button>
        </div>
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
        {roomsWithOccupancy.map((roomData) => (
          <div key={roomData.room.id} role="listitem">
            <RoomCard
              roomData={roomData}
              onClick={handleRoomClick}
              isDisabled={isNavigating}
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
    </div>
  );
});

RoomListPage.displayName = 'RoomListPage';

// ============================================================================
// Exports
// ============================================================================

export { RoomListPage };
export default RoomListPage;
