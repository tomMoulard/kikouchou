/**
 * @fileoverview The screen a trip template link lands on.
 *
 * An enterprise customer publishes one trip and hands out one link. Whoever
 * follows it — a customer of that hotel, with no account and often no idea what
 * this app is — reads what the template says and answers three questions: what
 * to call the trip, when it runs, and who is coming. The place, the map pin, the
 * currency and the rooms arrive with the template and are never asked about.
 *
 * The trip made here is an ordinary local trip. Nothing is synced, the
 * enterprise never sees it, and the customer owes nobody an account. That is
 * the promise of the link, and it is why this page reads through the one
 * anonymous function rather than through the invite path.
 *
 * @module features/sharing/pages/TemplateLandingPage
 */

import { type ReactElement, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, MapPin } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import {
  TripCreateWizard,
  type TripCreateWizardPrefill,
} from '@/features/trips/components/TripCreateWizard';
import { useTripContext } from '@/contexts/TripContext';
import { captureEvent, reportError } from '@/lib/posthog';
import type { NewTripRoom } from '@/features/trips/components/TripForm';
import { useTripTemplate, type TemplatePhase } from '../hooks/useTripTemplate';
import type { Trip } from '@/types';

// ============================================================================
// Shell
// ============================================================================

/** One centred card, so every phase of the screen looks like the same screen. */
function TemplateShell({ children }: { readonly children: ReactElement }): ReactElement {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-2xl">
        <CardContent className="pt-6">{children}</CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

/** What PostHog is told about a visit, once per landing. */
function outcomeOf(phase: TemplatePhase): string | null {
  switch (phase.kind) {
    case 'loading':
      return null;
    case 'ready':
      return 'ready';
    case 'not-found':
      return 'not-found';
    case 'unavailable':
      return 'unavailable';
    case 'failed':
      return 'failed';
  }
}

// ============================================================================
// Page
// ============================================================================

/**
 * Reads a template link and turns it into the customer's own trip.
 *
 * @returns The landing screen
 */
export function TemplateLandingPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();
  const { setCurrentTrip } = useTripContext();

  const { phase, retry } = useTripTemplate(token ?? null);

  // One event per landing, whatever re-renders happen after it.
  const reportedRef = useRef(false);
  useEffect(() => {
    const outcome = outcomeOf(phase);
    if (outcome === null || reportedRef.current) {
      return;
    }
    reportedRef.current = true;
    captureEvent('trip_template_opened', { outcome });
  }, [phase]);

  const prefill = useMemo<TripCreateWizardPrefill | undefined>(() => {
    if (phase.kind !== 'ready') {
      return undefined;
    }
    const { template } = phase;
    return {
      description: template.description,
      location: template.location,
      coordinates: template.coordinates ?? undefined,
      currency: template.currency,
      // `TemplateRoom` and `NewTripRoom` are the same three fields; the copy is
      // what stops the wizard's own edits reaching into the payload.
      rooms: template.rooms.map(
        (room): NewTripRoom => ({ name: room.name, capacity: room.capacity, icon: room.icon }),
      ),
    };
  }, [phase]);

  const handleCreated = useCallback(
    async (trip: Trip): Promise<void> => {
      // The trip exists by now, so a failure to select it must not strand the
      // customer on the done screen. Reported, then navigated anyway: the
      // calendar selects the trip from the route.
      try {
        await setCurrentTrip(trip.id);
      } catch (error) {
        reportError(error, { source: 'TemplateLandingPage.handleCreated' });
      }
      void navigate(`/trips/${trip.id}/calendar`);
    },
    [navigate, setCurrentTrip],
  );

  const handleCancel = useCallback((): void => {
    void navigate('/trips');
  }, [navigate]);

  if (phase.kind === 'loading') {
    return (
      <TemplateShell>
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-lg">
            {t('sharing.template.opening', 'Opening the trip template…')}
          </CardTitle>
        </div>
      </TemplateShell>
    );
  }

  if (phase.kind === 'not-found' || phase.kind === 'unavailable') {
    return (
      <TemplateShell>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <AlertTriangle className="size-6 text-muted-foreground" aria-hidden="true" />
          </div>
          <CardTitle className="text-lg">
            {t('sharing.template.notFound', "This trip template isn't available.")}
          </CardTitle>
          <CardDescription>
            {t(
              'sharing.template.askAgain',
              'Ask whoever gave you the link for a new one, or start a trip of your own.',
            )}
          </CardDescription>
          <Button variant="outline" onClick={() => void navigate('/trips/new')}>
            {t('trips.new', 'New trip')}
          </Button>
        </div>
      </TemplateShell>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <TemplateShell>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
          </div>
          <CardTitle className="text-lg">
            {t('sharing.template.failed', "Couldn't open the trip template")}
          </CardTitle>
          <CardDescription>{phase.message}</CardDescription>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void navigate('/trips')}>
              {t('trips.title', 'My trips')}
            </Button>
            <Button onClick={retry}>{t('common.retry', 'Retry')}</Button>
          </div>
        </div>
      </TemplateShell>
    );
  }

  const { template } = phase;

  return (
    <TemplateShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <CardTitle className="text-xl">{template.name}</CardTitle>
          {template.location === null ? null : (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="size-4 shrink-0" aria-hidden="true" />
              {template.location}
            </p>
          )}
          {template.description === null ? null : (
            // The enterprise's own words: check-in times, what to bring, who to
            // call. Kept above the questions, because it is what tells the
            // customer which dates and which guests to put in.
            <p className="whitespace-pre-line text-sm text-muted-foreground">
              {template.description}
            </p>
          )}
        </header>

        <TripCreateWizard
          prefill={prefill}
          onCreated={(trip) => void handleCreated(trip)}
          onCancel={handleCancel}
        />
      </div>
    </TemplateShell>
  );
}

// ============================================================================
// Exports
// ============================================================================

export default TemplateLandingPage;
