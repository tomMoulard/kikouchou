/**
 * @fileoverview Asks whether anybody would pay for this app, and counts the answer.
 *
 * A fake door. There is no paid tier, no checkout and no enforced limit: the
 * card offers one, the dialog describes it, and leaving an address records that
 * somebody wanted it. Nothing charges anybody and nothing is taken away.
 *
 * Three events make the funnel, and each one is a step a person had to take:
 *
 * 1. `upgrade_prompt_shown` — the card reached a screen. The denominator.
 * 2. `upgrade_prompt_opened` — somebody opened the dialog. Interest.
 * 3. `upgrade_intent_declared` — somebody read the price and left an address.
 *
 * `upgrade_prompt_dismissed` sits beside them: a No is an answer too, and a
 * dismissal rate that dwarfs the open rate says the offer is wrong rather than
 * that the audience is.
 *
 * `upgrade_plan_clicked` is the fifth, and it answers a different question:
 * **which** offer, not whether. Two buttons carry the two prices — nine euros
 * for one trip, nineteen a month for as many as you like — and each says which
 * was clicked and what it cost. A count of people who would pay something is
 * worth much less than a split between a one-off and a subscription, and that
 * split cannot be recovered later from a single button.
 *
 * The button that opens the full offer is gated by `ent-trip-templates`, the
 * enterprise cohort's flag: disabled while the flag is not an explicit yes,
 * with a line saying so. The two price buttons are not gated, because a price
 * nobody outside the cohort can answer measures the cohort and not the market.
 *
 * Every one of them carries the placement, the price and the free-tier limit,
 * so the funnel breaks down by screen and stays readable if the offer changes.
 *
 * **An address, not a click.** A button on its own measures curiosity, and
 * curiosity about a button is not willingness to pay. Typing an address costs
 * something, and it leaves a list of people who can be asked a second question
 * later, which a count never can. The address goes to PostHog as a *person*
 * property through `setPersonProperties` — see that function for why it must
 * never ride on an event — and it is the only user-typed value this project
 * sends anywhere.
 *
 * **The card never changes.** It reads the same on every screen, before and
 * after the question is answered, and the same button always opens the same
 * offer. Only the dialog knows the difference, and only where the form would
 * otherwise be: it thanks the reader rather than asking a second time. One offer in one place beats two cards to keep in step, and it
 * leaves the offer readable afterwards, which is the whole reason for
 * describing it before asking for anything. A reopened dialog carries
 * `already_declared: true`, so the interest step of the funnel is not inflated
 * by people rereading their own answer.
 *
 * Honesty rule for this card: it must never claim a limit exists, and it must
 * say plainly that nothing is on sale and what the address is for, before the
 * field that asks for one. A fake door that lies to a reader buys a number that
 * a real reader paid for.
 *
 * @module features/upgrade/components/UpgradePrompt
 */

import {
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
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
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { captureEvent, setPersonProperties } from '@/lib/posthog';
import { cn } from '@/lib/utils';
import {
  FREE_ACTIVE_TRIP_LIMIT,
  UPGRADE_FEATURE_KEYS,
  UPGRADE_OFFER_FLAG,
  UPGRADE_PLANS,
  UPGRADE_PRICE_EUR_MONTHLY,
  UPGRADE_WAITLIST_EMAIL_PROPERTY,
  type UpgradePlacement,
  type UpgradePlanKey,
  isPlausibleEmail,
  upgradeEventProperties,
} from '../constants';
import { useUpgradeInterest } from '../hooks/useUpgradeInterest';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the UpgradePrompt component.
 */
export interface UpgradePromptProps {
  /** Which screen this is on. Rides on all four events. */
  readonly placement: UpgradePlacement;
  /** Additional CSS classes for the card. */
  readonly className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * The paid-tier question, as a card plus a dialog.
 *
 * @param props - Component props
 * @returns The card, or null once it has been dismissed
 *
 * @example
 * ```tsx
 * <UpgradePrompt placement="settings" />
 * ```
 */
export const UpgradePrompt = memo(function UpgradePrompt({
  placement,
  className,
}: UpgradePromptProps): ReactElement | null {
  const { t } = useTranslation();
  const { isVisible, hasDeclared, declare, dismiss } = useUpgradeInterest();
  /*
   * `undefined` while PostHog is asked, and that counts as not yet allowed:
   * the same "fail closed" reading `lib/flags/guest-phone-sharing` takes, and
   * the alternative is a button that is live for a moment and then goes dead
   * under somebody's cursor.
   */
  const offerFlag = useFeatureFlag(UPGRADE_OFFER_FLAG);
  const isOfferOpen = offerFlag === true;
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [plan, setPlan] = useState<UpgradePlanKey | null>(null);
  const [email, setEmail] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const errorId = useId();

  /**
   * Whether the impression has already been reported.
   *
   * Never reset, for the reason `PlanOwnTripPrompt` never resets its own:
   * StrictMode runs the effect twice on mount in development, and a flag that
   * a cleanup cleared would report one impression as two.
   */
  const hasReportedRef = useRef<boolean>(false);

  useEffect(() => {
    if (isVisible && !hasReportedRef.current) {
      hasReportedRef.current = true;
      // Not a `captureUsage` action: seeing a card is not using the app.
      // The card reads the same either way, so `already_declared` is the only
      // thing that separates a first sight of the offer from a rereading of it.
      captureEvent('upgrade_prompt_shown', {
        ...upgradeEventProperties(placement),
        already_declared: hasDeclared,
      });
    }
  }, [hasDeclared, isVisible, placement]);

  const handleOpen = useCallback((): void => {
    setPlan(null);
    captureEvent('upgrade_prompt_opened', {
      ...upgradeEventProperties(placement),
      // False is the interest step of the funnel. True is somebody rereading
      // an offer they already accepted, which is not a second person interested.
      already_declared: hasDeclared,
    });
    setIsDialogOpen(true);
  }, [hasDeclared, placement]);

  /**
   * One handler for both price buttons, built per plan.
   *
   * The click is the answer, so it is captured before anything else happens.
   * Opening the dialog afterwards is not a second question: it is where the
   * address is left, and a price button that did nothing visible would read as
   * a broken control rather than as an offer.
   */
  const handlePlanClick = useCallback(
    (planKey: UpgradePlanKey, priceEur: number): void => {
      captureEvent('upgrade_plan_clicked', {
        ...upgradeEventProperties(placement),
        plan: planKey,
        plan_price_eur: priceEur,
        already_declared: hasDeclared,
      });
      setPlan(planKey);
      setIsDialogOpen(true);
    },
    [hasDeclared, placement],
  );

  const handleEmailChange = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setEmail(event.target.value);
    setError(null);
  }, []);

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
        // Null when the offer was opened from the main button rather than from
        // a price. Kept as a property rather than dropped, so the split between
        // the one-off and the subscription survives into the intent step.
        plan,
      });

      declare();
      setIsDialogOpen(false);
      setError(null);
    },
    [declare, email, placement, plan, t],
  );

  const handleDismiss = useCallback((): void => {
    captureEvent('upgrade_prompt_dismissed', upgradeEventProperties(placement));
    dismiss();
  }, [dismiss, placement]);

  const handleClose = useCallback((): void => {
    setIsDialogOpen(false);
  }, []);

  if (!isVisible) {
    return null;
  }

  return (
    <>
      <Card className={cn('mb-4 border-primary/20', className)}>
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            <div
              className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"
              aria-hidden="true"
            >
              <Sparkles className="size-6" />
            </div>

            <div className="min-w-0 flex-1">
              <CardTitle className="text-base font-semibold">
                {t('upgrade.card.title')}
              </CardTitle>
              <CardDescription className="mt-1 text-sm">
                {t('upgrade.card.description')}
              </CardDescription>

              {/* The two prices, first and on their own row: they are the
                  question with the most to say, and they answer for everybody
                  rather than for the cohort behind the flag. */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {UPGRADE_PLANS.map(({ key, priceEur }) => (
                  <Button
                    key={key}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      handlePlanClick(key, priceEur);
                    }}
                    className="h-11 sm:h-8"
                  >
                    {t(`upgrade.plans.${key}`, { price: priceEur })}
                  </Button>
                ))}
              </div>

              <div className="mt-2 flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleOpen}
                  disabled={!isOfferOpen}
                  className="h-11 flex-1 sm:h-8 sm:flex-none"
                >
                  {t('upgrade.card.action')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDismiss}
                  className="h-11 sm:h-8"
                >
                  {t('upgrade.card.notNow')}
                </Button>
              </div>

              {/* A disabled control with no explanation is a bug to whoever
                  meets it. Said in the page rather than in a tooltip, which a
                  touch screen has no way to open. */}
              {isOfferOpen ? null : (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('upgrade.card.locked')}
                </p>
              )}
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="-mt-1 -mr-1 size-11 shrink-0 md:size-8"
              onClick={handleDismiss}
              aria-label={t('common.close')}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
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
                <span>
                  {t(`upgrade.features.${key}`, { limit: FREE_ACTIVE_TRIP_LIMIT })}
                </span>
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
    </>
  );
});
