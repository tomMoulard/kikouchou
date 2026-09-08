/**
 * @fileoverview The printable sheet itself: one page of who sleeps where, who
 * arrives when and who drives.
 *
 * Pure presentation over a {@link TripSummary}. It holds no data access and no
 * lookups, so a test renders it from a fixture and the page above it stays a
 * thin loader.
 *
 * Print is a first-class layout here, not an afterthought: the sheet is plain
 * blocks and text, every colour carries a word beside it, and the `print:`
 * utilities drop the screen chrome (cards, shadows, wide gaps) so the browser's
 * own "Print to PDF" produces something worth taping to a fridge.
 *
 * @module features/summary/components/SummarySheet
 */

import { type ReactElement, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale } from 'date-fns';

import { toLocalISODateString } from '@/lib/db/utils';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { formatDateRange, formatFullDate } from '@/lib/utils/date-format';
import { formatTransportDatetimeParts } from '@/lib/utils/datetime-format';
import { localDayKeyOfInstant } from '@/lib/utils/trip-days';
import type {
  SummaryGuest,
  SummaryRoom,
  SummaryTravel,
  TripSummary,
} from '@/features/summary/lib/trip-summary';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for {@link SummarySheet}.
 */
interface SummarySheetProps {
  /** Everything the sheet prints. */
  readonly summary: TripSummary;
  /** The day the sheet was printed, so paper on a wall says how old it is. */
  readonly printedOn: Date;
}

/**
 * Travels sharing one calendar day, under that day's heading.
 */
interface TravelDayGroup {
  /** Local day key, `YYYY-MM-DD`. */
  readonly dayKey: string;
  /** That day's travels, earliest first. */
  readonly travels: readonly SummaryTravel[];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Groups travels by the calendar day the viewer sees them on.
 *
 * The list arrives sorted, so one pass keeps both the days and the rows inside
 * them in order. A travel whose datetime will not parse keeps its own group
 * under the raw value rather than being dropped: a wrong line on paper gets
 * fixed, a missing one does not.
 *
 * @param travels - Travels, earliest first
 * @returns One group per day, earliest first
 */
function groupTravelsByDay(
  travels: readonly SummaryTravel[],
): readonly TravelDayGroup[] {
  const groups: TravelDayGroup[] = [];
  let current: { dayKey: string; travels: SummaryTravel[] } | null = null;

  for (const travel of travels) {
    const dayKey = localDayKeyOfInstant(travel.datetime) ?? travel.datetime;
    if (current === null || current.dayKey !== dayKey) {
      current = { dayKey, travels: [] };
      groups.push(current);
    }
    current.travels.push(travel);
  }

  return groups;
}

// ============================================================================
// Sections
// ============================================================================

/**
 * One room and the guests booked into it.
 */
const RoomBlock = memo(function RoomBlock({
  room,
  dateLocale,
}: {
  readonly room: SummaryRoom;
  readonly dateLocale: Locale;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <li className="break-inside-avoid border-b border-border py-2 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold">{room.name}</h3>
        <span className="text-sm text-muted-foreground">
          {t('rooms.beds', { count: room.capacity })}
        </span>
      </div>

      {room.stays.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('summary.roomEmpty', 'Nobody yet')}
        </p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {room.stays.map((stay) => (
            <li
              key={stay.assignmentId}
              className="flex items-baseline justify-between gap-3 text-sm"
            >
              <span>
                {stay.personName}
                {stay.headcount > 1 ? (
                  <span className="text-muted-foreground">
                    {' '}
                    {t('summary.headcountSuffix', { count: stay.headcount })}
                  </span>
                ) : null}
              </span>
              <span className="text-muted-foreground whitespace-nowrap">
                {formatDateRange(stay.startDate, stay.endDate, dateLocale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
});

/**
 * One arrival or departure, with its driver.
 */
const TravelRow = memo(function TravelRow({
  travel,
  dateLocale,
}: {
  readonly travel: SummaryTravel;
  readonly dateLocale: Locale;
}): ReactElement {
  const { t } = useTranslation();

  const { time } = formatTransportDatetimeParts(
    travel.datetime,
    dateLocale,
    'timeOnly',
  );
  const isArrival = travel.type === 'arrival';
  // The arrow never carries the meaning on its own — the word travels with it,
  // which is also what makes the line readable in black and white.
  const direction = isArrival
    ? `↓ ${t('transports.arrival')}`
    : `↑ ${t('transports.departure')}`;

  const details = [
    travel.location,
    travel.number,
    travel.mode ? t(`transports.modes.${travel.mode}`) : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <li className="break-inside-avoid py-1 text-sm">
      <div className="flex items-baseline gap-2">
        <span className="w-12 shrink-0 font-medium tabular-nums">{time}</span>
        <span className="font-medium">
          {travel.personName ?? t('common.unknown')}
        </span>
        <span className="text-muted-foreground">{direction}</span>
      </div>
      {details.length > 0 ? (
        <p className="pl-14 text-muted-foreground">{details.join(' · ')}</p>
      ) : null}
      {travel.needsPickup || travel.driverName !== null ? (
        <p className="pl-14">
          {travel.driverName === null
            ? t('summary.driverMissing', 'Driver: nobody yet')
            : t('summary.driver', 'Driver: {{name}}', {
                name: travel.driverName,
              })}
        </p>
      ) : null}
    </li>
  );
});

/**
 * One guest and how to reach them.
 */
const GuestRow = memo(function GuestRow({
  guest,
  dateLocale,
}: {
  readonly guest: SummaryGuest;
  readonly dateLocale: Locale;
}): ReactElement {
  const { t } = useTranslation();

  const stay =
    guest.arrivalDate !== null && guest.departureDate !== null
      ? formatDateRange(guest.arrivalDate, guest.departureDate, dateLocale)
      : null;

  return (
    <li className="break-inside-avoid py-1 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span>
          <span className="font-medium">{guest.name}</span>
          {guest.headcount > 1 ? (
            <span className="text-muted-foreground">
              {' '}
              {t('summary.headcountSuffix', { count: guest.headcount })}
            </span>
          ) : null}
        </span>
        <span className="whitespace-nowrap tabular-nums">{guest.phone}</span>
      </div>
      {stay !== null ? <p className="text-muted-foreground">{stay}</p> : null}
      {guest.notes ? (
        <p className="text-muted-foreground">{guest.notes}</p>
      ) : null}
    </li>
  );
});

// ============================================================================
// Component
// ============================================================================

/**
 * Renders the printable one-page summary of a trip.
 *
 * @param props - The summary to print and the day it was printed
 * @returns The sheet
 *
 * @example
 * ```tsx
 * <SummarySheet summary={summary} printedOn={new Date()} />
 * ```
 */
export const SummarySheet = memo(function SummarySheet({
  summary,
  printedOn,
}: SummarySheetProps): ReactElement {
  const { t, i18n } = useTranslation();
  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  const travelDays = useMemo(
    () => groupTravelsByDay(summary.travels),
    [summary.travels],
  );

  return (
    <article
      className="mx-auto max-w-3xl space-y-6 text-foreground print:max-w-none print:space-y-4"
      aria-label={t('summary.title', 'Trip summary')}
    >
      {/* ==================================================================== */}
      {/* Heading */}
      {/* ==================================================================== */}
      <header className="border-b border-border pb-3">
        <h2 className="text-2xl font-bold">{summary.name}</h2>
        <p className="text-muted-foreground">
          {formatDateRange(summary.startDate, summary.endDate, dateLocale)}
          {summary.location ? ` · ${summary.location}` : ''}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('summary.headcount', { count: summary.headcount })}
        </p>
      </header>

      {/* ==================================================================== */}
      {/* Who sleeps where */}
      {/* ==================================================================== */}
      <section aria-labelledby="summary-rooms">
        <h2 id="summary-rooms" className="mb-1 text-lg font-semibold">
          {t('summary.rooms', 'Who sleeps where')}
        </h2>
        {summary.rooms.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('summary.noRooms', 'No rooms yet')}
          </p>
        ) : (
          <ul>
            {summary.rooms.map((room) => (
              <RoomBlock key={room.roomId} room={room} dateLocale={dateLocale} />
            ))}
          </ul>
        )}
        {summary.guestsWithoutRoom.length > 0 ? (
          <p className="mt-2 text-sm">
            {t('summary.guestsWithoutRoom', 'Still without a bed: {{names}}', {
              names: summary.guestsWithoutRoom.join(', '),
            })}
          </p>
        ) : null}
      </section>

      {/* ==================================================================== */}
      {/* Who arrives when, and who drives */}
      {/* ==================================================================== */}
      <section aria-labelledby="summary-travel">
        <h2 id="summary-travel" className="mb-1 text-lg font-semibold">
          {t('summary.travel', 'Arrivals and departures')}
        </h2>
        {travelDays.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('summary.noTravel', 'No travel plans yet')}
          </p>
        ) : (
          travelDays.map((group) => (
            <div key={group.dayKey} className="break-inside-avoid py-1">
              <h3 className="text-sm font-semibold">
                {formatFullDate(group.dayKey, dateLocale)}
              </h3>
              <ul>
                {group.travels.map((travel) => (
                  <TravelRow
                    key={travel.transportId}
                    travel={travel}
                    dateLocale={dateLocale}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {/* ==================================================================== */}
      {/* Who to call */}
      {/* ==================================================================== */}
      <section aria-labelledby="summary-guests">
        <h2 id="summary-guests" className="mb-1 text-lg font-semibold">
          {t('summary.guests', 'Guests')}
        </h2>
        {summary.guests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('summary.noGuests', 'No guests yet')}
          </p>
        ) : (
          <ul>
            {summary.guests.map((guest) => (
              <GuestRow
                key={guest.personId}
                guest={guest}
                dateLocale={dateLocale}
              />
            ))}
          </ul>
        )}
      </section>

      <footer className="border-t border-border pt-2 text-xs text-muted-foreground">
        {t('summary.printedOn', 'Printed on {{date}}', {
          date: formatFullDate(toLocalISODateString(printedOn), dateLocale),
        })}
      </footer>
    </article>
  );
});

// ============================================================================
// Exports
// ============================================================================

export type { SummarySheetProps };
