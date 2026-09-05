/**
 * @fileoverview Event Detail Dialog for displaying calendar event information.
 * Shows detailed view of room assignments, transports or activities with
 * edit/delete actions.
 *
 * @module features/calendar/components/EventDetailDialog
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Locale, differenceInDays, format, parseISO } from 'date-fns';
import {
  Calendar,
  Clock,
  MapPin,
  Moon,
  Pencil,
  Trash2,
  User,
  Users,
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
import { statusVariants } from '@/components/ui/status.variants';
import { Separator } from '@/components/ui/separator';
import { ActivityCategoryIcon } from '@/components/shared/ActivityCategoryIcon';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { TransportIcon } from '@/components/shared/TransportIcon';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { getRoomIconComponent } from '@/components/shared/RoomIconPicker';
import { formatTransportDatetimeParts } from '@/lib/utils/datetime-format';
import { DirectionsButton } from '@/features/transports/components/DirectionsButton';
import {
  formatActivityDayRange,
  formatActivityTimeRange,
} from '@/features/activities/utils/activity-utils';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { getActivityCategoryColor } from '@/types';
import type {
  Activity,
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
  /** Arrivals/departures shown on the timeline stay pill */
  readonly relatedTransports?: readonly Transport[];
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
 * Event data for activity display.
 */
export interface ActivityEventData {
  readonly type: 'activity';
  readonly activity: Activity;
  /** Guests signed up, resolved from the person list */
  readonly participants: readonly Person[];
  /** The guest leading the activity, when set */
  readonly organizer?: Person | undefined;
}

/**
 * Union type for all calendar event data.
 */
export type CalendarEventData =
  | AssignmentEventData
  | TransportEventData
  | ActivityEventData;

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
 * Type guard to check if event is an activity.
 */
function isActivityEvent(event: CalendarEventData): event is ActivityEventData {
  return event.type === 'activity';
}

// ============================================================================
// AssignmentDetails Subcomponent
// ============================================================================

interface AssignmentDetailsProps {
  readonly event: AssignmentEventData;
  readonly dateLocale: Locale;
}

/**
 * Displays details for a room assignment event.
 */
const AssignmentDetails = memo(function AssignmentDetails({ event, dateLocale }: AssignmentDetailsProps) {
  const { t } = useTranslation();
  const { assignment, person, room, relatedTransports } = event;

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
          {t('calendar.nights', {
            count: nights,
            defaultValue_one: '{{count}} night',
            defaultValue_other: '{{count}} nights',
          })}
        </span>
      </div>

      {relatedTransports && relatedTransports.length > 0 ? (
        <>
          <Separator />
          <div className="space-y-3">
            <h3 className="text-sm font-medium">{t('calendar.relatedTravel', 'Travel')}</h3>
            {relatedTransports.map((tr) => {
              const { date: formattedDate, time: formattedTime } =
                formatTransportDatetimeParts(tr.datetime, dateLocale, 'fullDayAndTime');
              const mode = tr.transportMode ?? 'other';
              const modeLabel = t(`transports.modes.${mode}`);

              return (
                <div
                  key={tr.id}
                  className="space-y-2 rounded-md border border-border bg-muted/30 p-3"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={tr.type === 'arrival' ? 'default' : 'secondary'}
                      className={statusVariants({ tone: tr.type })}
                    >
                      {tr.type === 'arrival' ? '↓' : '↑'}{' '}
                      {tr.type === 'arrival'
                        ? t('transports.arrival', 'Arrival')
                        : t('transports.departure', 'Departure')}
                    </Badge>
                    <span className="text-sm font-medium tabular-nums">{formattedTime}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="size-3.5 shrink-0" aria-hidden="true" />
                    <span>{formattedDate}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <TransportIcon mode={mode} className="size-3.5 shrink-0 text-muted-foreground" />
                    <span>
                      {modeLabel}
                      {tr.transportNumber ? ` — ${tr.transportNumber}` : ''}
                    </span>
                  </div>
                  {tr.location ? (
                    <div className="flex items-start gap-2 text-sm">
                      <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span>{tr.location}</span>
                    </div>
                  ) : null}
                  {tr.coordinates ? (
                    <DirectionsButton
                      coordinates={tr.coordinates}
                      locationName={tr.location}
                      variant="outline"
                      size="sm"
                      className="w-full"
                    />
                  ) : null}
                  {tr.notes ? (
                    <p className="text-xs text-muted-foreground">{tr.notes}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
});

// ============================================================================
// TransportDetails Subcomponent
// ============================================================================

interface TransportDetailsProps {
  readonly event: TransportEventData;
  readonly dateLocale: Locale;
}

/**
 * Displays details for a transport event.
 */
const TransportDetails = memo(function TransportDetails({ event, dateLocale }: TransportDetailsProps) {
  const { t } = useTranslation();
  const { transport, person, driver } = event;

  // Render the stored instant the same way every other surface does
  const { date: formattedDate, time: formattedTime } = formatTransportDatetimeParts(
    transport.datetime,
    dateLocale,
    'fullDayAndTime',
  );

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
// ActivityDetails Subcomponent
// ============================================================================

interface ActivityDetailsProps {
  readonly event: ActivityEventData;
  readonly dateLocale: Locale;
}

/**
 * Displays details for an activity: when, where, and who is coming.
 */
const ActivityDetails = memo(function ActivityDetails({
  event,
  dateLocale,
}: ActivityDetailsProps) {
  const { t } = useTranslation();
  const { activity, participants, organizer } = event;

  const categoryColor = getActivityCategoryColor(activity.category);
  const dayRange = formatActivityDayRange(activity, dateLocale);
  const timeRange = formatActivityTimeRange(activity, dateLocale);

  const participantCount = activity.participantIds?.length ?? 0;
  const cap = activity.maxParticipants;

  return (
    <div className="space-y-4">
      {/* Category */}
      <div className="flex items-center gap-3">
        <ActivityCategoryIcon
          category={activity.category}
          style={{ color: categoryColor }}
        />
        <span className="text-sm">{t(`activities.categories.${activity.category}`)}</span>
      </div>

      {/* Day */}
      <div className="flex items-center gap-3">
        <Calendar className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <span className="text-sm">{dayRange}</span>
      </div>

      {/* Time */}
      <div className="flex items-center gap-3">
        <Clock className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <span className="text-sm">
          {activity.allDay ? t('activities.allDay') : timeRange}
        </span>
      </div>

      {/* Location */}
      {activity.location && (
        <div className="flex items-center gap-3">
          <MapPin className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
          <span className="text-sm">{activity.location}</span>
        </div>
      )}

      {/* Get Directions */}
      {activity.coordinates && (
        <DirectionsButton
          coordinates={activity.coordinates}
          locationName={activity.location ?? activity.title}
          variant="outline"
          size="sm"
          className="w-full"
        />
      )}

      {/* Participants */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Users className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
          <span className="text-sm text-muted-foreground">
            {cap === undefined
              ? t('activities.participantCount', {
                  count: participantCount,
                  defaultValue_one: '{{count}} participant',
                  defaultValue_other: '{{count}} participants',
                })
              : `${participantCount}/${cap}`}
          </span>
          {cap !== undefined && participantCount >= cap && (
            <Badge variant="outline" className={statusVariants({ tone: 'warning', emphasis: 'outline' })}>
              {t('activities.full')}
            </Badge>
          )}
        </div>
        {participants.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pl-7">
            {participants.map((person) => (
              <PersonBadge key={person.id} person={person} size="sm" />
            ))}
          </div>
        ) : (
          <p className="pl-7 text-sm text-muted-foreground">
            {t('activities.noParticipants', 'Nobody has signed up yet')}
          </p>
        )}
      </div>

      {/* Organizer */}
      {organizer && (
        <div className="flex items-center gap-3">
          <User className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
          <span className="text-sm text-muted-foreground">
            {t('activities.organizer')}:
          </span>
          <PersonBadge person={organizer} size="sm" />
        </div>
      )}

      {/* Notes */}
      {activity.notes && (
        <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
          {activity.notes}
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
    if (isActivityEvent(event)) {
      return event.activity.title;
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
                  className={statusVariants({ tone: event.transport.type })}
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
            ) : isActivityEvent(event) ? (
              <ActivityDetails event={event} dateLocale={dateLocale} />
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
              className="flex-1 sm:flex-none h-11 md:h-8"
            >
              <Pencil className="size-4 mr-2" aria-hidden="true" />
              {t('common.edit')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteClick}
              className="flex-1 sm:flex-none h-11 md:h-8"
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
            ? t('confirm.removeAssignment')
            : isActivityEvent(event)
              ? t('confirm.deleteActivity')
              : t('confirm.deleteTransport')
        }
        description={
          isAssignmentEvent(event)
            ? t('confirm.removeAssignmentDescription')
            : isActivityEvent(event)
              ? t('confirm.deleteActivityDescription')
              : t('confirm.deleteTransportDescription')
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

export { EventDetailDialog, isActivityEvent, isAssignmentEvent, isTransportEvent };
