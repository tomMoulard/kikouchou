/**
 * @fileoverview Trip List Page - Displays all trips with options to select, create, edit.
 * Main entry point for trip management in the Kikouchou PWA.
 *
 * @module features/trips/pages/TripListPage
 */

import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Luggage, Plus, QrCode } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ViewSwitcher } from '@/components/ui/view-switcher';
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

/**
 * Initial value for the attendee query, hoisted so it is the same object on
 * every render — a fresh `new Map()` there would be a new identity each time.
 */
const EMPTY_PERSONS_BY_TRIP: ReadonlyMap<TripId, Person[]> = new Map();

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

  /**
   * Attendee badges for every card, in one query.
   *
   * The only place in the app that reads `db.persons` outside `PersonContext`,
   * and deliberately so: that context is scoped to the *current* trip, and this
   * page has no current trip — it needs the guests of all of them at once. Going
   * through the context would mean either mounting one provider per card or
   * querying per trip, which is the N+1 this batch replaced.
   *
   * `useLiveQuery` rather than an effect so the badges follow the database the
   * way every context-backed list does: adding a guest updates the card behind
   * it instead of waiting for the next mount.
   */
  const personsByTrip = useLiveQuery(
    async (): Promise<Map<TripId, Person[]>> => {
      const byTrip = new Map<TripId, Person[]>();
      const tripIds = trips.map((trip) => trip.id);
      for (const tripId of tripIds) {
        byTrip.set(tripId, []);
      }
      if (tripIds.length === 0) {
        return byTrip;
      }

      try {
        const persons = await db.persons.where('tripId').anyOf(tripIds).toArray();
        for (const person of persons) {
          // A person whose trip is not on screen is not an error: the query is
          // keyed on ids that were current when it started.
          byTrip.get(person.tripId)?.push(person);
        }

        // By name, because `PersonContext` reads the `[tripId+name]` index and
        // the guests page is therefore in name order. A card that shows the
        // first four of a differently ordered list shows a different four.
        for (const group of byTrip.values()) {
          group.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        }
      } catch (err) {
        // Caught rather than left to propagate: `useLiveQuery` rethrows during
        // render, so a blocked or evicted IndexedDB would take the whole trip
        // list to the error boundary over some badges. Cards without their
        // guests still show every trip, which is the page's actual job.
        console.error('Failed to load persons for trips:', err);
      }
      return byTrip;
    },
    [trips],
    EMPTY_PERSONS_BY_TRIP,
  );

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
          aria-label={t('trips.importFromQrAria')}
          className="hidden sm:flex shrink-0"
        >
          <QrCode className="size-4 mr-2" aria-hidden="true" />
          {t('trips.importFromQr')}
        </Button>
        <Button onClick={handleCreateClick} className="hidden sm:flex">
          <Plus className="size-4 mr-2" aria-hidden="true" />
          {t('trips.new')}
        </Button>
      </div>
    ),
    [handleCreateClick, openImportQr, t],
  );

  const importQrFab = useMemo(
    () => (
      <Button
        type="button"
        onClick={openImportQr}
        size="lg"
        variant="secondary"
        className={cn(
          'fixed bottom-fab-safe right-4 z-10',
          'size-14 rounded-full shadow-lg',
          'sm:hidden',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
        aria-label={t('trips.importFromQrAria')}
      >
        <QrCode className="size-6" aria-hidden="true" />
      </Button>
    ),
    [openImportQr, t],
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
        <div className="flex flex-col pb-second-fab">
          <PageHeader title={t('trips.title')} action={headerAction} />
          <div className="flex items-center justify-center py-20">
            <LoadingState variant="inline" size="lg" />
          </div>
          {importQrFab}
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
        <div className="flex flex-col pb-second-fab">
          <PageHeader title={t('trips.title')} action={headerAction} />
          <div className="py-8">
            <ErrorDisplay error={error} onRetry={handleRetry} />
          </div>
          {importQrFab}
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
        <div className="flex flex-col pb-second-fab">
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
          {importQrFab}
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
      {/*
        `pb-second-fab` on the wrapper, not on the grid.

        `<main>`'s `pb-bottom-stack` already clears one FAB; this page stacks a
        second (QR import) on top of it, and this is the 4rem difference. It
        goes on the wrapper because `RemoteTripsSection` renders *after* the
        grid — so the grid's old `pb-52` protected the trip cards and left the
        remote-trips list, the actual last thing on the page, under both FABs.
      */}
      <div className="flex flex-col pb-second-fab">
        <PageHeader
          title={t('trips.title')}
          action={headerAction}
          titleAccessory={
            <ViewSwitcher
              value={currentView}
              onValueChange={handleViewChange}
              ariaLabel={t('trips.view.ariaLabel')}
              options={[
                { value: 'list', label: t('trips.view.list') },
                { value: 'map', label: t('trips.view.map') },
              ]}
            />
          }
        />

        {currentView === 'map' ? (
          <div>
            <TripsLocationMap trips={trips} height={MAP_VIEW_HEIGHT} asCard={false} />
          </div>
        ) : (
          /* Trip grid */
          <div
            className={cn(
              'grid gap-4',
              'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
              // Bottom clearance lives on the wrapper above and on `<main>`.
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

        {importQrFab}
        <Button
          onClick={handleCreateClick}
          size="lg"
          className={cn(
            'fixed bottom-nav-safe right-4 z-10',
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
