/**
 * @fileoverview Share Dialog — offline/P2P trip handoff (same payload as Settings → Sync export).
 * There is no central server: the QR codes and copied text carry the full trip changeset.
 *
 * @module features/sharing/components/ShareDialog
 */

import { type ReactElement, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Share2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTripContext } from '@/contexts/TripContext';
import type { Trip } from '@/types';

import { TripSyncExportPanel } from './TripSyncExportPanel';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the ShareDialog component.
 */
export interface ShareDialogProps {
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback to change the open state */
  readonly onOpenChange: (open: boolean) => void;
  /**
   * When set (e.g. from the trip list), share this trip instead of the context
   * `currentTrip` (useful when no trip is selected in context).
   */
  readonly trip?: Trip;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Dialog for sharing a trip without a backend: full export QR / copy, same as Sync.
 */
const ShareDialog = memo(function ShareDialog({
  open,
  onOpenChange,
  trip: tripProp,
}: ShareDialogProps): ReactElement {
  const { t } = useTranslation(),
    { currentTrip } = useTripContext(),

    effectiveTrip = tripProp ?? currentTrip ?? undefined,

    hasTrip = Boolean(effectiveTrip);

  // ============================================================================
  // Render: Empty State (No Trip Selected)
  // ============================================================================

  if (open && !hasTrip) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="size-5" aria-hidden="true" />
              {t('sharing.title')}
            </DialogTitle>
            <DialogDescription>
              {t('errors.tripNotFound', 'No trip selected. Please select a trip first.')}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  // ============================================================================
  // Render: Main Content
  // ============================================================================

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="size-5" aria-hidden="true" />
            {t('sharing.title')}
          </DialogTitle>
          <DialogDescription>{t('sharing.p2pDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <p className="text-sm text-muted-foreground">{t('sharing.p2pNotice')}</p>

          {open && effectiveTrip ? (
            <TripSyncExportPanel
              key={`${String(effectiveTrip.id)}-${effectiveTrip.updatedAt}`}
              trip={effectiveTrip}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
});

export { ShareDialog };
