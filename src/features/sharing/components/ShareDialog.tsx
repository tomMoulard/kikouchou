/**
 * @fileoverview Share Dialog: the trip's invite link, and who is on the trip.
 *
 * `ShareLinkPanel` renders the link, its QR code and the button that withdraws
 * it. Once the link exists the trip is on the server, so `TripMembersPanel`
 * lists the accounts on it, and lets the organiser remove one. A removal
 * withdraws every live link, so the dialog then asks for a fresh one.
 *
 * @module features/sharing/components/ShareDialog
 */

import { type ReactElement, memo, useCallback, useState } from 'react';
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
import { TripMembersPanel } from './TripMembersPanel';
import type { ShareLinkState } from '../hooks/useTripShareLink';

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
  const [linkKind, setLinkKind] = useState<ShareLinkState['kind']>('loading');
  const [linkRefresh, setLinkRefresh] = useState(0);

  // A removal withdraws every live link, so the one on screen is dead.
  const handleMemberRemoved = useCallback(() => {
    setLinkRefresh((current) => current + 1);
  }, []);

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
          <div className="space-y-6 px-0 py-2">
            <ShareLinkPanel
              trip={effectiveTrip}
              active={open}
              withRevoke
              refreshKey={linkRefresh}
              onStateChange={setLinkKind}
            />
            <TripMembersPanel
              tripId={effectiveTrip?.id ?? null}
              active={open && linkKind === 'invite'}
              onMemberRemoved={handleMemberRemoved}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

export { ShareDialog };
