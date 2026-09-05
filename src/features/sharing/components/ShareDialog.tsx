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
import { statusVariants } from '@/components/ui/status.variants';
import { LoadingState } from '@/components/shared/LoadingState';
import { useTripContext } from '@/contexts/TripContext';
import { SignInDialog } from '@/features/auth/components/SignInDialog';
import { useTripShareLink } from '../hooks/useTripShareLink';
import type { Trip } from '@/types';
import { cn } from '@/lib/utils';

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

  const [copied, setCopied] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);

  const { state: linkState } = useTripShareLink(effectiveTrip, open);

  /**
   * The invite link, or nothing.
   *
   * There is no peer-to-peer fallback any more: the WebRTC transport is gone,
   * so a link that is not backed by an account has nothing to sync through.
   * `linkState` reports why when there is no link.
   */
  const shareUrl = linkState.kind === 'invite' ? linkState.url : null;
  const isGenerating = linkState.kind === 'loading';

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
            {linkState.kind === 'needs-account' ? (
              /* Handing over a link that syncs with nobody would be worse than
                 saying an account is needed. */
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  {t(
                    'sharing.p2p.needsAccount',
                    'Sharing needs an account, so the people you invite keep seeing your changes.',
                  )}
                </p>
                <Button onClick={() => setSignInOpen(true)}>
                  {t('auth.account.signInAction', 'Sign in')}
                </Button>
                <SignInDialog
                  open={signInOpen}
                  onOpenChange={setSignInOpen}
                  reason={t(
                    'sharing.p2p.signInReason',
                    'Sign in to share this trip and edit it together.',
                  )}
                />
              </div>
            ) : linkState.kind === 'unavailable' ? (
              /* Nothing failed and nothing is coming: this build has no server
                 to mint an invite against. Falling through to the spinner left
                 the dialog loading forever with nothing to wait for. */
              <p className="text-sm text-muted-foreground" role="alert">
                {t(
                  'sharing.p2p.unavailable',
                  'This copy of the app has no sync server configured, so trips cannot be shared from it.',
                )}
              </p>
            ) : linkState.kind === 'error' ? (
              <p className="text-sm text-destructive" role="alert">
                {linkState.message}
              </p>
            ) : isGenerating || !shareUrl ? (
              <LoadingState variant="inline" />
            ) : (
              <>
                {/* QR Code — full-width row so flex centering is stable inside the dialog */}
                <div className="flex w-full min-w-0 justify-center">
                  {/* eslint-disable-next-line kikouchou/no-raw-palette-class -- Literal white, not `bg-card`: a QR code needs a light quiet zone to scan, in either theme. */}
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
                    <Check
                      className={cn('size-4 shrink-0', statusVariants({ tone: 'success', emphasis: 'text' }))}
                      aria-hidden="true"
                    />
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
