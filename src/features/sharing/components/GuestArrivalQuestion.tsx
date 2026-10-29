/**
 * @fileoverview "When do you arrive?", the one question an invite link asks.
 *
 * Asked right after a guest picks their name on `/join/:token`, the way Doodle
 * and Partiful ask a guest one thing and nothing more. Each day of the trip is
 * one button, so the answer is one tap; "not decided yet" is the other way out.
 * The answer is the guest's `stayStartDate`. How they travel is asked after,
 * and can wait.
 *
 * @module features/sharing/components/GuestArrivalQuestion
 */

import { memo, type ReactElement, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { format, parseISO } from 'date-fns';
import { CalendarCheck, Car, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { formatFullDate } from '@/lib/utils/date-format';
import { listArrivalDays } from '../utils/arrival-days';
import type { ISODateString, Person, Trip } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

interface GuestArrivalQuestionProps {
  readonly trip: Pick<Trip, 'startDate' | 'endDate'>;
  readonly person: Pick<Person, 'name' | 'stayStartDate' | 'stayEndDate'>;
  /** Called with the day picked, or null for "not decided yet". */
  readonly onAnswer: (date: ISODateString | null) => void;
  /** True while the answer is being saved: every button waits. */
  readonly busy?: boolean;
}

interface GuestArrivalSavedProps {
  /** The day the guest said they arrive. */
  readonly date: ISODateString;
  /** Opens the transport form for the arrival. */
  readonly onAddTransport: () => void;
  /** Goes on to the trip; the transport can be added later. */
  readonly onLater: () => void;
}

// ============================================================================
// Components
// ============================================================================

/**
 * One button per day of the trip, and "not decided yet".
 *
 * The day the guest already holds, if any, is shown pressed: somebody the
 * organiser already gave a date to can confirm it with one tap.
 */
export const GuestArrivalQuestion = memo(function GuestArrivalQuestion({
  trip,
  person,
  onAnswer,
  busy = false,
}: GuestArrivalQuestionProps): ReactElement {
  const { t, i18n } = useTranslation();
  const locale = getDateLocale(i18n.language);

  const days = useMemo(
    () => listArrivalDays(trip, person.stayEndDate),
    [person.stayEndDate, trip],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="guest-arrival-question">
      <div className="space-y-1 text-center">
        <p className="font-display text-lg font-semibold text-foreground" id="guest-arrival-title">
          {t('sharing.join.arrivalQuestion', {
            name: person.name,
            defaultValue: 'When do you arrive, {{name}}?',
          })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t(
            'sharing.join.arrivalHint',
            'Pick the day. The others see it, and nobody has to ask you again.',
          )}
        </p>
      </div>

      <ul
        className="grid grid-cols-2 gap-2 sm:grid-cols-3"
        aria-labelledby="guest-arrival-title"
      >
        {days.map((day) => {
          const selected = person.stayStartDate === day;
          return (
            <li key={day}>
              <Button
                type="button"
                variant={selected ? 'default' : 'outline'}
                className="h-12 w-full capitalize"
                aria-pressed={selected}
                aria-label={formatFullDate(day, locale)}
                disabled={busy}
                onClick={() => {
                  onAnswer(day);
                }}
              >
                {format(parseISO(day), 'EEE d MMM', { locale })}
              </Button>
            </li>
          );
        })}
      </ul>

      <Button
        type="button"
        variant="ghost"
        className="h-11 w-full"
        disabled={busy}
        onClick={() => {
          onAnswer(null);
        }}
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {t('sharing.join.arrivalUnknown', 'Not decided yet')}
      </Button>
    </div>
  );
});

/**
 * "Noted", then the question that can wait: how the guest travels.
 *
 * The arrival transport needs a time and a place, which is three fields and not
 * one tap, so it is offered here and never required.
 */
export const GuestArrivalSaved = memo(function GuestArrivalSaved({
  date,
  onAddTransport,
  onLater,
}: GuestArrivalSavedProps): ReactElement {
  const { t, i18n } = useTranslation();
  const locale = getDateLocale(i18n.language);

  return (
    <div className="flex flex-col gap-4 text-center" data-testid="guest-arrival-saved">
      <CalendarCheck className="mx-auto size-8 text-primary" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-display text-lg font-semibold text-foreground">
          {t('sharing.join.arrivalNoted', {
            date: formatFullDate(date, locale),
            defaultValue: 'Noted: you arrive on {{date}}.',
          })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t(
            'sharing.join.arrivalTransportHint',
            'How are you getting there? Add it now, or later from the travel page.',
          )}
        </p>
      </div>
      <Button type="button" className="h-11 w-full" onClick={onAddTransport}>
        <Car className="size-4" aria-hidden="true" />
        {t('sharing.join.arrivalAddTransport', 'Add my journey')}
      </Button>
      <Button type="button" variant="ghost" className="h-11 w-full" onClick={onLater}>
        {t('sharing.join.arrivalLater', 'Later')}
      </Button>
    </div>
  );
});
