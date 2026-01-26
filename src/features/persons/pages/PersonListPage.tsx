/**
 * @fileoverview Person List Page - Displays and manages trip participants.
 * Shows persons as cards with their color indicator and transport summary.
 *
 * Route: /trips/:tripId/persons
 *
 * Features:
 * - Lists persons as cards in responsive grid
 * - Shows person color indicator and name
 * - Displays arrival/departure transport summary for each person
 * - Add person action (FAB on mobile, header button on desktop)
 * - Empty state for trips with no persons
 *
 * @module features/persons/pages/PersonListPage
 * @see RoomListPage.tsx for reference implementation pattern
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
import { format, parseISO } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import { Plus, Users, Plane } from 'lucide-react';

import { useTripContext } from '@/contexts/TripContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { LoadingState } from '@/components/shared/LoadingState';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Person, PersonId } from '@/types';

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
  } | null;
  /** Departure transport info, if any */
  readonly departure: {
    readonly datetime: string;
    readonly location: string;
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
  /** Callback when the card is clicked */
  readonly onClick: (personId: PersonId) => void;
  /** Whether interaction is disabled */
  readonly isDisabled?: boolean;
  /** Date locale for formatting */
  readonly dateLocale: typeof fr | typeof enUS;
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
 * Safely formats a datetime string for display.
 * Returns formatted date or empty string on error.
 *
 * @param datetime - ISO datetime string
 * @param locale - date-fns locale object
 * @returns Formatted date string (e.g., "15 Jul")
 */
function formatTransportDate(
  datetime: string,
  locale: typeof fr | typeof enUS,
): string {
  try {
    const date = parseISO(datetime);
    if (isNaN(date.getTime())) return '';
    return format(date, 'd MMM', { locale });
  } catch {
    return '';
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
  onClick,
  isDisabled = false,
  dateLocale,
}: PersonCardProps): ReactElement {
  const { t } = useTranslation();

  // Handle keyboard activation (Enter or Space)
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (isDisabled) return;

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick(person.id);
      }
    },
    [person.id, onClick, isDisabled],
  );

  // Handle click
  const handleClick = useCallback(() => {
    if (isDisabled) return;
    onClick(person.id);
  }, [person.id, onClick, isDisabled]);

  // Build aria-label for screen readers
  const ariaLabel = useMemo(() => {
    const parts = [person.name];
    if (transportSummary.arrival) {
      parts.push(`${t('transports.arrival')}: ${formatTransportDate(transportSummary.arrival.datetime, dateLocale)}`);
    }
    if (transportSummary.departure) {
      parts.push(`${t('transports.departure')}: ${formatTransportDate(transportSummary.departure.datetime, dateLocale)}`);
    }
    return parts.join(', ');
  }, [person.name, transportSummary, dateLocale, t]);

  const hasTransportInfo = transportSummary.arrival || transportSummary.departure;

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
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {hasTransportInfo ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            {/* Arrival info */}
            {transportSummary.arrival && (
              <div className="flex items-center gap-2">
                <Plane className="size-4 shrink-0" aria-hidden="true" />
                <span className="font-medium text-foreground">
                  {formatTransportDate(transportSummary.arrival.datetime, dateLocale)}
                </span>
                <span className="truncate" title={transportSummary.arrival.location}>
                  {transportSummary.arrival.location}
                </span>
              </div>
            )}

            {/* Departure info */}
            {transportSummary.departure && (
              <div className="flex items-center gap-2">
                <Plane className="size-4 shrink-0 rotate-45" aria-hidden="true" />
                <span className="font-medium text-foreground">
                  {formatTransportDate(transportSummary.departure.datetime, dateLocale)}
                </span>
                <span className="truncate" title={transportSummary.departure.location}>
                  {transportSummary.departure.location}
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            {t('transports.empty', 'No transport info')}
          </p>
        )}
      </CardContent>
    </Card>
  );
});

PersonCard.displayName = 'PersonCard';

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
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { tripId: tripIdFromUrl } = useParams<'tripId'>();

  // Context hooks
  const { currentTrip, isLoading: isTripLoading } = useTripContext();
  const { persons, isLoading: isPersonsLoading, error: personsError } = usePersonContext();
  const { getTransportsByPerson, isLoading: isTransportsLoading } = useTransportContext();

  // Track if we're currently navigating to prevent double-clicks
  const isNavigatingRef = useRef(false);
  const [isNavigating, setIsNavigating] = useState(false);

  // Combined loading state (includes transports to avoid "no transport info" flash)
  const isLoading = isTripLoading || isPersonsLoading || isTransportsLoading;

  // Get date locale based on current language
  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  // Validate tripId matches current trip
  const tripMismatch = useMemo(() => {
    if (!tripIdFromUrl || !currentTrip) return false;
    return tripIdFromUrl !== currentTrip.id;
  }, [tripIdFromUrl, currentTrip]);

  // Calculate transport summaries for all persons
  // Uses single-pass O(n) algorithm instead of sort-based O(n log n)
  const personsWithTransports = useMemo(() => {
    return persons.map((person) => {
      const transports = getTransportsByPerson(person.id);

      // Single-pass algorithm to find earliest arrival and latest departure
      let earliestArrival: { datetime: string; location: string } | null = null;
      let latestDeparture: { datetime: string; location: string } | null = null;

      for (const transport of transports) {
        if (transport.type === 'arrival') {
          if (!earliestArrival || transport.datetime < earliestArrival.datetime) {
            earliestArrival = {
              datetime: transport.datetime,
              location: transport.location,
            };
          }
        } else {
          // type === 'departure'
          if (!latestDeparture || transport.datetime > latestDeparture.datetime) {
            latestDeparture = {
              datetime: transport.datetime,
              location: transport.location,
            };
          }
        }
      }

      const transportSummary: TransportSummary = {
        arrival: earliestArrival,
        departure: latestDeparture,
      };

      return { person, transportSummary };
    });
  }, [persons, getTransportsByPerson]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles person card click - navigates to person detail/edit page.
   */
  const handlePersonClick = useCallback(
    (personId: PersonId) => {
      if (isNavigatingRef.current) return;

      isNavigatingRef.current = true;
      setIsNavigating(true);

      // Navigate to person edit page
      navigate(`/trips/${tripIdFromUrl}/persons/${personId}/edit`);
    },
    [navigate, tripIdFromUrl],
  );

  /**
   * Handles add person button click.
   */
  const handleAddPerson = useCallback(() => {
    // TODO: Replace with PersonDialog when available (Task 7.4)
    navigate(`/trips/${tripIdFromUrl}/persons/new`);
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
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4 min-h-[200px]">
          <div className="text-center" role="alert" aria-live="assertive">
            <p className="text-lg font-semibold text-destructive">
              {t('errors.loadingFailed')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {personsError.message}
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
        {personsWithTransports.map(({ person, transportSummary }) => (
          <div key={person.id} role="listitem">
            <PersonCard
              person={person}
              transportSummary={transportSummary}
              onClick={handlePersonClick}
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
    </div>
  );
});

PersonListPage.displayName = 'PersonListPage';

// ============================================================================
// Exports
// ============================================================================

export { PersonListPage };
export default PersonListPage;
