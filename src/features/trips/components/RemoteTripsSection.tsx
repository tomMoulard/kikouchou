/**
 * @fileoverview Trips this account is on that are not on this device yet.
 *
 * The case that makes this necessary: join a trip on your phone, then open the
 * app on a laptop. The membership exists server-side, but the laptop has no
 * local `Trip` row — so without this the laptop shows "no trips yet" and offers
 * no way in at all. That is why it renders inside the empty state as well as
 * below a populated list.
 *
 * Since signing in sweeps the whole account onto the device — see
 * `lib/sync/AccountTripSync` — this list is usually empty, and empty is what it
 * should be: it renders nothing at all when there is nothing left over. What it
 * still covers is everything the sweep could not do. A trip whose download
 * failed, one that appeared on the server while this device was offline and has
 * not reconnected, one added by another member between sweeps. Those need a way
 * in that does not involve relaunching the app, and this is it.
 *
 * The names here are the server's denormalised preview, not the document: this
 * device has no document for these trips yet, which is the whole reason the
 * section exists. Downloading one replaces the preview with the real thing.
 *
 * @module features/trips/components/RemoteTripsSection
 */

import { type ReactElement, memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CloudDownload, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useRemoteTrips, type RemoteOnlyTrip } from '../hooks/useRemoteTrips';

// ============================================================================
// Type Definitions
// ============================================================================

interface RemoteTripsSectionProps {
  /** Recomputes the list when the local trips change. */
  readonly localTripCount: number;
}

// ============================================================================
// Component
// ============================================================================

export const RemoteTripsSection = memo(function RemoteTripsSection({
  localTripCount,
}: RemoteTripsSectionProps): ReactElement | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { remoteOnly, download, isDownloading } = useRemoteTrips(localTripCount);

  const handleDownload = useCallback(
    async (trip: RemoteOnlyTrip): Promise<void> => {
      const tripId = await download(trip.id);
      if (tripId !== null) {
        void navigate(`/trips/${tripId}/calendar`);
      }
    },
    [download, navigate],
  );

  // Nothing to add: signed out, offline, or every trip is already here. None of
  // those is worth a heading.
  if (remoteOnly.length === 0) {
    return null;
  }

  return (
    <section className="mt-8 flex flex-col gap-3" aria-labelledby="remote-trips-heading">
      <div className="flex flex-col gap-1">
        <h2 id="remote-trips-heading" className="text-sm font-semibold">
          {t('trips.remote.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('trips.remote.description')}
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {remoteOnly.map((trip) => (
          <li key={trip.id}>
            <Button
              variant="outline"
              className="h-auto w-full justify-start gap-2 py-3"
              onClick={() => void handleDownload(trip)}
              disabled={isDownloading !== null}
            >
              {isDownloading === trip.id ? (
                <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
              ) : (
                <CloudDownload
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <span className="min-w-0 flex-1 truncate text-left">
                {/* The server's preview row is the only thing this device knows
                    about the trip, and it can be blank — a row written before
                    the name was set, or by a client that is not this one. The
                    placeholder is translated here rather than invented in the
                    sync layer, which has no language. */}
                {trip.name || t('trips.untitled')}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t('trips.remote.download')}
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
});
