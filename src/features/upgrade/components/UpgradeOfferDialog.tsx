/**
 * @fileoverview The offer itself, as a dialog, for every screen that asks.
 *
 * Lifted out of `UpgradePrompt` when a second caller appeared. `TripTemplateCard`
 * asks the same question from the trip settings screen when the enterprise flag
 * says no, and two dialogs describing one fake tier would drift apart within a
 * week: the price, the feature list and the disclaimer are the offer, and the
 * offer has to read the same wherever it is opened.
 *
 * What stays with the caller is the card and the funnel steps a card owns:
 * `upgrade_prompt_shown`, `upgrade_prompt_opened`, `upgrade_prompt_dismissed`
 * and `upgrade_plan_clicked` all describe something that happened on a card.
 * This component owns the one step that happens inside it,
 * `upgrade_intent_declared`, and nothing else.
 *
 * `hasDeclared` and `onDeclare` are props rather than a `useUpgradeInterest`
 * call of this component's own, deliberately. That hook reads localStorage once
 * per instance, so a second copy here would answer the caller's card with a
 * stale value: the reader would leave an address and the card behind the dialog
 * would still think the question was unanswered.
 *
 * Honesty rule, inherited from the card: this must never claim a limit exists,
 * and it must say plainly that nothing is on sale and what the address is for,
 * before the field that asks for one.
 *
 * @module features/upgrade/components/UpgradeOfferDialog
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
import { AlertTriangle, Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { captureEvent, setPersonProperties } from '@/lib/posthog';
import {
  FREE_ACTIVE_TRIP_LIMIT,
  UPGRADE_FEATURE_KEYS,
  UPGRADE_PRICE_EUR_MONTHLY,
  UPGRADE_WAITLIST_EMAIL_PROPERTY,
  type UpgradePlacement,
  type UpgradePlanKey,
  isPlausibleEmail,
  upgradeEventProperties,
} from '../constants';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the UpgradeOfferDialog component.
 */
export interface UpgradeOfferDialogProps {
  /** Whether the dialog is on screen. */
  readonly open: boolean;
  /** Called with the new open state, for the close button and the backdrop. */
  readonly onOpenChange: (open: boolean) => void;
  /** Which screen the offer was opened from. Rides on the intent event. */
  readonly placement: UpgradePlacement;
  /**
   * Which price button opened the dialog, or null for the plain offer button.
   *
   * Kept as a property on the intent event rather than dropped, so the split
   * between the one-off and the subscription survives into the intent step.
   */
  readonly plan?: UpgradePlanKey | null;
  /** Whether this browser already answered. The form is not asked again. */
  readonly hasDeclared: boolean;
  /** Records the answer for the caller, which owns the memory. */
  readonly onDeclare: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * The described tier, and the one field that answers it.
 *
 * @param props - See {@link UpgradeOfferDialogProps}
 * @returns The dialog
 *
 * @example
 * ```tsx
 * <UpgradeOfferDialog
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   placement="settings"
 *   hasDeclared={hasDeclared}
 *   onDeclare={declare}
 * />
 * ```
 */
export const UpgradeOfferDialog = memo(function UpgradeOfferDialog({
  open,
  onOpenChange,
  placement,
  plan = null,
  hasDeclared,
  onDeclare,
}: UpgradeOfferDialogProps): ReactElement {
  const { t } = useTranslation();
  const [email, setEmail] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const errorId = useId();

  const handleEmailChange = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setEmail(event.target.value);
    setError(null);
  }, []);

  const handleClose = useCallback((): void => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();

      const address = email.trim();
      if (!isPlausibleEmail(address)) {
        // Said in the page rather than counted: a typo is not an answer, and an
        // event for it would read as somebody declining.
        setError(t('upgrade.dialog.emailInvalid'));
        return;
      }

      /*
       * The address goes on the person, the event says only that there is one.
       * That ordering matters if this is ever unwound: deleting the person
       * takes the address with it and leaves the funnel intact.
       */
      setPersonProperties({ [UPGRADE_WAITLIST_EMAIL_PROPERTY]: address });
      captureEvent('upgrade_intent_declared', {
        ...upgradeEventProperties(placement),
        has_email: true,
        plan,
      });

      onDeclare();
      onOpenChange(false);
      setError(null);
    },
    [email, onDeclare, onOpenChange, placement, plan, t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('upgrade.dialog.title')}</DialogTitle>
          <DialogDescription>
            {t('upgrade.dialog.description', {
              price: UPGRADE_PRICE_EUR_MONTHLY,
              limit: FREE_ACTIVE_TRIP_LIMIT,
            })}
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-sm">
          {UPGRADE_FEATURE_KEYS.map((key) => (
            <li key={key} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span>{t(`upgrade.features.${key}`, { limit: FREE_ACTIVE_TRIP_LIMIT })}</span>
            </li>
          ))}
        </ul>

        {/* Says plainly that nothing is for sale and what the address is for.
            A reader who types one has to have been told that first. */}
        <p className="text-xs text-muted-foreground">{t('upgrade.dialog.disclaimer')}</p>

        {/* The one thing that knows the question was answered. The form is
            replaced by a line saying so, and by nothing else: reciting the
            address back, or when it was given, would be this app telling a
            reader what it has on file about them for no reason they asked
            for. Somebody rereading the offer is simply not asked twice. */}
        {hasDeclared ? (
          <>
            <p className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm" role="status">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span>{t('upgrade.dialog.alreadyDeclared')}</span>
            </p>
            <DialogFooter>
              <Button onClick={handleClose}>{t('upgrade.dialog.close')}</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-2" noValidate>
            <Label htmlFor={fieldId}>{t('upgrade.dialog.emailLabel')}</Label>
            <Input
              id={fieldId}
              type="email"
              value={email}
              onChange={handleEmailChange}
              autoComplete="email"
              inputMode="email"
              placeholder={t('upgrade.dialog.emailPlaceholder')}
              aria-invalid={error !== null}
              aria-describedby={error !== null ? errorId : undefined}
            />
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

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={handleClose}>
                {t('upgrade.dialog.cancel')}
              </Button>
              <Button type="submit">{t('upgrade.dialog.confirm')}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
});
