/**
 * @fileoverview Sign in by email, when the project has email enabled.
 *
 * A link, not a code. Supabase's default email template contains
 * `{{ .ConfirmationURL }}` and no `{{ .Token }}`, so a six-digit code input
 * would be a field nobody can fill — the message they receive has no code in
 * it. If the template is ever changed to send one, this is where the second
 * step goes.
 *
 * The success state is worded around what actually happened: the request was
 * accepted and the mail was *queued*. Saying "we sent you an email" and leaving
 * the form looking ready to submit again is how people click three times and
 * hit the sender's rate limit.
 *
 * @module features/auth/components/EmailSignInForm
 */

import {
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
  memo,
  useCallback,
  useId,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, MailCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/features/auth/AuthContext';

// ============================================================================
// Type Definitions
// ============================================================================

interface EmailSignInFormProps {
  /** Set while another way in is mid-attempt, or when offline. */
  readonly disabled: boolean;
}

// ============================================================================
// Component
// ============================================================================

export const EmailSignInForm = memo(function EmailSignInForm({
  disabled,
}: EmailSignInFormProps): ReactElement {
  const { t } = useTranslation();
  const { signInWithEmailLink } = useAuth();
  const fieldId = useId();
  const errorId = useId();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();

      const address = email.trim();
      if (address.length === 0) {
        return;
      }

      setError(null);
      setIsSending(true);
      const outcome = await signInWithEmailLink(address);
      setIsSending(false);

      switch (outcome.status) {
        case 'email-sent':
          setSentTo(address);
          return;
        case 'error':
          setError(outcome.message);
          return;
        case 'unavailable':
          setError(t('auth.errors.unavailable', 'Sign-in is not configured in this build.'));
          return;
        default:
          // 'redirecting' and 'signed-in' cannot come from this call.
          return;
      }
    },
    [email, signInWithEmailLink, t],
  );

  const handleSubmitEvent = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      void handleSubmit(event);
    },
    [handleSubmit],
  );

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setEmail(event.target.value);
  }, []);

  const handleUseAnother = useCallback((): void => {
    setSentTo(null);
    setEmail('');
  }, []);

  if (sentTo !== null) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm" role="status">
          <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {t(
              'auth.signIn.emailSent',
              'Check your inbox — the link we sent signs you in on this device.',
            )}{' '}
            <span className="font-medium">{sentTo}</span>
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleUseAnother} className="self-start">
          {t('auth.signIn.useAnotherEmail', 'Use a different address')}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmitEvent} className="flex flex-col gap-2" noValidate>
      <Label htmlFor={fieldId}>{t('auth.signIn.emailLabel', 'Email address')}</Label>
      <div className="flex gap-2">
        <Input
          id={fieldId}
          type="email"
          value={email}
          onChange={handleChange}
          disabled={disabled || isSending}
          autoComplete="email"
          inputMode="email"
          placeholder={t('auth.signIn.emailPlaceholder', 'you@example.com')}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? errorId : undefined}
        />
        <Button type="submit" disabled={disabled || isSending || email.trim().length === 0}>
          {isSending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {t('auth.signIn.sendEmailLink', 'Send link')}
        </Button>
      </div>
      {error !== null ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </form>
  );
});
