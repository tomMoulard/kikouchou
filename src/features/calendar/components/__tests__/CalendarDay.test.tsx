/**
 * @fileoverview Tests for the CalendarDay component.
 * @module features/calendar/components/__tests__/CalendarDay.test
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { CalendarDay } from '../CalendarDay';
import type { CalendarDayProps, CalendarEvent, CalendarTransport } from '../../types';
import type { HexColor, ISODateString, ISODateTimeString, PersonId, RoomAssignmentId, RoomId, TransportId, TripId } from '@/types';

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
