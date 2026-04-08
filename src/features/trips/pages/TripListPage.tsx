/**
 * @fileoverview Trip List Page - Displays all trips with options to select, create, edit.
 * Main entry point for trip management in the Kikoushou PWA.
 *
 * @module features/trips/pages/TripListPage
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Luggage, Plus, QrCode } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { PageHeader } from '@/components/shared/PageHeader';
import { ImportTripQrDialog, ShareDialog } from '@/features/sharing';
import { useTripContext } from '@/contexts/TripContext';
import { cn } from '@/lib/utils';
import { db } from '@/lib/db/database';
import type { Person, Trip, TripId } from '@/types';
import { TripCard } from '../components/TripCard';

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
  const [importQrOpen, setImportQrOpen] = useState(false);
  const [shareDialogTrip, setShareDialogTrip] = useState<Trip | null>(null);

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
    setShareDialogTrip(trip);
  }, []);

  const handleShareDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setShareDialogTrip(null);
    }
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

  // ============================================================================
  // Render: Loading State
  // ============================================================================

  if (isLoading) {
    return (
      <>
        <div className="flex flex-col min-h-[calc(100vh-4rem)]">
          <PageHeader title={t('trips.title')} action={headerAction} />
          <div className="flex-1 flex items-center justify-center">
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
        <div className="flex flex-col min-h-[calc(100vh-4rem)]">
          <PageHeader title={t('trips.title')} action={headerAction} />
          <ErrorDisplay error={error} onRetry={handleRetry} />
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
        <div className="flex flex-col min-h-[calc(100vh-4rem)]">
          <PageHeader title={t('trips.title')} action={headerAction} />
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
        <ImportTripQrDialog open={importQrOpen} onOpenChange={setImportQrOpen} />
      </>
    );
  }

  // ============================================================================
  // Render: Trip List
  // ============================================================================

  return (
    <>
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <PageHeader title={t('trips.title')} action={headerAction} />

        {/* Trip grid */}
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
        open={shareDialogTrip !== null}
        onOpenChange={handleShareDialogOpenChange}
        trip={shareDialogTrip ?? undefined}
      />
    </>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { TripListPage };


