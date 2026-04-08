/**
 * @fileoverview Tests for CalendarTimelineRow component.
 * @module features/calendar/components/__tests__/CalendarTimelineRow.test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalendarTimelineRow } from '../CalendarTimelineRow';
import type { CalendarTimelineRowModel, TimelineItemWithLane } from '../../types';
import type { TripTimelineViewportContext } from '@/components/shared/TripTimelineFrame';
import type { HexColor, ISODateString, Person, PersonId, RoomAssignment, RoomAssignmentId, RoomId, TripId } from '@/types';
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
    createdAt: Date.now(),
    updatedAt: Date.now(),
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
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as RoomAssignment;
}

const defaultViewport: TripTimelineViewportContext = {
  canvasWidth: 600,
  dayCount: 6,
  cellWidthPx: 100,
  dayWidthPx: 100,
  useFractionalColumns: false,
  labelColumnWidth: 140,
  laneHeightPx: 32,
  todayColumnIndex: undefined,
  dayGridTemplateColumns: undefined,
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

// ============================================================================
// Tests
// ============================================================================

describe('CalendarTimelineRow', () => {
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
      roomName: 'Room 1',
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
      id: 't1',
      tripId: 'trip-1',
      personId: 'p-Alice',
      type: 'arrival' as const,
      datetime: '2026-01-06T14:00:00Z',
      location: 'Station',
      mode: 'train' as const,
      transportNumber: '',
      needsPickup: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
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
    } as TimelineItemWithLane;

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
        viewport={{ ...defaultViewport, dayCount: 3 }}
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
    // @ts-expect-error - force empty name
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
