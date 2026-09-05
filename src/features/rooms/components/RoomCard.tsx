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
import { ChevronDown, MoreHorizontal, Pencil, Trash2, Users } from 'lucide-react';
import { getRoomIconComponent } from '@/components/shared/RoomIconPicker';

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
import { statusVariants } from '@/components/ui/status.variants';
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
  /** Peak occupancy across the selected date range */
  readonly peakOccupancy: number;
  /** Available spots (capacity - peakOccupancy) */
  readonly availableSpots: number;
  /** Whether the room is at or over capacity */
  readonly isFull: boolean;
  /** Whether the card interaction is currently disabled */
  readonly isDisabled?: boolean;
  /** Whether the card is currently expanded (controlled mode) */
  readonly isExpanded?: boolean;
  /** Callback when the card body is clicked - toggles expansion */
  readonly onClick?: (room: Room) => void;
  /** Callback when Edit is selected from the menu, or the name is double-clicked */
  readonly onEdit: (room: Room) => void;
  /** Callback when Delete is confirmed. Can be async. */
  readonly onDelete: (room: Room) => void | Promise<void>;
  /** Callback when "Claim this room" is clicked */
  readonly onClaim?: (room: Room) => void;
  /** Content to render when expanded (typically RoomAssignmentSection) */
  readonly expandedContent?: ReactNode;
}

// ============================================================================
// Helper Functions
// ============================================================================

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
 * - Double-click on the room name as a shortcut to the same Edit action
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
const RoomCard = memo(function RoomCard({
  room,
  occupants,
  peakOccupancy,
  availableSpots,
  isFull,
  isDisabled = false,
  isExpanded = false,
  onClick,
  onEdit,
  onDelete,
  onClaim,
  expandedContent,
}: RoomCardProps) {
  const { t } = useTranslation(),

  // State for delete confirmation dialog
   [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false),

  // ============================================================================
  // Derived Values
  // ============================================================================

  // Capacity progress ratio (0-1, capped at 1)
   capacityRatio = room.capacity > 0 ? Math.min(peakOccupancy / room.capacity, 1) : 0,

  // Progress bar color based on capacity usage
   progressColor = capacityRatio >= 1
    ? 'bg-destructive'
    : capacityRatio >= 0.5
      ? 'bg-warning'
      : 'bg-success',

  // Build aria-label for screen readers
   ariaLabel = useMemo(
    () =>
      [
        room.name,
        t('rooms.beds', { count: room.capacity }),
        t('rooms.spotsTaken', { occupied: peakOccupancy, capacity: room.capacity }),
      ].join(', '),
    [room.name, room.capacity, peakOccupancy, t]
  ),

  // Get the room icon component based on room.icon field
   RoomIconComponent = getRoomIconComponent(room.icon),

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
   * Opens the edit dialog on a double click on the room name — the same thing
   * the menu's Edit item does, two clicks earlier.
   *
   * The gesture also fires two ordinary clicks, which bubble to the card and
   * toggle the expansion twice, so the row is left as it was found. The menu
   * item stays the keyboard-reachable path: a double click has no keyboard
   * equivalent, so this can only ever be a shortcut on top of it.
   */
   handleNameDoubleClick = useCallback(() => {
    if (isDisabled) {return;}
    onEdit(room);
  }, [isDisabled, onEdit, room]),

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
        onClick={handleCardClick}
        className={cn(
          'relative transition-all duration-200',
          isInteractive && [
            'cursor-pointer',
            'hover:shadow-md hover:border-primary/20',
          ],
          isDisabled && 'opacity-50 cursor-not-allowed',
          isFull && 'opacity-75 bg-muted/30',
        )}
      >
        {/*
          The card's activation target, as a real button covering the card.

          The card used to carry `role="button"` itself, which made every
          control inside it — the menu trigger below, "claim this room" — a
          button nested in a button. That is not expressible in the
          accessibility tree (a button's children are presentational), so a
          screen reader announced one control where there were three, and it
          is why `nested-interactive` was disabled for the whole a11y suite.

          As a sibling laid over the card it keeps the whole-card hit area and
          the whole-card focus ring, while the menu and the claim button sit
          above it in the stacking order and stay reachable. It carries no
          click handler of its own: its click — including the synthetic one a
          keyboard Enter/Space produces — bubbles to the card's `onClick`,
          which is also what a click on the card's text does.
        */}
        {onClick && (
          <button
            type="button"
            tabIndex={isDisabled ? -1 : 0}
            aria-label={ariaLabel}
            aria-disabled={isDisabled || undefined}
            {...(expandedContent ? { 'aria-expanded': isExpanded } : {})}
            className={cn(
              'absolute inset-0 z-10 rounded-xl',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isDisabled && 'cursor-not-allowed',
            )}
          />
        )}

        {/* Dropdown Menu - positioned absolutely in top-right corner */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- The div has no behaviour of its own: the handlers only stop propagation so the full-card activation button underneath does not swallow a click meant for the menu. The interactive elements are the ones inside it. */}
        <div
          className="absolute top-2 right-2 z-20"
          onClick={handleMenuAreaClick}
          onKeyDown={handleMenuAreaKeyDown}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:size-8"
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
            {/*
              `relative z-20` is what makes the double click reachable at all:
              the full-card activation button above covers the header at z-10,
              so without it every pointer event on the name lands on the button
              instead. Lifting only the name keeps the rest of the card's hit
              area — and its focus ring — on that button.

              `select-none` because the second click of the gesture would
              otherwise leave the name highlighted behind the dialog it just
              opened.
            */}
            <CardTitle
              className="text-lg truncate relative z-20 select-none"
              title={`${room.name} — ${t('rooms.doubleClickToEdit')}`}
              onDoubleClick={handleNameDoubleClick}
            >
              {room.name}
            </CardTitle>
            <Badge variant="outline" className="shrink-0">
              <RoomIconComponent className="size-3 mr-1" aria-hidden="true" />
              {room.capacity}
            </Badge>
          </div>
          {room.description && (
            <CardDescription className="line-clamp-2" title={room.description}>
              {room.description}
            </CardDescription>
          )}
        </CardHeader>

        {/* Card Content - Capacity indicator and occupants */}
        <CardContent className="pb-2">
          {/* Visual Capacity Progress Bar */}
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Users className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm text-muted-foreground">
                {t('rooms.spotsTaken', { occupied: peakOccupancy, capacity: room.capacity })}
              </span>
              {isFull && (
                <Badge variant="destructive" className="text-xs">
                  {t('rooms.full')}
                </Badge>
              )}
            </div>
            {/* Progress bar */}
            <div
              className="h-2 w-full rounded-full bg-muted overflow-hidden"
              role="progressbar"
              aria-valuenow={peakOccupancy}
              aria-valuemin={0}
              aria-valuemax={room.capacity}
              aria-label={t('rooms.spotsTaken', { occupied: peakOccupancy, capacity: room.capacity })}
            >
              <div
                className={cn('h-full rounded-full transition-all duration-300', progressColor)}
                style={{ width: `${capacityRatio * 100}%` }}
              />
            </div>
            {availableSpots > 0 && (
              <p className={cn('text-xs mt-1', statusVariants({ tone: 'success', emphasis: 'text' }))}>
                {t('rooms.spotsOpen', { count: availableSpots })}
              </p>
            )}
          </div>

          {/* Current Occupants */}
          {occupants.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {occupants.map((person) => (
                <PersonBadge key={person.id} person={person} size="sm" />
              ))}
            </div>
          )}

          {/* Claim this room button */}
          {availableSpots > 0 && onClaim && (
            <Button
              variant="default"
              size="sm"
              // `relative z-20` lifts it above the full-card activation
              // button, which would otherwise swallow the click.
              className="relative z-20 w-full mt-3 h-11 md:h-8"
              disabled={isDisabled}
              onClick={(e) => {
                e.stopPropagation();
                onClaim(room);
              }}
            >
              {t('rooms.claimRoom')}
            </Button>
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
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- The div has no behaviour of its own: the handlers only stop propagation so the full-card activation button underneath does not swallow a click meant for the assignment controls. The interactive elements are the ones inside it.
          <div
            className="relative z-20 border-t px-4 py-4"
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
        title={t('confirm.deleteRoom')}
        description={t('confirm.deleteRoomDescription')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { RoomCard };
