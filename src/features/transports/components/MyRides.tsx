/**
 * @fileoverview The panel that tells the guest this browser is what *they*
 * have to do: the rides they drive, and their own arrivals and departures.
 *
 * A trip's transport page is a list of everybody's legs, and the one question
 * a guest opens it with — "am I driving anybody, and when do I travel?" — used
 * to mean reading every card. This answers it at the top of the page.
 *
 * @module features/transports/components/MyRides
 */

import { type ReactElement, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, ArrowUpFromLine, Car, MapPin, Plane } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { statusVariants } from '@/components/ui/status.variants';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import { formatTransportDatetime } from '@/lib/utils/datetime-format';
import { getTripGuestPersonId } from '@/lib/sharing/guest-identity';
import { isTransportUpcoming } from '@/features/transports/utils/pickup-utils';
import { selectMyTransports } from '@/features/transports/utils/my-transports';
import type { Locale } from 'date-fns';
import type { Person, PersonId, Transport } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the MyRides panel.
 */
export interface MyRidesProps {
  /** Optional className for additional styling. */
  readonly className?: string;
}

/**
 * Props for one line of the panel.
 */
interface MyRideRowProps {
  /** The leg to describe. */
  readonly transport: Transport;
  /** The guest travelling on it, when the row is a ride the reader drives. */
  readonly passenger: Person | undefined;
  /** Date locale for formatting. */
  readonly dateLocale: Locale;
}

// ============================================================================
// Row
// ============================================================================

/**
 * One leg, as a single readable line: when, what, who and where.
 */
const MyRideRow = memo(function MyRideRow({
  transport,
  passenger,
  dateLocale,
}: MyRideRowProps): ReactElement {
  const when = formatTransportDatetime(transport.datetime, dateLocale, 'dayAndTime');
  const TypeIcon = transport.type === 'arrival' ? ArrowDownToLine : ArrowUpFromLine;

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <TypeIcon
        className={cn(
          'size-4 shrink-0',
          statusVariants({ tone: transport.type, emphasis: 'text' }),
        )}
        aria-hidden="true"
      />
      <span className="font-medium tabular-nums">{when}</span>
      {passenger && <PersonBadge person={passenger} size="sm" />}
      <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
        <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate" title={transport.location}>
          {transport.location}
        </span>
      </span>
      {transport.transportNumber && (
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {transport.transportNumber}
        </span>
      )}
    </li>
  );
});

// ============================================================================
// Component
// ============================================================================

/**
 * Shows the reader their own upcoming transports.
 *
 * Renders nothing when this browser has no guest identity for the trip — an
 * owner planning for everybody has no "mine" to show, and a panel with an
 * empty answer would only be in their way.
 *
 * The set it splits is the trip's *upcoming* transports, measured against
 * `TransportContext.nowMs`, so this panel ages on the same minute tick as the
 * list under it rather than on a "now" of its own.
 *
 * @param props - Component props
 * @returns The panel, or null when there is nobody to show it to
 */
const MyRides = memo(function MyRides({
  className,
}: MyRidesProps): ReactElement | null {
  const { t, i18n } = useTranslation();
  const { currentTrip } = useTripContext();
  const { persons } = usePersonContext();
  const { transports, nowMs } = useTransportContext();

  const dateLocale = getDateLocale(i18n.language);

  /** The guest this browser identified as when it opened a share link. */
  const currentPersonId = getTripGuestPersonId(currentTrip);

  const me = persons.find((person) => person.id === currentPersonId);

  const personsMap = useMemo(() => {
    const map = new Map<PersonId, Person>();
    for (const person of persons) {
      map.set(person.id, person);
    }
    return map;
  }, [persons]);

  // Measured against the context's own reference instant, so this panel ages
  // on the same minute tick as the list under it.
  const upcoming = useMemo(
    () =>
      transports.filter((transport) => isTransportUpcoming(transport.datetime, nowMs)),
    [transports, nowMs],
  );

  const { driving, traveling } = useMemo(
    () => selectMyTransports(upcoming, currentPersonId),
    [upcoming, currentPersonId],
  );

  if (currentPersonId === undefined) {
    return null;
  }

  const hasNothing = driving.length === 0 && traveling.length === 0;

  return (
    <section
      className={cn(
        statusVariants({ tone: 'neutral', emphasis: 'surface' }),
        'rounded-xl border p-4',
        className,
      )}
      aria-labelledby="my-rides-heading"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Car className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h2 id="my-rides-heading" className="text-base font-semibold">
          {t('transports.myRides', 'Your rides')}
        </h2>
        {me && <PersonBadge person={me} size="sm" />}
      </div>

      {hasNothing ? (
        <p className="text-sm text-muted-foreground">
          {t(
            'transports.myRidesEmpty',
            'Nothing ahead for you: no ride to drive and no travel of your own.',
          )}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {driving.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('transports.myRidesDriving', 'You drive')}
                <Badge
                  variant="outline"
                  className={cn('ml-2', statusVariants({ tone: 'success', emphasis: 'outline' }))}
                >
                  {driving.length}
                </Badge>
              </h3>
              <ul className="space-y-2">
                {driving.map((transport) => (
                  <MyRideRow
                    key={transport.id}
                    transport={transport}
                    passenger={personsMap.get(transport.personId)}
                    dateLocale={dateLocale}
                  />
                ))}
              </ul>
            </div>
          )}

          {traveling.length > 0 && (
            <div>
              <h3 className="mb-2 flex items-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Plane className="mr-1.5 size-3.5 shrink-0" aria-hidden="true" />
                {t('transports.myRidesTravel', 'Your own travel')}
                <Badge variant="outline" className="ml-2">
                  {traveling.length}
                </Badge>
              </h3>
              <ul className="space-y-2">
                {traveling.map((transport) => (
                  <MyRideRow
                    key={transport.id}
                    transport={transport}
                    passenger={undefined}
                    dateLocale={dateLocale}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { MyRides };
