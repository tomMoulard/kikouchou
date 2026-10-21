/**
 * @fileoverview Tests for the CalendarDay component.
 * @module features/calendar/components/__tests__/CalendarDay.test
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test/utils';
import { CalendarDay } from '../CalendarDay';
import type {
  CalendarActivity,
  CalendarDayProps,
  CalendarEvent,
  CalendarTransport,
} from '../../types';
import type { ActivityId, HexColor, ISODateString, ISODateTimeString, PersonId, RoomAssignmentId, RoomId, TransportId, TripId } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    assignment: {
      id: 'assign-1' as RoomAssignmentId,
      tripId: 'trip-1' as TripId,
      roomId: 'room-1' as RoomId,
      personId: 'person-1' as PersonId,
      startDate: '2026-07-15' as ISODateString,
      endDate: '2026-07-17' as ISODateString,
    },
    person: { id: 'person-1' as PersonId, tripId: 'trip-1' as TripId, name: 'Alice', color: '#3b82f6' as HexColor },
    room: { id: 'room-1' as RoomId, tripId: 'trip-1' as TripId, name: 'Room 1', capacity: 2, order: 0 },
    label: 'Alice - Room 1',
    color: '#3b82f6' as HexColor,
    textColor: 'white',
    segmentPosition: 'single',
    slotIndex: 0,
    spanId: 'assign-1',
    totalDays: 1,
    dayOfWeek: 3,
    isRowStart: false,
    isRowEnd: false,
    ...overrides,
  };
}

function makeTransport(overrides: Partial<CalendarTransport> = {}): CalendarTransport {
  return {
    transport: {
      id: 'transport-1' as TransportId,
      tripId: 'trip-1' as TripId,
      personId: 'person-1' as PersonId,
      type: 'arrival',
      datetime: '2026-07-15T14:30:00' as ISODateTimeString,
      location: 'Airport',
      needsPickup: false,
      transportMode: 'plane',
    },
    person: undefined,
    personName: 'Alice',
    color: '#3b82f6' as HexColor,
    ...overrides,
  };
}

import { enUS } from 'date-fns/locale';

function makeDefaultProps(overrides: Partial<CalendarDayProps> = {}): CalendarDayProps {
  return {
    dateKey: '2026-07-15' as ISODateString,
    date: new Date(2026, 6, 15),
    events: [],
    transports: [],
    activities: [],
    isCurrentMonth: true,
    isToday: false,
    isWithinTrip: true,
    dateLocale: enUS,
    onEventClick: vi.fn(),
    ...overrides,
  };
}

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

describe('CalendarDay', () => {
  it('renders the day number', () => {
    render(<CalendarDay {...makeDefaultProps()} />, { withProviders: false });
    expect(screen.getByText('15')).toBeInTheDocument();
  });

  it('has gridcell role', () => {
    render(<CalendarDay {...makeDefaultProps()} />, { withProviders: false });
    expect(screen.getByRole('gridcell')).toBeInTheDocument();
  });

  it('has aria-label with full date', () => {
    render(<CalendarDay {...makeDefaultProps()} />, { withProviders: false });
    const cell = screen.getByRole('gridcell');
    expect(cell).toHaveAttribute('aria-label');
    // Should contain date info from date-fns
    expect(cell.getAttribute('aria-label')).toContain('2026');
  });

  it('marks today with aria-current="date"', () => {
    render(<CalendarDay {...makeDefaultProps({ isToday: true })} />, { withProviders: false });
    const cell = screen.getByRole('gridcell');
    expect(cell).toHaveAttribute('aria-current', 'date');
  });

  it('does not set aria-current for non-today', () => {
    render(<CalendarDay {...makeDefaultProps({ isToday: false })} />, { withProviders: false });
    const cell = screen.getByRole('gridcell');
    expect(cell).not.toHaveAttribute('aria-current');
  });

  it('renders event pills', () => {
    const event = makeEvent();
    render(
      <CalendarDay {...makeDefaultProps({ events: [event] })} />,
      { withProviders: false },
    );
    expect(screen.getByRole('button', { name: 'Alice - Room 1' })).toBeInTheDocument();
  });

  it('renders transport indicators', () => {
    const transport = makeTransport();
    render(
      <CalendarDay {...makeDefaultProps({ transports: [transport] })} />,
      { withProviders: false },
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('14:30')).toBeInTheDocument();
  });

  it('calls onEventClick when event is clicked', async () => {
    const onEventClick = vi.fn();
    const event = makeEvent();
    const { user } = render(
      <CalendarDay {...makeDefaultProps({ events: [event], onEventClick })} />,
      { withProviders: false },
    );
    await user.click(screen.getByRole('button', { name: 'Alice - Room 1' }));
    expect(onEventClick).toHaveBeenCalledWith(event.assignment);
  });

  it('shows hidden count when events exceed max visible slots', () => {
    // Create events with slotIndex beyond MAX_VISIBLE_EVENT_SLOTS (which is 3)
    const events = [
      makeEvent({ slotIndex: 0, spanId: 'a1' }),
      makeEvent({ slotIndex: 1, spanId: 'a2', label: 'Bob - Room 2' }),
      makeEvent({ slotIndex: 2, spanId: 'a3', label: 'Charlie - Room 3' }),
      makeEvent({ slotIndex: 3, spanId: 'a4', label: 'Diana - Room 4' }),
    ];
    render(
      <CalendarDay {...makeDefaultProps({ events })} />,
      { withProviders: false },
    );
    // The +1 indicator should be visible
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('handles tabIndex prop', () => {
    render(<CalendarDay {...makeDefaultProps({ tabIndex: 0 })} />, { withProviders: false });
    const cell = screen.getByRole('gridcell');
    expect(cell).toHaveAttribute('tabindex', '0');
  });

  it('calls onDayFocus when focused', () => {
    const onDayFocus = vi.fn();
    render(
      <CalendarDay {...makeDefaultProps({ tabIndex: 0, onDayFocus })} />,
      { withProviders: false },
    );
    const cell = screen.getByRole('gridcell');
    cell.focus();
    expect(onDayFocus).toHaveBeenCalledWith('2026-07-15');
  });
});

// ============================================================================
// Out-of-month readability
// ============================================================================

/**
 * The day number and the headcount used to fade to `text-muted-foreground/50`
 * outside the current month: 2.23:1 against the cell's `bg-muted/30` in light
 * and 2.75:1 in dark, where WCAG 1.4.3 asks 4.5:1 for 14px medium text.
 *
 * They are not decorative. `CalendarPage` looks events, transports, activities
 * and headcounts up by date with no `isCurrentMonth` gate, so a trip that
 * straddles a month boundary fills these cells — and they stay focusable grid
 * cells either way. The tests below pin both the readable colour and the two
 * *other* carriers of "outside this month", so nobody restores the fade on the
 * grounds that the distinction would otherwise be lost.
 */
describe('CalendarDay outside the current month', () => {
  it('keeps the day number at a readable opacity', () => {
    render(
      <CalendarDay {...makeDefaultProps({ isCurrentMonth: false })} />,
      { withProviders: false },
    );

    const dayNumber = screen.getByText('15');
    expect(dayNumber.className).toContain('text-muted-foreground');
    expect(dayNumber.className).not.toMatch(/text-muted-foreground\/\d+/);
  });

  it('keeps the headcount at a readable opacity', () => {
    render(
      <CalendarDay
        {...makeDefaultProps({
          isCurrentMonth: false,
          headcount: { guests: 3, people: 4 },
        })}
      />,
      { withProviders: false },
    );

    const headcount = screen.getByTestId('day-headcount-2026-07-15');
    expect(headcount.className).toContain('text-muted-foreground');
    expect(headcount.className).not.toMatch(/text-muted-foreground\/\d+/);
  });

  it('still ranks below an in-month day, by token rather than by opacity', () => {
    const { unmount } = render(
      <CalendarDay {...makeDefaultProps({ isCurrentMonth: false })} />,
      { withProviders: false },
    );
    const outside = screen.getByText('15').className;
    unmount();

    render(<CalendarDay {...makeDefaultProps()} />, { withProviders: false });
    const inside = screen.getByText('15').className;

    expect(inside).toContain('text-foreground');
    expect(outside).not.toContain('text-foreground');
  });

  it('tints the cell, so colour is not the only thing marking it', () => {
    render(
      <CalendarDay {...makeDefaultProps({ isCurrentMonth: false })} />,
      { withProviders: false },
    );

    expect(screen.getByRole('gridcell').className).toContain('bg-muted/30');
  });

  it('says so in the cell summary a screen reader reads', () => {
    render(
      <CalendarDay {...makeDefaultProps({ isCurrentMonth: false })} />,
      { withProviders: false },
    );

    const cell = screen.getByRole('gridcell');
    const summaryId = cell.getAttribute('aria-describedby');
    expect(summaryId).toBe('2026-07-15-summary');
    expect(document.getElementById(summaryId!)?.textContent).toContain(
      'calendar.outsideCurrentMonth',
    );
  });

  it('renders the events an out-of-month cell is given', () => {
    render(
      <CalendarDay
        {...makeDefaultProps({ isCurrentMonth: false, events: [makeEvent()] })}
      />,
      { withProviders: false },
    );

    expect(screen.getByText('Alice - Room 1')).toBeInTheDocument();
  });
});

// ============================================================================
// What a cell holds, and what it tells a screen reader
// ============================================================================

describe('CalendarDay contents', () => {
  function makeActivity(id: string, title: string): CalendarActivity {
    return {
      activity: {
        id: id as ActivityId,
        tripId: 'trip-1' as TripId,
        title,
        category: 'meal',
        startDatetime: '2026-07-15T12:00:00',
        allDay: false,
        participantIds: [],
      },
      color: '#e11d48' as HexColor,
      isSpanStart: true,
      isSpanEnd: true,
    };
  }

  /** The content area's children, top to bottom, as labels or `·` for a spacer. */
  function rowsOf(cell: HTMLElement): string[] {
    return Array.from(cell.children[1]!.children).map((element) =>
      element.getAttribute('aria-hidden') === 'true'
        ? '·'
        : (element.getAttribute('aria-label') ?? element.textContent ?? ''),
    );
  }

  function summaryText(): string | null {
    const id = screen.getByRole('gridcell').getAttribute('aria-describedby');
    return id === null ? null : (document.getElementById(id)?.textContent ?? null);
  }

  it('names the cell after its full date', () => {
    render(<CalendarDay {...makeDefaultProps()} />, { withProviders: false });

    expect(screen.getByRole('gridcell')).toHaveAttribute('aria-label', 'Wednesday, July 15th, 2026');
  });

  it('draws an in-trip day on the plain background, with a readable number', () => {
    render(<CalendarDay {...makeDefaultProps()} />, { withProviders: false });

    const cell = screen.getByRole('gridcell');
    expect(cell).toHaveClass(
      'bg-background',
      'min-h-[80px]',
      'p-1',
      'flex',
      'flex-col',
      'border-t',
      'focus-visible:ring-2',
    );
    expect(cell).not.toHaveClass('bg-muted/30');
    expect(cell).not.toHaveClass('bg-muted/50');
    expect(screen.getByText('15')).toHaveClass('text-sm', 'font-medium', 'size-6', 'rounded-full');
    // Nothing to say about an ordinary day.
    expect(cell).not.toHaveAttribute('aria-describedby');
    expect(document.getElementById('2026-07-15-summary')).toBeNull();
  });

  it('greys a day of the month outside the trip, and says why', () => {
    render(<CalendarDay {...makeDefaultProps({ isWithinTrip: false })} />, {
      withProviders: false,
    });

    expect(screen.getByRole('gridcell')).toHaveClass('bg-muted/50');
    expect(summaryText()).toBe('calendar.outsideTripDates');
  });

  it('greys a day of another month only once', () => {
    render(
      <CalendarDay {...makeDefaultProps({ isCurrentMonth: false, isWithinTrip: false })} />,
      { withProviders: false },
    );

    const cell = screen.getByRole('gridcell');
    expect(cell).toHaveClass('bg-muted/30');
    expect(cell).not.toHaveClass('bg-muted/50');
    expect(summaryText()).toBe('calendar.outsideCurrentMonth');
  });

  it('circles today and says so first', () => {
    render(
      <CalendarDay
        {...makeDefaultProps({ isToday: true, headcount: { guests: 1, people: 2 } })}
      />,
      { withProviders: false },
    );

    const dayNumber = screen.getByText('15');
    expect(dayNumber).toHaveClass('bg-primary', 'text-primary-foreground');
    expect(dayNumber).not.toHaveClass('text-foreground');
    expect(summaryText()).toBe('calendar.today. calendar.peopleOnSite');
  });

  it('shows how many people sleep there', () => {
    render(<CalendarDay {...makeDefaultProps({ headcount: { guests: 2, people: 3 } })} />, {
      withProviders: false,
    });

    const headcount = screen.getByTestId('day-headcount-2026-07-15');
    expect(headcount).toHaveTextContent('3');
    expect(headcount).toHaveAttribute('title', 'calendar.peopleOnSite');
    expect(headcount).toHaveAttribute('aria-hidden', 'true');
    expect(headcount).toHaveClass('absolute', 'right-0', 'text-xs');
  });

  it('shows no headcount on a day nobody sleeps there', () => {
    render(<CalendarDay {...makeDefaultProps({ headcount: { guests: 0, people: 0 } })} />, {
      withProviders: false,
    });

    expect(screen.queryByTestId('day-headcount-2026-07-15')).not.toBeInTheDocument();
  });

  it('shows two activities and two legs, and counts what does not fit', () => {
    render(
      <CalendarDay
        {...makeDefaultProps({
          activities: [
            makeActivity('a1', 'Breakfast'),
            makeActivity('a2', 'Lunch'),
            makeActivity('a3', 'Dinner'),
          ],
          transports: [
            makeTransport(),
            makeTransport({
              transport: { ...makeTransport().transport, id: 't2' as TransportId },
              personName: 'Bob',
            }),
            makeTransport({
              transport: { ...makeTransport().transport, id: 't3' as TransportId },
              personName: 'Carol',
            }),
          ],
          events: [makeEvent({ slotIndex: 3 })],
        })}
      />,
      { withProviders: false },
    );

    expect(screen.getByText('Breakfast')).toBeInTheDocument();
    expect(screen.getByText('Lunch')).toBeInTheDocument();
    expect(screen.queryByText('Dinner')).not.toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Carol')).not.toBeInTheDocument();
    const overflow = screen.getByText('+3').parentElement;
    expect(overflow).toHaveClass('text-xs', 'text-muted-foreground', 'text-center');
    expect(overflow).toHaveTextContent('+3calendar.moreItemsHidden');
    expect(summaryText()).toBe('calendar.moreItemsHidden');
  });

  it('keeps a stay in its lane with a spacer above it', () => {
    const { container } = render(
      <CalendarDay {...makeDefaultProps({ events: [makeEvent({ slotIndex: 1 })] })} />,
      { withProviders: false },
    );

    expect(rowsOf(screen.getByRole('gridcell'))).toEqual(['·', 'Alice - Room 1']);
    expect(container.querySelector('[aria-hidden="true"].h-\\[28px\\]')).toBeInTheDocument();
  });

  it('lays out every lane up to the highest one in the day', () => {
    render(
      <CalendarDay
        {...makeDefaultProps({
          events: [
            makeEvent({ slotIndex: 0, spanId: 'a1' }),
            makeEvent({ slotIndex: 2, spanId: 'a3', label: 'Carol - Room 3' }),
          ],
        })}
      />,
      { withProviders: false },
    );

    expect(rowsOf(screen.getByRole('gridcell'))).toEqual(['Alice - Room 1', '·', 'Carol - Room 3']);
  });

  it('gives each pill and spacer a key of its own', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <CalendarDay
        {...makeDefaultProps({
          events: [
            makeEvent({ slotIndex: 0, spanId: 'a1' }),
            makeEvent({ slotIndex: 1, spanId: 'a2', label: 'Bob - Room 2' }),
          ],
        })}
      />,
      { withProviders: false },
    );

    const duplicateKeys = consoleError.mock.calls.filter((call) =>
      String(call[0]).includes('same key'),
    );
    expect(duplicateKeys).toEqual([]);
    consoleError.mockRestore();
  });

  it('hands key presses and its node to the grid', () => {
    const onDayKeyDown = vi.fn();
    const dayRef = vi.fn();
    const { unmount } = render(
      <CalendarDay {...makeDefaultProps({ onDayKeyDown, dayRef })} />,
      { withProviders: false },
    );

    const cell = screen.getByRole('gridcell');
    expect(dayRef).toHaveBeenCalledWith('2026-07-15', cell);

    fireEvent.keyDown(cell, { key: 'ArrowRight' });
    expect(onDayKeyDown).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'ArrowRight' }),
      '2026-07-15',
    );

    unmount();
    expect(dayRef).toHaveBeenLastCalledWith('2026-07-15', null);
  });

  it('draws no lanes on a day with no stays', () => {
    render(<CalendarDay {...makeDefaultProps()} />, { withProviders: false });

    expect(rowsOf(screen.getByRole('gridcell'))).toEqual([]);
  });

  it('finds the highest lane whatever order the stays come in', () => {
    render(
      <CalendarDay
        {...makeDefaultProps({
          events: [
            makeEvent({ slotIndex: 2, spanId: 'a3', label: 'Carol - Room 3' }),
            makeEvent({ slotIndex: 0, spanId: 'a1' }),
          ],
        })}
      />,
      { withProviders: false },
    );

    const rows = rowsOf(screen.getByRole('gridcell'));
    expect(rows).toHaveLength(3);
    expect(rows[2]).toBe('Carol - Room 3');
  });

  it('keeps the spacers to the lanes a day can show', () => {
    render(<CalendarDay {...makeDefaultProps({ events: [makeEvent({ slotIndex: 3 })] })} />, {
      withProviders: false,
    });

    // Lane 3 is past the last one drawn, so the day shows three spacers and
    // the count.
    expect(rowsOf(screen.getByRole('gridcell'))).toEqual(['·', '·', '·', '+1calendar.moreItemsHidden']);
  });

  it('gives each spacer a key of its own', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<CalendarDay {...makeDefaultProps({ events: [makeEvent({ slotIndex: 2 })] })} />, {
      withProviders: false,
    });

    expect(
      consoleError.mock.calls.filter((call) => String(call[0]).includes('same key')),
    ).toEqual([]);
    consoleError.mockRestore();
  });

  it('hides the visible overflow count from screen readers, which hear the sentence', () => {
    render(<CalendarDay {...makeDefaultProps({ events: [makeEvent({ slotIndex: 3 })] })} />, {
      withProviders: false,
    });

    expect(screen.getByText('+1')).toHaveAttribute('aria-hidden', 'true');
  });

  it('takes key presses without a handler', () => {
    render(<CalendarDay {...makeDefaultProps()} />, { withProviders: false });

    expect(errorsDuring(() => fireEvent.keyDown(screen.getByRole('gridcell'), { key: 'a' }))).toEqual(
      [],
    );
  });

  it('follows its props when the page re-renders it', () => {
    const firstFocus = vi.fn();
    const secondFocus = vi.fn();
    const firstKeyDown = vi.fn();
    const secondKeyDown = vi.fn();
    const firstRef = vi.fn();
    const secondRef = vi.fn();
    const { rerender } = render(
      <CalendarDay
        {...makeDefaultProps({
          tabIndex: 0,
          onDayFocus: firstFocus,
          onDayKeyDown: firstKeyDown,
          dayRef: firstRef,
          events: [makeEvent({ slotIndex: 0 })],
        })}
      />,
      { withProviders: false },
    );

    rerender(
      <CalendarDay
        {...makeDefaultProps({
          tabIndex: 0,
          isToday: true,
          onDayFocus: secondFocus,
          onDayKeyDown: secondKeyDown,
          dayRef: secondRef,
          events: [
            makeEvent({ slotIndex: 0, spanId: 'a1' }),
            makeEvent({ slotIndex: 1, spanId: 'a2', label: 'Bob - Room 2' }),
          ],
        })}
      />,
    );

    const cell = screen.getByRole('gridcell');
    expect(rowsOf(cell)).toEqual(['Alice - Room 1', 'Bob - Room 2']);
    expect(summaryText()).toBe('calendar.today');
    expect(secondRef).toHaveBeenCalledWith('2026-07-15', cell);

    cell.focus();
    fireEvent.keyDown(cell, { key: 'ArrowRight' });
    expect(secondFocus).toHaveBeenCalledWith('2026-07-15');
    expect(secondKeyDown).toHaveBeenCalled();
    expect(firstFocus).not.toHaveBeenCalled();
    expect(firstKeyDown).not.toHaveBeenCalled();
  });
});
