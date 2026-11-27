/**
 * @fileoverview Trip Create Page: the wizard that creates every new trip.
 *
 * @module features/trips/pages/TripCreatePage
 */

import { type ReactElement, memo, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUnsavedChanges } from '@/hooks';
import { useShortLandscapeViewport } from '@/hooks/usePhoneViewport';

import { PageHeader } from '@/components/shared/PageHeader';
import { UnsavedChangesDialog } from '@/components/shared/UnsavedChangesDialog';
import { Card, CardContent } from '@/components/ui/card';
import { useHideNavigation } from '@/contexts/NavigationVisibilityContext';
import { TripCreateWizard } from '@/features/trips/components/TripCreateWizard';
import { useAuth } from '@/features/auth/AuthContext';
import { getAccountGuestName } from '@/features/auth/display-name';
import { holdRewards } from '@/lib/achievements/reward-hold';
import { setCurrentTrip } from '@/lib/db';
import { cn } from '@/lib/utils';
import type { Trip } from '@/types';
import { reportError } from '@/lib/posthog';

// ============================================================================
// Component
// ============================================================================

/**
 * Page component for creating a new trip.
 *
 * Every new trip goes through `TripCreateWizard`: the name, then the invite
 * link. The one-page form a returning visitor used to get was removed on
 * 2026-11-27, so the first trip and the tenth are created the same way. The
 * dates, the place, the guests and the rooms are filled in on the trip once
 * it exists.
 *
 * @returns The trip create page element
 *
 * @example
 * ```tsx
 * // In router configuration
 * <Route path="/trips/new" element={<TripCreatePage />} />
 * ```
 */
export const TripCreatePage = memo(function TripCreatePage(): ReactElement {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();

  /**
   * How much vertical room the page may spend on its own frame.
   *
   * `Layout` drops the header, the sidebar and the bottom bar on this route at
   * this viewport; spending the height it just gave back on the page's own
   * padding and heading would undo half of it. Same query on both sides, so
   * the two decisions cannot disagree.
   */
  const isShortLandscape = useShortLandscapeViewport();
  const containerClass = cn(
    'container mx-auto max-w-2xl',
    isShortLandscape ? 'py-2' : 'py-6 md:py-8',
  );
  const headerClass = isShortLandscape ? 'gap-2 pb-2 md:pb-2' : undefined;

  /*
    No navigation beside the wizard. It asks one question at a time, and the
    bar only competes with it; on a first visit every trip tab is disabled
    anyway. The page keeps its own back link.
  */
  useHideNavigation(true);

  /*
    The wizard ends on its sign-in screen, and creating the trip unlocks the
    first achievement. Its toast sat over the sign-in buttons, so the
    message waits until the visitor leaves the wizard.
  */
  useEffect(() => holdRewards(), []);

  /**
   * The creator's own guest row, when the account gives a name.
   *
   * `undefined` signed out, and signed out is a first-class way to use this
   * app: the guest then adds themself through the invite link like everybody
   * else.
   */
  const currentUserName = getAccountGuestName(user);

  // ============================================================================
  // Dirty State & Unsaved Changes Guard
  // ============================================================================

  const [isDirty, setIsDirty] = useState(false);
  const { isBlocked, proceed, reset, skipNextBlock } = useUnsavedChanges(isDirty);

  const handleDirtyChange = useCallback((dirty: boolean) => {
    setIsDirty(dirty);
  }, []);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * The wizard's way out: it has already created the trip and celebrated.
   *
   * The trip is selected here rather than at creation (see `selectAsCurrent`
   * in `lib/create-trip-with-details`) so the wizard survives to its done
   * screen.
   */
  const handleWizardCreated = useCallback(
    async (trip: Trip): Promise<void> => {
      setIsDirty(false);
      skipNextBlock();

      // The trip is made and celebrated by this point, so a failure to select it
      // must not strand the reader on the invite screen with no way on and nothing
      // said. Reported, then navigated anyway: the calendar selects the trip
      // from the route.
      try {
        await setCurrentTrip(trip.id);
      } catch (error) {
        reportError(error, { source: 'TripCreatePage.handleWizardCreated' });
      }
      navigate(`/trips/${trip.id}/calendar`);
    },
    [navigate, skipNextBlock],
  );

  /**
   * Handles cancel action by navigating back to trips list.
   * Reset dirty state first so the unsaved changes dialog doesn't appear.
   */
  const handleCancel = useCallback(() => {
    setIsDirty(false);
    skipNextBlock();
    navigate('/trips');
  }, [navigate, skipNextBlock]);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className={containerClass}>
      <PageHeader title={t('trips.new')} backLink="/trips" className={headerClass} />
      <Card>
        <CardContent className={isShortLandscape ? 'pt-4' : 'pt-6'}>
          <TripCreateWizard
            currentUserName={currentUserName}
            onCreated={(trip) => void handleWizardCreated(trip)}
            onCancel={handleCancel}
            onDirtyChange={handleDirtyChange}
          />
        </CardContent>
      </Card>
      <UnsavedChangesDialog open={isBlocked} onStay={reset} onLeave={proceed} />
    </div>
  );
});
