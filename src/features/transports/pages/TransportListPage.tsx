/**
 * @fileoverview Transport List Page - Displays arrivals and departures for a trip.
 * Shows transports in a single chronological list grouped by date.
 *
 * Route: /trips/:tripId/transports
 *
 * Features:
 * - Single chronological list (no tabs)
 * - Date grouping with date headers
 * - Clear visual distinction between arrivals (green) and departures (orange)
 * - Transport cards with person badge, datetime, location, mode, and pickup indicator
 * - Edit/delete actions via dropdown menu
 * - Add transport action (FAB on mobile, header button on desktop)
 * - Empty state when no transports
 * - Responsive design
 *
 * @module features/transports/pages/TransportListPage
 */

import {
  type KeyboardEvent,
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
import { format, parseISO } from 'date-fns';
import { enUS, fr } from 'date-fns/locale';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bus,
  Car,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock,
  Edit,
  History,
  Map as MapIcon,
  MapPin,
  MoreVertical,
  Plane,
  Plus,
  Train,
  Trash2,
  User,
} from 'lucide-react';

import { useTripContext } from '@/contexts/TripContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { TransportDialog } from '@/features/transports/components/TransportDialog';
import { UpcomingPickups } from '@/features/transports/components/UpcomingPickups';
import type { Person, PersonId, Transport, TransportId, TransportMode, TransportType } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the TransportCard component.
 */
interface TransportCardProps {
  /** The transport to display */
  readonly transport: Transport;
  /** The person associated with this transport */
  readonly person: Person | undefined;
  /** The driver for pickup (if applicable) */
  readonly driver: Person | undefined;
  /** Callback when edit is clicked */
  readonly onEdit: (transportId: TransportId) => void;
  /** Callback when delete is clicked */
  readonly onDelete: (transportId: TransportId) => void;
  /** Date locale for formatting */
  readonly dateLocale: typeof fr | typeof enUS;
  /** Whether actions are disabled */
  readonly isActionsDisabled?: boolean;
  /** Whether this transport is in the past */
  readonly isPast?: boolean;
}

/**
 * A group of transports for a single date.
 */
interface DateGroup {
  /** Date key (YYYY-MM-DD format) */
  readonly dateKey: string;
  /** Formatted date for display */
  readonly displayDate: string;
  /** Transports for this date, sorted by time */
  readonly transports: readonly Transport[];
}

/**
 * Props for the TransportList component.
 */
interface TransportListProps {
  /** Array of date groups for upcoming transports */
  readonly upcomingDateGroups: readonly DateGroup[];
  /** Array of date groups for past transports */
  readonly pastDateGroups: readonly DateGroup[];
  /** Total count of past transports */
  readonly pastCount: number;
  /** Map of person ID to Person object */
  readonly personsMap: Map<PersonId, Person>;
  /** Callback when edit is clicked */
  readonly onEdit: (transportId: TransportId) => void;
  /** Callback when delete is clicked */
  readonly onDelete: (transportId: TransportId) => void;
  /** Date locale for formatting */
  readonly dateLocale: typeof fr | typeof enUS;
  /** Accessible label for the list */
  readonly listLabel: string;
  /** Empty state message */
  readonly emptyTitle: string;
  /** Empty state description */
  readonly emptyDescription: string;
  /** Whether actions are disabled */
  readonly isActionsDisabled?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Gets the date-fns locale based on the current i18n language.
 *
 * @param language - The current i18n language code
 * @returns The date-fns locale object
 */
function getDateLocale(language: string): typeof fr | typeof enUS {
  return language === 'fr' ? fr : enUS;
}

/**
 * Gets the icon component for a transport mode.
 *
 * @param mode - The transport mode
 * @returns The Lucide icon component
 */
function getTransportModeIcon(mode: TransportMode | undefined): typeof Train {
  switch (mode) {
    case 'train':
      return Train;
    case 'plane':
      return Plane;
    case 'car':
      return Car;
    case 'bus':
      return Bus;
    case 'other':
    default:
      return CircleDot;
  }
}

/**
 * Safely formats a datetime string for display.
 * Returns formatted date and time or empty strings on error.
 *
 * @param datetime - ISO datetime string
 * @param locale - date-fns locale object
 * @returns Object with formatted date and time strings
 */
function formatTransportDatetime(
  datetime: string,
  locale: typeof fr | typeof enUS,
): { date: string; time: string } {
  try {
    const parsedDate = parseISO(datetime);
    if (isNaN(parsedDate.getTime())) {
      return { date: '', time: '' };
    }
    return {
      date: format(parsedDate, 'EEE d MMM', { locale }),
      time: format(parsedDate, 'HH:mm', { locale }),
    };
  } catch {
    return { date: '', time: '' };
  }
}

/**
 * Extracts the date key (YYYY-MM-DD) from a datetime string.
 *
 * @param datetime - ISO datetime string
 * @returns Date key string or empty string on error
 */
function getDateKey(datetime: string): string {
  try {
    const parsedDate = parseISO(datetime);
    if (isNaN(parsedDate.getTime())) {return '';}
    return format(parsedDate, 'yyyy-MM-dd');
  } catch {
    return '';
  }
}

/**
 * Formats a date key for display as a date header.
 *
 * @param dateKey - Date key in YYYY-MM-DD format
 * @param locale - date-fns locale object
 * @returns Formatted date string (e.g., "Monday, January 5, 2026")
 */
function formatDateHeader(dateKey: string, locale: typeof fr | typeof enUS): string {
  try {
    const parsedDate = parseISO(dateKey);
    if (isNaN(parsedDate.getTime())) {return dateKey;}
    return format(parsedDate, 'EEEE, MMMM d, yyyy', { locale });
  } catch {
    return dateKey;
  }
}

/**
 * Checks if a transport is in the past.
 *
 * @param datetime - ISO datetime string
 * @returns True if the transport datetime is before now
 */
function isTransportPast(datetime: string): boolean {
  try {
    const parsedDate = parseISO(datetime);
    if (isNaN(parsedDate.getTime())) {return false;}
    return parsedDate < new Date();
  } catch {
    return false;
  }
}

/**
 * Groups transports by date, sorted chronologically.
 *
 * @param transports - Array of transports to group
 * @param locale - date-fns locale for date formatting
 * @returns Array of date groups, each containing transports for that date
 */
function groupTransportsByDate(
  transports: readonly Transport[],
  locale: typeof fr | typeof enUS,
): DateGroup[] {
  // Create a map of date key to transports
  const groupsMap = new Map<string, Transport[]>();
  
  for (const transport of transports) {
    const dateKey = getDateKey(transport.datetime);
    if (!dateKey) {continue;}
    
    const existing = groupsMap.get(dateKey);
    if (existing) {
      existing.push(transport);
    } else {
      groupsMap.set(dateKey, [transport]);
    }
  }
  
  // Sort transports within each group by time
  for (const transports of groupsMap.values()) {
    transports.sort((a, b) => a.datetime.localeCompare(b.datetime));
  }
  
  // Convert to array and sort by date key (chronological)
  const groups: DateGroup[] = Array.from(groupsMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, transports]) => ({
      dateKey,
      displayDate: formatDateHeader(dateKey, locale),
      transports,
    }));
  
  return groups;
}

// ============================================================================
// TransportCard Component
// ============================================================================

/**
 * Individual transport card displaying transport details with actions.
 */
const TransportCard = memo(function TransportCard({
  transport,
  person,
  driver,
  onEdit,
  onDelete,
  dateLocale,
  isActionsDisabled = false,
  isPast = false,
}: TransportCardProps): ReactElement {
  const { t } = useTranslation(),

  // Format datetime for display
   { date, time } = useMemo(
    () => formatTransportDatetime(transport.datetime, dateLocale),
    [transport.datetime, dateLocale],
  ),

  // Get transport mode icon
   ModeIcon = useMemo(
    () => getTransportModeIcon(transport.transportMode),
    [transport.transportMode],
  ),

  // Get transport type icon
   TypeIcon = transport.type === 'arrival' ? ArrowDownToLine : ArrowUpFromLine,

  // Handle edit click
   handleEdit = useCallback(() => {
    onEdit(transport.id);
  }, [transport.id, onEdit]),

  // Handle delete click
   handleDelete = useCallback(() => {
    onDelete(transport.id);
  }, [transport.id, onDelete]),

  // Handle keyboard activation for card
   handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleEdit();
      }
    },
    [handleEdit],
  ),

  // Smart pickup logic: show "needs pickup" only when needsPickup=true AND no driver assigned
   showNeedsPickupBadge = transport.needsPickup && !transport.driverId,

  // Build aria-label for accessibility
   ariaLabel = useMemo(() => {
    const parts = [
      transport.type === 'arrival' ? t('transports.arrival') : t('transports.departure'),
      person?.name ?? t('common.unknown'),
      date,
      time,
      transport.location,
    ];
    if (showNeedsPickupBadge) {
      parts.push(t('transports.needsPickup'));
    }
    if (driver) {
      parts.push(`${t('transports.driver')}: ${driver.name}`);
    }
    return parts.filter(Boolean).join(', ');
  }, [transport, person, driver, date, time, t, showNeedsPickupBadge]);

  return (
    <Card
      role="article"
      tabIndex={0}
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn(
        'transition-all duration-200',
        'hover:shadow-md hover:border-primary/20',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        // Past transport styling - dimmed appearance
        isPast && 'opacity-60',
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          {/* Person badge and type indicator */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <TypeIcon
              className={cn(
                'size-5 shrink-0',
                transport.type === 'arrival' ? 'text-green-600' : 'text-orange-600',
              )}
              aria-hidden="true"
            />
            {person ? (
              <PersonBadge person={person} size="default" />
            ) : (
              <Badge variant="secondary" className="text-muted-foreground">
                {t('common.unknown')}
              </Badge>
            )}
            {/* Smart pickup indicator: show "needs pickup" only when no driver assigned */}
            {showNeedsPickupBadge && (
              <Badge
                variant="outline"
                className="shrink-0 border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-950/30"
              >
                {t('transports.needsPickup')}
              </Badge>
            )}
            {/* Show driver badge when driver is assigned (pickup resolved) */}
            {driver && transport.needsPickup && (
              <Badge
                variant="outline"
                className="shrink-0 border-green-500 text-green-600 bg-green-50 dark:bg-green-950/30"
              >
                {t('transports.driver')}: {driver.name}
              </Badge>
            )}
          </div>

          {/* Actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 md:size-8 shrink-0"
                disabled={isActionsDisabled}
                aria-label={t('common.actions', 'Actions')}
              >
                <MoreVertical className="size-5 md:size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleEdit}>
                <Edit className="size-4" aria-hidden="true" />
                {t('common.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={handleDelete}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-2">
        {/* Date and time */}
        <div className="flex items-center gap-2 text-sm">
          <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{date}</span>
          <span className="text-muted-foreground">{time}</span>
        </div>

        {/* Location */}
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate" title={transport.location}>
            {transport.location}
          </span>
        </div>

        {/* Transport mode and number */}
        {(transport.transportMode ?? transport.transportNumber) && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ModeIcon className="size-4 shrink-0" aria-hidden="true" />
            {transport.transportMode && (
              <span>{t(`transports.modes.${transport.transportMode}`)}</span>
            )}
            {transport.transportNumber && (
              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                {transport.transportNumber}
              </span>
            )}
          </div>
        )}

        {/* Driver - only show in content if not already shown in badge (badge shown when needsPickup is true) */}
        {driver && !transport.needsPickup && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <User className="size-4 shrink-0" aria-hidden="true" />
            <span>{t('transports.driver')}:</span>
            <PersonBadge person={driver} size="sm" />
          </div>
        )}

        {/* Notes */}
        {transport.notes && (
          <p className="text-sm text-muted-foreground italic line-clamp-2">
            {transport.notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
});

// ============================================================================
// DateGroupSection Component
// ============================================================================

/**
 * Props for the DateGroupSection component.
 */
interface DateGroupSectionProps {
  /** The date group to render */
  readonly group: DateGroup;
  /** Map of person ID to Person object */
  readonly personsMap: Map<PersonId, Person>;
  /** Callback when edit is clicked */
  readonly onEdit: (transportId: TransportId) => void;
  /** Callback when delete is clicked */
  readonly onDelete: (transportId: TransportId) => void;
  /** Date locale for formatting */
  readonly dateLocale: typeof fr | typeof enUS;
  /** Whether actions are disabled */
  readonly isActionsDisabled?: boolean;
  /** Whether transports in this group are past */
  readonly isPast?: boolean;
}

/**
 * Renders a single date group with its transports.
 */
const DateGroupSection = memo(function DateGroupSection({
  group,
  personsMap,
  onEdit,
  onDelete,
  dateLocale,
  isActionsDisabled = false,
  isPast = false,
}: DateGroupSectionProps): ReactElement {
  return (
    <section key={group.dateKey} aria-labelledby={`date-header-${group.dateKey}`}>
    {/* Date header */}
    <h2
      id={`date-header-${group.dateKey}`}
      className={cn(
        'text-sm font-semibold uppercase tracking-wide mb-3 px-1',
        isPast ? 'text-muted-foreground/60' : 'text-muted-foreground',
      )}
    >
      {group.displayDate}
    </h2>
    
    {/* Transports grid for this date */}
    <div
      className={cn(
        'grid gap-4',
        'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
      )}
    >
      {group.transports.map((transport) => {
        const person = personsMap.get(transport.personId),
         driver = transport.driverId
          ? personsMap.get(transport.driverId)
          : undefined;

        return (
          <div key={transport.id} role="listitem">
            <TransportCard
              transport={transport}
              person={person}
              driver={driver}
              onEdit={onEdit}
              onDelete={onDelete}
              dateLocale={dateLocale}
              isActionsDisabled={isActionsDisabled}
              isPast={isPast}
            />
          </div>
        );
      })}
    </div>
  </section>
  );
});

// ============================================================================
// TransportList Component
// ============================================================================

/**
 * List of transport cards grouped by date with date headers.
 * Includes collapsible section for past transports.
 */
const TransportList = memo(function TransportList({
  upcomingDateGroups,
  pastDateGroups,
  pastCount,
  personsMap,
  onEdit,
  onDelete,
  dateLocale,
  listLabel,
  emptyTitle,
  emptyDescription,
  isActionsDisabled = false,
}: TransportListProps): ReactElement {
  const { t } = useTranslation();
  
  // State for past transports collapsible section
  const [isPastExpanded, setIsPastExpanded] = useState(false);
  
  // Toggle past section visibility
  const togglePastSection = useCallback(() => {
    setIsPastExpanded((prev) => !prev);
  }, []);

  // Render empty state if no transports at all
  if (upcomingDateGroups.length === 0 && pastDateGroups.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <EmptyState
          icon={Plane}
          title={emptyTitle}
          description={emptyDescription}
        />
      </div>
    );
  }

  return (
    <div
      role="list"
      aria-label={listLabel}
      className="space-y-6 pb-20 sm:pb-4"
    >
      {/* Upcoming transports */}
      {upcomingDateGroups.map((group) => (
        <DateGroupSection
          key={group.dateKey}
          group={group}
          personsMap={personsMap}
          onEdit={onEdit}
          onDelete={onDelete}
          dateLocale={dateLocale}
          isActionsDisabled={isActionsDisabled}
          isPast={false}
        />
      ))}

      {/* Past transports - collapsible section */}
      {pastCount > 0 && (
        <div className="border-t pt-4 mt-6">
          {/* Past section toggle button */}
          <button
            type="button"
            onClick={togglePastSection}
            className={cn(
              'flex items-center gap-2 w-full text-left',
              'text-sm font-semibold text-muted-foreground',
              'hover:text-foreground transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md',
              'py-2 px-1',
            )}
            aria-expanded={isPastExpanded}
            aria-controls="past-transports-section"
          >
            {isPastExpanded ? (
              <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
            )}
            <History className="size-4 shrink-0" aria-hidden="true" />
            <span>
              {t('transports.pastTransports', 'Past transports')} ({pastCount})
            </span>
          </button>

          {/* Past transports content - shown when expanded */}
          {isPastExpanded && (
            <div id="past-transports-section" className="mt-4 space-y-6">
              {pastDateGroups.map((group) => (
                <DateGroupSection
                  key={group.dateKey}
                  group={group}
                  personsMap={personsMap}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  dateLocale={dateLocale}
                  isActionsDisabled={isActionsDisabled}
                  isPast={true}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// TransportListPage Component
// ============================================================================

/**
 * Main transport list page component.
 * Displays arrivals and departures in a single chronological list grouped by date.
 *
 * @example
 * ```tsx
 * // In router configuration
 * { path: '/trips/:tripId/transports', element: <TransportListPage /> }
 * ```
 */
const TransportListPage = memo(function TransportListPage(): ReactElement {
  const { t, i18n } = useTranslation(),
   navigate = useNavigate(),
   { tripId: tripIdFromUrl } = useParams<'tripId'>(),

  // Context hooks
   { currentTrip, isLoading: isTripLoading, setCurrentTrip } = useTripContext(),
   { persons, isLoading: isPersonsLoading } = usePersonContext(),
   {
    arrivals,
    departures,
    upcomingPickups,
    isLoading: isTransportsLoading,
    error: transportsError,
    deleteTransport,
  } = useTransportContext(),

  // Local state
   [transportToDelete, setTransportToDelete] = useState<TransportId | null>(null),

  // Dialog state for create/edit transport
   [isDialogOpen, setIsDialogOpen] = useState(false),
   [editingTransportId, setEditingTransportId] = useState<TransportId | undefined>(undefined),
   [defaultTransportType, setDefaultTransportType] = useState<TransportType>('arrival'),

  // Track if we're currently navigating to prevent double-clicks
   isNavigatingRef = useRef(false),

  // Combined loading state
   isLoading = isTripLoading || isPersonsLoading || isTransportsLoading,

  // Get date locale based on current language
   dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]),

  // Build persons map for O(1) lookups
   personsMap = useMemo(() => {
    const map = new Map<PersonId, Person>();
    for (const person of persons) {
      map.set(person.id, person);
    }
    return map;
  }, [persons]),

  // Combine arrivals and departures into a single list
   allTransports = useMemo(() => [...arrivals, ...departures], [arrivals, departures]),

  // Separate upcoming and past transports
   { upcomingTransports, pastTransports } = useMemo(() => {
    const upcoming: Transport[] = [];
    const past: Transport[] = [];
    
    for (const transport of allTransports) {
      if (isTransportPast(transport.datetime)) {
        past.push(transport);
      } else {
        upcoming.push(transport);
      }
    }
    
    return { upcomingTransports: upcoming, pastTransports: past };
  }, [allTransports]),

  // Group upcoming transports by date (chronological)
   upcomingDateGroups = useMemo(
    () => groupTransportsByDate(upcomingTransports, dateLocale),
    [upcomingTransports, dateLocale],
  ),

  // Group past transports by date (reverse chronological - most recent first)
   pastDateGroups = useMemo(
    () => groupTransportsByDate(pastTransports, dateLocale).reverse(),
    [pastTransports, dateLocale],
  ),

   pastCount = pastTransports.length,

  // Check if there are any pickups (assigned or unassigned) to show the UpcomingPickups section
   hasAnyPickups = useMemo(
    () => upcomingPickups.some((t) => t.needsPickup),
    [upcomingPickups],
  );

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

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles edit transport click - opens the transport edit dialog.
   */
   handleEdit = useCallback(
    (transportId: TransportId) => {
      if (isNavigatingRef.current) {return;}
      setEditingTransportId(transportId);
      setIsDialogOpen(true);
    },
    [],
  ),

  /**
   * Opens delete confirmation dialog.
   */
   handleDeleteClick = useCallback((transportId: TransportId) => {
    setTransportToDelete(transportId);
  }, []),

  /**
   * Confirms and executes transport deletion.
   * Note: Loading state is managed by ConfirmDialog internally.
   */
   handleConfirmDelete = useCallback(async () => {
    if (!transportToDelete) {return;}

    try {
      await deleteTransport(transportToDelete);
      setTransportToDelete(null);
      toast.success(t('transports.deleteSuccess', 'Transport deleted successfully'));
    } catch (error) {
      // Log for debugging, show user-friendly error via toast
      console.error('Failed to delete transport:', error);
      toast.error(t('errors.deleteFailed', 'Failed to delete'));
      throw error; // Re-throw to keep dialog open for retry
    }
  }, [transportToDelete, deleteTransport, t]),

  /**
   * Closes delete confirmation dialog.
   */
   handleCancelDelete = useCallback((open: boolean) => {
    if (!open) {
      setTransportToDelete(null);
    }
  }, []),

  /**
   * Handles add transport button click - opens the create transport dialog.
   */
   handleAddTransport = useCallback(() => {
    setEditingTransportId(undefined); // Clear editing transport ID for create mode
    setDefaultTransportType('arrival'); // Default to arrival for new transports
    setIsDialogOpen(true);
  }, []),

  /**
   * Handles back navigation.
   */
   handleBack = useCallback(() => {
    navigate(`/trips/${tripIdFromUrl}/calendar`);
  }, [navigate, tripIdFromUrl]),

  /**
   * Handles navigation to map view.
   */
   handleOpenMap = useCallback(() => {
    navigate(`/trips/${tripIdFromUrl}/transports/map`);
  }, [navigate, tripIdFromUrl]),

  /**
   * Handles dialog close - resets editing state.
   */
   handleDialogOpenChange = useCallback((open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setEditingTransportId(undefined);
    }
  }, []),

  // ============================================================================
  // Header Action (desktop buttons)
  // ============================================================================

   headerAction = useMemo(
    () => (
      <div className="hidden sm:flex items-center gap-2">
        <Button variant="outline" onClick={handleOpenMap}>
          <MapIcon className="size-4 mr-2" aria-hidden="true" />
          {t('transports.mapView', 'Map view')}
        </Button>
        <Button onClick={handleAddTransport}>
          <Plus className="size-4 mr-2" aria-hidden="true" />
          {t('transports.new')}
        </Button>
      </div>
    ),
    [handleAddTransport, handleOpenMap, t],
  );

  // ============================================================================
  // Render: Loading State
  // ============================================================================

  if (isLoading) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader
          title={t('transports.title')}
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
        <PageHeader title={t('transports.title')} backLink="/trips" />
        <div className="flex-1 flex items-center justify-center min-h-[200px]">
          <EmptyState
            icon={Plane}
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

  if (transportsError) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader
          title={t('transports.title')}
          backLink={`/trips/${tripIdFromUrl}/calendar`}
        />
        <ErrorDisplay
          error={transportsError}
          onRetry={() => window.location.reload()}
          onBack={handleBack}
        />
      </div>
    );
  }

  // ============================================================================
  // Render: Main Content - Single Chronological List
  // ============================================================================

  return (
    <div className="container max-w-4xl py-6 md:py-8">
      <PageHeader
        title={t('transports.title')}
        backLink={`/trips/${tripIdFromUrl}/calendar`}
        action={headerAction}
      />

      {/* Transport count summary */}
      {allTransports.length > 0 && (
        <div className="flex items-center gap-4 mb-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <ArrowDownToLine className="size-4 text-green-600" aria-hidden="true" />
            <span>{arrivals.length} {t('transports.arrivals').toLowerCase()}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ArrowUpFromLine className="size-4 text-orange-600" aria-hidden="true" />
            <span>{departures.length} {t('transports.departures').toLowerCase()}</span>
          </div>
        </div>
      )}

      {/* Pickup alerts section - shown when any pickups exist (component handles empty state internally) */}
      {hasAnyPickups && (
        <div className="mb-6 p-4 rounded-xl border-2 border-amber-200 bg-amber-50/20 dark:border-amber-800 dark:bg-amber-950/10">
          <UpcomingPickups />
        </div>
      )}

      {/* Single chronological list grouped by date with collapsible past section */}
      <TransportList
        upcomingDateGroups={upcomingDateGroups}
        pastDateGroups={pastDateGroups}
        pastCount={pastCount}
        personsMap={personsMap}
        onEdit={handleEdit}
        onDelete={handleDeleteClick}
        dateLocale={dateLocale}
        listLabel={t('transports.title')}
        emptyTitle={t('transports.empty')}
        emptyDescription={t('transports.emptyDescription')}
      />

      {/* Floating Action Button for mobile */}
      <Button
        onClick={handleAddTransport}
        size="lg"
        className={cn(
          'fixed bottom-20 right-4 z-10',
          'size-14 rounded-full shadow-lg',
          'sm:hidden',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
        aria-label={t('transports.new')}
      >
        <Plus className="size-6" aria-hidden="true" />
      </Button>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={transportToDelete !== null}
        onOpenChange={handleCancelDelete}
        title={t('confirm.deleteTransport')}
        description={t('confirm.deleteTransportDescription')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />

      {/* Transport Create/Edit Dialog */}
      <TransportDialog
        transportId={editingTransportId}
        open={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
        defaultType={defaultTransportType}
      />
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { TransportListPage };
export default TransportListPage;
