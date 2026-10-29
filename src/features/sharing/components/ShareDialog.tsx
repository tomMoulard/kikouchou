/**
 * @fileoverview Share Dialog — generates a P2P collaboration link with QR code.
 *
 * When opened, generates a roomId + encryption key for the trip (if not already set),
 * persists them, and displays the shareable URL with QR code.
 *
 * The URL format is: /trip/:roomId#:encryptionKey
 * The fragment (encryption key) is never sent to any server.
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
import { ShareLinkPanel } from './ShareLinkPanel';

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
 * Dialog for sharing a trip via P2P link with QR code.
 */
const ShareDialog = memo(function ShareDialog({
  open,
  onOpenChange,
  trip: tripProp,
}: ShareDialogProps): ReactElement {
  const { t } = useTranslation();
  const { currentTrip } = useTripContext();
  const effectiveTrip = tripProp ?? currentTrip ?? undefined;
  const hasTrip = Boolean(effectiveTrip);

  // ============================================================================
  // Render: Empty State (No Trip Selected)
  // ============================================================================

  if (open && !hasTrip) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="pr-10">
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="size-5" aria-hidden="true" />
              {t('sharing.title')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'errors.tripNotFound',
                'No trip selected. Please select a trip first.',
              )}
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
      <DialogContent
        className="flex max-h-[90vh] flex-col gap-0 overflow-hidden sm:max-w-md"
        data-testid="share-dialog"
      >
        <DialogHeader className="min-w-0 shrink-0 space-y-2 pr-10 text-center">
          <DialogTitle className="flex items-center justify-center gap-2">
            <Share2 className="size-5 shrink-0" aria-hidden="true" />
            {t('sharing.title')}
          </DialogTitle>
          <DialogDescription className="min-w-0 break-words">
            {t(
              'sharing.p2p.shareDescription',
              'Share this link to collaborate in real-time',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden [-webkit-overflow-scrolling:touch]">
          <div className="px-0 py-2">
            <ShareLinkPanel trip={effectiveTrip} active={open} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

export { ShareDialog };
