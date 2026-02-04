/**
 * @fileoverview Event Detail Dialog for displaying calendar event information.
 * Shows detailed view of room assignments or transports with edit/delete actions.
 *
 * @module features/calendar/components/EventDetailDialog
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { differenceInDays, format, parseISO } from 'date-fns';
import { enUS, fr } from 'date-fns/locale';
import {
  Calendar,
  Clock,
  MapPin,
  Moon,
  Pencil,
  Trash2,
  User,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { TransportIcon } from '@/components/shared/TransportIcon';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { getRoomIconComponent } from '@/components/shared/RoomIconPicker';
import { DirectionsButton } from '@/features/transports/components/DirectionsButton';
import type {
  Person,
  Room,
  RoomAssignment,
  Transport,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Event data for room assignment display.
 */
export interface AssignmentEventData {
  readonly type: 'assignment';
  readonly assignment: RoomAssignment;
  readonly person: Person | undefined;
  readonly room: Room | undefined;
}

/**
 * Event data for transport display.
 */
export interface TransportEventData {
  readonly type: 'transport';
  readonly transport: Transport;
  readonly person: Person | undefined;
  readonly driver?: Person | undefined;
}

/**
 * Union type for all calendar event data.
 */
export type CalendarEventData = AssignmentEventData | TransportEventData;

/**
 * Props for the EventDetailDialog component.
 */
export interface EventDetailDialogProps {
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback to change the open state */
  readonly onOpenChange: (open: boolean) => void;
  /** The event to display (null when dialog is closed) */
  readonly event: CalendarEventData | null;
  /** Callback when edit is clicked */
  readonly onEdit: () => void;
  /** Callback when delete is confirmed */
  readonly onDelete: () => Promise<void>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Type guard to check if event is a room assignment.
 */
function isAssignmentEvent(event: CalendarEventData): event is AssignmentEventData {
  return event.type === 'assignment';
}

/**
 * Type guard to check if event is a transport.
 */
function isTransportEvent(event: CalendarEventData): event is TransportEventData {
  return event.type === 'transport';
}

/**
 * Gets the date-fns locale based on the i18n language.
 */
function getDateLocale(language: string) {
  return language === 'fr' ? fr : enUS;
}

// ============================================================================
// AssignmentDetails Subcomponent
// ============================================================================

interface AssignmentDetailsProps {
  readonly event: AssignmentEventData;
  readonly dateLocale: ReturnType<typeof getDateLocale>;
}

/**
 * Displays details for a room assignment event.
 */
const AssignmentDetails = memo(function AssignmentDetails({ event, dateLocale }: AssignmentDetailsProps) {
  const { t } = useTranslation();
  const { assignment, person, room } = event;

  // Parse dates for formatting
  const startDate = parseISO(assignment.startDate);
  const endDate = parseISO(assignment.endDate);
  
  // Calculate duration (nights stayed = days between dates)
  const nights = differenceInDays(endDate, startDate);
  
  // Format dates
  const formattedStart = format(startDate, 'PPP', { locale: dateLocale });
  const formattedEnd = format(endDate, 'PPP', { locale: dateLocale });
  
  // Get room icon element - memoized to prevent re-renders when room doesn't change
  const roomIconElement = useMemo(() => {
    const IconComponent = getRoomIconComponent(room?.icon);
    return <IconComponent className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />;
  }, [room?.icon]);

  return (
    <div className="space-y-4">
      {/* Guest */}
      <div className="flex items-center gap-3">
        <User className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          {person ? (
            <PersonBadge person={person} size="default" />
          ) : (
            <span className="text-muted-foreground">{t('common.unknown')}</span>
          )}
        </div>
      </div>

      {/* Room */}
      <div className="flex items-center gap-3">
        {roomIconElement}
        <span className="text-sm">
          {room?.name ?? t('common.unknown')}
        </span>
      </div>

      {/* Date Range */}
      <div className="flex items-center gap-3">
        <Calendar className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <span className="text-sm">
          {formattedStart} → {formattedEnd}
        </span>
      </div>

      {/* Duration */}
      <div className="flex items-center gap-3">
        <Moon className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <span className="text-sm">
          {t('calendar.nights', '{{count}} night', { count: nights })}
          {nights !== 1 && 's'}
        </span>
      </div>
    </div>
  );
});

// ============================================================================
// TransportDetails Subcomponent
// ============================================================================

interface TransportDetailsProps {
  readonly event: TransportEventData;
  readonly dateLocale: ReturnType<typeof getDateLocale>;
}

/**
 * Displays details for a transport event.
 */
const TransportDetails = memo(function TransportDetails({ event, dateLocale }: TransportDetailsProps) {
  const { t } = useTranslation();
  const { transport, person, driver } = event;

  // Parse and format datetime
  const datetime = parseISO(transport.datetime);
  const formattedDate = format(datetime, 'PPP', { locale: dateLocale });
  const formattedTime = format(datetime, 'HH:mm', { locale: dateLocale });

  // Transport mode and number
  const transportMode = transport.transportMode ?? 'other';
  const modeLabel = t(`transports.modes.${transportMode}`);

  return (
    <div className="space-y-4">
      {/* Guest */}
      <div className="flex items-center gap-3">
        <User className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          {person ? (
            <PersonBadge person={person} size="default" />
          ) : (
            <span className="text-muted-foreground">{t('common.unknown')}</span>
          )}
        </div>
      </div>

      {/* Transport Mode */}
      <div className="flex items-center gap-3">
        <TransportIcon mode={transportMode} className="size-4 text-muted-foreground shrink-0" />
        <span className="text-sm">
          {modeLabel}
          {transport.transportNumber && ` - ${transport.transportNumber}`}
        </span>
      </div>

      {/* Date and Time */}
      <div className="flex items-center gap-3">
        <Calendar className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <span className="text-sm">{formattedDate}</span>
      </div>

      <div className="flex items-center gap-3">
        <Clock className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <span className="text-sm">{formattedTime}</span>
      </div>

      {/* Location */}
      {transport.location && (
        <div className="flex items-center gap-3">
          <MapPin className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
          <span className="text-sm">{transport.location}</span>
        </div>
      )}

      {/* Get Directions */}
      {transport.coordinates && (
        <DirectionsButton
          coordinates={transport.coordinates}
          locationName={transport.location}
          variant="outline"
          size="sm"
          className="w-full"
        />
      )}

      {/* Driver */}
      {driver && (
        <div className="flex items-center gap-3">
          <User className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
          <span className="text-sm text-muted-foreground">{t('transports.driver')}:</span>
          <PersonBadge person={driver} size="sm" />
        </div>
      )}

      {/* Pickup Status */}
      {transport.needsPickup && (
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-xs">
            {t('transports.needsPickup')}
          </Badge>
        </div>
      )}

      {/* Notes */}
      {transport.notes && (
        <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3">
          {transport.notes}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

/**
 * Dialog component for displaying calendar event details.
 *
 * Features:
 * - Shows detailed information for room assignments or transports
 * - Edit and Delete action buttons
 * - Confirmation dialog before delete
 * - Accessible with proper ARIA attributes
 *
 * @param props - Component props
 * @returns The event detail dialog element
 *
 * @example
 * ```tsx
 * <EventDetailDialog
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   event={selectedEvent}
 *   onEdit={handleEdit}
 *   onDelete={handleDelete}
 * />
 * ```
 */
const EventDetailDialog = memo(function EventDetailDialog({
  open,
  onOpenChange,
  event,
  onEdit,
  onDelete,
}: EventDetailDialogProps) {
  const { t, i18n } = useTranslation();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Get date locale for formatting
  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  // Determine dialog title based on event type
  const dialogTitle = useMemo(() => {
    if (!event) return '';
    if (isAssignmentEvent(event)) {
      return t('assignments.title', 'Room Assignment');
    }
    return event.transport.type === 'arrival'
      ? t('transports.arrival', 'Arrival')
      : t('transports.departure', 'Departure');
  }, [event, t]);

  // Handle edit click
  const handleEditClick = useCallback(() => {
    onEdit();
    onOpenChange(false);
  }, [onEdit, onOpenChange]);

  // Handle delete click - opens confirmation
  const handleDeleteClick = useCallback(() => {
    setIsDeleteDialogOpen(true);
  }, []);

  // Handle confirmed delete
  const handleConfirmDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await onDelete();
      setIsDeleteDialogOpen(false);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to delete:', error);
    } finally {
      setIsDeleting(false);
    }
  }, [onDelete, onOpenChange]);

  // Handle delete dialog close
  const handleDeleteDialogOpenChange = useCallback((open: boolean) => {
    if (!isDeleting) {
      setIsDeleteDialogOpen(open);
    }
  }, [isDeleting]);

  // Early return if no event
  if (!event) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('common.loading')}</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isTransportEvent(event) && (
                <Badge
                  variant={event.transport.type === 'arrival' ? 'default' : 'secondary'}
                  className={event.transport.type === 'arrival' 
                    ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400'
                    : 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400'
                  }
                >
                  {event.transport.type === 'arrival' ? '↓' : '↑'}
                </Badge>
              )}
              {dialogTitle}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t('calendar.eventDetails', 'Event details')}
            </DialogDescription>
          </DialogHeader>

          <Separator />

          {/* Event Details */}
          <div className="py-2">
            {isAssignmentEvent(event) ? (
              <AssignmentDetails event={event} dateLocale={dateLocale} />
            ) : (
              <TransportDetails event={event} dateLocale={dateLocale} />
            )}
          </div>

          <Separator />

          {/* Action Buttons */}
          <DialogFooter className="flex-row gap-2 sm:justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={handleEditClick}
              className="flex-1 sm:flex-none"
            >
              <Pencil className="size-4 mr-2" aria-hidden="true" />
              {t('common.edit')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteClick}
              className="flex-1 sm:flex-none"
            >
              <Trash2 className="size-4 mr-2" aria-hidden="true" />
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={handleDeleteDialogOpenChange}
        title={
          isAssignmentEvent(event)
            ? t('assignments.deleteConfirmTitle', 'Delete assignment?')
            : t('transports.deleteConfirmTitle', 'Delete transport?')
        }
        description={
          isAssignmentEvent(event)
            ? t('assignments.deleteConfirm', 'Are you sure you want to delete this assignment?')
            : t('transports.deleteConfirm', 'Are you sure you want to delete this transport?')
        }
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

export { EventDetailDialog, isAssignmentEvent, isTransportEvent };
