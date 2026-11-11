/**
 * @fileoverview The screen shown instead of the app when the device has no
 * storage left for the database to open.
 *
 * Rendered by `main.tsx` outside every provider and the router: none of them
 * can work without IndexedDB. It needs only i18n, which is ready by then.
 *
 * Amber, not red: nothing is broken in the app, and the user is the one who
 * can fix it.
 *
 * @module components/shared/StorageFullScreen
 */

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { HardDrive, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { statusVariants } from '@/components/ui/status.variants';

import { cn } from '@/lib/utils';

// ============================================================================
// Type Definitions
// ============================================================================

interface StorageFullScreenProps {
  /** Tries again, once the user has freed some space. */
  readonly onRetry: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Says the device storage is full, what to do about it, and offers a retry.
 */
export const StorageFullScreen = memo(function StorageFullScreen({
  onRetry,
}: StorageFullScreenProps) {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <div
        role="alert"
        className="flex max-w-md flex-col items-center gap-4 text-center"
      >
        <div
          className={cn(statusVariants({ tone: 'warning' }), 'rounded-full p-3')}
          aria-hidden="true"
        >
          <HardDrive className="size-6" />
        </div>
        <h1 className="font-display text-xl font-semibold">
          {t('errors.storageFull.title', "Your device's storage is full")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            'errors.storageFull.description',
            'Kikouchou saves your trips on this device and needs some free space to open them. Free some space, for example by deleting photos or apps you no longer use, then retry.',
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
