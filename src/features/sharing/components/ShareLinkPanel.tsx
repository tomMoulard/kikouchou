/**
 * @fileoverview A trip's invite link, or the reason there is none yet.
 *
 * The body of `ShareDialog`, and the invite screen at the end of the
 * first-trip wizard. It asks `useTripShareLink` for a link and renders
 * whichever outcome applies: the QR code and the copy button, a sign-in when
 * sharing needs an account, or why this copy of the app cannot share.
 *
 * @module features/sharing/components/ShareLinkPanel
 */

import { type ReactElement, memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Link2, Share2, Unlink } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

import { Button } from '@/components/ui/button';
import { statusVariants } from '@/components/ui/status.variants';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { LoadingState } from '@/components/shared/LoadingState';
import { ProviderList } from '@/features/auth/components/ProviderList';
import { SignInDialog } from '@/features/auth/components/SignInDialog';
import { canShareLink, shareLink } from '@/lib/native/share-link';
import { notify } from '@/lib/notifications';
import { captureEvent } from '@/lib/posthog';
import { getSupabaseClient } from '@/lib/supabase/client';
import { revokeInvite } from '@/lib/sync/invites';
import { copyText } from '@/lib/utils/clipboard';
import { cn } from '@/lib/utils';
import { type ShareLinkState, useTripShareLink } from '../hooks/useTripShareLink';
import type { Trip } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export interface ShareLinkPanelProps {
  /** The trip to share. */
  readonly trip: Trip | undefined;
  /** Whether to ask for a link; false while the surrounding dialog is closed. */
  readonly active: boolean;
  /**
   * Where the sign-in goes when sharing needs an account.
   *
   * `dialog` puts a button that opens `SignInDialog`, which suits a dialog
   * already on top of a page. `inline` lists the providers in place, for a
   * screen whose whole job is the invitation.
   */
  readonly signIn?: 'dialog' | 'inline';
  /** Offers the system share sheet beside the copy button, where there is one. */
  readonly withShareSheet?: boolean;
  /** Told each time the link's state changes kind. */
  readonly onStateChange?: ((kind: ShareLinkState['kind']) => void) | undefined;
  /**
   * Offers to withdraw the link on screen. The next one is minted at once, so
   * people who already joined stay on the trip and only the old link dies.
   */
  readonly withRevoke?: boolean;
  /** Asks for the link again when it changes: something withdrew this one. */
  readonly refreshKey?: number;
}

// ============================================================================
// Constants
// ============================================================================

const COPIED_TICK_MS = 2000;

// ============================================================================
// Component
// ============================================================================

export const ShareLinkPanel = memo(function ShareLinkPanel({
  trip,
  active,
  signIn = 'dialog',
  withShareSheet = false,
  onStateChange,
  withRevoke = false,
  refreshKey = 0,
}: ShareLinkPanelProps): ReactElement {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);

  const [revokeOpen, setRevokeOpen] = useState(false);

  const { state: linkState, refresh } = useTripShareLink(trip, active);

  useEffect(() => {
    onStateChange?.(linkState.kind);
  }, [linkState.kind, onStateChange]);

  useEffect(() => {
    if (refreshKey > 0) refresh();
  }, [refresh, refreshKey]);

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
    // `copyText` carries the insecure-context fallback, which the template
    // link needs too; the tick of "Copied" is shown either way, because a
    // selection that the browser refused is not worth a second message here.
    await copyText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_TICK_MS);
  }, [shareUrl]);

  const handleShareSheet = useCallback(async () => {
    if (!shareUrl) return;
    await shareLink({
      url: shareUrl,
      title: trip?.name ?? '',
      text: t('sharing.p2p.shareSheetText', {
        tripName: trip?.name ?? '',
        defaultValue: 'Join {{tripName}} on Kikouchou',
      }),
    });
  }, [shareUrl, t, trip?.name]);

  const handleRevoke = useCallback(async () => {
    if (linkState.kind !== 'invite') return;
    const client = await getSupabaseClient();
    const result = client
      ? await revokeInvite(client, linkState.token)
      : { ok: false, message: 'No sync server.' };
    if (result.ok) {
      captureEvent('trip_invite_revoked');
      notify.success(t('sharing.revoke.done', 'Link withdrawn. Here is a new one.'));
      refresh();
    } else {
      console.error('Failed to withdraw invite link:', result.message);
      notify.error(t('sharing.revoke.failed', 'Could not withdraw the link. Try again.'));
    }
    setRevokeOpen(false);
  }, [linkState, refresh, t]);

  const signInReason = t(
    'sharing.p2p.signInReason',
    'Sign in to share this trip and edit it together.',
  );

  if (linkState.kind === 'needs-account') {
    // Handing over a link that syncs with nobody would be worse than saying
    // an account is needed.
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t(
            'sharing.p2p.needsAccount',
            'Sharing needs an account, so the people you invite keep seeing your changes.',
          )}
        </p>
        {signIn === 'inline' ? (
          <ProviderList />
        ) : (
          <>
            <Button onClick={() => setSignInOpen(true)}>
              {t('auth.account.signInAction', 'Sign in')}
            </Button>
            <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} reason={signInReason} />
          </>
        )}
      </div>
    );
  }

  if (linkState.kind === 'unavailable') {
    // Nothing failed and nothing is coming: this build has no server to mint
    // an invite against. Falling through to the spinner left the dialog
    // loading forever with nothing to wait for.
    return (
      <p className="text-sm text-muted-foreground" role="alert">
        {t(
          'sharing.p2p.unavailable',
          'This copy of the app has no sync server configured, so trips cannot be shared from it.',
        )}
      </p>
    );
  }

  if (linkState.kind === 'error') {
    return (
      <p className="text-sm text-destructive" role="alert">
        {linkState.message}
      </p>
    );
  }

  if (isGenerating || !shareUrl) {
    return <LoadingState variant="inline" />;
  }

  return (
    <div className="space-y-6">
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
        <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-mono">{shareUrl}</span>
        {copied ? (
          <Check
            className={cn('size-4 shrink-0', statusVariants({ tone: 'success', emphasis: 'text' }))}
            aria-hidden="true"
          />
        ) : (
          <Copy className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </Button>

      {withShareSheet && canShareLink() ? (
        <Button type="button" variant="outline" className="w-full" onClick={handleShareSheet}>
          <Share2 className="size-4" aria-hidden="true" />
          {t('sharing.p2p.shareSheetAction', 'Send the link')}
        </Button>
      ) : null}

      {/* Privacy notice */}
      <p className="px-1 text-center text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {t('sharing.p2p.privacyNotice', 'Anyone with this link can view and edit this trip')}
      </p>

      {withRevoke && trip?.viewerToken === undefined ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={() => setRevokeOpen(true)}
          >
            <Unlink className="size-4" aria-hidden="true" />
            {t('sharing.revoke.action', 'Withdraw this link')}
          </Button>
          <ConfirmDialog
            open={revokeOpen}
            onOpenChange={setRevokeOpen}
            variant="destructive"
            title={t('sharing.revoke.confirmTitle', 'Withdraw this link?')}
            description={t(
              'sharing.revoke.confirmDescription',
              'Nobody new can join with it. The people already on the trip stay on it, and you get a new link to send.',
            )}
            confirmLabel={t('sharing.revoke.confirmAction', 'Withdraw')}
            onConfirm={handleRevoke}
          />
        </>
      ) : null}
    </div>
  );
});
