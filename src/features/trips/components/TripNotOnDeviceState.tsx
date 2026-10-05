/**
 * @fileoverview What a trip page shows when this device does not hold the
 * trip its URL names.
 *
 * Trips are stored per device, so a `/trips/<id>/…` link copied from another
 * device, or from another person, opens on a device that has never seen the
 * trip. The generic "does not exist or you do not have access" message gave no
 * hint of what to do next. This one says why, and offers the two ways out: the
 * trip list, which also lists the trips of a signed-in account, and the same
 * "scan or paste an invite" dialog the trip list offers.
 *
 * @module features/trips/components/TripNotOnDeviceState
 */

import { type ReactElement, memo, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Smartphone } from 'lucide-react';

import { EmptyState } from '@/components/shared/EmptyState';
import { ImportTripQrDialog } from '@/features/sharing/components/ImportTripQrDialog';

// ============================================================================
// Component
// ============================================================================

export const TripNotOnDeviceState = memo(function TripNotOnDeviceState(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [importOpen, setImportOpen] = useState(false);

  const handleBackToTrips = useCallback(() => {
    navigate('/trips');
  }, [navigate]);

  const handleOpenImport = useCallback(() => {
    setImportOpen(true);
  }, []);

  return (
    <>
      <EmptyState
        icon={Smartphone}
        title={t('errors.tripNotOnDevice')}
        description={t('errors.tripNotOnDeviceDescription')}
        action={{ label: t('errors.backToTrips'), onClick: handleBackToTrips }}
        secondaryAction={{ label: t('trips.joinWithInvite'), onClick: handleOpenImport }}
      />
      <ImportTripQrDialog open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
});
