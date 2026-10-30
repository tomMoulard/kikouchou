/**
 * @fileoverview Tests for CalendarTimelineRow component.
 * @module features/calendar/components/__tests__/CalendarTimelineRow.test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalendarTimelineRow } from '../CalendarTimelineRow';
import type {
  CalendarTimelineRowModel,
  CalendarTransport,
  TimelineItemWithLane,
} from '../../types';
import type { TripTimelineViewportContext } from '@/components/shared/TripTimelineFrame';
import type { ResolvedRide } from '@/features/transports/utils/ride-model';
import {
  TimelineScrollContext,
  type TimelineScrollApi,
  type TimelineVisibleRange,
} from '@/components/shared/timeline-scroll-context';
import { columnsFromDays } from '@/lib/utils/timeline-scale';
import { toDayKeys } from '@/lib/utils/trip-days';
import type { HexColor, ISODateString, Person, PersonId, RoomAssignment, RoomAssignmentId, RoomId, Transport, TransportId, TripId } from '@/types';
import { enUS, fr } from 'date-fns/locale';

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


/**
 * The errors an event handler threw while `act` ran.
 *
 * jsdom catches an exception thrown by a listener and reports it on `window`
 * rather than rethrowing it from `dispatchEvent`, so `expect(...).not.toThrow()`
 * would pass whatever the handler did.
 */
function errorsDuring(act: () => void): unknown[] {
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent): void => {
    errors.push(event.error);
    event.preventDefault();
  };
  window.addEventListener('error', onError);
  try {
    act();
  } finally {
    window.removeEventListener('error', onError);
  }
  return errors;
}

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

  it('opens the guest editor when the name in the label column is clicked', () => {
    const model = makeModel();
    const onPersonClick = vi.fn();
    render(
      <CalendarTimelineRow
        model={model}
        viewport={defaultViewport}
        dateLocale={enUS}
        onAssignmentClick={vi.fn()}
        onPersonClick={onPersonClick}
      />,
    );

    fireEvent.click(screen.getByTestId(`calendar-timeline-edit-person-${model.person.id}`));
    expect(onPersonClick).toHaveBeenCalledWith(model.person);
    expect(screen.getByTitle('Alice · common.clickToEdit')).toBeInTheDocument();
  });

  // Without the callback (a viewer) the name is plain text, and the tooltip
  // must not promise an editor.
  it('leaves the name plain text without onPersonClick', () => {
    const model = makeModel();
    render(
      <CalendarTimelineRow
        model={model}
        viewport={defaultViewport}
        dateLocale={enUS}
        onAssignmentClick={vi.fn()}
      />,
    );

    expect(
      screen.queryByTestId(`calendar-timeline-edit-person-${model.person.id}`),
    ).not.toBeInTheDocument();
    expect(screen.queryByTitle(/common\.clickToEdit/)).not.toBeInTheDocument();
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

  // ==========================================================================
  // Geometry and text of the pills
  // ==========================================================================

  describe('a stay pill', () => {
    function stayItem(overrides: Partial<TimelineItemWithLane> = {}): TimelineItemWithLane {
      return {
        kind: 'assignment',
        id: 'a-geo',
        startIndex: 1,
        endIndex: 2,
        assignment: makeAssignment('a-geo', 'r1', 'p-Alice'),
        person: makePerson('Alice'),
        room: undefined,
        label: 'Blue room',
        color: '#1d4ed8' as HexColor,
        textColor: 'white',
        laneIndex: 1,
        ...overrides,
      } as TimelineItemWithLane;
    }

    function leg(id: string, type: 'arrival' | 'departure', datetime: string, location: string) {
      return {
        id: id as TransportId,
        tripId: 'trip-1' as TripId,
        personId: 'p-Alice' as PersonId,
        type,
        // Offset-less, so the clock the pill prints is the same on every runner.
        datetime,
        location,
        needsPickup: false,
      };
    }

    function renderStay(
      item: TimelineItemWithLane,
      options: {
        readonly model?: Partial<CalendarTimelineRowModel>;
        readonly viewport?: Partial<TripTimelineViewportContext>;
        readonly onAssignmentClick?: (
          assignment: RoomAssignment,
          relatedTransports?: readonly Transport[],
        ) => void;
        readonly rideForTransport?: (id: TransportId) => ResolvedRide | undefined;
      } = {},
    ) {
      return render(
        <CalendarTimelineRow
          model={makeModel({ items: [item], laneCount: 2, ...options.model })}
          viewport={{ ...defaultViewport, ...options.viewport }}
          dateLocale={enUS}
          onAssignmentClick={options.onAssignmentClick ?? vi.fn()}
          rideForTransport={options.rideForTransport}
        />,
      );
    }

    it('spans its columns in its lane, inset by two pixels each side', () => {
      renderStay(stayItem());

      const pill = screen.getByRole('button');
      expect(pill).toHaveStyle({
        left: '100px',
        top: '34px',
        width: '196px',
        height: '26px',
        backgroundColor: '#1d4ed8',
        color: 'rgb(255, 255, 255)',
      });
      expect(pill).toHaveClass('justify-start', 'px-2', 'border');
      expect(pill).not.toHaveClass('justify-center');
    });

    it('names the room and the days it covers, check-out day included', () => {
      renderStay(stayItem());

      const pill = screen.getByRole('button');
      expect(pill.getAttribute('title')).toMatch(/^Blue room, 6 Jan \S 8 Jan$/u);
      expect(pill).toHaveAccessibleName(/^Blue room\. Stay 6 Jan \S 8 Jan\.$/u);
      expect(pill).toHaveTextContent(/6 Jan \S 8 Jan/u);
    });

    it('falls back to the room name alone off the end of the axis', () => {
      renderStay(stayItem({ startIndex: 4, endIndex: 7 }));

      const pill = screen.getByRole('button');
      expect(pill).toHaveAttribute('title', 'Blue room');
      expect(pill).toHaveAccessibleName('Blue room');
      expect(pill.querySelector('.leading-tight')).toBeNull();
    });

    it('puts a light chip on a dark pill and a dark chip on a light one', () => {
      /* eslint-disable kikouchou/no-raw-palette-class -- The chip sits on the guest's own colour, so the component picks white or black at runtime; these are the classes it is asserted to pick. */
      const { unmount } = renderStay(stayItem());
      expect(screen.getByTitle('Blue room')).toHaveClass('bg-white/25', 'text-white');
      unmount();

      renderStay(stayItem({ textColor: 'black', color: '#fde047' as HexColor }));
      expect(screen.getByTitle('Blue room')).toHaveClass('bg-black/12', 'text-black/80');
      /* eslint-enable kikouchou/no-raw-palette-class */
    });

    it('hatches the check-out day and widens the pill over it', () => {
      const { container } = renderStay(stayItem(), { model: { checkoutDayIndex: 3 } });

      expect(screen.getByRole('button')).toHaveStyle({ width: '296px' });
      const hatch = container.querySelector('.pointer-events-none.right-0') as HTMLElement;
      expect(hatch).toHaveStyle({ width: '100px' });
      expect(hatch.style.backgroundImage).toContain('rgba(255, 255, 255, 0.22)');
    });

    it('hatches in dark stripes on a light pill', () => {
      const { container } = renderStay(stayItem({ textColor: 'black' }), {
        model: { checkoutDayIndex: 3 },
      });

      const hatch = container.querySelector('.pointer-events-none.right-0') as HTMLElement;
      expect(hatch.style.backgroundImage).toContain('rgba(0, 0, 0, 0.12)');
    });

    it.each([
      ['a day later than the check-out', 4, 6],
      ['past the end of the axis', 3, 3],
    ])('does not hatch a check-out %s', (_, checkoutDayIndex, dayCount) => {
      const { container } = renderStay(stayItem(), {
        model: { checkoutDayIndex },
        viewport: { dayCount },
      });

      expect(screen.getByRole('button')).toHaveStyle({ width: '196px' });
      expect(container.querySelector('.pointer-events-none.right-0')).toBeNull();
    });

    it('hatches the first column for a stay whose last night is just before the axis', () => {
      const { container } = renderStay(stayItem({ startIndex: -2, endIndex: -1 }), {
        model: { checkoutDayIndex: 0 },
      });

      expect(container.querySelector('.pointer-events-none.right-0')).not.toBeNull();
    });

    it('hatches nothing for a check-out that is itself before the axis', () => {
      const { container } = renderStay(stayItem({ startIndex: -4, endIndex: -3 }), {
        model: { checkoutDayIndex: -2 },
      });

      expect(container.querySelector('.pointer-events-none.right-0')).toBeNull();
    });

    it('never runs past the end of the canvas', () => {
      renderStay(stayItem({ startIndex: 5, endIndex: 5 }), {
        model: { checkoutDayIndex: 6 },
        viewport: { dayCount: 7 },
      });

      expect(screen.getByRole('button')).toHaveStyle({ width: '96px' });
    });

    it('stays at least twelve pixels wide on a narrow column', () => {
      renderStay(stayItem({ startIndex: 0, endIndex: 0 }), { viewport: { cellWidthPx: 10 } });

      expect(screen.getByRole('button')).toHaveStyle({ width: '12px' });
    });

    it('marks the arrivals and departures it carries earliest first, whatever order they come in', () => {
      const late = leg('in-late', 'arrival', '2026-01-06T18:00:00', 'Late train');
      const early = leg('in-early', 'arrival', '2026-01-06T09:00:00', 'Early train');
      const out = leg('out', 'departure', '2026-01-08T07:30:00', 'Airport');
      const onClick = vi.fn();

      renderStay(
        stayItem({
          timelineTransports: [
            { transport: late, dayIndex: 1 },
            { transport: early, dayIndex: 1 },
            { transport: out, dayIndex: 2 },
          ],
        } as Partial<TimelineItemWithLane>),
        { onAssignmentClick: onClick },
      );

      const pill = screen.getByRole('button');
      const markers = Array.from(pill.querySelectorAll('[title]'))
        .map((element) => element.getAttribute('title'))
        .filter((title) => title !== 'Blue room');
      expect(markers).toEqual(['Early train', 'Late train', 'Airport']);
      expect(pill).toHaveTextContent(/↓09:00↓18:00.*↑07:30/u);

      fireEvent.click(pill);
      expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'a-geo' }), [
        late,
        early,
        out,
      ]);
    });

    it('names its legs after the stay, in the time order the model hands them', () => {
      const early = leg('in-early', 'arrival', '2026-01-06T09:00:00', 'Early train');
      const late = leg('in-late', 'arrival', '2026-01-06T18:00:00', 'Late train');
      const out = leg('out', 'departure', '2026-01-08T07:30:00', 'Airport');

      renderStay(
        stayItem({
          timelineTransports: [
            { transport: early, dayIndex: 1 },
            { transport: late, dayIndex: 1 },
            { transport: out, dayIndex: 2 },
          ],
        } as Partial<TimelineItemWithLane>),
      );

      const pill = screen.getByRole('button');
      expect(pill.getAttribute('title')).toMatch(
        /^Blue room, 6 Jan \S 8 Jan\. ↓ 09:00 · Early train; ↓ 18:00 · Late train; ↑ 07:30 · Airport$/u,
      );
      expect(pill).toHaveAccessibleName(
        /^Blue room\. Stay 6 Jan \S 8 Jan\. ↓ 09:00 · Early train; ↓ 18:00 · Late train; ↑ 07:30 · Airport$/u,
      );
    });

    it('names only the legs when there is no range to name', () => {
      const out = leg('out', 'departure', '2026-01-08T07:30:00', 'Airport');
      renderStay(
        stayItem({
          startIndex: 4,
          endIndex: 7,
          timelineTransports: [{ transport: out, dayIndex: 5 }],
        } as Partial<TimelineItemWithLane>),
      );

      const pill = screen.getByRole('button');
      expect(pill).toHaveAttribute('title', 'Blue room. ↑ 07:30 · Airport');
      expect(pill).toHaveAccessibleName('Blue room ↑ 07:30 · Airport');
    });

    it('says which legs travel in a shared car, and who drives', () => {
      const shared = leg('in', 'arrival', '2026-01-06T09:00:00', 'Station');
      const ride = { isLegacy: false, driver: makePerson('Bruno') } as unknown as ResolvedRide;
      renderStay(
        stayItem({
          timelineTransports: [{ transport: shared, dayIndex: 1 }],
        } as Partial<TimelineItemWithLane>),
        { rideForTransport: () => ride },
      );

      expect(
        screen.getByTitle('Station · Part of a shared ride, Bruno driving'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button').getAttribute('title')).toContain(
        '↓ 09:00 · Station · Part of a shared ride, Bruno driving',
      );
    });
  });

  describe('a transport pill', () => {
    function transportItem(overrides: Partial<TimelineItemWithLane> = {}): TimelineItemWithLane {
      return {
        ...TRANSPORT_ITEM,
        transport: {
          ...(TRANSPORT_ITEM as Extract<TimelineItemWithLane, { kind: 'transport' }>).transport,
          datetime: '2026-01-06T14:30:00',
        },
        ...overrides,
      } as TimelineItemWithLane;
    }

    function renderLeg(
      item: TimelineItemWithLane,
      viewport: Partial<TripTimelineViewportContext> = {},
      extra: {
        readonly rideForTransport?: (id: TransportId) => ResolvedRide | undefined;
        readonly onTransportClick?: (transport: CalendarTransport) => void;
      } = {},
    ) {
      return render(
        <CalendarTimelineRow
          model={makeModel({ items: [item] })}
          viewport={{ ...defaultViewport, ...viewport }}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
          {...extra}
        />,
      );
    }

    it('fills a wide column and sits in its lane', () => {
      renderLeg(transportItem());

      const pill = screen.getByRole('button');
      expect(pill).toHaveStyle({ left: '100px', width: '100px', top: '2px', height: '26px' });
      expect(pill).toHaveClass('justify-center', 'border', 'px-1');
      expect(pill).not.toHaveClass('justify-start');
    });

    it('centres a fixed-width pill on a narrow column', () => {
      renderLeg(transportItem({ startIndex: 2, endIndex: 2 }), { cellWidthPx: 20 });

      expect(screen.getByRole('button')).toHaveStyle({ left: '22px', width: '56px' });
    });

    it('holds the pill at the left edge of the canvas', () => {
      renderLeg(transportItem({ startIndex: 0, endIndex: 0 }), { cellWidthPx: 20 });

      expect(screen.getByRole('button')).toHaveStyle({ left: '0px' });
    });

    it('holds the pill at the right edge of the canvas', () => {
      renderLeg(transportItem({ startIndex: 5, endIndex: 5 }), {
        cellWidthPx: 20,
        canvasWidth: 120,
      });

      expect(screen.getByRole('button')).toHaveStyle({ left: '64px', width: '56px' });
    });

    it('reads its arrow and time, in the guest colour', () => {
      renderLeg(transportItem());

      const pill = screen.getByRole('button');
      expect(pill).toHaveTextContent('↓14:30');
      expect(pill).toHaveAttribute('title', '14:30 · Station');
      expect(pill).toHaveAccessibleName('14:30 · Station');
      expect(pill).toHaveStyle({ backgroundColor: '#ef4444' });
      expect(screen.queryByTestId('ride-glyph')).not.toBeInTheDocument();
    });

    it('points up for a departure and greys a leg with no guest', () => {
      renderLeg(
        transportItem({
          person: undefined,
          transport: {
            ...TRANSPORT_ITEM.transport,
            type: 'departure',
            datetime: '2026-01-06T14:30:00',
          },
        } as Partial<TimelineItemWithLane>),
      );

      const pill = screen.getByRole('button');
      expect(pill).toHaveTextContent('↑14:30');
      expect(pill).toHaveStyle({ backgroundColor: '#6b7280', color: 'rgb(255, 255, 255)' });
    });

    it('widens for the car glyph and names the driver', () => {
      const ride = { isLegacy: false, driver: makePerson('Bruno') } as unknown as ResolvedRide;
      renderLeg(
        transportItem({ startIndex: 2, endIndex: 2 }),
        { cellWidthPx: 20 },
        { rideForTransport: () => ride },
      );

      const pill = screen.getByRole('button');
      expect(pill).toHaveStyle({ width: '72px', left: '14px' });
      expect(screen.getByTestId('ride-glyph')).toBeInTheDocument();
      expect(pill).toHaveAttribute(
        'title',
        '14:30 · Station · Part of a shared ride, Bruno driving',
      );
      expect(pill).toHaveAccessibleName('14:30 · Station · Part of a shared ride, Bruno driving');
    });

    it('says "shared ride" without a name while nobody drives', () => {
      const ride = { isLegacy: false } as unknown as ResolvedRide;
      renderLeg(transportItem(), {}, { rideForTransport: () => ride });

      expect(screen.getByRole('button')).toHaveAttribute(
        'title',
        '14:30 · Station · Part of a shared ride',
      );
    });

    it('says nothing about a legacy driver-only leg', () => {
      const ride = { isLegacy: true, driver: makePerson('Bruno') } as unknown as ResolvedRide;
      renderLeg(transportItem(), {}, { rideForTransport: () => ride });

      expect(screen.getByRole('button')).toHaveAttribute('title', '14:30 · Station');
      expect(screen.queryByTestId('ride-glyph')).not.toBeInTheDocument();
    });

    it('opens the leg with its guest, colour and car', () => {
      const ride = { isLegacy: false } as unknown as ResolvedRide;
      const onTransportClick = vi.fn();
      const item = transportItem() as Extract<TimelineItemWithLane, { kind: 'transport' }>;
      renderLeg(item, {}, { rideForTransport: () => ride, onTransportClick });

      fireEvent.click(screen.getByRole('button'));

      expect(onTransportClick).toHaveBeenCalledWith({
        transport: item.transport,
        person: item.person,
        personName: 'Alice',
        color: '#ef4444',
        ride,
      });
    });

    it('opens a leg with no guest as an unknown one, in grey', () => {
      const onTransportClick = vi.fn();
      renderLeg(
        transportItem({ person: undefined } as Partial<TimelineItemWithLane>),
        {},
        { onTransportClick },
      );

      fireEvent.click(screen.getByRole('button'));

      expect(onTransportClick).toHaveBeenCalledWith(
        expect.objectContaining({ personName: 'common.unknown', color: '#6b7280' }),
      );
    });
  });

  describe('the row around the pills', () => {
    it('is as tall as its lanes, and one lane tall when empty', () => {
      const { container, rerender } = render(
        <CalendarTimelineRow
          model={makeModel({ laneCount: 3 })}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      expect(screen.getByRole('group')).toHaveStyle({ width: '600px', height: '96px' });
      expect(container.querySelector('.sticky')).toHaveStyle({ height: '96px' });
      expect(container.querySelector('.sticky')).toHaveClass('px-3');

      rerender(
        <CalendarTimelineRow
          model={makeModel({ laneCount: 0 })}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );
      expect(screen.getByRole('group')).toHaveStyle({ height: '32px' });
    });

    it('centres the folded label', () => {
      const { container } = render(
        <CalendarTimelineRow
          model={makeModel()}
          viewport={{ ...defaultViewport, labelsCollapsed: true }}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      expect(container.querySelector('.sticky')).toHaveClass('justify-center', 'px-1');
      expect(screen.getByText('A')).toHaveStyle({ color: '#ef4444' });
    });

    it('says how many people a guest entry counts for', () => {
      render(
        <CalendarTimelineRow
          model={makeModel({ person: { ...makePerson('Alice'), headcount: 2 } })}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      expect(screen.getByTitle('Counts as 2 people')).toHaveTextContent('×2');
    });

    it('drops the count for one person, and once the label has folded', () => {
      const { rerender } = render(
        <CalendarTimelineRow
          model={makeModel()}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );
      expect(screen.queryByText(/×/)).not.toBeInTheDocument();

      rerender(
        <CalendarTimelineRow
          model={makeModel({ person: { ...makePerson('Alice'), headcount: 2 } })}
          viewport={{ ...defaultViewport, labelsCollapsed: true }}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );
      expect(screen.queryByText(/×/)).not.toBeInTheDocument();
    });

    it('shades today, the weekend and every other weekday behind the row', () => {
      const { container } = render(
        <CalendarTimelineRow
          model={makeModel()}
          viewport={{
            ...defaultViewport,
            todayColumnIndex: 1,
            dayGridTemplateColumns: 'repeat(6, 1fr)',
          }}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      const grid = container.querySelector('.grid') as HTMLElement;
      expect(grid).toHaveStyle({ gridTemplateColumns: 'repeat(6, 1fr)' });
      const cells = Array.from(grid.children);
      expect(cells).toHaveLength(6);
      // Monday 5 to Saturday 10 January; today is the Tuesday.
      expect(cells[0]).toHaveClass('bg-muted/10', 'min-w-0', 'h-full', 'border-r');
      expect(cells[1]).toHaveClass('bg-primary/12');
      expect(cells[1]).not.toHaveClass('bg-muted/10');
      expect(cells[2]).toHaveClass('bg-muted/10');
      expect(cells[3]).not.toHaveClass('bg-muted/10');
      expect(cells[5]).toHaveClass('bg-muted/35');
      expect(cells[5]).toHaveAttribute('data-weekend', 'true');
      expect(cells[4]).not.toHaveAttribute('data-weekend');
    });

    it('leaves the grid template to the stylesheet when there is none', () => {
      const { container } = render(
        <CalendarTimelineRow
          model={makeModel()}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      expect((container.querySelector('.grid') as HTMLElement).getAttribute('style')).toBeNull();
    });

    it('draws the stay window behind the pills', () => {
      const { container } = render(
        <CalendarTimelineRow
          model={makeModel({ staySpan: { startIndex: 1, endIndex: 3 }, laneCount: 2 })}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      expect(container.querySelector('.border-dashed')).toHaveStyle({
        left: '102px',
        top: '2px',
        width: '296px',
        height: '60px',
      });
    });

    it('names the arrows after the guest', () => {
      render(
        <CalendarTimelineRow
          model={makeModel({ items: [TRANSPORT_ITEM] })}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
        { wrapper: withVisibleRange({ start: 0, end: 600 }) },
      );

      expect(screen.getByTestId('timeline-offscreen-left')).toHaveAttribute(
        'title',
        'Alice is booked earlier. Scroll back',
      );
      expect(screen.getByTestId('timeline-offscreen-right')).toHaveAttribute(
        'title',
        'Alice is booked later. Scroll forward',
      );
    });

    it('draws its label cell as a sticky, bordered column', () => {
      const { container } = render(
        <CalendarTimelineRow
          model={makeModel()}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      expect(container.querySelector('.sticky')).toHaveClass(
        'left-0',
        'z-10',
        'bg-background',
        'border-r',
        'border-muted',
      );
    });

    it('offers no arrows on a row with nothing on it', () => {
      render(
        <CalendarTimelineRow
          model={makeModel()}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
        { wrapper: withVisibleRange({ start: 0, end: 200 }) },
      );

      expect(screen.queryByTestId('timeline-offscreen-left')).not.toBeInTheDocument();
    });

    it('points nowhere while a pill is partly on screen', () => {
      // The stay covers 102 to 298 on the canvas; the reader sees 200 to 600.
      render(
        <CalendarTimelineRow
          model={makeModel({
            items: [
              {
                kind: 'assignment',
                id: 'a-part',
                startIndex: 1,
                endIndex: 2,
                assignment: makeAssignment('a-part', 'r1', 'p-Alice'),
                person: makePerson('Alice'),
                room: undefined,
                label: 'Blue room',
                color: '#ef4444' as HexColor,
                textColor: 'white',
                laneIndex: 0,
              },
            ],
          })}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
        { wrapper: withVisibleRange({ start: 200, end: 600 }) },
      );

      expect(screen.getByTestId('timeline-offscreen-left').hidden).toBe(true);
      expect(screen.getByTestId('timeline-offscreen-right').hidden).toBe(true);
    });
  });

  describe('pills that share a row', () => {
    const transport = {
      ...TRANSPORT_ITEM.transport,
      datetime: '2026-01-06T14:30:00',
    } as Extract<TimelineItemWithLane, { kind: 'transport' }>['transport'];

    const stay: TimelineItemWithLane = {
      kind: 'assignment',
      id: 'a-share',
      startIndex: 1,
      endIndex: 2,
      assignment: makeAssignment('a-share', 'r1', 'p-Alice'),
      person: makePerson('Alice'),
      room: undefined,
      label: 'Blue room',
      color: '#1d4ed8' as HexColor,
      textColor: 'white',
      laneIndex: 0,
    };

    const legItem: TimelineItemWithLane = {
      ...TRANSPORT_ITEM,
      transport,
      startIndex: 4,
      endIndex: 4,
    } as TimelineItemWithLane;

    function departure(id: string, datetime: string, location: string) {
      return {
        ...transport,
        id: id as TransportId,
        type: 'departure' as const,
        datetime,
        location,
      };
    }

    it('gives every pill its own key', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      render(
        <CalendarTimelineRow
          model={makeModel({ items: [stay, legItem] })}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      expect(
        consoleError.mock.calls.filter((call) => String(call[0]).includes('same key')),
      ).toEqual([]);
      consoleError.mockRestore();
    });

    it('draws every pill as a small rounded, focusable block', () => {
      render(
        <CalendarTimelineRow
          model={makeModel({ items: [stay] })}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      const pill = screen.getByRole('button');
      expect(pill).toHaveClass(
        'absolute',
        'z-[1]',
        'rounded-md',
        'text-xs',
        'overflow-hidden',
        'focus-visible:ring-2',
        'transition-opacity',
        'hover:opacity-90',
      );
      expect(screen.getByTitle('Blue room')).toHaveClass(
        'h-[18px]',
        'max-w-[2.75rem]',
        'rounded-full',
        'text-[9px]',
        'font-semibold',
      );
      // No legs, so no columns of leg markers either side.
      expect(pill.querySelector('.flex-col')).toBeNull();
    });

    it('lists the departures it carries in time order', () => {
      render(
        <CalendarTimelineRow
          model={makeModel({
            items: [
              {
                ...stay,
                timelineTransports: [
                  { transport: departure('late', '2026-01-08T18:00:00', 'Late'), dayIndex: 3 },
                  { transport: departure('early', '2026-01-08T07:00:00', 'Early'), dayIndex: 3 },
                ],
              } as TimelineItemWithLane,
            ],
          })}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      const pill = screen.getByRole('button');
      const markers = Array.from(pill.querySelectorAll('[title]'))
        .map((element) => element.getAttribute('title'))
        .filter((title) => title !== 'Blue room');
      expect(markers).toEqual(['Early', 'Late']);
    });

    it('opens a stay that carries no legs with none', () => {
      const onAssignmentClick = vi.fn();
      render(
        <CalendarTimelineRow
          model={makeModel({ items: [stay] })}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={onAssignmentClick}
        />,
      );

      fireEvent.click(screen.getByRole('button'));

      expect(onAssignmentClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a-share' }),
        undefined,
      );
    });

    it('does nothing on a leg when nothing can open it', () => {
      render(
        <CalendarTimelineRow
          model={makeModel({ items: [legItem] })}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      expect(errorsDuring(() => fireEvent.click(screen.getByRole('button')))).toEqual([]);
    });

    it('follows a ride arranged while the row is on screen', () => {
      const ride = { isLegacy: false, driver: makePerson('Bruno') } as unknown as ResolvedRide;
      const onTransportClick = vi.fn();
      const withMarker = {
        ...stay,
        timelineTransports: [{ transport: { ...transport, id: 'marker' as TransportId }, dayIndex: 1 }],
      } as TimelineItemWithLane;
      const model = makeModel({ items: [withMarker, legItem] });
      const { rerender } = render(
        <CalendarTimelineRow
          model={model}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
          onTransportClick={onTransportClick}
          rideForTransport={() => undefined}
        />,
      );
      expect(screen.getByRole('button', { name: '14:30 · Station' })).toBeInTheDocument();

      rerender(
        <CalendarTimelineRow
          model={model}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
          onTransportClick={onTransportClick}
          rideForTransport={() => ride}
        />,
      );

      const leg = screen.getByRole('button', {
        name: '14:30 · Station · Part of a shared ride, Bruno driving',
      });
      expect(screen.getByTitle('Station · Part of a shared ride, Bruno driving')).toBeInTheDocument();
      fireEvent.click(leg);
      expect(onTransportClick).toHaveBeenCalledWith(expect.objectContaining({ ride }));
    });

    it('opens a stay with the handler it was last given', () => {
      const first = vi.fn();
      const second = vi.fn();
      const model = makeModel({ items: [stay] });
      const { rerender } = render(
        <CalendarTimelineRow
          model={model}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={first}
        />,
      );

      rerender(
        <CalendarTimelineRow
          model={model}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={second}
        />,
      );
      fireEvent.click(screen.getByRole('button'));

      expect(second).toHaveBeenCalled();
      expect(first).not.toHaveBeenCalled();
    });

    it('redraws its pills when the stays or the language change', () => {
      const { rerender } = render(
        <CalendarTimelineRow
          model={makeModel({ items: [stay] })}
          viewport={defaultViewport}
          dateLocale={enUS}
          onAssignmentClick={vi.fn()}
        />,
      );

      rerender(
        <CalendarTimelineRow
          model={makeModel({ items: [stay, legItem] })}
          viewport={defaultViewport}
          dateLocale={fr}
          onAssignmentClick={vi.fn()}
        />,
      );

      expect(screen.getAllByRole('button')).toHaveLength(2);
      expect(screen.getAllByRole('button')[0]).toHaveTextContent(/6 janv\. \S 8 janv\./u);
    });
  });
});
