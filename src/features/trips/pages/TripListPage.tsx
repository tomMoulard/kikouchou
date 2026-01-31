/**
 * @fileoverview Trip List Page - Displays all trips with options to select, create, edit.
 * Main entry point for trip management in the Kikoushou PWA.
 *
 * @module features/trips/pages/TripListPage
 */

import { type KeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { type Locale, format, parseISO } from 'date-fns';
import { enUS, fr } from 'date-fns/locale';
import { Calendar, Luggage, MapPin, Plus, Users } from 'lucide-react';

import { useTripContext } from '@/contexts/TripContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getPersonsByTripId } from '@/lib/db';
import type { Person, Trip, TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** Maximum number of person badges to show before "+N more" */
const MAX_VISIBLE_PERSONS = 4;

/**
 * Props for the TripCard component.
 */
interface TripCardProps {
  /** The trip to display */
  readonly trip: Trip;
  /** Persons attending this trip */
  readonly persons: readonly Person[];
  /** Callback when the trip is selected */
  readonly onSelect: (trip: Trip) => void;
  /** Whether the card interaction is currently disabled */
  readonly isDisabled?: boolean;
  /** Date-fns locale for date formatting */
  readonly locale: Locale;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Formats a date range for display.
 * Handles same month and different month cases for cleaner output.
 *
 * @param startDate - Start date in ISO format (YYYY-MM-DD)
 * @param endDate - End date in ISO format (YYYY-MM-DD)
 * @param locale - date-fns locale object
 * @returns Formatted date range string
 *
 * @example
 * // Same month
 * formatDateRange('2024-07-15', '2024-07-22', fr) // "15 - 22 juil. 2024"
 *
 * // Different months
 * formatDateRange('2024-07-28', '2024-08-05', fr) // "28 juil. - 5 août 2024"
 */
function formatDateRange(
  startDate: string,
  endDate: string,
  locale: Locale,
): string {
  try {
    const start = parseISO(startDate),
     end = parseISO(endDate),

    // Check if dates are in the same month and year
     sameMonth =
      start.getMonth() === end.getMonth() &&
      start.getFullYear() === end.getFullYear();

    if (sameMonth) {
      // Same month: "15 - 22 juil. 2024"
      return `${format(start, 'd', { locale })} - ${format(end, 'd MMM yyyy', { locale })}`;
    }

    // Different months: "28 juil. - 5 août 2024"
    return `${format(start, 'd MMM', { locale })} - ${format(end, 'd MMM yyyy', { locale })}`;
  } catch {
    // Fallback to raw ISO strings if parsing fails
    return `${startDate} - ${endDate}`;
  }
}

/**
 * Gets the date-fns locale based on a language code.
 */
function getDateLocale(lang: string): Locale {
  return lang === 'fr' ? fr : enUS;
}

// ============================================================================
// TripCard Component
// ============================================================================

/**
 * Individual trip card component displaying trip information.
 * Supports click and keyboard interaction for accessibility.
 */
const TripCard = memo(({
  trip,
  persons,
  onSelect,
  isDisabled = false,
  locale,
}: TripCardProps) => {
  const { t } = useTranslation(),
   dateRange = useMemo(
    () => formatDateRange(trip.startDate, trip.endDate, locale),
    [trip.startDate, trip.endDate, locale],
  ),

  // Persons to show vs overflow count
   visiblePersons = useMemo(
    () => persons.slice(0, MAX_VISIBLE_PERSONS),
    [persons],
  ),
   overflowCount = useMemo(
    () => Math.max(0, persons.length - MAX_VISIBLE_PERSONS),
    [persons],
  ),

  // Handle keyboard activation (Enter or Space)
   handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (isDisabled) {return;}

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(trip);
      }
    },
    [trip, onSelect, isDisabled],
  ),

  // Handle click
   handleClick = useCallback(() => {
    if (isDisabled) {return;}
    onSelect(trip);
  }, [trip, onSelect, isDisabled]);

  return (
    <Card
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      aria-label={`${trip.name}${trip.location ? `, ${trip.location}` : ''}, ${dateRange}`}
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
        <CardTitle
          className="text-lg truncate"
          title={trip.name}
        >
          {trip.name}
        </CardTitle>
        {trip.location && (
          <CardDescription className="flex items-center gap-1.5 truncate">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate" title={trip.location}>
              {trip.location}
            </span>
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Date range */}
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Calendar className="size-4 shrink-0" aria-hidden="true" />
          <span>{dateRange}</span>
        </div>

        {/* Attendees */}
        <div className="flex items-center gap-1.5">
          <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {persons.length === 0 ? (
            <span className="text-sm text-muted-foreground italic">
              {t('trips.noGuests', 'No guests yet')}
            </span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {visiblePersons.map((person) => (
                <PersonBadge key={person.id} person={person} size="sm" />
              ))}
              {overflowCount > 0 && (
                <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded-full">
                  +{overflowCount}
                </span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

TripCard.displayName = 'TripCard';

// ============================================================================
// TripListPage Component
// ============================================================================

/**
 * Main trip list page component.
 * Displays all trips, handles loading/error/empty states, and provides navigation.
 *
 * @example
 * ```tsx
 * // In router configuration
 * { path: '/trips', element: <TripListPage /> }
 * ```
 */
const TripListPage = memo(() => {
  const { t, i18n } = useTranslation(),
   navigate = useNavigate(),
   { trips, isLoading, error, setCurrentTrip, checkConnection } =
    useTripContext(),

  // Track if we're currently navigating to prevent double-clicks
  // Using ref for guard check to avoid stale closure issues
   isNavigatingRef = useRef(false),
   [isNavigating, setIsNavigating] = useState(false),

  // Persons per trip (map of tripId -> persons)
   [personsByTrip, setPersonsByTrip] = useState<Map<TripId, Person[]>>(new Map()),

  // Get locale based on current language, reactive to language changes
   locale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  // Fetch persons for all trips when trips change
  useEffect(() => {
    async function loadPersons() {
      if (trips.length === 0) {
        setPersonsByTrip(new Map());
        return;
      }

      const newMap = new Map<TripId, Person[]>();
      await Promise.all(
        trips.map(async (trip) => {
          try {
            const persons = await getPersonsByTripId(trip.id);
            newMap.set(trip.id, persons);
          } catch {
            // If fetch fails, just show empty array
            newMap.set(trip.id, []);
          }
        }),
      );
      setPersonsByTrip(newMap);
    }

    loadPersons();
  }, [trips]);

  const

  /**
   * Handles trip selection: sets current trip and navigates to calendar.
   */
   handleTripSelect = useCallback(
    async (trip: Trip) => {
      // Use ref for guard to prevent stale closure issues
      if (isNavigatingRef.current) {return;}

      isNavigatingRef.current = true;
      setIsNavigating(true);
      try {
        await setCurrentTrip(trip.id);
        navigate(`/trips/${trip.id}/calendar`);
      } catch (err) {
        // Error is already captured in context, just reset navigation state
        console.error('Failed to select trip:', err);
      } finally {
        // Always reset state (component may unmount on success, but this is safe)
        isNavigatingRef.current = false;
        setIsNavigating(false);
      }
    },
    [setCurrentTrip, navigate],
  ),

  /**
   * Handles create button click - navigates to trip creation form.
   */
   handleCreateClick = useCallback(() => {
    navigate('/trips/new');
  }, [navigate]),

  /**
   * Handles retry when there's an error.
   */
   handleRetry = useCallback(async () => {
    try {
      await checkConnection();
    } catch {
      // Error is captured in context
    }
  }, [checkConnection]),

  // Create button for header action (desktop)
   headerAction = useMemo(
    () => (
      <Button onClick={handleCreateClick} className="hidden sm:flex">
        <Plus className="size-4 mr-2" aria-hidden="true" />
        {t('trips.new')}
      </Button>
    ),
    [handleCreateClick, t],
  );

  // ============================================================================
  // Render: Loading State
  // ============================================================================

  if (isLoading) {
    return (
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <PageHeader title={t('trips.title')} />
        <div className="flex-1 flex items-center justify-center">
          <LoadingState variant="inline" size="lg" />
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render: Error State
  // ============================================================================

  if (error) {
    return (
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <PageHeader title={t('trips.title')} />
        <ErrorDisplay error={error} onRetry={handleRetry} />
      </div>
    );
  }

  // ============================================================================
  // Render: Empty State
  // ============================================================================

  if (trips.length === 0) {
    return (
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <PageHeader title={t('trips.title')} />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={Luggage}
            title={t('trips.empty')}
            description={t('trips.emptyDescription')}
            action={{
              label: t('trips.new'),
              onClick: handleCreateClick,
            }}
          />
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render: Trip List
  // ============================================================================

  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)]">
      <PageHeader title={t('trips.title')} action={headerAction} />

      {/* Trip grid */}
      <div
        className={cn(
          'grid gap-4',
          'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
          // Extra bottom padding for FAB on mobile
          'pb-20 sm:pb-4',
        )}
        role="list"
        aria-label={t('trips.title')}
      >
        {trips.map((trip) => (
          <div key={trip.id} role="listitem">
            <TripCard
              trip={trip}
              persons={personsByTrip.get(trip.id) ?? []}
              onSelect={handleTripSelect}
              isDisabled={isNavigating}
              locale={locale}
            />
          </div>
        ))}
      </div>

      {/* Floating Action Button for mobile */}
      <Button
        onClick={handleCreateClick}
        size="lg"
        className={cn(
          'fixed bottom-20 right-4 z-10',
          'size-14 rounded-full shadow-lg',
          'sm:hidden',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
        aria-label={t('trips.new')}
      >
        <Plus className="size-6" aria-hidden="true" />
      </Button>
    </div>
  );
});

TripListPage.displayName = 'TripListPage';

// ============================================================================
// Exports
// ============================================================================

export { TripListPage };
export default TripListPage;
