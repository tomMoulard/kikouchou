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

import {
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Link2, Share2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/shared/LoadingState';
import { useTripContext } from '@/contexts/TripContext';
import { ensureTripP2pCredentials } from '@/lib/yjs';
import type { Trip, TripId } from '@/types';

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
  /** Called once the trip has usable P2P credentials and can be kept online elsewhere. */
  readonly onSyncReady?: (sync: ShareDialogSyncState) => void;
}

export interface ShareDialogSyncState {
  readonly tripId: TripId;
  readonly roomId: string;
  readonly encryptionKey: string;
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
  onSyncReady,
}: ShareDialogProps): ReactElement {
  const { t } = useTranslation();
  const { currentTrip } = useTripContext();
  const effectiveTrip = tripProp ?? currentTrip ?? undefined;
  const hasTrip = Boolean(effectiveTrip);

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Generate or retrieve the P2P share URL when dialog opens
  useEffect(() => {
    if (!open || !effectiveTrip) {
      setShareUrl(null);
      setCopied(false);
      return;
    }

    let cancelled = false;

    async function ensureP2PCredentials() {
      setIsGenerating(true);
      try {
        const creds = await ensureTripP2pCredentials(effectiveTrip!.id as TripId);
        if (!creds || cancelled) {
          return;
        }

        const origin = window.location.origin;
        const base = import.meta.env.BASE_URL ?? '/';
        const url = `${origin}${base}trip/${creds.roomId}#${creds.encryptionKey}`;
        setShareUrl(url);
        onSyncReady?.({
          tripId: effectiveTrip!.id as TripId,
          roomId: creds.roomId,
          encryptionKey: creds.encryptionKey,
        });
      } catch (err) {
        console.error('[ShareDialog] Failed to generate P2P credentials:', err);
      } finally {
        if (!cancelled) {
          setIsGenerating(false);
        }
      }
    }

    ensureP2PCredentials();
    return () => {
      cancelled = true;
    };
  }, [onSyncReady, open, effectiveTrip]);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for insecure contexts
      const textarea = document.createElement('textarea');
      textarea.value = shareUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl]);

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
            {isGenerating || !shareUrl ? (
              <LoadingState variant="inline" />
            ) : (
              <>
                {/* QR Code — full-width row so flex centering is stable inside the dialog */}
                <div className="flex w-full min-w-0 justify-center">
                  <div className="shrink-0 rounded-xl bg-white p-4 shadow-sm">
                    <QRCodeSVG value={shareUrl} size={200} level="M" />
                  </div>
                </div>

                {/* Share URL — single control: click anywhere to copy */}
                <Button
                  type="button"
                  variant="outline"
                  data-testid="share-url"
                  className="h-auto min-h-10 w-full max-w-full justify-start gap-2 px-3 py-2.5 text-left font-normal"
                  onClick={handleCopy}
                  title={shareUrl}
                  aria-label={
                    copied
                      ? t('sharing.p2p.linkCopied', 'Link copied')
                      : t('sharing.p2p.copyLinkAction', 'Copy link')
                  }
                >
                  <Link2
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-mono">
                    {shareUrl}
                  </span>
                  {copied ? (
                    <Check className="size-4 shrink-0 text-green-500" aria-hidden="true" />
                  ) : (
                    <Copy className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                </Button>

                {/* Privacy notice */}
                <p className="px-1 text-center text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {t(
                    'sharing.p2p.privacyNotice',
                    'Anyone with this link can view and edit this trip',
                  )}
                </p>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

export { ShareDialog };
