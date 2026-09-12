/**
 * @fileoverview "Print the trip summary" card for the trip settings page.
 *
 * The printable sheet used to have its own entry in the main navigation, next
 * to the calendar and the rooms. It does not belong there: it is not a place
 * you go to plan, it is a thing you do once, the morning everybody leaves.
 * One button in the trip settings is the whole feature, and the sidebar gets a
 * slot back.
 *
 * The route still exists and still carries the sheet — this only changes how
 * it is reached.
 *
 * @module features/trips/components/PrintSummaryCard
 */

import { type ReactElement, memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useTripContext } from '@/contexts/TripContext';

// ============================================================================
// Component
// ============================================================================

/**
 * Lets the user open the printable one-page summary of the current trip.
 *
 * With no trip selected the button is disabled rather than hidden: a card that
 * appears and disappears with the trip makes the page jump, and a disabled
 * button says the feature exists and what it needs.
 *
 * @returns The print-summary card
 */
export const PrintSummaryCard = memo(function PrintSummaryCard(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentTrip } = useTripContext();

  const handleOpen = useCallback((): void => {
    if (!currentTrip) {
      return;
    }
    void navigate(`/trips/${currentTrip.id}/summary`);
  }, [currentTrip, navigate]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
            <Printer className="size-5 text-primary" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-base">
              {t('summary.title', 'Trip summary')}
            </CardTitle>
            <CardDescription>
              {t(
                'summary.description',
                'One page for the fridge door: who sleeps where, who arrives when, who drives.',
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button onClick={handleOpen} disabled={!currentTrip}>
          <Printer className="mr-2 size-4" aria-hidden="true" />
          {t('settings.printSummary', 'Print the trip summary')}
        </Button>
        {!currentTrip && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t('settings.printSummaryNoTrip', 'Open a trip to print its summary.')}
          </p>
        )}
      </CardContent>
    </Card>
  );
});
