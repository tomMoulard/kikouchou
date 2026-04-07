/**
 * @fileoverview Timeline row for a single person.
 *
 * @module features/calendar/components/CalendarTimelineRow
 */

import { type ReactElement, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { RoomAssignment } from '@/types';
import { cn } from '@/lib/utils';
import type { CalendarTransport, CalendarTimelineRowModel, TimelineItemWithLane } from '../types';
import { formatTime } from '../utils/calendar-utils';

// ============================================================================
// Constants
// ============================================================================

const DAY_WIDTH_PX = 44;
const LANE_HEIGHT_PX = 32;
const PERSON_COL_PX = 200;

// ============================================================================
// Component
// ============================================================================

interface CalendarTimelineRowProps {
  readonly model: CalendarTimelineRowModel;
  readonly dayCount: number;
  readonly onAssignmentClick: (assignment: RoomAssignment) => void;
  readonly onTransportClick?: (transport: CalendarTransport) => void;
}

const CalendarTimelineRow = memo(function CalendarTimelineRow({
  model,
  dayCount,
  onAssignmentClick,
  onTransportClick,
}: CalendarTimelineRowProps): ReactElement {
  const { t } = useTranslation();

  const rowHeight = Math.max(1, model.laneCount) * LANE_HEIGHT_PX;
  const canvasWidth = dayCount * DAY_WIDTH_PX;

  const personLabel = model.person.name || t('common.unknown');

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
        onAssignmentClick(item.assignment);
        return;
      }

      onTransportClick?.(transportToCalendarTransport(item));
    },
    [onAssignmentClick, onTransportClick, transportToCalendarTransport],
  );

  const renderedItems = useMemo(() => {
    return model.items.map((item) => {
      const laneIndex = item.laneIndex;
      const left = item.startIndex * DAY_WIDTH_PX;
      const baseWidth = (item.endIndex - item.startIndex + 1) * DAY_WIDTH_PX;
      const top = laneIndex * LANE_HEIGHT_PX + 2;

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

      const width = shouldHatchCheckoutDay ? baseWidth + DAY_WIDTH_PX : baseWidth;

      const pillWidth = Math.max(12, width - 4);
      const pillLeft = left;

      return (
        <button
          key={`${item.kind}-${item.id}-${item.startIndex}-${laneIndex}`}
          type="button"
          onClick={() => handleItemClick(item)}
          className={cn(
            'absolute flex items-center gap-2 rounded-md px-2 text-xs overflow-hidden',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'transition-opacity hover:opacity-90',
            isAssignment
              ? 'border'
              : 'text-foreground/80 hover:text-foreground',
          )}
          style={{
            left: isTransport ? left : pillLeft,
            top: isTransport ? laneIndex * LANE_HEIGHT_PX + 6 : top,
            width: isTransport ? DAY_WIDTH_PX : pillWidth,
            height: isTransport ? LANE_HEIGHT_PX - 10 : LANE_HEIGHT_PX - 6,
            backgroundColor: isAssignment ? item.color : undefined,
            color: isAssignment ? item.textColor : undefined,
          }}
          title={isTransport ? `${transportLabel} — ${item.label}` : item.label}
          aria-label={isTransport ? `${transportLabel} — ${item.label}` : item.label}
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
              <span className="truncate relative z-10">{item.label}</span>
              {shouldHatchCheckoutDay && (
                <span
                  className="absolute top-0 bottom-0 right-0 pointer-events-none"
                  style={{
                    width: DAY_WIDTH_PX,
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
  }, [dayCount, handleItemClick, model.items, model.checkoutDayIndex]);

  return (
    <div className="flex border-t border-muted">
      <div
        className={cn(
          'sticky left-0 z-10 flex items-center gap-2 bg-background',
          'border-r border-muted px-3',
        )}
        style={{ width: PERSON_COL_PX, minWidth: PERSON_COL_PX, height: rowHeight }}
      >
        <span
          className="size-2 rounded-full shrink-0"
          style={{ backgroundColor: model.person.color }}
          aria-hidden="true"
        />
        <span className="text-sm font-medium truncate" title={personLabel}>
          {personLabel}
        </span>
      </div>

      <div
        className="relative bg-background"
        style={{ width: canvasWidth, height: rowHeight }}
        aria-label={t('calendar.timeline.personRow', '{{name}} timeline', { name: personLabel })}
      >
        {/* Day grid vertical lines */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="flex h-full">
            {Array.from({ length: dayCount }).map((_, i) => (
              <div
                key={`grid-${i}`}
                className={cn('h-full border-r border-muted/50', i % 2 === 0 && 'bg-muted/10')}
                style={{ width: DAY_WIDTH_PX }}
              />
            ))}
          </div>
        </div>

        {/* Stay span (presence) shown even without room assignment */}
        {model.staySpan && (
          <div
            className="absolute rounded-md border border-dashed border-muted-foreground/40 bg-muted/20"
            style={{
              left: model.staySpan.startIndex * DAY_WIDTH_PX + 2,
              top: 2,
              width:
                (model.staySpan.endIndex - model.staySpan.startIndex + 1) * DAY_WIDTH_PX - 4,
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

