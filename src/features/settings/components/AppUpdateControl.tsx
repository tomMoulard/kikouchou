/**
 * @fileoverview "Check for updates" in the About card of Settings.
 *
 * One tap, one button: it asks for a newer build and moves onto it at once
 * (`lib/pwa/app-update`). On the website, a newer build that is found but does
 * not take over in time (`installing`) used to leave the page where it was,
 * with "it restarts when it is ready" and a second button, "Reload from the
 * server", for when it did not. The tap now goes that step itself: it drops
 * the service worker and its caches and loads the new build from the network.
 * A check that finds nothing newer, or fails, says so and reloads nothing.
 *
 * The answer is written into a `role="status"` region, so a screen reader hears
 * "You have the latest version" as well as seeing it.
 *
 * @module features/settings/components/AppUpdateControl
 */

import { type ReactElement, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  type AppUpdateOutcome,
  canCheckForAppUpdate,
  canReloadFromServer,
  checkForAppUpdate,
  reloadFromServer,
} from '@/lib/pwa/app-update';
import { captureEvent } from '@/lib/posthog';

// ============================================================================
// Type Definitions
// ============================================================================

/** What the control shows: idle, busy, or the last answer. */
type UpdateState = 'idle' | 'checking' | 'reloading-from-server' | 'offline-for-reload' | AppUpdateOutcome;

// ============================================================================
// Constants
// ============================================================================

/** The states in which a tap would start a second request. */
const BUSY: ReadonlySet<UpdateState> = new Set(['checking', 'reloading', 'reloading-from-server']);

// ============================================================================
// Component
// ============================================================================

/**
 * The button and its answer.
 *
 * Renders nothing in a store app without live updates (the F-Droid build),
 * where no build can arrive outside a release.
 */
export const AppUpdateControl = memo(function AppUpdateControl(): ReactElement | null {
  const { t } = useTranslation();
  const [state, setState] = useState<UpdateState>('idle');
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleCheck = useCallback(async (): Promise<void> => {
    setState('checking');
    let outcome: AppUpdateOutcome;
    try {
      outcome = await checkForAppUpdate();
    } catch (error) {
      console.warn('Update check failed:', error);
      outcome = 'failed';
    }
    captureEvent('app_update_checked', { outcome });
    if (!isMountedRef.current) {
      return;
    }

    // A newer build exists but its worker did not take over in time. Waiting
    // for it is what left the page on the old version: load it from the
    // server instead, now, as the person asked.
    if (outcome === 'installing' && canReloadFromServer()) {
      setState('reloading-from-server');
      captureEvent('app_reloaded_from_server');
      const started = await reloadFromServer();
      if (!started && isMountedRef.current) {
        setState('offline-for-reload');
      }
      return;
    }

    setState(outcome);
  }, []);

  if (!canCheckForAppUpdate()) {
    return null;
  }

  const busy = BUSY.has(state);
  const message = statusMessage(state, t);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm text-muted-foreground">
          {t('settings.update.description', 'Get the latest version of the app.')}
        </span>
        <Button
          variant="outline"
          onClick={() => void handleCheck()}
          disabled={busy}
          className="w-full sm:w-auto"
        >
          {state === 'checking' ? (
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="mr-2 size-4" aria-hidden="true" />
          )}
          {t('settings.update.check', 'Check for updates')}
        </Button>
      </div>

      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {message}
      </p>
    </div>
  );
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * The sentence for a state, or an empty string when there is nothing to say.
 *
 * @param state - The control's state
 * @param t - The translator
 * @returns The status text
 */
function statusMessage(state: UpdateState, t: (key: string, fallback: string) => string): string {
  switch (state) {
    case 'idle':
    case 'checking':
      return '';
    case 'current':
      return t('settings.update.current', 'You have the latest version.');
    case 'installing':
      return t(
        'settings.update.installing',
        'A new version is installing. The app restarts when it is ready.',
      );
    case 'offline':
    case 'offline-for-reload':
      return t('settings.update.offline', 'You are offline. Connect to the internet to update the app.');
    case 'failed':
      return t('settings.update.failed', 'Could not check for updates. Try again later.');
    case 'reloading':
    case 'reloading-from-server':
      return t('settings.update.reloading', 'Updating the app...');
  }
}
