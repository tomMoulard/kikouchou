/**
 * @fileoverview Person List Page - Displays and manages trip participants.
 * Shows persons as cards with their color indicator and transport summary.
 *
 * Route: /trips/:tripId/persons
 *
 * Features:
 * - Lists persons as cards in responsive grid
 * - Shows person color indicator and name
 * - Displays stay dates, assigned room(s), and arrival/departure transport summary
 * - Add person action (FAB on mobile, header button on desktop)
 * - Empty state for trips with no persons
 *
 * @module features/persons/pages/PersonListPage
 * @see RoomListPage.tsx for reference implementation pattern
 */

import {
  type KeyboardEvent,
  type MouseEvent,
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
import { type Locale, format, parseISO } from 'date-fns';
import { ArrowDownRight, ArrowUpRight, Plus, Trash2, Users } from 'lucide-react';

import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useTripContext } from '@/contexts/TripContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useOfflineAwareToast } from '@/hooks';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { Button } from '@/components/ui/button';
import { statusVariants } from '@/components/ui/status.variants';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import { formatTransportDatetimeParts } from '@/lib/utils/datetime-format';
import { PersonDialog } from '@/features/persons/components/PersonDialog';
import { getPersonHeadcount } from '@/types';
import type { Person, PersonId, TransportMode } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Transport summary for a person.
 */
interface TransportSummary {
  /** Arrival transport info, if any */
  readonly arrival: {
    readonly datetime: string;
    readonly location: string;
    readonly transportMode?: TransportMode;
  } | null;
  /** Departure transport info, if any */
  readonly departure: {
    readonly datetime: string;
    readonly location: string;
    readonly transportMode?: TransportMode;
  } | null;
}

/**
 * Props for the PersonCard component.
 */
interface PersonCardProps {
  /** The person to display */
  readonly person: Person;
  /** Transport summary for the person */
  readonly transportSummary: TransportSummary;
  /** Formatted stay range from guest dates (e.g. "7 Apr – 26 Apr") */
  readonly stayRangeLabel?: string;
  /** Comma-separated room names from trip assignments (any dates) */
  readonly roomsDisplay?: string;
  /** Callback when the card is clicked */
  readonly onClick: (personId: PersonId) => void;
  /** Callback when delete action is clicked */
  readonly onDelete: (personId: PersonId) => void;
  /** Whether interaction is disabled */
  readonly isDisabled?: boolean;
  /** Date locale for formatting */
  readonly dateLocale: Locale;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Formats guest stay dates for the card (check-out day exclusive in storage, shown as end date).
 */
function formatPersonStayRangeLabel(
  person: Person,
  locale: Locale,
): string | undefined {
  if (!person.stayStartDate || !person.stayEndDate) {
    return undefined;
  }
  try {
    const start = parseISO(person.stayStartDate);
    const end = parseISO(person.stayEndDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      return undefined;
    }
    return `${format(start, 'd MMM', { locale })} – ${format(end, 'd MMM', { locale })}`;
  } catch {
    return undefined;
  }
}

// ============================================================================
// PersonCard Component
// ============================================================================

/**
 * Individual person card displaying name, color, and transport summary.
 */
const PersonCard = memo(function PersonCard({
  person,
  transportSummary,
  stayRangeLabel,
  roomsDisplay,
  onClick,
  onDelete,
  isDisabled = false,
  dateLocale,
}: PersonCardProps): ReactElement {
  const { t } = useTranslation(),

  // Handle keyboard activation (Enter or Space)
   handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (isDisabled) {return;}

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick(person.id);
      }
    },
    [person.id, onClick, isDisabled],
  ),

  // Handle click
   handleClick = useCallback(() => {
    if (isDisabled) {return;}
    onClick(person.id);
  }, [person.id, onClick, isDisabled]),
   handleDeleteClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (isDisabled) {
        return;
      }
      onDelete(person.id);
    },
    [isDisabled, onDelete, person.id],
  ),

  // Build aria-label for screen readers
   ariaLabel = useMemo(() => {
    const parts = [person.name];
    if (stayRangeLabel) {
      parts.push(`${t('persons.stayDates')}: ${stayRangeLabel}`);
    }
    if (roomsDisplay) {
      parts.push(`${t('assignments.room')}: ${roomsDisplay}`);
    }
    if (transportSummary.arrival) {
      const { full } = formatTransportDatetimeParts(transportSummary.arrival.datetime, dateLocale, 'dayAndTime');
      parts.push(`${t('transports.arrival')}: ${full}`);
    }
    if (transportSummary.departure) {
      const { full } = formatTransportDatetimeParts(transportSummary.departure.datetime, dateLocale, 'dayAndTime');
      parts.push(`${t('transports.departure')}: ${full}`);
    }
    const rawNotes = person.notes?.trim();
    if (rawNotes) {
      const excerpt = rawNotes.length > 160 ? `${rawNotes.slice(0, 160)}…` : rawNotes;
      parts.push(`${t('persons.notes')}: ${excerpt}`);
    }
    const headcount = getPersonHeadcount(person);
    if (headcount > 1) {
      parts.push(t('persons.headcountSummary', 'Counts as {{count}} people', { count: headcount }));
    }
    return parts.join(', ');
  }, [dateLocale, person, roomsDisplay, stayRangeLabel, transportSummary.departure, transportSummary.arrival, t]),

   hasTransportInfo = transportSummary.arrival || transportSummary.departure,
   trimmedNotes = person.notes?.trim() ?? '';

  // A guest entry can stand for several people (e.g. a couple under one name).
  const personHeadcount = getPersonHeadcount(person);
  const headcountLabel = t('persons.headcountSummary', 'Counts as {{count}} people', {
    count: personHeadcount,
  });

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
        <div className="flex items-center gap-3">
          {/* Color indicator */}
          <div
            className="size-4 rounded-full shrink-0 ring-1 ring-inset ring-black/10"
            style={{ backgroundColor: person.color }}
            aria-hidden="true"
          />
          <CardTitle className="text-lg truncate" title={person.name}>
            {person.name}
          </CardTitle>
          {personHeadcount > 1 && (
            <span
              className="shrink-0 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
              title={headcountLabel}
            >
              <Users className="size-3" aria-hidden="true" />
              <span className="tabular-nums">{personHeadcount}</span>
            </span>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="ml-auto size-8 text-muted-foreground hover:text-destructive"
            aria-label={t('common.delete')}
            onClick={handleDeleteClick}
            disabled={isDisabled}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-2">
        {stayRangeLabel && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{t('persons.stayDates')}</span>
            <span className="text-muted-foreground"> · {stayRangeLabel}</span>
          </p>
        )}
        {roomsDisplay && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{t('assignments.room')}</span>
            <span className="text-muted-foreground"> · {roomsDisplay}</span>
          </p>
        )}

        {hasTransportInfo ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            {/* Arrival info */}
            {transportSummary.arrival && (() => {
              const { full } = formatTransportDatetimeParts(transportSummary.arrival.datetime, dateLocale, 'dayAndTime');
              return (
                <div className="flex items-start gap-2 min-w-0">
                  <ArrowDownRight
                    className={cn('size-4 shrink-0', statusVariants({ tone: 'arrival', emphasis: 'text' }))}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-foreground tabular-nums">
                      {full}
                    </div>
                    <div className="text-muted-foreground truncate" title={transportSummary.arrival.location}>
                      {transportSummary.arrival.location}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Departure info */}
            {transportSummary.departure && (() => {
              const { full } = formatTransportDatetimeParts(transportSummary.departure.datetime, dateLocale, 'dayAndTime');
              return (
                <div className="flex items-start gap-2 min-w-0">
                  <ArrowUpRight
                    className={cn('size-4 shrink-0', statusVariants({ tone: 'departure', emphasis: 'text' }))}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-foreground tabular-nums">
                      {full}
                    </div>
                    <div className="text-muted-foreground truncate" title={transportSummary.departure.location}>
                      {transportSummary.departure.location}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          <>
            {(stayRangeLabel || roomsDisplay) && (
              <p className="text-sm text-muted-foreground italic">
                {t('persons.cardNoTransportDetail')}
              </p>
            )}
            {!stayRangeLabel && !roomsDisplay && !trimmedNotes && (
              <p className="text-sm text-muted-foreground italic">{t('transports.empty')}</p>
            )}
          </>
        )}

        {trimmedNotes && (
          <div
            className={cn(
              'text-sm text-muted-foreground',
              (stayRangeLabel || roomsDisplay || hasTransportInfo) &&
                'mt-2 border-t border-muted/60 pt-2',
            )}
          >
            <span className="font-medium text-foreground">{t('persons.notes')}</span>
            <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap break-words" title={trimmedNotes}>
              {trimmedNotes}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

// ============================================================================
// PersonListPage Component
// ============================================================================

/**
 * Main person list page component.
 * Displays all persons for the current trip with transport summaries.
 *
 * @example
 * ```tsx
 * // In router configuration
 * { path: '/trips/:tripId/persons', element: <PersonListPage /> }
 * ```
 */
const PersonListPage = memo(function PersonListPage(): ReactElement {
  const { t, i18n } = useTranslation(),
   navigate = useNavigate(),
   { tripId: tripIdFromUrl } = useParams<'tripId'>(),
   { successToast } = useOfflineAwareToast(),

  // Context hooks
   { currentTrip, isLoading: isTripLoading, setCurrentTrip } = useTripContext(),
   { rooms, isLoading: isRoomsLoading } = useRoomContext(),
   { assignments, isLoading: isAssignmentsLoading } = useAssignmentContext(),
   { persons, isLoading: isPersonsLoading, error: personsError, deletePerson } = usePersonContext(),
   { getTransportsByPerson, isLoading: isTransportsLoading } = useTransportContext(),

  // Track if we're currently navigating to prevent double-clicks
   isNavigatingRef = useRef(false),
   [isNavigating] = useState(false),

  // Dialog state for create/edit person
   [isDialogOpen, setIsDialogOpen] = useState(false),
   [editingPersonId, setEditingPersonId] = useState<PersonId | undefined>(undefined),
   [deletingPersonId, setDeletingPersonId] = useState<PersonId | undefined>(undefined),

  // Combined loading state (includes transports to avoid "no transport info" flash)
   isLoading =
    isTripLoading || isRoomsLoading || isAssignmentsLoading || isPersonsLoading || isTransportsLoading,

  // Get date locale based on current language
   dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

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

  // Transport summaries + stay label + all assigned room names for this trip
   personsWithTransports = useMemo(() => {
      const roomsById = new Map<string, string>(rooms.map((r) => [r.id, r.name]));

      const roomNamesByPersonId = new Map<PersonId, string[]>();
      for (const a of assignments) {
        const roomName = roomsById.get(a.roomId);
        if (!roomName) continue;

        const list = roomNamesByPersonId.get(a.personId) ?? [];
        if (!list.includes(roomName)) {
          list.push(roomName);
        }
        roomNamesByPersonId.set(a.personId, list);
      }

      return persons.map((person) => {
      const transports = getTransportsByPerson(person.id);

      // Single-pass algorithm to find earliest arrival and latest departure
      let earliestArrival: { datetime: string; location: string; transportMode?: TransportMode } | null = null,
       latestDeparture: { datetime: string; location: string; transportMode?: TransportMode } | null = null;

      for (const transport of transports) {
        if (transport.type === 'arrival') {
          if (!earliestArrival || transport.datetime < earliestArrival.datetime) {
            earliestArrival = {
              datetime: transport.datetime,
              location: transport.location,
              transportMode: transport.transportMode,
            };
          }
        } else {
          // Type === 'departure'
          if (!latestDeparture || transport.datetime > latestDeparture.datetime) {
            latestDeparture = {
              datetime: transport.datetime,
              location: transport.location,
              transportMode: transport.transportMode,
            };
          }
        }
      }

      const transportSummary: TransportSummary = {
        arrival: earliestArrival,
        departure: latestDeparture,
      };

      const roomList = roomNamesByPersonId.get(person.id);
      const roomsDisplay =
        roomList && roomList.length > 0
          ? [...roomList].sort((a, b) => a.localeCompare(b)).join(', ')
          : undefined;

      const stayRangeLabel = formatPersonStayRangeLabel(person, dateLocale);

      return { person, transportSummary, stayRangeLabel, roomsDisplay };
    });
    }, [assignments, dateLocale, getTransportsByPerson, persons, rooms]),

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles person card click - opens the person edit dialog.
   */
   handlePersonClick = useCallback(
    (personId: PersonId) => {
      if (isNavigatingRef.current) {return;}
      setEditingPersonId(personId);
      setIsDialogOpen(true);
    },
    [],
  ),

  /**
   * Handles add person button click - opens the create person dialog.
   */
   handleAddPerson = useCallback(() => {
    setEditingPersonId(undefined); // Clear editing person ID for create mode
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
      setEditingPersonId(undefined);
    }
  }, []),
   handlePersonDeleteIntent = useCallback((personId: PersonId) => {
    setDeletingPersonId(personId);
  }, []),
   handleDeleteDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setDeletingPersonId(undefined);
    }
  }, []),
   handleConfirmDelete = useCallback(async () => {
    if (!deletingPersonId) {
      return;
    }
    try {
      await deletePerson(deletingPersonId);
      successToast(t('persons.deleteSuccess', 'Guest removed successfully'));
      setDeletingPersonId(undefined);
    } catch (error) {
      console.error('Failed to delete person:', error);
      toast.error(t('errors.deleteFailed', 'Failed to delete'));
      throw error;
    }
  }, [deletePerson, deletingPersonId, successToast, t]),

  // ============================================================================
  // Header Action (desktop button)
  // ============================================================================

   headerAction = useMemo(
    () => (
      <Button onClick={handleAddPerson} className="hidden sm:flex">
        <Plus className="size-4 mr-2" aria-hidden="true" />
        {t('persons.new')}
      </Button>
    ),
    [handleAddPerson, t],
  );

  // ============================================================================
  // Render: Loading State
  // ============================================================================

  if (isLoading) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader
          title={t('persons.title')}
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
        <PageHeader title={t('persons.title')} backLink="/trips" />
        <div className="flex-1 flex items-center justify-center min-h-[200px]">
          <EmptyState
            icon={Users}
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

  if (personsError) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader
          title={t('persons.title')}
          backLink={`/trips/${tripIdFromUrl}/calendar`}
        />
        <ErrorDisplay
          error={personsError}
          onRetry={() => window.location.reload()}
          onBack={handleBack}
        />
      </div>
    );
  }

  // ============================================================================
  // Render: Empty State
  // ============================================================================

  if (persons.length === 0) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader
          title={t('persons.title')}
          backLink={`/trips/${tripIdFromUrl}/calendar`}
        />
        <div className="flex-1 flex items-center justify-center min-h-[200px]">
          <EmptyState
            icon={Users}
            title={t('persons.empty')}
            description={t('persons.emptyDescription')}
            action={{
              label: t('persons.new'),
              onClick: handleAddPerson,
            }}
          />
        </div>

        {/* Person Create Dialog - needed even in empty state */}
        <PersonDialog
          personId={editingPersonId}
          open={isDialogOpen}
          onOpenChange={handleDialogOpenChange}
        />
      </div>
    );
  }

  // ============================================================================
  // Render: Person List
  // ============================================================================

  return (
    <div className="container max-w-4xl py-6 md:py-8">
      <PageHeader
        title={t('persons.title')}
        backLink={`/trips/${tripIdFromUrl}/calendar`}
        action={headerAction}
      />

      {/* Person grid */}
      <div
        role="list"
        aria-label={t('persons.title')}
        className={cn(
          'grid gap-4',
          'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
          // Extra bottom padding for FAB on mobile
          'pb-20 sm:pb-4',
        )}
      >
        {personsWithTransports.map(({ person, transportSummary, stayRangeLabel, roomsDisplay }) => (
          <div key={person.id} role="listitem">
            <PersonCard
              person={person}
              transportSummary={transportSummary}
              stayRangeLabel={stayRangeLabel}
              roomsDisplay={roomsDisplay}
              onClick={handlePersonClick}
              onDelete={handlePersonDeleteIntent}
              isDisabled={isNavigating}
              dateLocale={dateLocale}
            />
          </div>
        ))}
      </div>

      {/* Floating Action Button for mobile */}
      <Button
        onClick={handleAddPerson}
        size="lg"
        className={cn(
          'fixed bottom-20 right-4 z-10',
          'size-14 rounded-full shadow-lg',
          'sm:hidden',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
        aria-label={t('persons.new')}
      >
        <Plus className="size-6" aria-hidden="true" />
      </Button>

      {/* Person Create/Edit Dialog */}
      <PersonDialog
        personId={editingPersonId}
        open={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
      />

      <ConfirmDialog
        open={Boolean(deletingPersonId)}
        onOpenChange={handleDeleteDialogOpenChange}
        title={t('confirm.deletePerson', 'Delete guest?')}
        description={t('confirm.deletePersonDescription', 'This action cannot be undone.')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { PersonListPage };
export default PersonListPage;
