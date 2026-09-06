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
  type MouseEvent,
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
import { type Locale, format, parseISO } from 'date-fns';
import {
  ArrowDownRight,
  ArrowUpRight,
  Baby,
  Phone,
  Plus,
  Trash2,
  Users,
  UsersRound,
} from 'lucide-react';

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
import {
  GuestGroupImportDialog,
  SaveGuestsAsGroupDialog,
  useGuestGroups,
  type GuestGroupSelection,
} from '@/features/guest-groups';
import { captureUsage } from '@/lib/posthog';
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

  // Keeps a tap on the phone link from also opening the edit dialog behind it.
   stopCardClick = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
  }, []),

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
    const rawPhone = person.phone?.trim();
    if (rawPhone) {
      parts.push(`${t('persons.phone', 'Phone')}: ${rawPhone}`);
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
    if (person.childSeat) {
      parts.push(`${t('childSeats.label')}: ${t(`childSeats.${person.childSeat}`)}`);
    }
    return parts.join(', ');
  }, [dateLocale, person, roomsDisplay, stayRangeLabel, transportSummary.departure, transportSummary.arrival, t]),

   hasTransportInfo = transportSummary.arrival || transportSummary.departure,
   trimmedNotes = person.notes?.trim() ?? '',
   trimmedPhone = person.phone?.trim() ?? '';

  // A guest entry can stand for several people (e.g. a couple under one name).
  const personHeadcount = getPersonHeadcount(person);
  const headcountLabel = t('persons.headcountSummary', 'Counts as {{count}} people', {
    count: personHeadcount,
  });

  return (
    <Card
      onClick={handleClick}
      className={cn(
        'relative cursor-pointer transition-all duration-200',
        'hover:shadow-md hover:border-primary/20',
        isDisabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      {/*
        The card's activation target, as a real button covering the card.

        A card carrying `role="button"` cannot legally contain the delete
        button below it — `nested-interactive`: a button's children are
        presentational, so the delete control simply vanished from the
        accessibility tree. As an overlaid sibling this keeps the whole-card
        hit area and focus ring while leaving the delete button reachable.

        No click handler of its own: its click — including the synthetic one a
        keyboard Enter/Space produces — bubbles to the card's `onClick`, which
        is also what a click on the card's text does.
      */}
      <button
        type="button"
        tabIndex={isDisabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-disabled={isDisabled}
        className={cn(
          'absolute inset-0 z-10 rounded-xl',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isDisabled && 'cursor-not-allowed',
        )}
      />

      <CardHeader className="pb-2">
        <div className="flex items-center gap-3">
          {/* Color indicator */}
          <div
            // eslint-disable-next-line kikouchou/no-raw-palette-class -- A hairline over a user-chosen colour (see the `backgroundColor` below); a theme border would vanish against half the palette.
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
            // `relative z-20` lifts it above the full-card activation button,
            // which would otherwise swallow the click.
            className="relative z-20 ml-auto size-8 text-muted-foreground hover:text-destructive"
            variant="ghost"
            aria-label={t('common.delete')}
            onClick={handleDeleteClick}
            disabled={isDisabled}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-2">
        {/* The declared child restraint. A badge rather than a labelled row:
            it is the one thing on this card a driver scans the roster for. */}
        {person.childSeat && (
          <p>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              <Baby className="size-3 shrink-0" aria-hidden="true" />
              {t(`childSeats.${person.childSeat}`)}
            </span>
          </p>
        )}
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
        ) : null}

        {trimmedPhone && (
          <div
            className={cn(
              'text-sm',
              (person.childSeat || stayRangeLabel || roomsDisplay || hasTransportInfo) &&
                'mt-2 border-t border-muted/60 pt-2',
            )}
          >
            <a
              href={`tel:${trimmedPhone.replace(/\s+/gu, '')}`}
              // The whole card opens the editor, so a tap meant for the number
              // has to stop there or dialling is impossible.
              onClick={stopCardClick}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-sm text-muted-foreground',
                'hover:text-foreground hover:underline',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <Phone className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate tabular-nums">{trimmedPhone}</span>
            </a>
          </div>
        )}

        {trimmedNotes && (
          <div
            className={cn(
              'text-sm text-muted-foreground',
              (person.childSeat ||
                stayRangeLabel ||
                roomsDisplay ||
                hasTransportInfo ||
                trimmedPhone) &&
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
   [searchParams, setSearchParams] = useSearchParams(),
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

  // Dialog state for create/edit person.
  //
  // `?new=1` opens it on the first render rather than through an effect — it is
  // how the calendar's empty state sends people here to add their first guest,
  // and a mount-then-open would flash the empty list first.
   [isDialogOpen, setIsDialogOpen] = useState(() => searchParams.get('new') !== null),
   [editingPersonId, setEditingPersonId] = useState<PersonId | undefined>(undefined),
   [deletingPersonId, setDeletingPersonId] = useState<PersonId | undefined>(undefined),

  // Guest groups: importing a saved roster, and saving this trip's guests as one.
   { importMembers } = useGuestGroups(),
   [isImportGroupOpen, setIsImportGroupOpen] = useState(false),
   [isSaveGroupOpen, setIsSaveGroupOpen] = useState(false),

  // Combined loading state (includes transports to avoid "no transport info" flash)
   isLoading =
    isTripLoading || isRoomsLoading || isAssignmentsLoading || isPersonsLoading || isTransportsLoading,

  // Get date locale based on current language
   dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  // Drop `?new=1` once it has done its job, so closing the dialog and reloading
  // — or coming back through history — does not pop it open again.
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
  // Guest Groups
  // ============================================================================

   handleOpenImportGroup = useCallback(() => {
    setIsImportGroupOpen(true);
  }, []),

   handleOpenSaveAsGroup = useCallback(() => {
    setIsSaveGroupOpen(true);
  }, []),

  /**
   * Copies the chosen members in as guests.
   *
   * Rethrows so the dialog stays open on failure — the selection the user made
   * is worth more than a clean close.
   */
   handleImportGroups = useCallback(
    async (selections: readonly GuestGroupSelection[]) => {
      if (!currentTrip) {
        return;
      }

      try {
        // Sequential rather than `Promise.all`: each import opens its own
        // read-write transaction over `persons`, and Dexie serialises them
        // anyway — running them in order keeps the guests in the order the
        // user ticked the groups instead of whichever transaction won.
        let addedCount = 0,
          skippedCount = 0;

        for (const { group, memberIds } of selections) {
          const result = await importMembers(currentTrip.id, group.id, memberIds);
          addedCount += result.persons.length;
          skippedCount += result.skippedMemberIds.length;
        }

        successToast(
          t('guestGroups.importSuccess', '{{count}} guests added', {
            count: addedCount,
          }),
        );

        // Somebody edited a group between opening the picker and confirming it.
        // Nothing is broken, but fewer people arrived than were ticked.
        if (skippedCount > 0) {
          toast.warning(
            t('guestGroups.importSkipped', '{{count}} people were no longer in the group', {
              count: skippedCount,
            }),
          );
        }

        captureUsage('guest_group_imported', {
          member_count: addedCount,
          skipped_count: skippedCount,
          group_count: selections.length,
          source: 'guest_list',
        });
      } catch (error) {
        console.error('Failed to import guest groups:', error);
        toast.error(t('guestGroups.importFailed', "Could not add the group's guests"));
        throw error;
      }
    },
    [currentTrip, importMembers, successToast, t],
  ),

  // ============================================================================
  // Header Action (desktop button)
  // ============================================================================

   headerAction = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleOpenImportGroup}>
          <UsersRound className="size-4 mr-2" aria-hidden="true" />
          {t('guestGroups.importAction', 'Add from a group')}
        </Button>
        {persons.length > 0 && (
          <Button variant="ghost" size="sm" onClick={handleOpenSaveAsGroup}>
            {t('guestGroups.saveAsGroup', 'Save as a group')}
          </Button>
        )}
        <Button onClick={handleAddPerson} className="hidden sm:flex">
          <Plus className="size-4 mr-2" aria-hidden="true" />
          {t('persons.new')}
        </Button>
      </div>
    ),
    [handleAddPerson, handleOpenImportGroup, handleOpenSaveAsGroup, persons.length, t],
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
            // An empty guest list is exactly where a saved group pays off, so
            // the second way in is offered beside the first rather than hidden
            // in a header the empty state has drawn attention away from.
            secondaryAction={{
              label: t('guestGroups.importAction', 'Add from a group'),
              onClick: handleOpenImportGroup,
            }}
          />
        </div>

        {/* Person Create Dialog - needed even in empty state */}
        <PersonDialog
          personId={editingPersonId}
          open={isDialogOpen}
          onOpenChange={handleDialogOpenChange}
        />

        <GuestGroupImportDialog
          open={isImportGroupOpen}
          onOpenChange={setIsImportGroupOpen}
          onConfirm={handleImportGroups}
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
          // No bottom padding of its own: `<main>`'s `pb-bottom-stack` clears
          // the FAB, the nav bar and the home indicator for every page.
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
          'fixed bottom-nav-safe right-4 z-10',
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

      <GuestGroupImportDialog
        open={isImportGroupOpen}
        onOpenChange={setIsImportGroupOpen}
        onConfirm={handleImportGroups}
      />

      <SaveGuestsAsGroupDialog
        persons={persons}
        defaultName={currentTrip.name}
        open={isSaveGroupOpen}
        onOpenChange={setIsSaveGroupOpen}
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
