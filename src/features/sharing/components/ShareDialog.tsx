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
import { nanoid } from 'nanoid';

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
import { db } from '@/lib/db/database';
import { TripYjsSyncBinding } from '@/lib/yjs';
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

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [syncRoomId, setSyncRoomId] = useState<string | null>(null);
  const [syncEncryptionKey, setSyncEncryptionKey] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Generate or retrieve the P2P share URL when dialog opens
  useEffect(() => {
    if (!open || !effectiveTrip) {
      setShareUrl(null);
      setSyncRoomId(null);
      setSyncEncryptionKey(null);
      setCopied(false);
      return;
    }

    let cancelled = false;

    async function ensureP2PCredentials() {
      setIsGenerating(true);
      try {
        let roomId = effectiveTrip!.p2pRoomId;
        let key = effectiveTrip!.p2pEncryptionKey;

        if (!roomId || !key) {
          // Generate new credentials
          roomId = nanoid(12);
          key = nanoid(24);

          // Persist to Dexie
          await db.trips.update(effectiveTrip!.id as TripId, {
            p2pRoomId: roomId,
            p2pEncryptionKey: key,
          });
        }

        if (!cancelled) {
          const origin = window.location.origin;
          const base = import.meta.env.BASE_URL ?? '/';
          const url = `${origin}${base}trip/${roomId}#${key}`;
          setShareUrl(url);
          setSyncRoomId(roomId);
          setSyncEncryptionKey(key);
        }
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
  }, [open, effectiveTrip]);

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
          <DialogHeader>
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
    <>
      {open &&
      effectiveTrip &&
      syncRoomId &&
      syncEncryptionKey ? (
        <TripYjsSyncBinding
          tripId={effectiveTrip.id}
          roomId={syncRoomId}
          encryptionKey={syncEncryptionKey}
        />
      ) : null}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-md max-h-[90vh] overflow-y-auto"
          data-testid="share-dialog"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="size-5" aria-hidden="true" />
              {t('sharing.title')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'sharing.p2p.shareDescription',
                'Share this link to collaborate in real-time',
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {isGenerating || !shareUrl ? (
              <LoadingState variant="inline" />
            ) : (
              <>
                {/* QR Code */}
                <div className="flex justify-center">
                  <div className="rounded-xl bg-white p-4">
                    <QRCodeSVG value={shareUrl} size={200} level="M" />
                  </div>
                </div>

                {/* Share URL + Copy */}
                <div className="flex items-center gap-2">
                  <div
                    className="flex-1 flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 overflow-hidden"
                    data-testid="share-url"
                  >
                    <Link2
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="text-sm truncate font-mono">
                      {shareUrl}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopy}
                    aria-label={t('common.copy', 'Copy')}
                  >
                    {copied ? (
                      <Check className="size-4 text-green-500" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                </div>

                {/* Privacy notice */}
                <p className="text-xs text-muted-foreground text-center">
                  {t(
                    'sharing.p2p.privacyNotice',
                    'Anyone with this link can view and edit this trip',
                  )}
                </p>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});

export { ShareDialog };
