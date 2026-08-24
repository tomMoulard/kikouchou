/**
 * @fileoverview Timeline row for a single person.
 *
 * @module features/calendar/components/CalendarTimelineRow
 */

import { type ReactElement, memo, useCallback, useMemo } from 'react';
import { addDays, format, type Locale } from 'date-fns';
import { useTranslation } from 'react-i18next';

import type { TripTimelineViewportContext } from '@/components/shared/TripTimelineFrame';
import { getPersonHeadcount } from '@/types';
import type { HexColor, RoomAssignment, Transport } from '@/types';
import { cn } from '@/lib/utils';
import type { CalendarTransport, CalendarTimelineRowModel, TimelineItemWithLane } from '../types';
import { formatTime, getContrastTextColor } from '../utils/calendar-utils';

// ============================================================================
// Component
// ============================================================================

interface CalendarTimelineRowProps {
  readonly model: CalendarTimelineRowModel;
  readonly viewport: TripTimelineViewportContext;
  readonly tripDays: readonly Date[];
  readonly dateLocale: Locale;
  readonly onAssignmentClick: (assignment: RoomAssignment, relatedTransports?: readonly Transport[]) => void;
  readonly onTransportClick?: (transport: CalendarTransport) => void;
}

const CalendarTimelineRow = memo(function CalendarTimelineRow({
  model,
  viewport,
  tripDays,
  dateLocale,
  onAssignmentClick,
  onTransportClick,
}: CalendarTimelineRowProps): ReactElement {
  const { t } = useTranslation();

  const rowHeight = Math.max(1, model.laneCount) * viewport.laneHeightPx;
  const { canvasWidth, dayCount, cellWidthPx, dayGridTemplateColumns, todayColumnIndex } = viewport;

  const personLabel = model.person.name || t('common.unknown');
  // A guest entry can stand for several people (e.g. a couple under one name).
  const personHeadcount = getPersonHeadcount(model.person);

  const transportToCalendarTransport = useCallback(
    (item: Extract<TimelineItemWithLane, { kind: 'transport' }>): CalendarTransport => ({
      transport: item.transport,
      person: item.person,
      personName: item.person?.name ?? t('common.unknown'),
      color: item.person?.color ?? ('#6b7280' as import('@/types').HexColor),
    }),
    [t],
  );

  const handleItemClick = useCallback(
    (item: TimelineItemWithLane) => {
      if (item.kind === 'assignment') {
        const related = item.timelineTransports?.map((m) => m.transport);
        onAssignmentClick(item.assignment, related?.length ? related : undefined);
        return;
      }

      onTransportClick?.(transportToCalendarTransport(item));
    },
    [onAssignmentClick, onTransportClick, transportToCalendarTransport],
  );

  const formatVisibleAssignmentRange = useCallback(
    (startIndex: number, endIndex: number): string => {
      const startDate = tripDays[startIndex];
      const endDate = tripDays[endIndex];
      if (!startDate || !endDate) {
        return '';
      }
      return `${format(startDate, 'd MMM', { locale: dateLocale })} – ${format(addDays(endDate, 1), 'd MMM', { locale: dateLocale })}`;
    },
    [dateLocale, tripDays],
  );

  const renderedItems = useMemo(() => {
    const cellW = cellWidthPx;
    const laneH = viewport.laneHeightPx;

    return model.items.map((item) => {
      const laneIndex = item.laneIndex;
      const left = item.startIndex * cellW;
      const baseWidth = (item.endIndex - item.startIndex + 1) * cellW;
      const bandTop = laneIndex * laneH + 2;

      const isAssignment = item.kind === 'assignment';
      const isTransport = item.kind === 'transport';

      const transportTime = isTransport ? formatTime(item.transport.datetime) : '';
      const transportLabel = transportTime;

      const shouldHatchCheckoutDay =
        isAssignment &&
        model.checkoutDayIndex !== undefined &&
        model.checkoutDayIndex === item.endIndex + 1 &&
        model.checkoutDayIndex >= 0 &&
        model.checkoutDayIndex < dayCount;

      const pillLeft = left;
      const rawBarWidth = shouldHatchCheckoutDay ? baseWidth + cellW : baseWidth;
      const maxBarWidth = Math.max(0, canvasWidth - pillLeft);
      const width = Math.min(rawBarWidth, maxBarWidth);

      const pillWidth = Math.max(12, width - 4);

      const assignmentRange =
        isAssignment && item.kind === 'assignment'
          ? formatVisibleAssignmentRange(item.startIndex, item.endIndex)
          : '';
      let assignmentTitle =
        isAssignment && item.kind === 'assignment' && assignmentRange
          ? t('calendar.timeline.assignmentBarTitle', '{{room}} — {{range}}', {
              room: item.label,
              range: assignmentRange,
            })
          : isAssignment
            ? item.label
            : '';
      let assignmentAria =
        isAssignment && item.kind === 'assignment' && assignmentRange
          ? t('calendar.timeline.assignmentBarAria', '{{room}}. Stay {{range}}.', {
              room: item.label,
              range: assignmentRange,
            })
          : isAssignment
            ? item.label
            : '';

      const markers =
        isAssignment && item.kind === 'assignment' ? item.timelineTransports : undefined;
      const arrivals =
        markers
          ?.filter((m) => m.transport.type === 'arrival')
          .sort((a, b) => a.transport.datetime.localeCompare(b.transport.datetime)) ?? [];
      const departures =
        markers
          ?.filter((m) => m.transport.type === 'departure')
          .sort((a, b) => a.transport.datetime.localeCompare(b.transport.datetime)) ?? [];

      if (markers?.length && isAssignment) {
        const legSummaries = markers
          .map((m) => {
            const arrow = m.transport.type === 'arrival' ? '↓' : '↑';
            return `${arrow} ${formatTime(m.transport.datetime)} — ${m.transport.location}`;
          })
          .join('; ');
        assignmentTitle = assignmentTitle ? `${assignmentTitle}. ${legSummaries}` : legSummaries;
        assignmentAria = assignmentAria ? `${assignmentAria} ${legSummaries}` : legSummaries;
      }

      const orphanBg =
        isTransport && item.kind === 'transport'
          ? ((item.person?.color ?? '#6b7280') as HexColor)
          : undefined;
      const orphanTextColor = orphanBg ? getContrastTextColor(orphanBg) : undefined;

      return (
        <button
          key={`${item.kind}-${item.id}-${item.startIndex}-${laneIndex}`}
          type="button"
          onClick={() => handleItemClick(item)}
          className={cn(
            'absolute z-[1] flex items-center gap-2 rounded-md px-2 text-xs overflow-hidden',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'transition-opacity hover:opacity-90',
            isAssignment && 'justify-start gap-1.5',
            isAssignment && 'border',
            isTransport && 'justify-center border',
          )}
          style={{
            left: isTransport ? left : pillLeft,
            top: bandTop,
            width: isTransport ? cellW : pillWidth,
            height: laneH - 6,
            backgroundColor: isAssignment ? item.color : orphanBg,
            color: isAssignment ? item.textColor : orphanTextColor,
          }}
          title={isTransport ? `${transportLabel} — ${item.label}` : assignmentTitle}
          aria-label={isTransport ? `${transportLabel} — ${item.label}` : assignmentAria}
        >
          {isTransport ? (
            <span className="flex items-center justify-center gap-1 w-full">
              <span className="text-[11px] font-semibold leading-none" aria-hidden="true">
                {item.transport.type === 'arrival' ? '↓' : '↑'}
              </span>
              <span className="text-[11px] font-medium tabular-nums leading-none">{transportLabel}</span>
            </span>
          ) : (
            <>
              <span className="relative z-[1] flex min-w-0 flex-1 items-center gap-1">
                {arrivals.length > 0 ? (
                  <span className="flex shrink-0 flex-col justify-center gap-0.5">
                    {arrivals.map((m) => (
                      <span
                        key={m.transport.id}
                        className="flex items-center gap-0.5 text-[10px] font-semibold tabular-nums leading-none opacity-95"
                        title={m.transport.location}
                      >
                        <span aria-hidden="true">↓</span>
                        <span>{formatTime(m.transport.datetime)}</span>
                      </span>
                    ))}
                  </span>
                ) : null}
                <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                  <span
                    className={cn(
                      'flex h-[18px] max-w-[2.75rem] shrink-0 items-center justify-center rounded-full px-1',
                      'text-[9px] font-semibold leading-none tabular-nums',
                      item.textColor === 'white'
                        ? 'bg-white/25 text-white shadow-sm shadow-black/15'
                        : 'bg-black/12 text-black/80',
                    )}
                    aria-hidden="true"
                    title={item.label}
                  >
                    <span className="block max-w-full truncate">{item.label}</span>
                  </span>
                  {assignmentRange ? (
                    <span className="min-w-0 flex-1 truncate text-left text-[11px] font-medium leading-tight opacity-90">
                      {assignmentRange}
                    </span>
                  ) : null}
                </span>
                {departures.length > 0 ? (
                  <span className="flex shrink-0 flex-col items-end justify-center gap-0.5">
                    {departures.map((m) => (
                      <span
                        key={m.transport.id}
                        className="flex items-center gap-0.5 text-[10px] font-semibold tabular-nums leading-none opacity-95"
                        title={m.transport.location}
                      >
                        <span aria-hidden="true">↑</span>
                        <span>{formatTime(m.transport.datetime)}</span>
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
              {shouldHatchCheckoutDay && (
                <span
                  className="absolute top-0 bottom-0 right-0 z-0 pointer-events-none"
                  style={{
                    width: cellW,
                    backgroundImage:
                      item.textColor === 'white'
                        ? 'repeating-linear-gradient(135deg, rgba(255,255,255,0.22) 0 6px, rgba(255,255,255,0) 6px 12px)'
                        : 'repeating-linear-gradient(135deg, rgba(0,0,0,0.12) 0 6px, rgba(0,0,0,0) 6px 12px)',
                  }}
                  aria-hidden="true"
                />
              )}
            </>
          )}
        </button>
      );
    });
  }, [
    canvasWidth,
    cellWidthPx,
    dateLocale,
    dayCount,
    formatVisibleAssignmentRange,
    handleItemClick,
    model.items,
    model.checkoutDayIndex,
    t,
    viewport.laneHeightPx,
  ]);

  return (
    <div className="flex border-t border-muted">
      <div
        className={cn(
          'sticky left-0 z-10 flex items-center gap-2 bg-background',
          'border-r border-muted px-3',
        )}
        style={{ width: viewport.labelColumnWidth, minWidth: viewport.labelColumnWidth, height: rowHeight }}
      >
        <span
          className="size-2 rounded-full shrink-0"
          style={{ backgroundColor: model.person.color }}
          aria-hidden="true"
        />
        <span className="text-sm font-medium truncate" title={personLabel}>
          {personLabel}
        </span>
        {personHeadcount > 1 && (
          <span
            className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground tabular-nums"
            title={t('calendar.timeline.guestHeadcount', 'Counts as {{count}} people', {
              count: personHeadcount,
            })}
          >
            ×{personHeadcount}
          </span>
        )}
      </div>

      <div
        className="relative min-w-0 overflow-hidden bg-background"
        style={{ width: canvasWidth, height: rowHeight }}
        aria-label={t('calendar.timeline.personRow', '{{name}} timeline', { name: personLabel })}
      >
        <div className="pointer-events-none absolute inset-0 z-0">
          <div
            className="grid h-full min-w-0 w-full"
            style={
              dayGridTemplateColumns !== undefined
                ? { gridTemplateColumns: dayGridTemplateColumns }
                : undefined
            }
          >
            {Array.from({ length: dayCount }).map((_, i) => (
              <div
                key={`grid-bg-${i}`}
                className={cn(
                  'min-w-0 h-full border-r border-muted/50',
                  todayColumnIndex === i ? 'bg-primary/12' : i % 2 === 0 && 'bg-muted/10',
                )}
              />
            ))}
          </div>
        </div>

        {model.staySpan && (
          <div
            className="absolute z-[1] rounded-md border border-dashed border-muted-foreground/40 bg-muted/20"
            style={{
              left: model.staySpan.startIndex * cellWidthPx + 2,
              top: 2,
              width: (model.staySpan.endIndex - model.staySpan.startIndex + 1) * cellWidthPx - 4,
              height: rowHeight - 4,
            }}
            aria-hidden="true"
          />
        )}

        {renderedItems}
      </div>
    </div>
  );
});

export { CalendarTimelineRow };
