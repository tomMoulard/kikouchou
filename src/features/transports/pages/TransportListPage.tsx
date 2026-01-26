/**
 * @fileoverview Transport List Page - Displays arrivals and departures for a trip.
 * Shows transports in a tabbed interface with chronological ordering.
 *
 * Route: /trips/:tripId/transports
 *
 * Features:
 * - Tabbed interface for Arrivals/Departures
 * - Transport cards with person badge, datetime, location, mode, and pickup indicator
 * - Edit/delete actions via dropdown menu
 * - Add transport action (FAB on mobile, header button on desktop)
 * - Empty state per tab
 * - Responsive design
 *
 * @module features/transports/pages/TransportListPage
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
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import {
  Plus,
  Plane,
  Train,
  Car,
  Bus,
  CircleDot,
  MoreVertical,
  Edit,
  Trash2,
  ArrowDownToLine,
  ArrowUpFromLine,
  MapPin,
  Clock,
  User,
} from 'lucide-react';

import { useTripContext } from '@/contexts/TripContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { LoadingState } from '@/components/shared/LoadingState';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardHeader,
  CardContent,
} from '@/components/ui/card';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Transport, TransportId, TransportMode, Person, PersonId } from '@/types';

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
}

/**
 * Props for the TransportList component.
 */
interface TransportListProps {
  /** Array of transports to display */
  readonly transports: readonly Transport[];
  /** Map of person ID to Person object */
  readonly personsMap: Map<PersonId, Person>;
  /** Callback when edit is clicked */
  readonly onEdit: (transportId: TransportId) => void;
  /** Callback when delete is clicked */
  readonly onDelete: (transportId: TransportId) => void;
  /** Date locale for formatting */
  readonly dateLocale: typeof fr | typeof enUS;
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
}: TransportCardProps): ReactElement {
  const { t } = useTranslation();

  // Format datetime for display
  const { date, time } = useMemo(
    () => formatTransportDatetime(transport.datetime, dateLocale),
    [transport.datetime, dateLocale],
  );

  // Get transport mode icon
  const ModeIcon = useMemo(
    () => getTransportModeIcon(transport.transportMode),
    [transport.transportMode],
  );

  // Get transport type icon
  const TypeIcon = transport.type === 'arrival' ? ArrowDownToLine : ArrowUpFromLine;

  // Handle edit click
  const handleEdit = useCallback(() => {
    onEdit(transport.id);
  }, [transport.id, onEdit]);

  // Handle delete click
  const handleDelete = useCallback(() => {
    onDelete(transport.id);
  }, [transport.id, onDelete]);

  // Handle keyboard activation for card
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleEdit();
      }
    },
    [handleEdit],
  );

  // Build aria-label for accessibility
  const ariaLabel = useMemo(() => {
    const parts = [
      transport.type === 'arrival' ? t('transports.arrival') : t('transports.departure'),
      person?.name ?? t('common.unknown'),
      date,
      time,
      transport.location,
    ];
    if (transport.needsPickup) {
      parts.push(t('transports.needsPickup'));
    }
    return parts.filter(Boolean).join(', ');
  }, [transport, person, date, time, t]);

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
            {/* Pickup indicator */}
            {transport.needsPickup && (
              <Badge
                variant="outline"
                className="shrink-0 border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-950/30"
              >
                {t('transports.needsPickup')}
              </Badge>
            )}
          </div>

          {/* Actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                disabled={isActionsDisabled}
                aria-label={t('common.actions', 'Actions')}
              >
                <MoreVertical className="size-4" aria-hidden="true" />
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

        {/* Driver */}
        {driver && (
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

TransportCard.displayName = 'TransportCard';

// ============================================================================
// TransportList Component
// ============================================================================

/**
 * List of transport cards with empty state handling.
 */
const TransportList = memo(function TransportList({
  transports,
  personsMap,
  onEdit,
  onDelete,
  dateLocale,
  emptyTitle,
  emptyDescription,
  isActionsDisabled = false,
}: TransportListProps): ReactElement {
  // Render empty state if no transports
  if (transports.length === 0) {
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
      aria-label={emptyTitle}
      className={cn(
        'grid gap-4',
        'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        // Extra bottom padding for FAB on mobile
        'pb-20 sm:pb-4',
      )}
    >
      {transports.map((transport) => {
        const person = personsMap.get(transport.personId);
        const driver = transport.driverId
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
            />
          </div>
        );
      })}
    </div>
  );
});

TransportList.displayName = 'TransportList';

// ============================================================================
// TransportListPage Component
// ============================================================================

/**
 * Main transport list page component.
 * Displays arrivals and departures in a tabbed interface.
 *
 * @example
 * ```tsx
 * // In router configuration
 * { path: '/trips/:tripId/transports', element: <TransportListPage /> }
 * ```
 */
const TransportListPage = memo(function TransportListPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { tripId: tripIdFromUrl } = useParams<'tripId'>();

  // Context hooks
  const { currentTrip, isLoading: isTripLoading } = useTripContext();
  const { persons, isLoading: isPersonsLoading } = usePersonContext();
  const {
    arrivals,
    departures,
    isLoading: isTransportsLoading,
    error: transportsError,
    deleteTransport,
  } = useTransportContext();

  // Local state
  const [activeTab, setActiveTab] = useState<'arrivals' | 'departures'>('arrivals');
  const [transportToDelete, setTransportToDelete] = useState<TransportId | null>(null);

  // Track if we're currently navigating to prevent double-clicks
  const isNavigatingRef = useRef(false);

  // Combined loading state
  const isLoading = isTripLoading || isPersonsLoading || isTransportsLoading;

  // Get date locale based on current language
  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  // Build persons map for O(1) lookups
  const personsMap = useMemo(() => {
    const map = new Map<PersonId, Person>();
    for (const person of persons) {
      map.set(person.id, person);
    }
    return map;
  }, [persons]);

  // Validate tripId matches current trip
  const tripMismatch = useMemo(() => {
    if (!tripIdFromUrl || !currentTrip) return false;
    return tripIdFromUrl !== currentTrip.id;
  }, [tripIdFromUrl, currentTrip]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles edit transport click - navigates to transport edit page.
   */
  const handleEdit = useCallback(
    (transportId: TransportId) => {
      // Prevent double-clicks and guard against undefined tripId
      if (isNavigatingRef.current || !tripIdFromUrl) return;
      isNavigatingRef.current = true;
      navigate(`/trips/${tripIdFromUrl}/transports/${transportId}/edit`);
    },
    [navigate, tripIdFromUrl],
  );

  /**
   * Opens delete confirmation dialog.
   */
  const handleDeleteClick = useCallback((transportId: TransportId) => {
    setTransportToDelete(transportId);
  }, []);

  /**
   * Confirms and executes transport deletion.
   * Note: Loading state is managed by ConfirmDialog internally.
   */
  const handleConfirmDelete = useCallback(async () => {
    if (!transportToDelete) return;

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
  }, [transportToDelete, deleteTransport, t]);

  /**
   * Closes delete confirmation dialog.
   */
  const handleCancelDelete = useCallback((open: boolean) => {
    if (!open) {
      setTransportToDelete(null);
    }
  }, []);

  /**
   * Handles add transport button click.
   */
  const handleAddTransport = useCallback(() => {
    // Guard against undefined tripId
    if (!tripIdFromUrl) return;
    // Navigate to new transport page with active tab as default type
    navigate(`/trips/${tripIdFromUrl}/transports/new?type=${activeTab === 'arrivals' ? 'arrival' : 'departure'}`);
  }, [navigate, tripIdFromUrl, activeTab]);

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
      <Button onClick={handleAddTransport} className="hidden sm:flex">
        <Plus className="size-4 mr-2" aria-hidden="true" />
        {t('transports.new')}
      </Button>
    ),
    [handleAddTransport, t],
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
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4 min-h-[200px]">
          <div className="text-center">
            <p className="text-lg font-semibold text-destructive">
              {t('errors.loadingFailed')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {transportsError.message}
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
  // Render: Main Content with Tabs
  // ============================================================================

  return (
    <div className="container max-w-4xl py-6 md:py-8">
      <PageHeader
        title={t('transports.title')}
        backLink={`/trips/${tripIdFromUrl}/calendar`}
        action={headerAction}
      />

      {/* Tabs for Arrivals/Departures */}
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'arrivals' | 'departures')}
        className="w-full"
      >
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="arrivals" className="gap-2">
            <ArrowDownToLine className="size-4" aria-hidden="true" />
            {t('transports.arrivals')}
            {arrivals.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                {arrivals.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="departures" className="gap-2">
            <ArrowUpFromLine className="size-4" aria-hidden="true" />
            {t('transports.departures')}
            {departures.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                {departures.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Arrivals Tab Content */}
        <TabsContent value="arrivals" className="mt-6">
          <TransportList
            transports={arrivals}
            personsMap={personsMap}
            onEdit={handleEdit}
            onDelete={handleDeleteClick}
            dateLocale={dateLocale}
            emptyTitle={t('transports.empty')}
            emptyDescription={t('transports.emptyDescription')}
          />
        </TabsContent>

        {/* Departures Tab Content */}
        <TabsContent value="departures" className="mt-6">
          <TransportList
            transports={departures}
            personsMap={personsMap}
            onEdit={handleEdit}
            onDelete={handleDeleteClick}
            dateLocale={dateLocale}
            emptyTitle={t('transports.empty')}
            emptyDescription={t('transports.emptyDescription')}
          />
        </TabsContent>
      </Tabs>

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
        title={t('transports.deleteConfirmTitle', 'Delete transport?')}
        description={t('transports.deleteConfirm')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
});

TransportListPage.displayName = 'TransportListPage';

// ============================================================================
// Exports
// ============================================================================

export { TransportListPage };
export default TransportListPage;
