/**
 * @fileoverview The whole guest, under the booking that was clicked.
 *
 * @module features/calendar/components/GuestOverviewSection
 */

import { type ReactElement, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type Locale, format, parseISO } from 'date-fns';
import { CalendarDays, Coins, LogIn, LogOut, MapPin } from 'lucide-react';

import { Separator } from '@/components/ui/separator';
import { ActivityCategoryIcon } from '@/components/shared/ActivityCategoryIcon';
import { TransportIcon } from '@/components/shared/TransportIcon';
import { getRoomIconComponent } from '@/components/shared/RoomIconPicker';
import { useMoneyFormat } from '@/features/money/hooks/useMoneyFormat';
import {
  formatActivityDayRange,
  formatActivityTimeRange,
} from '@/features/activities/utils/activity-utils';
import { formatTransportDatetimeParts } from '@/lib/utils/datetime-format';
import { cn } from '@/lib/utils';
import type { ISODateString, TransportId } from '@/types';

import type { GuestOverview } from '../utils/guest-overview';

// ============================================================================
// Types
// ============================================================================

export interface GuestOverviewSectionProps {
  readonly overview: GuestOverview;
  readonly dateLocale: Locale;
  /**
   * Legs the dialog already shows in full above this section.
   *
   * The stay pill's own arrivals and departures get a detailed card each —
   * mode, notes, a directions button. Repeating them here in one line would be
   * the same facts twice, so this section lists only the guest's *other*
   * travel.
   */
  readonly shownTransportIds?: readonly TransportId[];
}

// ============================================================================
// Helpers
// ============================================================================

function formatDayKey(key: ISODateString | null, dateLocale: Locale): string | null {
  if (!key) {
    return null;
  }
  const date = parseISO(key);
  return isNaN(date.getTime()) ? null : format(date, 'PPP', { locale: dateLocale });
}

// ============================================================================
// Component
// ============================================================================

/**
 * Renders one guest's stay window, rooms, travel, agenda and money standing.
 *
 * @param props - The gathered overview, the date locale, and the legs shown above
 * @returns The section, for the assignment view of the event dialog
 *
 * @example
 * ```tsx
 * <GuestOverviewSection overview={overview} dateLocale={dateLocale} />
 * ```
 */
const GuestOverviewSection = memo(function GuestOverviewSection({
  overview,
  dateLocale,
  shownTransportIds,
}: GuestOverviewSectionProps): ReactElement {
  const { t } = useTranslation();
  const formatMoney = useMoneyFormat(overview.currency);

  const checkIn = formatDayKey(overview.checkIn, dateLocale);
  const checkOut = formatDayKey(overview.checkOut, dateLocale);

  const otherTransports = useMemo(() => {
    const shown = new Set(shownTransportIds ?? []);
    return overview.transports.filter((transport) => !shown.has(transport.id));
  }, [overview.transports, shownTransportIds]);

  return (
    <div className="space-y-4" data-testid="guest-overview">
      <Separator />

      <h3 className="text-sm font-medium">
        {t('calendar.guestOverview.title', 'About {{name}}', { name: overview.person.name })}
      </h3>

      {/* Check-in and check-out: the two dates every other screen asks about. */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-2 text-sm">
          <LogIn className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">{t('calendar.guestOverview.checkIn', 'Check-in')}</span>
          <span className="font-medium">{checkIn ?? t('common.unknown')}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <LogOut className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">{t('calendar.guestOverview.checkOut', 'Check-out')}</span>
          <span className="font-medium">{checkOut ?? t('common.unknown')}</span>
        </div>
      </div>

      {/* Every room, not only the one that was clicked: a guest who moves
          between rooms mid-trip is exactly the case this answers. */}
      {overview.stays.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('calendar.guestOverview.rooms', 'Rooms')}
          </h4>
          <ul className="space-y-1">
            {overview.stays.map(({ assignment, room }) => {
              const RoomIcon = getRoomIconComponent(room?.icon);
              return (
                <li key={assignment.id} className="flex items-center gap-2 text-sm">
                  <RoomIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{room?.name ?? t('common.unknown')}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatDayKey(assignment.startDate, dateLocale)} →{' '}
                    {formatDayKey(assignment.endDate, dateLocale)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {otherTransports.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('calendar.guestOverview.otherTravel', 'Other travel')}
          </h4>
          <ul className="space-y-1">
            {otherTransports.map((transport) => {
              const { date, time } = formatTransportDatetimeParts(
                transport.datetime,
                dateLocale,
                'fullDayAndTime',
              );
              return (
                <li key={transport.id} className="flex items-center gap-2 text-sm">
                  <TransportIcon
                    mode={transport.transportMode ?? 'other'}
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span aria-hidden="true" className="shrink-0 font-semibold">
                    {transport.type === 'arrival' ? '↓' : '↑'}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {transport.location || t('common.unknown')}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {date} {time}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {overview.activities.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('calendar.guestOverview.activities', 'Activities')}
          </h4>
          <ul className="space-y-1">
            {overview.activities.map((activity) => {
              const timeRange = formatActivityTimeRange(activity, dateLocale);
              return (
                <li key={activity.id} className="flex items-center gap-2 text-sm">
                  <ActivityCategoryIcon
                    category={activity.category ?? 'other'}
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate">{activity.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatActivityDayRange(activity, dateLocale)}
                    {timeRange ? ` · ${timeRange}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Money last: it is the one line that is about the group rather than
          about the guest's day, and the one people scroll to on purpose. */}
      <div className="flex items-center gap-2 text-sm">
        <Coins className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {overview.balance === undefined ? (
          <span className="text-muted-foreground">
            {t('calendar.guestOverview.noMoney', 'Not on any money line yet')}
          </span>
        ) : overview.balance.balance < 0 ? (
          <span>
            {t('calendar.guestOverview.owes', 'Owes the group')}{' '}
            <span className="font-semibold tabular-nums">
              {formatMoney(Math.abs(overview.balance.balance))}
            </span>
          </span>
        ) : overview.balance.balance > 0 ? (
          <span>
            {t('calendar.guestOverview.isOwed', 'The group owes them')}{' '}
            <span className="font-semibold tabular-nums">
              {formatMoney(overview.balance.balance)}
            </span>
          </span>
        ) : (
          <span className={cn('text-muted-foreground')}>
            {t('calendar.guestOverview.settled', 'Square with the group')}
          </span>
        )}
      </div>

      {overview.stays.length === 0 &&
        otherTransports.length === 0 &&
        overview.activities.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
            {t('calendar.guestOverview.nothingElse', 'Nothing else booked for this guest yet')}
          </p>
        )}

      {/* A guest with a room but no address to go to is a common mid-planning
          state, and saying so beats an empty panel. */}
      {overview.transports.length === 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          {t('calendar.guestOverview.noTravel', 'No travel recorded')}
        </p>
      )}
    </div>
  );
});

export { GuestOverviewSection };
