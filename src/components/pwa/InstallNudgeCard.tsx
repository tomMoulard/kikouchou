/**
 * @fileoverview The one place the app asks a phone to install it, and why.
 *
 * The reason is reminders. A trip shared with this phone has dates worth being
 * told about — the start, your own arrival, a pickup you agreed to drive — and
 * an installed app is the better place to receive them. So the card appears on
 * a shared trip's calendar, on a phone, in a browser tab, and says that; it
 * appears nowhere else. Not on a laptop, where nobody installs a web app. Not
 * on a trip that lives only on this device: nothing will ever be sent about it.
 * Not in the installed app, where it is done.
 *
 * And not where the browser gave us nothing to fire. `beforeinstallprompt` is
 * Chromium's alone, so on an iPhone and in Firefox there is no card at all.
 * Telling somebody to find "Add to Home Screen" in a menu is not an offer to
 * install, it is homework, and a card that cannot install anything is one more
 * thing to dismiss.
 *
 * "Not now" is remembered for 30 days, like the other unsolicited card
 * (`features/trips/hooks/usePlanOwnTripPrompt`).
 *
 * @module components/pwa/InstallNudgeCard
 */

import { type ReactElement, memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { useInstallPromptState } from '@/contexts/InstallPromptContext';
import { usePhoneViewport } from '@/hooks/usePhoneViewport';
import { notify } from '@/lib/notifications';
import { captureEvent } from '@/lib/posthog';
import { cn } from '@/lib/utils';
import type { Trip } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/** LocalStorage key holding the dismissal timestamp. */
const DISMISSAL_STORAGE_KEY = 'kikouchou-install-nudge-dismissed';

/** How long a dismissal hides the card (30 days). */
const DISMISSAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

// ============================================================================
// Type Definitions
// ============================================================================

export interface InstallNudgeCardProps {
  /** The trip on screen. Decides whether there is anything to remind about. */
  readonly trip: Trip;
  readonly className?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function isDismissedRecently(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const dismissedAt = window.localStorage.getItem(DISMISSAL_STORAGE_KEY);
    if (!dismissedAt) {
      return false;
    }
    const timestamp = parseInt(dismissedAt, 10);
    return !Number.isNaN(timestamp) && Date.now() - timestamp < DISMISSAL_DURATION_MS;
  } catch {
    // Private browsing, disabled storage: show the card rather than suppress it.
    return false;
  }
}

function storeDismissal(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(DISMISSAL_STORAGE_KEY, Date.now().toString());
  } catch {
    // Storage refused: the dismissal lasts for this page only.
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * Suggests installing the app for reminders, on a phone, for a shared trip.
 *
 * @param props - The trip and an optional class for the card
 * @returns The card, or null wherever the suggestion does not apply
 */
export const InstallNudgeCard = memo(function InstallNudgeCard({
  trip,
  className,
}: InstallNudgeCardProps): ReactElement | null {
  const { t } = useTranslation();
  const isPhone = usePhoneViewport();
  const { canInstall, isInstalled, isInstalling, install } = useInstallPromptState();

  const [isDismissed, setIsDismissed] = useState<boolean>(isDismissedRecently);

  // A trip nothing is ever sent about is a trip with no reason to install: the
  // reminders come from the server, and a device-only trip has never been there.
  const isShared = trip.viewerToken !== undefined || trip.remoteTripId !== undefined;
  const isVisible = isPhone && isShared && canInstall && !isInstalled && !isDismissed;

  useEffect(() => {
    if (isVisible) {
      captureEvent('install_nudge_shown', {
        trip_access: trip.viewerToken !== undefined ? 'viewer' : 'member',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per appearance: the card is the same card whether or not the trip object was replaced
  }, [isVisible, trip.id]);

  const handleInstall = useCallback(async (): Promise<void> => {
    captureEvent('install_nudge_accepted');
    const success = await install();
    if (!success) {
      notify.error(t('pwa.installFailed', 'Installation failed. Please try again.'));
    }
  }, [install, t]);

  const handleDismiss = useCallback((): void => {
    captureEvent('install_nudge_dismissed');
    storeDismissal();
    setIsDismissed(true);
  }, []);

  if (!isVisible) {
    return null;
  }

  return (
    <Card
      className={cn('border-primary/20', className)}
      role="region"
      aria-label={t('install.nudge.region', 'Install suggestion')}
      data-testid="install-nudge-card"
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <BellRing className="size-6" />
          </div>

          <div className="min-w-0 flex-1">
            <CardTitle className="text-base font-semibold">
              {t('install.nudge.title', 'Get a reminder before the trip')}
            </CardTitle>
            <CardDescription className="mt-1 text-sm">
              {t('install.nudge.description', {
                tripName: trip.name,
                defaultValue:
                  'Install Kikouchou on your phone and it can remind you before {{tripName}} starts, when you arrive, and when a pickup is due.',
              })}
            </CardDescription>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                className="h-11 sm:h-8"
                onClick={() => void handleInstall()}
                disabled={isInstalling}
              >
                {t('pwa.install', 'Install app')}
              </Button>
              <Button size="sm" variant="ghost" className="h-11 sm:h-8" onClick={handleDismiss}>
                {t('pwa.notNow', 'Not now')}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
