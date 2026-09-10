/**
 * @fileoverview The organiser's column: beds tonight, next arrivals, no bed yet.
 *
 * A laptop shows every trip page in its left third and nothing in the other
 * two. This panel is what goes there — the three questions the host asks all
 * day, answered beside whatever page they are on instead of behind two clicks.
 *
 * It reads the trip contexts the pages themselves read, so it adds no database
 * work, and it derives nothing itself: {@link buildTripGlance} owns the night
 * arithmetic so this file is only markup.
 *
 * Hidden below `xl` by the layout that mounts it. On a phone the same answers
 * are one tap away on the rooms and transport pages, and a fourth stacked
 * section would push the actual page below the fold.
 *
 * @module features/summary/components/TripGlancePanel
 */

import { type ReactElement, memo, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, BedDouble, TriangleAlert } from 'lucide-react';

import { getRoomIconComponent } from '@/components/shared/RoomIconPicker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { statusVariants } from '@/components/ui/status.variants';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useToday } from '@/hooks/useToday';
import { toLocalISODateString } from '@/lib/db/utils';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import { formatFullDate } from '@/lib/utils/date-format';
import { formatTransportDatetime } from '@/lib/utils/datetime-format';
import type { Trip } from '@/types';

import { buildTripGlance } from '../lib/trip-glance';

// ============================================================================
// Constants
// ============================================================================

/**
 * How many rows each section shows before it counts the rest.
 *
 * The panel is a glance, not a page: the three sections have to fit one screen
 * beside the content, and each one links to the page that lists them all.
 */
const MAX_ROOM_ROWS = 6,
  MAX_ARRIVAL_ROWS = 4,
  MAX_GUEST_ROWS = 5;

// ============================================================================
// Types
// ============================================================================

/** Props for {@link TripGlancePanel}. */
export interface TripGlancePanelProps {
  /** The selected trip. The panel is not rendered without one. */
  readonly trip: Trip;
  /** Extra classes, used by the layout for its width and sticky offset. */
  readonly className?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * A guest's colour dot, the same one the sidebar and the guest list use.
 *
 * The colour is a database value, which is the inline-style carve-out in
 * `AGENTS.md` § Styling.
 */
const GuestDot = memo(function GuestDot({
  color,
}: {
  readonly color: string | undefined;
}): ReactElement {
  return (
    <span
      className="size-2 shrink-0 rounded-full bg-muted-foreground"
      style={color ? { backgroundColor: color } : undefined}
      aria-hidden="true"
    />
  );
});

/**
 * One section of the panel: a heading that links to the page behind it.
 */
const GlanceSection = memo(function GlanceSection({
  title,
  to,
  linkLabel,
  children,
}: {
  readonly title: string;
  readonly to: string;
  readonly linkLabel: string;
  readonly children: React.ReactNode;
}): ReactElement {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Link
            to={to}
            aria-label={linkLabel}
            className={cn(
              'rounded-sm hover:text-foreground transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            {title}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 text-sm">{children}</CardContent>
    </Card>
  );
});

// ============================================================================
// Component
// ============================================================================

/**
 * The trip-page side column.
 *
 * @param props - The trip and the layout's classes
 * @returns Three cards: beds for the night, next arrivals, guests with no bed
 */
export const TripGlancePanel = memo(function TripGlancePanel({
  trip,
  className,
}: TripGlancePanelProps): ReactElement {
  const { t, i18n } = useTranslation();
  const { today } = useToday();
  const { persons, isLoading: isPersonsLoading } = usePersonContext();
  const { rooms, isLoading: isRoomsLoading } = useRoomContext();
  const { assignments, isLoading: isAssignmentsLoading } = useAssignmentContext();
  const {
    arrivals,
    departures,
    nowMs,
    isLoading: isTransportsLoading,
  } = useTransportContext();

  const locale = getDateLocale(i18n.language);
  const todayKey = useMemo(() => toLocalISODateString(today), [today]);

  const glance = useMemo(
    () =>
      buildTripGlance({
        trip,
        persons,
        rooms,
        assignments,
        arrivals,
        departures,
        todayKey,
        nowMs,
      }),
    [arrivals, assignments, departures, nowMs, persons, rooms, todayKey, trip],
  );

  const isLoading =
    isPersonsLoading || isRoomsLoading || isAssignmentsLoading || isTransportsLoading;

  const roomsPath = `/trips/${trip.id}/rooms`,
    personsPath = `/trips/${trip.id}/persons`,
    transportsPath = `/trips/${trip.id}/transports`;

  const bedsTitle =
    glance.night === 'firstNight'
      ? t('glance.beds.titleFirstNight', 'Beds on the first night')
      : t('glance.beds.titleTonight', 'Beds tonight');

  const hiddenRooms = Math.max(0, glance.rooms.length - MAX_ROOM_ROWS),
    hiddenArrivals = Math.max(0, glance.nextArrivals.length - MAX_ARRIVAL_ROWS),
    hiddenGuests = Math.max(0, glance.guestsWithoutRoom.length - MAX_GUEST_ROWS);

  return (
    <aside className={cn('space-y-4', className)} aria-label={t('glance.title', 'At a glance')}>
      {/* ---------------------------------------------------------------- */}
      {/* Beds for the night                                               */}
      {/* ---------------------------------------------------------------- */}
      <GlanceSection
        title={bedsTitle}
        to={roomsPath}
        linkLabel={t('glance.beds.openRooms', 'Open the rooms page')}
      >
        {isLoading ? (
          <p className="text-muted-foreground">{t('glance.loading', 'Loading…')}</p>
        ) : glance.night === 'over' ? (
          <p className="text-muted-foreground">
            {t('glance.beds.tripOver', 'This trip’s last night has passed')}
          </p>
        ) : glance.rooms.length === 0 ? (
          <p className="text-muted-foreground">
            {t('glance.beds.noRooms', 'No rooms yet. Add one to hand out beds.')}
          </p>
        ) : (
          <>
            <p className="text-foreground">
              {t('glance.beds.taken', {
                count: glance.bedsTaken,
                total: glance.bedsTotal,
                defaultValue_one: '{{count}} of {{total}} beds taken',
                defaultValue_other: '{{count}} of {{total}} beds taken',
              })}
            </p>
            {glance.night === 'firstNight' && glance.nightKey !== null ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatFullDate(glance.nightKey, locale)}
              </p>
            ) : null}
            <ul className="mt-2 space-y-1" aria-label={bedsTitle}>
              {glance.rooms.slice(0, MAX_ROOM_ROWS).map((room) => {
                const RoomIconComponent = getRoomIconComponent(room.icon),
                  isFull = room.occupancy >= room.capacity;
                return (
                  <li
                    key={room.roomId}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <RoomIconComponent className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate text-foreground" title={room.name}>
                      {room.name}
                    </span>
                    <span
                      className={cn(
                        'ml-auto shrink-0 tabular-nums',
                        isFull
                          ? statusVariants({ tone: 'warning', emphasis: 'text' })
                          : undefined,
                      )}
                    >
                      {t('glance.beds.roomOccupancy', {
                        occupancy: room.occupancy,
                        capacity: room.capacity,
                        defaultValue: '{{occupancy}}/{{capacity}}',
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
            {hiddenRooms > 0 ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('glance.beds.moreRooms', {
                  count: hiddenRooms,
                  defaultValue_one: '{{count}} more room',
                  defaultValue_other: '{{count}} more rooms',
                })}
              </p>
            ) : null}
          </>
        )}
      </GlanceSection>

      {/* ---------------------------------------------------------------- */}
      {/* Next arrivals                                                    */}
      {/* ---------------------------------------------------------------- */}
      <GlanceSection
        title={t('glance.arrivals.title', 'Next arrivals')}
        to={transportsPath}
        linkLabel={t('glance.arrivals.openTransports', 'Open the transport page')}
      >
        {isLoading ? (
          <p className="text-muted-foreground">{t('glance.loading', 'Loading…')}</p>
        ) : glance.nextArrivals.length === 0 ? (
          <p className="text-muted-foreground">
            {t('glance.arrivals.empty', 'No arrival left to expect')}
          </p>
        ) : (
          <>
            <ul className="space-y-2" aria-label={t('glance.arrivals.title', 'Next arrivals')}>
              {glance.nextArrivals.slice(0, MAX_ARRIVAL_ROWS).map((arrival) => (
                <li key={arrival.transportId} className="flex items-start gap-2">
                  {/* The arrow keeps arrival/departure legible without colour. */}
                  <ArrowDownToLine
                    className={cn(
                      'mt-0.5 size-3.5 shrink-0',
                      statusVariants({ tone: 'arrival', emphasis: 'text' }),
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <GuestDot color={arrival.personColor} />
                      <span className="truncate text-foreground">
                        {arrival.personName ?? t('common.unknown')}
                      </span>
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatTransportDatetime(arrival.datetime, locale, 'dayAndTime')}
                    </span>
                    {arrival.location ? (
                      <span
                        className="block truncate text-xs text-muted-foreground"
                        title={arrival.location}
                      >
                        {arrival.location}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {hiddenArrivals > 0 ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('glance.arrivals.more', {
                  count: hiddenArrivals,
                  defaultValue_one: '{{count}} more arrival',
                  defaultValue_other: '{{count}} more arrivals',
                })}
              </p>
            ) : null}
          </>
        )}
      </GlanceSection>

      {/* ---------------------------------------------------------------- */}
      {/* Guests with no bed                                               */}
      {/* ---------------------------------------------------------------- */}
      <GlanceSection
        title={t('glance.noRoom.title', 'Still without a room')}
        to={roomsPath}
        linkLabel={t('glance.noRoom.openRooms', 'Open the rooms page to assign beds')}
      >
        {isLoading ? (
          <p className="text-muted-foreground">{t('glance.loading', 'Loading…')}</p>
        ) : glance.guestsWithoutRoom.length === 0 ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <BedDouble className="size-4 shrink-0" aria-hidden="true" />
            {t('glance.noRoom.empty', 'Everyone has a bed')}
          </p>
        ) : (
          <>
            <ul
              className="space-y-1.5"
              aria-label={t('glance.noRoom.title', 'Still without a room')}
            >
              {glance.guestsWithoutRoom.slice(0, MAX_GUEST_ROWS).map((guest) => (
                <li key={guest.personId} className="flex items-center gap-2">
                  <TriangleAlert
                    className={cn(
                      'size-3.5 shrink-0',
                      statusVariants({ tone: 'warning', emphasis: 'text' }),
                    )}
                    aria-hidden="true"
                  />
                  <GuestDot color={guest.color} />
                  <Link
                    to={personsPath}
                    className={cn(
                      'min-w-0 truncate text-foreground hover:underline',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                    title={guest.name}
                  >
                    {guest.name}
                  </Link>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                    {t('glance.noRoom.nights', {
                      count: guest.nightsWithoutRoom,
                      defaultValue_one: '{{count}} night',
                      defaultValue_other: '{{count}} nights',
                    })}
                  </span>
                </li>
              ))}
            </ul>
            {hiddenGuests > 0 ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('glance.noRoom.more', {
                  count: hiddenGuests,
                  defaultValue_one: '{{count}} more guest',
                  defaultValue_other: '{{count}} more guests',
                })}
              </p>
            ) : null}
          </>
        )}
      </GlanceSection>
    </aside>
  );
});
