/**
 * @fileoverview Publish a trip as a template, and show the link that comes out.
 *
 * The enterprise half of trip templates, on the trip's own settings screen. One
 * trip, one link, and the link does not change: it goes on a web page or into a
 * message, and every customer who follows it starts a trip of their own with
 * this trip's place, description, currency and rooms already filled.
 *
 * The link follows the trip. The payload a customer reads is a copy, and
 * `useTemplateRefresh` rewrites it after each edit on the owner's device, so the
 * enterprise does not have to remember to publish again. Publish again stays
 * as the way to push the copy by hand, for example from a device that was
 * offline when the trip changed.
 *
 * **The card is shown to everybody, and `ent-trip-templates` decides only what
 * the buttons do.** It used to render nothing outside the cohort, which meant
 * the feature was invisible to the people whose interest in it is the thing
 * worth measuring. Now the flag picks one of two arms:
 *
 * - **Flag on.** The publish controls are live, subject to the trip's owner
 *   still being the only person who can use them.
 * - **Flag off, or still being decided.** The same card, the same description,
 *   a disabled publish button with a line saying why, and a second button that
 *   opens the paid-tier offer — the same `UpgradeOfferDialog` the "Would you
 *   pay for Kikouchou?" card opens, so an answer given here lands in the same
 *   funnel and the same waiting list as an answer given anywhere else.
 *
 * Undecided reads as off, the "fail closed" reading `UpgradePrompt` takes for
 * the same flag: the alternative is a live publish button that goes dead under
 * somebody's cursor a moment later.
 *
 * @module features/sharing/components/TripTemplateCard
 */

import { type ReactElement, memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Loader2, Sparkles, Store } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignInDialog } from '@/features/auth/components/SignInDialog';
import { UpgradeOfferDialog } from '@/features/upgrade/components/UpgradeOfferDialog';
import { useUpgradeInterest } from '@/features/upgrade/hooks/useUpgradeInterest';
import { upgradeEventProperties } from '@/features/upgrade/constants';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { captureEvent } from '@/lib/posthog';
import { copyText } from '@/lib/utils/clipboard';
import { buildTemplateEmbedSnippets } from '@/lib/sync/templates';
import { useTripTemplateLink } from '../hooks/useTripTemplateLink';
import type { Trip } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * The PostHog flag that decides whether a template can be published.
 *
 * Released to the "enterprise customers" cohort, which is static: somebody adds
 * an account to it by hand. It gates publishing only, in two senses. A link
 * already handed out keeps working for whoever opens it, flag or no flag,
 * because the customer following it is not the enterprise and has no reason to
 * be in that cohort. And the card describing templates is shown to everybody:
 * an account outside the cohort reads what the feature is and is offered the
 * paid-tier question instead of the publish button.
 */
export const TRIP_TEMPLATES_FLAG = 'ent-trip-templates';

/** How long the copy button says it copied. */
const COPIED_FOR_MS = 2_000;

/**
 * Which screen the offer was opened from, for the upgrade funnel.
 *
 * This card lives on a trip's settings screen, so it reports the placement that
 * screen already reports. A fourth placement for one card would split the
 * funnel without answering a question anybody has.
 */
const UPGRADE_PLACEMENT = 'settings' as const;

// ============================================================================
// Type Definitions
// ============================================================================

export interface TripTemplateCardProps {
  /** The trip being edited. */
  readonly trip: Trip;
}

interface CopyFieldProps {
  /** The input's id, which the label points at. */
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /** The copy button's accessible name. */
  readonly copyLabel: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * One read-only value and the button that copies it.
 *
 * Each field keeps its own "copied" tick, so copying the Markdown does not
 * say the HTML was copied too.
 */
const CopyField = memo(function CopyField({
  id,
  label,
  value,
  copyLabel,
}: CopyFieldProps): ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (): Promise<void> => {
    await copyText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_FOR_MS);
  }, [value]);

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          className="min-w-0 flex-1 rounded-md border bg-muted px-3 py-2 text-sm"
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          variant="outline"
          size="icon"
          onClick={() => void handleCopy()}
          aria-label={copyLabel}
        >
          {copied ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  );
});

/**
 * The publish control for the cohort, and the offer for everybody else.
 *
 * @param props - See {@link TripTemplateCardProps}
 * @returns The card
 */
export const TripTemplateCard = memo(function TripTemplateCard({
  trip,
}: TripTemplateCardProps): ReactElement {
  const { t } = useTranslation();
  const flag = useFeatureFlag(TRIP_TEMPLATES_FLAG);
  const enabled = flag === true;

  const { state, publish, unpublish, isBusy } = useTripTemplateLink(trip, enabled);
  const [signInOpen, setSignInOpen] = useState(false);
  const { hasDeclared, declare } = useUpgradeInterest();
  const [offerOpen, setOfferOpen] = useState(false);

  // A member of somebody else's trip sees the same link and the same copy
  // button, and none of the controls behind it.
  const url =
    state.kind === 'published' ? state.url : state.kind === 'not-owner' ? state.url : null;
  const cardUrl =
    state.kind === 'published' || state.kind === 'not-owner' ? state.cardUrl : null;
  const snippets = useMemo(
    () =>
      url !== null && cardUrl !== null
        ? buildTemplateEmbedSnippets(url, cardUrl, trip.name)
        : null,
    [url, cardUrl, trip.name],
  );

  /**
   * Opens the paid-tier offer, and counts the open.
   *
   * The same event the upgrade card's own button sends, with the same
   * placement, because this is the same step of the same funnel reached from a
   * different button. A separate event would make the funnel unreadable.
   *
   * No `captureFeatureInteraction`, and there must not be one. That call means
   * "somebody acted on the enabled experience", and this button only exists
   * when the flag said no: a click on it is evidence about the offer, not about
   * the gated feature. `UpgradePrompt` reports the interaction because its own
   * offer button sits behind the gate.
   */
  const handleOfferOpen = useCallback((): void => {
    captureEvent('upgrade_prompt_opened', {
      ...upgradeEventProperties(UPGRADE_PLACEMENT),
      already_declared: hasDeclared,
    });
    setOfferOpen(true);
  }, [hasDeclared]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Store className="size-5 shrink-0" aria-hidden="true" />
          {t('sharing.template.title', 'Trip template')}
        </CardTitle>
        <CardDescription>
          {t(
            'sharing.template.description',
            'Publish this trip as a template and share one link. Whoever opens it starts their own trip with this place, this description and these rooms, and fills in the name, the dates and the guests.',
          )}
        </CardDescription>
      </CardHeader>

      {enabled ? (
        <CardContent className="flex flex-col gap-4">
          {state.kind === 'loading' ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {t('common.loading', 'Loading…')}
            </p>
          ) : null}

          {state.kind === 'unavailable' ? (
            <p className="text-sm text-muted-foreground" role="alert">
              {t(
                'sharing.template.unavailable',
                'This copy of the app has no sync server configured, so a template cannot be published from it.',
              )}
            </p>
          ) : null}

          {state.kind === 'needs-account' ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">
                {t(
                  'sharing.template.needsAccount',
                  'Publishing a template needs an account, because the link reads it from the server.',
                )}
              </p>
              <Button onClick={() => setSignInOpen(true)}>
                {t('auth.account.signInAction', 'Sign in')}
              </Button>
              <SignInDialog
                open={signInOpen}
                onOpenChange={setSignInOpen}
                reason={t(
                  'sharing.template.signInReason',
                  'Sign in to publish this trip as a template.',
                )}
              />
            </div>
          ) : null}

          {state.kind === 'error' ? (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          ) : null}

          {state.kind === 'not-owner' ? (
            <p className="text-sm text-muted-foreground">
              {state.url === null
                ? t(
                    'sharing.template.notOwner',
                    'Only the person who created this trip can publish it as a template.',
                  )
                : t(
                    'sharing.template.notOwnerPublished',
                    'This trip is published as a template. Only the person who created it can change that or take it down.',
                  )}
            </p>
          ) : null}

          {url !== null ? (
            <div className="flex flex-col gap-3">
              <CopyField
                id="template-link"
                label={t('sharing.template.linkLabel', 'The link to share')}
                value={url}
                copyLabel={t('sharing.copy', 'Copy link')}
              />
              {state.kind === 'published' ? (
                <p className="text-sm text-muted-foreground">
                  {t(
                    'sharing.template.followsTripHint',
                    'Your changes to this trip reach the link on their own while you are online. The link preview can take a few minutes to follow.',
                  )}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Only the preview service draws the card, so a build without one
              offers the bare link and nothing to embed. */}
          {snippets !== null ? (
            <section
              className="flex flex-col gap-3 border-t pt-4"
              aria-labelledby="template-embed-title"
            >
              <div className="flex flex-col gap-1">
                <h3 id="template-embed-title" className="font-display text-sm font-semibold">
                  {t('sharing.template.embedTitle', 'Put it on a web page')}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t(
                    'sharing.template.embedHint',
                    'Paste one of these where your page accepts HTML or Markdown. It shows the card below, and a click on it opens the template.',
                  )}
                </p>
              </div>
              <img
                src={cardUrl ?? undefined}
                alt={t('sharing.template.cardPreviewAlt', 'The card the link shows')}
                width={600}
                height={315}
                loading="lazy"
                className="h-auto w-full max-w-sm rounded-md border"
              />
              <CopyField
                id="template-embed-html"
                label={t('sharing.template.htmlLabel', 'HTML, for a website or an email')}
                value={snippets.html}
                copyLabel={t('sharing.template.copyHtml', 'Copy the HTML')}
              />
              <CopyField
                id="template-embed-markdown"
                label={t('sharing.template.markdownLabel', 'Markdown, for a wiki or a README')}
                value={snippets.markdown}
                copyLabel={t('sharing.template.copyMarkdown', 'Copy the Markdown')}
              />
            </section>
          ) : null}

          {state.kind === 'published' || state.kind === 'unpublished' ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void publish()} disabled={isBusy}>
                {isBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                {state.kind === 'published'
                  ? t('sharing.template.republish', 'Publish again')
                  : t('sharing.template.publish', 'Publish as a template')}
              </Button>
              {state.kind === 'published' ? (
                <Button variant="outline" onClick={() => void unpublish()} disabled={isBusy}>
                  {t('sharing.template.unpublish', 'Take it down')}
                </Button>
              ) : null}
            </div>
          ) : null}

          {state.kind === 'unpublished' ? (
            <p className="text-sm text-muted-foreground">
              {t(
                'sharing.template.keepsTheLink',
                'Taking a template down closes every copy of its link at once. Publishing it again gives back the same link.',
              )}
            </p>
          ) : null}
        </CardContent>
      ) : (
        <CardContent className="flex flex-col gap-4">
          {/* A disabled control with no explanation is a bug to whoever meets
              it, so the reason is in the page rather than in a tooltip that a
              touch screen has no way to open. */}
          <p className="text-sm text-muted-foreground">
            {t(
              'sharing.template.locked',
              'Publishing a template is open to enterprise accounts for now. Tell us you want it and we will know to build it for everybody.',
            )}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button disabled>{t('sharing.template.publish', 'Publish as a template')}</Button>
            <Button variant="outline" onClick={handleOfferOpen}>
              <Sparkles className="size-4" aria-hidden="true" />
              {t('sharing.template.askForIt', 'I would pay for this')}
            </Button>
          </div>

          <UpgradeOfferDialog
            open={offerOpen}
            onOpenChange={setOfferOpen}
            placement={UPGRADE_PLACEMENT}
            hasDeclared={hasDeclared}
            onDeclare={declare}
          />
        </CardContent>
      )}
    </Card>
  );
});
