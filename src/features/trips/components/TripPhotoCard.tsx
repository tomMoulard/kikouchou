/**
 * @fileoverview The trip's cover photo on its settings page: shown, and
 * changed or removed in place.
 *
 * A card of its own, like the description, because a photo is saved the
 * moment it is picked: there is nothing to type and nothing to confirm, and
 * holding it until the trip form is submitted would lose it to a navigation.
 *
 * @module features/trips/components/TripPhotoCard
 */

import { type ReactElement, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PhotoField, type PhotoChange } from '@/components/shared/PhotoField';

import { useOfflineAwareNotify } from '@/hooks/useOfflineAwareNotify';
import { usePhotoUrl } from '@/hooks/usePhotoUrl';
import { db } from '@/lib/db/database';
import { setTripPhoto } from '@/lib/db/repositories/photo-repository';
import { notify } from '@/lib/notifications';
import { captureEvent } from '@/lib/posthog';
import type { Trip } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

interface TripPhotoCardProps {
  /** The trip. Its photo is read live, so a change made elsewhere shows. */
  readonly trip: Trip;
  /** False for a viewer trip: the photo is shown and nothing else. */
  readonly canEdit: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Shows a trip's cover photo, and replaces or removes it.
 */
const TripPhotoCard = memo(function TripPhotoCard({
  trip,
  canEdit,
}: TripPhotoCardProps): ReactElement | null {
  const { t } = useTranslation();
  const { notifySuccess } = useOfflineAwareNotify();
  const [isSaving, setIsSaving] = useState(false);

  const photoId = useLiveQuery(
    async () => (await db.trips.get(trip.id))?.photoId,
    [trip.id],
    trip.photoId,
  );
  const url = usePhotoUrl(trip, photoId);
  const alt = t('photos.tripAlt', { name: trip.name });

  const handleChange = useCallback(
    async (change: PhotoChange): Promise<void> => {
      if (change === undefined) {
        return;
      }
      setIsSaving(true);
      try {
        await setTripPhoto(trip.id, change);
        captureEvent('photo_saved', { subject: 'trip', removed: change === null });
        notifySuccess(
          change === null
            ? t('photos.removed', 'Photo removed')
            : t('photos.saved', 'Photo saved'),
        );
      } catch (error) {
        console.error('Failed to save the trip photo:', error);
        notify.error(t('photos.saveFailed', 'The photo could not be saved'));
      } finally {
        setIsSaving(false);
      }
    },
    [notifySuccess, t, trip.id],
  );

  // A viewer with no photo to look at gets no card at all.
  if (!canEdit && url === undefined) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('photos.tripLabel', 'Cover photo')}</CardTitle>
      </CardHeader>
      <CardContent>
        {canEdit ? (
          <PhotoField
            label={t('photos.tripFieldLabel', 'Photo shown on the trip card')}
            storedUrl={url}
            value={undefined}
            onChange={(change) => void handleChange(change)}
            alt={alt}
            disabled={isSaving}
          />
        ) : (
          <img src={url} alt={alt} className="h-40 w-full rounded-md border object-cover" />
        )}
      </CardContent>
    </Card>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { TripPhotoCard };
export type { TripPhotoCardProps };
