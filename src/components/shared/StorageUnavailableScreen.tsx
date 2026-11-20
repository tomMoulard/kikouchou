/**
 * @fileoverview The screen shown instead of the app when the browser cannot
 * store data on this device at all.
 *
 * Some browsers refuse to open IndexedDB on every try, usually in a private
 * mode or on an old Android build (PostHog issues 01a1f8f9-ce46 and
 * 01a1f8f9-ce44, Samsung Internet 23, Android 8). Rendered by `main.tsx`
 * outside every provider and the router, like `StorageFullScreen`: none of
 * them can work without IndexedDB. It needs only i18n, which is ready by then.
 *
 * Amber, not red: nothing is broken in the app, and the user can get out of
 * it by opening the app somewhere else.
 *
 * @module components/shared/StorageUnavailableScreen
 */

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { DatabaseZap, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { statusVariants } from '@/components/ui/status.variants';

import { cn } from '@/lib/utils';

// ============================================================================
// Type Definitions
// ============================================================================

interface StorageUnavailableScreenProps {
  /** Tries again, for example after leaving private mode. */
  readonly onRetry: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Says the browser cannot store data here, what to do about it, and offers a
 * retry.
 */
export const StorageUnavailableScreen = memo(function StorageUnavailableScreen({
  onRetry,
}: StorageUnavailableScreenProps) {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <div role="alert" className="flex max-w-md flex-col items-center gap-4 text-center">
        <div
          className={cn(statusVariants({ tone: 'warning' }), 'rounded-full p-3')}
          aria-hidden="true"
        >
          <DatabaseZap className="size-6" />
        </div>
        <h1 className="font-display text-xl font-semibold">
          {t('errors.storageUnavailable.title', 'This browser cannot store data here')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            'errors.storageUnavailable.description',
            'Kikouchou saves your trips on this device, and this browser would not let it, so the app cannot start. Retry first. If this screen comes back, open Kikouchou in another browser, or leave private or secret mode.',
          )}
        </p>
        <Button onClick={onRetry}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {t('common.retry', 'Retry')}
        </Button>
      </div>
    </main>
  );
});
