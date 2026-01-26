/**
 * @fileoverview Reusable Room Card component with dropdown menu actions.
 * Displays room information, occupancy status, and current occupants
 * with Edit/Delete actions in a dropdown menu.
 *
 * @module features/rooms/components/RoomCard
 */

import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { BedDouble, ChevronDown, MoreHorizontal, Pencil, Trash2, Users } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { cn } from '@/lib/utils';
import type { Person, Room } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the RoomCard component.
 */
export interface RoomCardProps {
  /** The room to display */
  readonly room: Room;
  /** Current occupants (persons assigned for today's date) */
  readonly occupants: readonly Person[];
  /** Whether the card interaction is currently disabled */
  readonly isDisabled?: boolean;
  /** Whether the card is currently expanded (controlled mode) */
  readonly isExpanded?: boolean;
  /** Callback when the card body is clicked - toggles expansion */
  readonly onClick?: (room: Room) => void;
  /** Callback when Edit is selected from the menu */
  readonly onEdit: (room: Room) => void;
  /** Callback when Delete is confirmed. Can be async. */
  readonly onDelete: (room: Room) => void | Promise<void>;
  /** Content to render when expanded (typically RoomAssignmentSection) */
  readonly expandedContent?: ReactNode;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determines the badge variant based on occupancy status.
 *
 * @param occupancyCount - Current number of occupants
 * @param capacity - Room capacity
 * @returns Badge variant: 'secondary' (empty), 'default' (under), 'destructive' (at/over)
 */
function getOccupancyBadgeVariant(
  occupancyCount: number,
  capacity: number,
): 'secondary' | 'default' | 'destructive' {
  if (occupancyCount === 0) {return 'secondary';}
  if (occupancyCount >= capacity) {return 'destructive';}
  return 'default';
}

// ============================================================================
// Component
// ============================================================================

/**
 * A reusable room card component with dropdown menu actions.
 *
 * Features:
 * - Displays room name, capacity, description (truncated), and current occupants
 * - Shows real-time occupancy status with color-coded badge
 * - Dropdown menu with Edit and Delete actions
 * - Delete confirmation via ConfirmDialog
 * - Full keyboard accessibility (Enter/Space to activate card)
 * - Event propagation control (menu clicks don't trigger card click)
 * - Disabled state support during async operations
 *
 * @param props - Component props
 * @returns The room card element
 *
 * @example
 * ```tsx
 * <RoomCard
 *   room={room}
 *   occupants={currentOccupants}
 *   onClick={(room) => navigate(`/trips/${tripId}/rooms/${room.id}`)}
 *   onEdit={(room) => navigate(`/trips/${tripId}/rooms/${room.id}/edit`)}
 *   onDelete={async (room) => await deleteRoom(room.id)}
 * />
 * ```
 */
const RoomCard = memo(({
  room,
  occupants,
  isDisabled = false,
  isExpanded = false,
  onClick,
  onEdit,
  onDelete,
  expandedContent,
}: RoomCardProps) => {
  const { t } = useTranslation(),

  // State for delete confirmation dialog
   [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false),

  // ============================================================================
  // Derived Values
  // ============================================================================

   occupancyCount = occupants.length,

  // Determine occupancy badge variant (trivial O(1) computation - no memoization needed)
   occupancyVariant = getOccupancyBadgeVariant(occupancyCount, room.capacity),

  // Occupancy status text
   occupancyStatusText = occupancyCount === 0
    ? t('rooms.available')
    : t('rooms.occupied'),

  // Build aria-label for screen readers
   ariaLabel = useMemo(
    () =>
      [
        room.name,
        t('rooms.beds', { count: room.capacity }),
        `${occupancyCount}/${room.capacity} ${occupancyStatusText.toLowerCase()}`,
      ].join(', '),
    [room.name, room.capacity, occupancyCount, occupancyStatusText, t]
  ),

  // Determine if card should be interactive (has onClick handler)
   isInteractive = Boolean(onClick) && !isDisabled,

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles card click - triggers onClick if interactive.
   */
   handleCardClick = useCallback(() => {
    if (!isInteractive) {return;}
    onClick?.(room);
  }, [onClick, room, isInteractive]),

  /**
   * Handles keyboard activation (Enter or Space) on the card.
   */
   handleCardKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!isInteractive) {return;}

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick?.(room);
      }
    },
    [onClick, room, isInteractive],
  ),

  /**
   * Stops event propagation to prevent card click when interacting with menu.
   */
   handleMenuAreaClick = useCallback((e: MouseEvent) => {
    e.stopPropagation();
  }, []),

  /**
   * Stops keyboard event propagation in menu area.
   */
   handleMenuAreaKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      e.stopPropagation();
    },
    [],
  ),

  /**
   * Handles Edit menu item click.
   */
   handleEditClick = useCallback(() => {
    onEdit(room);
  }, [onEdit, room]),

  /**
   * Opens the delete confirmation dialog.
   */
   handleDeleteClick = useCallback(() => {
    setIsDeleteDialogOpen(true);
  }, []),

  /**
   * Handles delete confirmation - calls onDelete callback.
   */
   handleConfirmDelete = useCallback(async () => {
    await onDelete(room);
  }, [onDelete, room]),

  /**
   * Handles delete dialog open state change.
   */
   handleDeleteDialogOpenChange = useCallback((open: boolean) => {
    setIsDeleteDialogOpen(open);
  }, []);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <>
      <Card
        role={isInteractive ? 'button' : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        aria-label={isInteractive ? ariaLabel : undefined}
        aria-disabled={isDisabled || undefined}
        onClick={handleCardClick}
        onKeyDown={isInteractive ? handleCardKeyDown : undefined}
        className={cn(
          'relative transition-all duration-200',
          isInteractive && [
            'cursor-pointer',
            'hover:shadow-md hover:border-primary/20',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          ],
          isDisabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        {/* Dropdown Menu - positioned absolutely in top-right corner */}
        <div
          className="absolute top-2 right-2 z-10"
          onClick={handleMenuAreaClick}
          onKeyDown={handleMenuAreaKeyDown}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 md:size-8"
                aria-label={t('common.openMenu', 'Open menu')}
                disabled={isDisabled}
              >
                <MoreHorizontal className="size-5 md:size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={handleEditClick}>
                <Pencil className="mr-2 size-4" aria-hidden="true" />
                {t('common.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={handleDeleteClick}
              >
                <Trash2 className="mr-2 size-4" aria-hidden="true" />
                {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Card Header - Room name and capacity badge */}
        <CardHeader className="pb-2 pr-12">
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

        {/* Card Content - Occupancy status and occupants */}
        <CardContent className="pb-2">
          {/* Occupancy Status */}
          <div className="flex items-center gap-2 mb-3">
            <Users className="size-4 text-muted-foreground" aria-hidden="true" />
            <Badge variant={occupancyVariant}>
              {occupancyCount} / {room.capacity}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {occupancyStatusText}
            </span>
          </div>

          {/* Current Occupants */}
          {occupants.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {occupants.map((person) => (
                <PersonBadge key={person.id} person={person} size="sm" />
              ))}
            </div>
          )}
        </CardContent>

        {/* Card Footer - Beds count and expand indicator */}
        <CardFooter className="pt-0 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {t('rooms.beds', { count: room.capacity })}
          </p>
          {expandedContent && (
            <ChevronDown
              className={cn(
                'size-4 text-muted-foreground transition-transform duration-200',
                isExpanded && 'rotate-180',
              )}
              aria-hidden="true"
            />
          )}
        </CardFooter>

        {/* Expanded Content (e.g., RoomAssignmentSection) */}
        {expandedContent && isExpanded && (
          <div
            className="border-t px-4 py-4"
            onClick={handleMenuAreaClick}
            onKeyDown={handleMenuAreaKeyDown}
          >
            {expandedContent}
          </div>
        )}
      </Card>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={handleDeleteDialogOpenChange}
        title={t('rooms.deleteConfirmTitle', 'Delete room?')}
        description={t('rooms.deleteConfirm', 'Are you sure you want to delete this room? This action cannot be undone.')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
});

RoomCard.displayName = 'RoomCard';

// ============================================================================
// Exports
// ============================================================================

export { RoomCard };
