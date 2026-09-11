/**
 * @fileoverview Run sheet — the dated list of every arrival and departure of a
 * trip, with the legs that still need a driver flagged.
 *
 * Route: /trips/:tripId/transports/runsheet
 *
 * Analytics has counted "pickups needing a driver" for a while, and no screen
 * listed them, so the number was a fact nobody could act on. This is that
 * screen: one line per leg, ordered by day and by clock, the unassigned ones
 * marked, and a tap on a line opens the leg so a driver can be filled in.
 *
 * @module features/transports/pages/TransportRunSheetPage
 */

import { type ReactElement, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, ArrowUpFromLine, Car, Clock, MapPin, Plane } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { statusVariants } from '@/components/ui/status.variants';
import { ViewSwitcher } from '@/components/ui/view-switcher';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { PageHeader } from '@/components/shared/PageHeader';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import { formatTransportDatetimeParts } from '@/lib/utils/datetime-format';
import { getTripGuestPersonId } from '@/lib/sharing/guest-identity';
import { TransportDialog } from '@/features/transports/components/TransportDialog';
import {
  isTransportUpcoming,
  selectPickupsNeedingDriver,
} from '@/features/transports/utils/pickup-utils';
import { isDrivenBy, isMyTransport } from '@/features/transports/utils/my-transports';
import {
  countGroupedTransports,
  groupTransportsByDate,
} from '@/features/transports/utils/transport-grouping';
import type { Locale } from 'date-fns';
import type { Person, PersonId, Transport, TransportId } from '@/types';
import { captureEvent } from '@/lib/posthog';

// ============================================================================
// Type Definitions
// ============================================================================

/** Which legs the run sheet is showing. */
const RUN_SHEET_FILTERS = ['all', 'needsDriver', 'mine'] as const;

/** A run sheet filter from {@link RUN_SHEET_FILTERS}. */
type RunSheetFilter = (typeof RUN_SHEET_FILTERS)[number];

/** The query parameter that carries the filter, so a link can point at one. */
const FILTER_PARAM = 'filter';

/**
 * Props for one line of the run sheet.
 */
interface RunSheetRowProps {
  /** The leg this line describes. */
  readonly transport: Transport;
  /** The guest travelling. */
  readonly person: Person | undefined;
  /** The driver, when one is assigned. */
  readonly driver: Person | undefined;
  /** Date locale for formatting. */
  readonly dateLocale: Locale;
  /** True when the leg has already happened. */
  readonly isPast: boolean;
  /** True when the reader travels on this leg or drives it. */
  readonly isMine: boolean;
  /** True when the reader is the driver of this leg. */
  readonly isDriving: boolean;
  /** Opens the leg for editing. */
  readonly onOpen: (transportId: TransportId) => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Reads a filter out of the URL.
 *
 * An unknown value falls back to `all` rather than showing nothing: a stale
 * or hand-typed link must still land on a usable run sheet.
 *
 * @param raw - The raw query parameter value
 * @returns A filter the page can render
 */
function parseFilter(raw: string | null): RunSheetFilter {
  return RUN_SHEET_FILTERS.find((filter) => filter === raw) ?? 'all';
}

// ============================================================================
// RunSheetRow Component
// ============================================================================

/**
 * One leg of the run sheet: the clock, who travels, where, and who drives.
 */
const RunSheetRow = memo(function RunSheetRow({
  transport,
  person,
  driver,
  dateLocale,
  isPast,
  isMine,
  isDriving,
  onOpen,
}: RunSheetRowProps): ReactElement {
  const { t } = useTranslation();

  const { time } = formatTransportDatetimeParts(
    transport.datetime,
    dateLocale,
    'timeOnly',
  );
  const TypeIcon = transport.type === 'arrival' ? ArrowDownToLine : ArrowUpFromLine;
  const needsDriver = transport.needsPickup && !transport.driverId;

  const handleClick = useCallback(() => {
    onOpen(transport.id);
  }, [onOpen, transport.id]);

  const parts = [
    time,
    transport.type === 'arrival' ? t('transports.arrival') : t('transports.departure'),
    person?.name ?? t('common.unknown'),
    transport.location,
  ];
  if (needsDriver) {
    parts.push(t('pickups.needsDriver'));
  } else if (driver) {
    parts.push(`${t('transports.driver')}: ${driver.name}`);
  }
  const ariaLabel = parts.filter(Boolean).join(', ');

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        aria-label={ariaLabel}
        data-testid="run-sheet-row"
        // The end-to-end suite runs in French, so the flag is addressed as
        // data rather than as text.
        data-needs-driver={needsDriver ? 'true' : 'false'}
        className={cn(
          'flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border p-3 text-left',
          'transition-colors hover:bg-muted/60',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          needsDriver && statusVariants({ tone: 'warning', emphasis: 'surface' }),
          isMine && 'border-l-4 border-l-primary',
          isPast && 'opacity-60',
        )}
      >
        {/* Clock — the column a run sheet is read down */}
        <span className="flex w-16 shrink-0 items-center gap-1.5 font-semibold tabular-nums">
          <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {time}
        </span>

        <TypeIcon
          className={cn(
            'size-4 shrink-0',
            statusVariants({ tone: transport.type, emphasis: 'text' }),
          )}
          aria-hidden="true"
        />

        {person ? (
          <PersonBadge person={person} size="sm" />
        ) : (
          <Badge variant="secondary" className="text-muted-foreground">
            {t('common.unknown')}
          </Badge>
        )}

        <span className="flex min-w-0 flex-1 items-center gap-1 text-sm text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate" title={transport.location}>
            {transport.location}
          </span>
        </span>

        {transport.transportNumber && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {transport.transportNumber}
          </span>
        )}

        {/* The flag this page exists for */}
        {needsDriver && (
          <Badge
            variant="outline"
            className={cn('shrink-0', statusVariants({ tone: 'warning', emphasis: 'outline' }))}
          >
            <Car className="mr-1 size-3.5" aria-hidden="true" />
            {t('pickups.needsDriver')}
          </Badge>
        )}

        {driver && (
          <Badge
            variant="outline"
            className={cn('shrink-0', statusVariants({ tone: 'success', emphasis: 'outline' }))}
          >
            {isDriving
              ? t('transports.youDrive', 'You drive')
              : `${t('transports.driver')}: ${driver.name}`}
          </Badge>
        )}
      </button>
    </li>
  );
});

// ============================================================================
// TransportRunSheetPage Component
// ============================================================================

/**
 * The trip's run sheet.
 *
 * @example
 * ```tsx
 * { path: '/trips/:tripId/transports/runsheet', element: <TransportRunSheetPage /> }
 * ```
 */
const TransportRunSheetPage = memo(function TransportRunSheetPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { tripId: tripIdFromUrl } = useParams<'tripId'>();
  const [searchParams, setSearchParams] = useSearchParams();

  const { currentTrip, isLoading: isTripLoading, setCurrentTrip } = useTripContext();
  const { persons, isLoading: isPersonsLoading } = usePersonContext();
  // A pickup counts as covered once its car has a driver, so this selection
  // needs the trip's rides as well as its legs.
  const { rides } = useRideContext();
  const {
    transports,
    upcomingPickups,
    nowMs,
    isLoading: isTransportsLoading,
    error: transportsError,
  } = useTransportContext();

  const [editingTransportId, setEditingTransportId] = useState<
    TransportId | undefined
  >(undefined);

  const isLoading = isTripLoading || isPersonsLoading || isTransportsLoading;

  const dateLocale = getDateLocale(i18n.language);

  const personsMap = useMemo(() => {
    const map = new Map<PersonId, Person>();
    for (const person of persons) {
      map.set(person.id, person);
    }
    return map;
  }, [persons]);

  /** The guest this browser identified as, when it did. */
  const currentPersonId = getTripGuestPersonId(currentTrip);

  /**
   * `mine` needs somebody to be. Without an identity it falls back to `all`,
   * so a link shared between an owner and a guest lands somewhere useful for
   * both instead of on an empty sheet under a filter that has no tab.
   */
  const requestedFilter = parseFilter(searchParams.get(FILTER_PARAM));
  const filter: RunSheetFilter =
    requestedFilter === 'mine' && currentPersonId === undefined
      ? 'all'
      : requestedFilter;

  /**
   * The legs that still need a driver — the same selection the analytics badge
   * counts and the alert panel shows, so a link that lands here with
   * `?filter=needsDriver` lists exactly the number that was clicked.
   */
  const pickupsNeedingDriver = useMemo(
    () => selectPickupsNeedingDriver(upcomingPickups, rides),
    [upcomingPickups, rides],
  );

  const myTransports = useMemo(
    () => transports.filter((transport) => isMyTransport(transport, currentPersonId)),
    [transports, currentPersonId],
  );

  const filteredTransports = useMemo((): readonly Transport[] => {
    if (filter === 'needsDriver') {
      return pickupsNeedingDriver;
    }
    if (filter === 'mine') {
      return myTransports;
    }
    return transports;
  }, [filter, transports, pickupsNeedingDriver, myTransports]);

  const dateGroups = useMemo(
    () => groupTransportsByDate(filteredTransports, dateLocale),
    [filteredTransports, dateLocale],
  );

  // Count what the page renders: grouping drops a leg whose datetime cannot be
  // read, so counting the input would promise lines that never appear.
  const shownCount = countGroupedTransports(dateGroups);

  const handleOpenTransport = useCallback((transportId: TransportId) => {
    setEditingTransportId(transportId);
  }, []);

  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setEditingTransportId(undefined);
    }
  }, []);

  const handleFilterChange = useCallback(
    (value: RunSheetFilter) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === 'all') {
            next.delete(FILTER_PARAM);
          } else {
            next.set(FILTER_PARAM, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleBack = useCallback(() => {
    navigate(`/trips/${tripIdFromUrl}/transports`);
  }, [navigate, tripIdFromUrl]);

  const filterOptions: Array<{ value: RunSheetFilter; label: string }> = [
    { value: 'all', label: t('transports.runSheetFilterAll', 'Everything') },
    {
      value: 'needsDriver',
      label: `${t('pickups.needsDriver')} (${pickupsNeedingDriver.length})`,
    },
  ];

  // "Mine" is only a question somebody who said who they are can ask.
  if (currentPersonId !== undefined) {
    filterOptions.push({
      value: 'mine',
      label: `${t('transports.runSheetFilterMine', 'Mine')} (${myTransports.length})`,
    });
  }

  // Sync the URL's trip with the context, the way every trip-scoped page does.
  useEffect(() => {
    if (tripIdFromUrl && !isTripLoading && currentTrip?.id !== tripIdFromUrl) {
      setCurrentTrip(tripIdFromUrl).catch((error: unknown) => {
        console.error('Failed to set current trip from URL:', error);
      });
    }
  }, [tripIdFromUrl, currentTrip?.id, isTripLoading, setCurrentTrip]);

  // Who opens the run sheet, with which filter, and whether it had anything
  // in it. The route has its own `$pageview`, but the filter lives in a query
  // parameter and `requestedFilter` can differ from `filter` — asking for
  // "mine" without an identity silently falls back to "all", which is a
  // disappointed reader that no page-level count would show.
  const hasReportedViewRef = useRef(false);
  useEffect(() => {
    if (isLoading || hasReportedViewRef.current) {
      return;
    }
    hasReportedViewRef.current = true;
    captureEvent('transports_view_opened', {
      view: 'runsheet',
      filter,
      requested_filter: requestedFilter,
      has_identity: currentPersonId !== undefined,
      shown_count: shownCount,
    });
  }, [currentPersonId, filter, isLoading, requestedFilter, shownCount]);

  const tripMismatch =
    Boolean(tripIdFromUrl) && Boolean(currentTrip) && tripIdFromUrl !== currentTrip?.id;

  // ==========================================================================
  // Render: Loading
  // ==========================================================================

  if (isLoading) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader
          title={t('transports.runSheet', 'Run sheet')}
          backLink={tripIdFromUrl ? `/trips/${tripIdFromUrl}/transports` : '/trips'}
        />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <LoadingState variant="inline" size="lg" />
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: Trip mismatch or not found
  // ==========================================================================

  if (!tripIdFromUrl || !currentTrip || tripMismatch) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader title={t('transports.runSheet', 'Run sheet')} backLink="/trips" />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <EmptyState
            icon={Plane}
            title={t('errors.tripNotFound', 'Trip not found')}
            description={t(
              'errors.tripNotFoundDescription',
              'The trip you are looking for does not exist or you do not have access to it.',
            )}
            action={{
              label: t('common.back'),
              onClick: () => navigate('/trips'),
            }}
          />
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: Error
  // ==========================================================================

  if (transportsError) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader
          title={t('transports.runSheet', 'Run sheet')}
          backLink={`/trips/${tripIdFromUrl}/transports`}
        />
        <ErrorDisplay
          error={transportsError}
          onRetry={() => window.location.reload()}
          onBack={handleBack}
        />
      </div>
    );
  }

  // ==========================================================================
  // Render: Run sheet
  // ==========================================================================

  return (
    <div className="container max-w-4xl py-6 md:py-8">
      <PageHeader
        title={t('transports.runSheet', 'Run sheet')}
        description={t(
          'transports.runSheetDescription',
          'Every arrival and departure, day by day. A flagged line still needs a driver.',
        )}
        backLink={`/trips/${tripIdFromUrl}/transports`}
      />

      <ViewSwitcher
        className="mb-4"
        value={filter}
        onValueChange={handleFilterChange}
        ariaLabel={t('transports.runSheetFilterLabel', 'Run sheet filter')}
        options={filterOptions}
      />

      <p className="mb-6 text-sm text-muted-foreground" data-testid="run-sheet-summary">
        {t('transports.runSheetSummary', {
          count: shownCount,
          defaultValue_one: '{{count}} leg',
          defaultValue_other: '{{count}} legs',
        })}
        {' · '}
        {t('transports.runSheetNeedsDriverSummary', {
          count: pickupsNeedingDriver.length,
          defaultValue_one: '{{count}} still needs a driver',
          defaultValue_other: '{{count}} still need a driver',
        })}
      </p>

      {dateGroups.length === 0 ? (
        <div className="flex min-h-[200px] items-center justify-center">
          <EmptyState
            icon={Plane}
            title={
              filter === 'needsDriver'
                ? t('transports.runSheetAllCovered', 'Every pickup has a driver')
                : t('transports.runSheetEmpty', 'Nothing on the run sheet yet')
            }
            description={
              filter === 'needsDriver'
                ? t('pickups.allCovered')
                : t(
                    'transports.runSheetEmptyDescription',
                    'Add an arrival or a departure and it takes its place on this sheet.',
                  )
            }
            action={{
              label: t('transports.title'),
              onClick: handleBack,
            }}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {dateGroups.map((group) => (
            <section key={group.dateKey} aria-labelledby={`run-sheet-${group.dateKey}`}>
              <h2
                id={`run-sheet-${group.dateKey}`}
                className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {group.displayDate}
              </h2>
              <ul className="space-y-2">
                {group.transports.map((transport) => (
                  <RunSheetRow
                    key={transport.id}
                    transport={transport}
                    person={personsMap.get(transport.personId)}
                    driver={
                      transport.driverId ? personsMap.get(transport.driverId) : undefined
                    }
                    dateLocale={dateLocale}
                    isPast={!isTransportUpcoming(transport.datetime, nowMs)}
                    isMine={isMyTransport(transport, currentPersonId)}
                    isDriving={isDrivenBy(transport, currentPersonId)}
                    onOpen={handleOpenTransport}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <div className="mt-8">
        <Button variant="outline" onClick={handleBack}>
          {t('transports.title')}
        </Button>
      </div>

      {/* Opening a line is how a driver gets filled in from here */}
      <TransportDialog
        transportId={editingTransportId}
        open={editingTransportId !== undefined}
        onOpenChange={handleDialogOpenChange}
      />
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { TransportRunSheetPage };
export default TransportRunSheetPage;
