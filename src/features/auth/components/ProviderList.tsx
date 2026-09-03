/**
 * @fileoverview Every way in this project accepts, rendered from what the
 * project said.
 *
 * The one component both sign-in surfaces use — the `/signin` page and the
 * in-context `SignInDialog` — so that enabling a provider changes both at once
 * and neither can drift. Nothing here names a provider: the OAuth ids come from
 * `useAuthProviders`, the labels are derived, and the artwork degrades to a
 * neutral key icon for an id this build has never seen.
 *
 * Four mechanisms, in the order they appear: an OAuth redirect per discovered
 * provider, an emailed link, a passkey, and a wallet signature. Only the first
 * two are fully described by the project's own settings — a passkey also needs
 * WebAuthn in this browser, and web3 is invisible to the endpoint entirely.
 *
 * Offline is a first-class state rather than an error. Signing in is one of only
 * two things in this app that genuinely need a network, so the list says so and
 * refuses up front instead of failing into an opaque fetch error.
 *
 * @module features/auth/components/ProviderList
 */

import { type ReactElement, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Fingerprint,
  Loader2,
  UserPlus,
  Wallet,
  WifiOff,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { EmailSignInForm } from '@/features/auth/components/EmailSignInForm';
import { ProviderMark } from '@/features/auth/provider-marks';
import { getProviderDisplayName } from '@/features/auth/provider-names';
import { useAuthProviders } from '@/features/auth/hooks/useAuthProviders';
import { useAuth } from '@/features/auth/AuthContext';
import type { SignInOutcome } from '@/features/auth/AuthContext';
import type { Web3Chain } from '@/features/auth/web3';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

// ============================================================================
// Constants
// ============================================================================

/**
 * Stands in for a provider id in the `pending` state, so the spinner can land on
 * the passkey button. Underscore-free ids come from the backend, so this cannot
 * collide with one.
 */
const PASSKEY_PENDING = '\u0000passkey';

// ============================================================================
// Type Definitions
// ============================================================================

interface ProviderListProps {
  /**
   * Called when an attempt produced a session without leaving the page — a
   * wallet signature or a passkey. The redirect flows never reach it: the
   * document is already being torn down.
   */
  readonly onSignedIn?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export const ProviderList = memo(function ProviderList({
  onSignedIn,
}: ProviderListProps): ReactElement {
  const { t } = useTranslation();
  const {
    isAvailable,
    isSigningIn,
    signInWithPasskey,
    signInWithProvider,
    signInWithWallet,
  } = useAuth();
  const { settings, walletChains, canUsePasskeys } = useAuthProviders();
  const { isOnline } = useOnlineStatus();

  const [error, setError] = useState<string | null>(null);
  /**
   * Which button is mid-attempt, so the spinner lands on the one that was
   * clicked. The context's `isSigningIn` says only *that* something is in
   * flight, which is what disables the others.
   */
  const [pending, setPending] = useState<string | null>(null);

  const blockedOffline = !isOnline;
  const disabled = !isAvailable || blockedOffline || isSigningIn;

  const handleOutcome = useCallback(
    (outcome: SignInOutcome): void => {
      switch (outcome.status) {
        case 'error':
          setError(outcome.message);
          return;
        case 'unavailable':
          setError(t('auth.errors.unavailable', 'Sign-in is not configured in this build.'));
          return;
        case 'signed-in':
          onSignedIn?.();
          return;
        default:
          // 'redirecting': the browser is leaving; nothing to do.
          return;
      }
    },
    [onSignedIn, t],
  );

  const handleProvider = useCallback(
    async (providerId: string): Promise<void> => {
      setError(null);
      setPending(providerId);
      const outcome = await signInWithProvider(providerId);
      if (outcome.status !== 'redirecting') {
        setPending(null);
      }
      handleOutcome(outcome);
    },
    [handleOutcome, signInWithProvider],
  );

  const runPasskey = useCallback(async (): Promise<void> => {
    setError(null);
    setPending(PASSKEY_PENDING);
    // Completes in this document like a wallet does — the browser prompts for a
    // screen lock and a session follows — so there is always a `pending` to
    // clear afterwards.
    const outcome = await signInWithPasskey();
    setPending(null);
    handleOutcome(outcome);
  }, [handleOutcome, signInWithPasskey]);

  const handlePasskey = useCallback((): void => {
    void runPasskey();
  }, [runPasskey]);

  const handleWallet = useCallback(
    async (chain: Web3Chain): Promise<void> => {
      setError(null);
      setPending(chain);
      // Shown inside the wallet's own signing prompt, so it has to say what is
      // being agreed to. One line: most wallets reject a newline.
      const outcome = await signInWithWallet(
        chain,
        t(
          'auth.signIn.walletStatement',
          'Sign in to Kikoushou. This does not approve any transaction.',
        ),
      );
      setPending(null);
      handleOutcome(outcome);
    },
    [handleOutcome, signInWithWallet, t],
  );

  if (!isAvailable) {
    return (
      <p className="text-sm text-muted-foreground">
        {t(
          'auth.account.notConfigured',
          'This build has no account backend, so trips stay on this device.',
        )}
      </p>
    );
  }

  const hasAnyProvider =
    settings.oauth.length > 0 ||
    settings.email ||
    walletChains.length > 0 ||
    canUsePasskeys;

  return (
    <div className="flex flex-col gap-4">
      {blockedOffline ? (
        <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm" role="status">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {t(
              'auth.signIn.offline',
              'You are offline. Signing in needs a connection — everything else keeps working without one.',
            )}
          </span>
        </div>
      ) : null}

      {settings.signupDisabled ? (
        <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm" role="status">
          <UserPlus className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {t(
              'auth.signIn.signupDisabled',
              'This project is not accepting new accounts at the moment. Signing in still works if you already have one.',
            )}
          </span>
        </div>
      ) : null}

      {error !== null ? (
        <div
          className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {settings.oauth.length > 0 ? (
        <div className="flex flex-col gap-2">
          {settings.oauth.map((providerId, index) => (
            <ProviderButton
              key={providerId}
              providerId={providerId}
              // One clear default among several equal-looking options; the order
              // is the project's own.
              isPrimary={index === 0}
              disabled={disabled}
              isPending={pending === providerId}
              onSelect={handleProvider}
            />
          ))}
        </div>
      ) : null}

      {settings.email && settings.oauth.length > 0 ? <OrDivider /> : null}

      {settings.email ? <EmailSignInForm disabled={disabled} /> : null}

      {canUsePasskeys ? (
        <Button
          variant="outline"
          onClick={handlePasskey}
          disabled={disabled}
          className="w-full"
        >
          {pending === PASSKEY_PENDING ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Fingerprint className="size-4" aria-hidden="true" />
          )}
          {t('auth.signIn.withPasskey', 'Continue with a passkey')}
        </Button>
      ) : null}

      {walletChains.length > 0 ? (
        <div className="flex flex-col gap-2">
          {walletChains.map((chain) => (
            <WalletButton
              key={chain}
              chain={chain}
              disabled={disabled}
              isPending={pending === chain}
              onSelect={handleWallet}
            />
          ))}
        </div>
      ) : null}

      {!hasAnyProvider ? (
        <p className="text-sm text-muted-foreground">
          {t(
            'auth.signIn.noProviders',
            'No way to sign in is enabled on this project right now.',
          )}
        </p>
      ) : null}
    </div>
  );
});

// ============================================================================
// Sub-Components
// ============================================================================

interface ProviderButtonProps {
  readonly providerId: string;
  readonly isPrimary: boolean;
  readonly disabled: boolean;
  readonly isPending: boolean;
  readonly onSelect: (providerId: string) => Promise<void>;
}

/**
 * One OAuth provider.
 *
 * The label is two nodes — a translated "Continue with" and the untranslated
 * brand name — rather than an interpolated sentence, because the brand name is
 * a proper noun in every locale and the provider list is not known at build
 * time, so there is no key to add for it.
 */
const ProviderButton = memo(function ProviderButton({
  providerId,
  isPrimary,
  disabled,
  isPending,
  onSelect,
}: ProviderButtonProps): ReactElement {
  const { t } = useTranslation();

  const handleClick = useCallback((): void => {
    void onSelect(providerId);
  }, [onSelect, providerId]);

  return (
    <Button
      variant={isPrimary ? 'default' : 'outline'}
      onClick={handleClick}
      disabled={disabled}
      className="w-full"
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <ProviderMark providerId={providerId} />
      )}
      {t('auth.signIn.continueWith', 'Continue with')} {getProviderDisplayName(providerId)}
    </Button>
  );
});

interface WalletButtonProps {
  readonly chain: Web3Chain;
  readonly disabled: boolean;
  readonly isPending: boolean;
  readonly onSelect: (chain: Web3Chain) => Promise<void>;
}

const WalletButton = memo(function WalletButton({
  chain,
  disabled,
  isPending,
  onSelect,
}: WalletButtonProps): ReactElement {
  const { t } = useTranslation();

  const handleClick = useCallback((): void => {
    void onSelect(chain);
  }, [chain, onSelect]);

  return (
    <Button variant="outline" onClick={handleClick} disabled={disabled} className="w-full">
      {isPending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Wallet className="size-4" aria-hidden="true" />
      )}
      {t('auth.signIn.withWallet', 'Continue with your {{chain}} wallet', {
        chain: chain === 'solana' ? 'Solana' : 'Ethereum',
      })}
    </Button>
  );
});

function OrDivider(): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3">
      <Separator className="flex-1" />
      <span className="text-xs uppercase text-muted-foreground">
        {t('auth.signIn.or', 'or')}
      </span>
      <Separator className="flex-1" />
    </div>
  );
}
