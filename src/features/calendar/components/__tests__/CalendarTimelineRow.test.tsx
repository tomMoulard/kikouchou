/**
 * @fileoverview Tests for CalendarTimelineRow component.
 * @module features/calendar/components/__tests__/CalendarTimelineRow.test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalendarTimelineRow } from '../CalendarTimelineRow';
import type { CalendarTimelineRowModel, TimelineItemWithLane } from '../../types';
import type { TripTimelineViewportContext } from '@/components/shared/TripTimelineFrame';
import {
  TimelineScrollContext,
  type TimelineScrollApi,
  type TimelineVisibleRange,
} from '@/components/shared/timeline-scroll-context';
import { columnsFromDays } from '@/lib/utils/timeline-scale';
import { toDayKeys } from '@/lib/utils/trip-days';
import type { HexColor, ISODateString, Person, PersonId, RoomAssignment, RoomAssignmentId, RoomId, TransportId, TripId } from '@/types';
import { enUS } from 'date-fns/locale';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      // 3-arg form: t(key, defaultValue, opts) → interpolate opts into defaultValue
      if (typeof fallbackOrOpts === 'string' && opts && typeof opts === 'object') {
        let result = fallbackOrOpts;
        for (const [k, v] of Object.entries(opts)) {
          result = result.replace(`{{${k}}}`, String(v));
        }
        return result;
      }
      if (typeof fallbackOrOpts === 'string') return fallbackOrOpts;
      return key;
    },
  }),
}));

// ============================================================================
// Helpers
// ============================================================================

function makePerson(name: string, color = '#ef4444'): Person {
  return {
    id: `p-${name}` as PersonId,
    tripId: 'trip-1' as TripId,
    name,
    color: color as HexColor,
    order: 0,
  } as Person;
}

function makeAssignment(id: string, roomId: string, personId: string): RoomAssignment {
  return {
    id: id as RoomAssignmentId,
    tripId: 'trip-1' as TripId,
    roomId: roomId as RoomId,
    personId: personId as PersonId,
    startDate: '2026-01-06' as ISODateString,
    endDate: '2026-01-09' as ISODateString,
  } as RoomAssignment;
}

const defaultTripDays = Array.from({ length: 6 }, (_, index) => {
  const date = new Date(2026, 0, 5);
  date.setDate(date.getDate() + index);
  return date;
});

const defaultColumns = columnsFromDays(defaultTripDays, toDayKeys(defaultTripDays), enUS);

const defaultViewport: TripTimelineViewportContext = {
  canvasWidth: 600,
  dayCount: 6,
  cellWidthPx: 100,
  dayWidthPx: 100,
  useFractionalColumns: false,
  labelColumnWidth: 140,
  labelsCollapsed: false,
  laneHeightPx: 32,
  todayColumnIndex: undefined,
  dayGridTemplateColumns: undefined,
  columns: defaultColumns,
};

function makeModel(overrides: Partial<CalendarTimelineRowModel> = {}): CalendarTimelineRowModel {
  const person = makePerson('Alice');
  return {
    person,
    laneCount: 1,
    items: [],
    staySpan: undefined,
    checkoutDayIndex: undefined,
    ...overrides,
  };
}

/**
 * Renders `children` under a scroll context reporting one fixed visible slice
 * of the canvas, which is what the off-screen arrows read.
 */
function withVisibleRange(range: TimelineVisibleRange, scrollTo = vi.fn()) {
  const api: TimelineScrollApi = {
    subscribeVisibleRange: (listener) => {
      listener(range);
      return () => undefined;
    },
    scrollCanvasPositionIntoView: scrollTo,
  };
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <TimelineScrollContext.Provider value={api}>{children}</TimelineScrollContext.Provider>;
  };
}

const TRANSPORT_ITEM: TimelineItemWithLane = {
  kind: 'transport',
  id: 't-width',
  startIndex: 1,
  endIndex: 1,
  transport: {
    id: 't-width' as TransportId,
    tripId: 'trip-1' as TripId,
    personId: 'p-Alice' as PersonId,
    type: 'arrival',
    datetime: '2026-01-06T14:30:00Z',
    location: 'Station',
  } as never,
  person: makePerson('Alice'),
  label: 'Station',
  laneIndex: 0,
};

// ============================================================================
// Tests
// ============================================================================

describe('CalendarTimelineRow', () => {
  // A transport pill reads `↓ 14:30`. Drawn exactly one column wide it lost the
  // clock time the moment a column was narrower than a 44px day — which is
  // every column of the hours and day scales.
  describe('transport pill width', () => {
    it('never draws a transport pill narrower than its clock time needs', () => {
      render(
        <CalendarTimelineRow
          model={makeModel({ items: [TRANSPORT_ITEM] })}
          viewport={{ ...defaultViewport, cellWidthPx: 20 }}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      const pill = screen.getAllByRole('button')[0]!;
      expect(parseFloat(pill.style.width)).toBeGreaterThanOrEqual(56);
    });

    it('centres the pill on its column and keeps it inside the canvas', () => {
      render(
        <CalendarTimelineRow
          model={makeModel({ items: [{ ...TRANSPORT_ITEM, startIndex: 5, endIndex: 5 }] })}
          viewport={{ ...defaultViewport, cellWidthPx: 20, canvasWidth: 120 }}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      const pill = screen.getAllByRole('button')[0]!;
      const left = parseFloat(pill.style.left);
      const width = parseFloat(pill.style.width);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + width).toBeLessThanOrEqual(120);
    });
  });

  // Weekends read as a darker band, so a reader finds "the Saturday" without
  // counting columns.
  describe('weekend shading', () => {
    it('marks the weekend columns behind the row', () => {
      // The axis runs Monday 5 January 2026 to Saturday the 10th, so exactly
      // one column of the six is a weekend day.
      const { container } = render(
        <CalendarTimelineRow
          model={makeModel()}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      const weekendCells = container.querySelectorAll('[data-weekend="true"]');
      expect(weekendCells).toHaveLength(1);
    });
  });

  // A guest whose whole stay is off to one side leaves an empty row, and an
  // empty row reads as "nothing booked" rather than "you scrolled past it".
  describe('off-screen pills', () => {
    const stayItem: TimelineItemWithLane = {
      kind: 'assignment',
      id: 'a-off',
      startIndex: 4,
      endIndex: 5,
      assignment: makeAssignment('a-off', 'r1', 'p-Alice'),
      person: makePerson('Alice'),
      room: undefined,
      label: 'Blue room',
      color: '#ef4444' as HexColor,
      textColor: 'white',
      laneIndex: 0,
    };

    it('points right when the only pill is further along the axis', () => {
      render(
        <CalendarTimelineRow
          model={makeModel({ items: [stayItem] })}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
        { wrapper: withVisibleRange({ start: 0, end: 200 }) },
      );

      expect(screen.getByTestId('timeline-offscreen-right').hidden).toBe(false);
      expect(screen.getByTestId('timeline-offscreen-left').hidden).toBe(true);
    });

    it('points left when the only pill is behind the visible axis', () => {
      render(
        <CalendarTimelineRow
          model={makeModel({ items: [stayItem] })}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
        { wrapper: withVisibleRange({ start: 600, end: 800 }) },
      );

      expect(screen.getByTestId('timeline-offscreen-left').hidden).toBe(false);
      expect(screen.getByTestId('timeline-offscreen-right').hidden).toBe(true);
    });

    it('shows no arrow while the pill is on screen', () => {
      render(
        <CalendarTimelineRow
          model={makeModel({ items: [stayItem] })}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
        { wrapper: withVisibleRange({ start: 0, end: 600 }) },
      );

      expect(screen.getByTestId('timeline-offscreen-left').hidden).toBe(true);
      expect(screen.getByTestId('timeline-offscreen-right').hidden).toBe(true);
    });

    it('scrolls to the hidden pill when the arrow is pressed', () => {
      const scrollTo = vi.fn();
      render(
        <CalendarTimelineRow
          model={makeModel({ items: [stayItem] })}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
        { wrapper: withVisibleRange({ start: 0, end: 200 }, scrollTo) },
      );

      fireEvent.click(screen.getByTestId('timeline-offscreen-right'));

      // The pill covers columns 4 and 5 of six 100px columns, less the 4px a
      // stay pill insets itself by, so its centre is at 498 on the canvas.
      expect(scrollTo).toHaveBeenCalledWith(498);
    });
  });
  // Folded, the column is 40px — one letter's worth of space. A colour dot plus
  // a name truncated to "M.." spent that space saying almost nothing; the
  // initial in the guest's own colour carries both identity and colour.
  describe('once the label column has folded', () => {
    const collapsed = { ...defaultViewport, labelsCollapsed: true };

    it('shows the guest initial in their own colour', () => {
      render(
        <CalendarTimelineRow
          model={makeModel()}
          viewport={collapsed}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      expect(screen.getByText('A')).toBeInTheDocument();
    });

    it('drops the colour dot, which the initial now carries', () => {
      const { container } = render(
        <CalendarTimelineRow
          model={makeModel()}
          viewport={collapsed}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      expect(container.querySelector('.rounded-full.size-2')).toBeNull();
    });

    it('keeps the full name reachable rather than only the initial', () => {
      render(
        <CalendarTimelineRow
          model={makeModel()}
          viewport={collapsed}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      // The initial is decorative; the name still has to reach a screen reader.
      expect(screen.getByTitle('Alice')).toBeInTheDocument();
    });
  });

  it('renders person name in the label column', () => {
    const model = makeModel();
    render(
      <CalendarTimelineRow
        model={model}
        viewport={defaultViewport}
        dateLocale={enUS}
        onAssignmentClick={vi.fn()}
      />,
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('renders person color dot', () => {
    const model = makeModel();
    const { container } = render(
      <CalendarTimelineRow
        model={model}
        viewport={defaultViewport}
        dateLocale={enUS}
        onAssignmentClick={vi.fn()}
      />,
    );

    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).toHaveStyle({ backgroundColor: '#ef4444' });
  });

  it('renders timeline area with correct aria-label', () => {
    const model = makeModel();
    render(
      <CalendarTimelineRow
        model={model}
        viewport={defaultViewport}
        dateLocale={enUS}
        onAssignmentClick={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Alice timeline')).toBeInTheDocument();
  });

  it('renders assignment item as a clickable button', () => {
    const assignment = makeAssignment('a1', 'r1', 'p-Alice');
    const item: TimelineItemWithLane = {
      kind: 'assignment',
      id: 'a1',
      startIndex: 1,
      endIndex: 3,
      assignment,
      person: undefined,
      room: undefined,
      label: 'Room 1',
      color: '#ef4444' as HexColor,
      textColor: 'white',
      laneIndex: 0,
      timelineTransports: [],
    };

    const model = makeModel({ items: [item] });
    const onClick = vi.fn();

    render(
      <CalendarTimelineRow
        model={model}
        viewport={defaultViewport}
        dateLocale={enUS}
        onAssignmentClick={onClick}
      />,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(buttons[0]!);
    expect(onClick).toHaveBeenCalledWith(assignment, undefined);
  });

  it('renders transport item and handles click', () => {
    const transport = {
      id: 't1' as TransportId,
      tripId: 'trip-1' as TripId,
      personId: 'p-Alice' as PersonId,
      type: 'arrival' as const,
      datetime: '2026-01-06T14:00:00Z',
      location: 'Station',
      mode: 'train' as const,
      transportNumber: '',
      needsPickup: false,
    };
    const person = makePerson('Alice');

    const item: TimelineItemWithLane = {
      kind: 'transport',
      id: 't1',
      startIndex: 1,
      endIndex: 1,
      transport,
      person,
      label: 'Station',
      laneIndex: 0,
    };

    const model = makeModel({ items: [item] });
    const onTransportClick = vi.fn();

    render(
      <CalendarTimelineRow
        model={model}
        viewport={defaultViewport}
        dateLocale={enUS}
        onAssignmentClick={vi.fn()}
        onTransportClick={onTransportClick}
      />,
    );

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]!);
    expect(onTransportClick).toHaveBeenCalled();
  });

  it('renders stay span background when staySpan is provided', () => {
    const model = makeModel({
      staySpan: { startIndex: 0, endIndex: 3 },
    });

    const { container } = render(
      <CalendarTimelineRow
        model={model}
        viewport={defaultViewport}
        dateLocale={enUS}
        onAssignmentClick={vi.fn()}
      />,
    );

    // Should have a dashed border div for the stay span
    const staySpanEl = container.querySelector('[aria-hidden="true"].border-dashed');
    expect(staySpanEl).toBeInTheDocument();
  });

  it('renders grid background cells for each day', () => {
    const model = makeModel();

    const { container } = render(
      <CalendarTimelineRow
        model={model}
        viewport={{ ...defaultViewport, dayCount: 3, columns: defaultColumns.slice(0, 3) }}
        dateLocale={enUS}
        onAssignmentClick={vi.fn()}
      />,
    );

    // Grid should have cells matching dayCount
    const gridCells = container.querySelectorAll('.border-r.border-muted\\/50');
    expect(gridCells.length).toBeGreaterThanOrEqual(3);
  });

  it('uses "Unknown" label for person without name', () => {
    const person = makePerson('');
    person.name = '';
    const model = makeModel({ person });

    render(
      <CalendarTimelineRow
        model={model}
        viewport={defaultViewport}
        dateLocale={enUS}
        onAssignmentClick={vi.fn()}
      />,
    );

    expect(screen.getByText('common.unknown')).toBeInTheDocument();
  });
});
