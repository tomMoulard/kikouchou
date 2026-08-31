/**
 * @fileoverview Trip List Page - Displays all trips with options to select, create, edit.
 * Main entry point for trip management in the Kikoushou PWA.
 *
 * @module features/trips/pages/TripListPage
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Luggage, Plus, QrCode } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { PageHeader } from '@/components/shared/PageHeader';
import {
  ImportTripQrDialog,
  ShareDialog,
} from '@/features/sharing';
import { useTripContext } from '@/contexts/TripContext';
import { RemoteTripsSection } from '../components/RemoteTripsSection';
import { cn } from '@/lib/utils';
import { db } from '@/lib/db/database';
import type { Person, Trip, TripId } from '@/types';
import { TripCard } from '../components/TripCard';
import { TripsLocationMap } from '../components/TripsLocationMap';

// ============================================================================
// Constants
// ============================================================================

/** Height of the map view on the trip list, in pixels. */
const MAP_VIEW_HEIGHT = 520;

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
const TripListPage = memo(function TripListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { trips, isLoading, error, setCurrentTrip, checkConnection } =
    useTripContext();

  // Track if we're currently navigating to prevent double-clicks
  // Using ref for guard check to avoid stale closure issues
  const isNavigatingRef = useRef(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // The chosen view lives in the URL, like the rooms page: opening a trip and
  // coming back lands on the same view instead of snapping back to the list.
  const currentView = useMemo(
    () => (searchParams.get('view') === 'map' ? 'map' : 'list'),
    [searchParams],
  );

  const handleViewChange = useCallback(
    (nextValue: string) => {
      const view = nextValue === 'map' ? 'map' : 'list';
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('view', view);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const [importQrOpen, setImportQrOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [sharedTripId, setSharedTripId] = useState<TripId | null>(null);
  const sharedTrip = useMemo(
    () => trips.find((trip) => trip.id === sharedTripId) ?? null,
    [sharedTripId, trips],
  );

  // Persons per trip (map of tripId -> persons)
  const [personsByTrip, setPersonsByTrip] = useState<Map<TripId, Person[]>>(
    new Map(),
  );

  // Fetch persons for all trips when trips change
  // Uses batch query for O(1) instead of O(n) queries (PERF-1 fix)
  // Uses isMounted flag to prevent state updates after unmount (IMP-2 fix)
  useEffect(() => {
    let isMounted = true;

    async function loadPersons() {
      if (trips.length === 0) {
        if (isMounted) {
          setPersonsByTrip(new Map());
        }
        return;
      }

      try {
        // Use batch query instead of N+1 individual queries (PERF-1 fix)
        const allTripIds = trips.map((t) => t.id);
        const allPersons = await db.persons
          .where('tripId')
          .anyOf(allTripIds)
          .toArray();

        // Group persons by tripId
        const newMap = new Map<TripId, Person[]>();
        // Initialize all trips with empty arrays
        for (const tripId of allTripIds) {
          newMap.set(tripId, []);
        }
        // Populate with fetched persons
        for (const person of allPersons) {
          const existing = newMap.get(person.tripId);
          if (existing) {
            existing.push(person);
          }
        }

        // Only update state if component is still mounted
        if (isMounted) {
          setPersonsByTrip(newMap);
        }
      } catch (err) {
        // Log error for debugging (CR-3 fix)
        console.error('Failed to load persons for trips:', err);
        // Set empty map on error
        if (isMounted) {
          setPersonsByTrip(new Map());
        }
      }
    }

    loadPersons();

    return () => {
      isMounted = false;
    };
  }, [trips]);

  const handleTripSelect = useCallback(
    async (trip: Trip) => {
      // Use ref for guard to prevent stale closure issues
      if (isNavigatingRef.current) {
        return;
      }

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
  );

  const handleCreateClick = useCallback(() => {
    navigate('/trips/new');
  }, [navigate]);

  const handleRetry = useCallback(async () => {
    try {
      await checkConnection();
    } catch {
      // Error is captured in context
    }
  }, [checkConnection]);
  const openImportQr = useCallback(() => {
    setImportQrOpen(true);
  }, []);

  const handleShareTrip = useCallback((trip: Trip) => {
    setSharedTripId(trip.id);
    setShareDialogOpen(true);
  }, []);

  const handleShareDialogOpenChange = useCallback((open: boolean) => {
    setShareDialogOpen(open);
  }, []);


  const headerAction = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={openImportQr}
          aria-label={t('trips.importFromQrAria', 'Import a shared trip using a QR code')}
          className="shrink-0"
        >
          <QrCode className="size-4 sm:mr-2" aria-hidden="true" />
          <span className="hidden sm:inline">{t('trips.importFromQr', 'Import from QR code')}</span>
        </Button>
        <Button onClick={handleCreateClick} className="hidden sm:flex">
          <Plus className="size-4 mr-2" aria-hidden="true" />
          {t('trips.new')}
        </Button>
      </div>
    ),
    [handleCreateClick, openImportQr, t],
  );

  /**
   * Nothing to keep online any more.
   *
   * A second Yjs binding used to be mounted here so a trip stayed connected
   * while its Share dialog was open — WebRTC needed both peers present at the
   * same moment. The server holds the log now, so the other side can arrive
   * whenever it likes and there is nothing to hold open.
   */

  // ============================================================================
  // Render: Loading State
  // ============================================================================

  if (isLoading) {
    return (
      <>
        <div className="flex flex-col">
          <PageHeader title={t('trips.title')} action={headerAction} />
          <div className="flex items-center justify-center py-20">
            <LoadingState variant="inline" size="lg" />
          </div>
        </div>
        <ImportTripQrDialog open={importQrOpen} onOpenChange={setImportQrOpen} />
      </>
    );
  }

  // ============================================================================
  // Render: Error State
  // ============================================================================

  if (error) {
    return (
      <>
        <div className="flex flex-col">
          <PageHeader title={t('trips.title')} action={headerAction} />
          <div className="py-8">
            <ErrorDisplay error={error} onRetry={handleRetry} />
          </div>
        </div>
        <ImportTripQrDialog open={importQrOpen} onOpenChange={setImportQrOpen} />
      </>
    );
  }

  // ============================================================================
  // Render: Empty State
  // ============================================================================

  if (trips.length === 0) {
    return (
      <>
        <div className="flex flex-col">
          <PageHeader title={t('trips.title')} action={headerAction} />
          <div className="flex items-center justify-center py-16 sm:py-24">
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
          {/* Load-bearing here specifically: joining on a phone and then opening
              a laptop leaves this device with no local trips at all, and without
              this the laptop offers no way into the trip. */}
          <RemoteTripsSection localTripCount={0} />
        </div>
        <ImportTripQrDialog open={importQrOpen} onOpenChange={setImportQrOpen} />
      </>
    );
  }

  // ============================================================================
  // Render: Trip List
  // ============================================================================

  return (
    <>
      <div className="flex flex-col">
        <PageHeader title={t('trips.title')} action={headerAction} />

        <Tabs value={currentView} onValueChange={handleViewChange} className="mb-4">
          <TabsList aria-label={t('trips.view.ariaLabel', 'Trips view')}>
            <TabsTrigger value="list">{t('trips.view.list', 'List')}</TabsTrigger>
            <TabsTrigger value="map">{t('trips.view.map', 'Map')}</TabsTrigger>
          </TabsList>
        </Tabs>

        {currentView === 'map' ? (
          /* Extra bottom padding for stacked FABs on mobile */
          <div className="pb-52 sm:pb-4">
            <TripsLocationMap trips={trips} height={MAP_VIEW_HEIGHT} asCard={false} />
          </div>
        ) : (
          /* Trip grid */
          <div
            className={cn(
              'grid gap-4',
              'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
              // Extra bottom padding for stacked FABs on mobile
              'pb-52 sm:pb-4',
            )}
            role="list"
            aria-label={t('trips.title')}
          >
            {trips.map((trip) => (
              <div key={trip.id} role="listitem">
                <TripCard
                  trip={trip}
                  persons={personsByTrip.get(trip.id) ?? []}
                  onClick={handleTripSelect}
                  onShare={handleShareTrip}
                  isDisabled={isNavigating}
                />
              </div>
            ))}
          </div>
        )}

        <RemoteTripsSection localTripCount={trips.length} />

        {/* Floating actions — mobile */}
        <Button
          type="button"
          onClick={openImportQr}
          size="lg"
          variant="secondary"
          className={cn(
            'fixed bottom-36 right-4 z-10',
            'size-14 rounded-full shadow-lg',
            'sm:hidden',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
          aria-label={t('trips.importFromQrAria', 'Import a shared trip using a QR code')}
        >
          <QrCode className="size-6" aria-hidden="true" />
        </Button>
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
      <ImportTripQrDialog open={importQrOpen} onOpenChange={setImportQrOpen} />
      <ShareDialog
        open={shareDialogOpen}
        onOpenChange={handleShareDialogOpenChange}
        trip={sharedTrip ?? undefined}
      />
    </>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { TripListPage };
