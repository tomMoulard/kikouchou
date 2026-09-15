/**
 * @fileoverview The one place the app asks a phone to install it, and why.
 *
 * The reason is reminders. A trip shared with this phone has dates worth being
 * told about — the start, your own arrival, a pickup you agreed to drive — and
 * on an iPhone only an installed app can receive them. So the card appears on
 * a shared trip's calendar, on a phone, in a browser tab, and says that; it
 * appears nowhere else. Not on a laptop, where nobody installs a web app and
 * Firefox cannot. Not on a trip that lives only on this device: nothing will
 * ever be sent about it. Not in the installed app, where it is done.
 *
 * Two ways to say yes, decided by the browser:
 *
 * - Chromium captured `beforeinstallprompt` → one button fires the prompt.
 * - Anything else → "Show me how" hands the phone to the page it should install
 *   *from*. An installed iPhone app has storage separate from Safari's, and a
 *   manifest with no `start_url` opens the Home Screen app on the page it was
 *   added from — so the invite page (viewer) or the trip's own link (member)
 *   puts the trip back in front of the visitor once they open the icon. Those
 *   pages swap the manifest and the global banner shows the steps; see
 *   `lib/pwa/use-here-manifest` and `contexts/InstallPromptContext`.
 *
 * "Not now" is remembered for 30 days, like the other unsolicited card
 * (`features/trips/hooks/usePlanOwnTripPrompt`).
 *
 * @module components/pwa/InstallNudgeCard
 */

import { type ReactElement, memo, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BellRing } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { useInstallPromptState } from '@/contexts/InstallPromptContext';
import { usePhoneViewport } from '@/hooks/usePhoneViewport';
import { installHandoffUrl } from '@/lib/pwa/install-handoff';
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
  const navigate = useNavigate();
  const isPhone = usePhoneViewport();
  const { canInstall, isInstalled, isInstalling, install, manualInstallPlatform, requestInstall } =
    useInstallPromptState();

  const [isDismissed, setIsDismissed] = useState<boolean>(isDismissedRecently);

  const handoffUrl = installHandoffUrl(trip);
  const isVisible = isPhone && !isInstalled && !isDismissed && handoffUrl !== null;

  useEffect(() => {
    if (isVisible) {
      captureEvent('install_nudge_shown', {
        trip_access: trip.viewerToken !== undefined ? 'viewer' : 'member',
        can_prompt: canInstall,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per appearance, not per prompt capture: `canInstall` flipping true a second after mount is the same card, already counted
  }, [isVisible, trip.id]);

  const handleInstall = useCallback(async (): Promise<void> => {
    captureEvent('install_nudge_accepted', { via: 'prompt' });
    const success = await install();
    if (!success) {
      notify.error(t('pwa.installFailed', 'Installation failed. Please try again.'));
    }
  }, [install, t]);

  const handleShowMe = useCallback((): void => {
    if (handoffUrl === null) {
      return;
    }
    captureEvent('install_nudge_accepted', {
      via: 'handoff',
      platform: manualInstallPlatform,
    });
    // The request first, so the banner's steps are up by the time the page
    // is; the URL carries the same request for a reload or a forwarded link.
    requestInstall();
    void navigate(handoffUrl);
  }, [handoffUrl, manualInstallPlatform, navigate, requestInstall]);

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
              {canInstall ? (
                <Button
                  size="sm"
                  className="h-11 sm:h-8"
                  onClick={() => void handleInstall()}
                  disabled={isInstalling}
                >
                  {t('pwa.install', 'Install app')}
                </Button>
              ) : (
                <Button size="sm" className="h-11 sm:h-8" onClick={handleShowMe}>
                  {t('install.nudge.showMe', 'Show me how')}
                </Button>
              )}
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
