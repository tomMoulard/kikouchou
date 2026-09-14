/**
 * @fileoverview Publish a trip as a template, and show the link that comes out.
 *
 * The enterprise half of trip templates, on the trip's own settings screen and
 * behind the `ent-trip-templates` flag. One trip, one link, and the link does
 * not change: it goes on a web page or into a message, and every customer who
 * follows it starts a trip of their own with this trip's place, description,
 * currency and rooms already filled.
 *
 * Publish is also republish. The payload a customer reads is a copy taken when
 * the button was pressed, so a trip edited afterwards is published again by
 * pressing it again, and the screen says so rather than leaving the enterprise
 * to guess.
 *
 * @module features/sharing/components/TripTemplateCard
 */

import { type ReactElement, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Loader2, Store } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignInDialog } from '@/features/auth/components/SignInDialog';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { copyText } from '@/lib/utils/clipboard';
import { useTripTemplateLink } from '../hooks/useTripTemplateLink';
import type { Trip } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * The PostHog flag that offers templates at all.
 *
 * Released to the "enterprise customers" cohort, which is static: somebody adds
 * an account to it by hand. It gates publishing only. A link already handed out
 * keeps working for whoever opens it, flag or no flag, because the customer
 * following it is not the enterprise and has no reason to be in that cohort.
 */
export const TRIP_TEMPLATES_FLAG = 'ent-trip-templates';

/** How long the copy button says it copied. */
const COPIED_FOR_MS = 2_000;

// ============================================================================
// Type Definitions
// ============================================================================

export interface TripTemplateCardProps {
  /** The trip being edited. */
  readonly trip: Trip;
}

// ============================================================================
// Component
// ============================================================================

/**
 * The publish control, or nothing at all for everybody outside the cohort.
 *
 * @param props - See {@link TripTemplateCardProps}
 * @returns The card, or null
 */
export const TripTemplateCard = memo(function TripTemplateCard({
  trip,
}: TripTemplateCardProps): ReactElement | null {
  const { t } = useTranslation();
  const flag = useFeatureFlag(TRIP_TEMPLATES_FLAG);
  const enabled = flag === true;

  const { state, publish, unpublish, isBusy } = useTripTemplateLink(trip, enabled);
  const [copied, setCopied] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);

  const url = state.kind === 'published' ? state.url : null;

  const handleCopy = useCallback(async (): Promise<void> => {
    if (url === null) {
      return;
    }
    await copyText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_FOR_MS);
  }, [url]);

  // Nothing is rendered while the flag is undecided, and nothing at all for a
  // person the flag says no to: this is a section of the screen, not the
  // screen, so there is no control arm to hold a space for.
  if (!enabled) {
    return null;
  }

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

        {state.kind === 'published' ? (
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium" htmlFor="template-link">
              {t('sharing.template.linkLabel', 'The link to share')}
            </label>
            <div className="flex gap-2">
              <input
                id="template-link"
                className="min-w-0 flex-1 rounded-md border bg-muted px-3 py-2 text-sm"
                readOnly
                value={state.url}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => void handleCopy()}
                aria-label={t('sharing.copy', 'Copy link')}
              >
                {copied ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {t(
                'sharing.template.republishHint',
                'Customers read a copy taken when you published. Publish again after you change the trip.',
              )}
            </p>
          </div>
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
    </Card>
  );
});
