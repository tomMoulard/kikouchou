/**
 * @fileoverview Tests for the ActivityIndicator component: the activity pill
 * in a month cell.
 *
 * @module features/calendar/components/__tests__/ActivityIndicator.test
 */

import { describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen } from '@/test/utils';
import type { Activity, ActivityId, HexColor, PersonId, TripId } from '@/types';

import { ActivityIndicator } from '../ActivityIndicator';
import type { CalendarActivity } from '../../types';

// ============================================================================
// Helpers
// ============================================================================

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'activity-1' as ActivityId,
    tripId: 'trip-1' as TripId,
    title: 'Plant fair',
    category: 'horticulture',
    // Offset-less: a local wall-clock time, so the pill reads 09:00 anywhere.
    startDatetime: '2026-07-15T09:00:00',
    allDay: false,
    location: 'Saint-Jean',
    participantIds: ['person-1' as PersonId, 'person-2' as PersonId],
    ...overrides,
  };
}

function makeCalendarActivity(
  overrides: Partial<CalendarActivity> = {},
  activity: Partial<Activity> = {},
): CalendarActivity {
  return {
    activity: makeActivity(activity),
    // Dark green, so the contrast decision is white text.
    color: '#166534' as HexColor,
    isSpanStart: true,
    isSpanEnd: true,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ActivityIndicator', () => {
  it('shows the start time and the title, tinted with the category colour', () => {
    render(<ActivityIndicator activity={makeCalendarActivity()} />, { withProviders: false });

    const pill = screen.getByLabelText('calendar.viewActivityDetails');
    expect(pill.tagName).toBe('DIV');
    expect(pill).toHaveTextContent('09:00');
    expect(pill).toHaveTextContent('Plant fair');
    expect(pill).toHaveStyle({ backgroundColor: '#166534', color: 'rgb(255, 255, 255)' });
    expect(pill).toHaveAttribute('title', '09:00 · Plant fair · Saint-Jean');
  });

  it('says "all day" in the tooltip and shows no clock for an all-day activity', () => {
    render(
      <ActivityIndicator activity={makeCalendarActivity({}, { allDay: true, location: undefined })} />,
      { withProviders: false },
    );

    const pill = screen.getByLabelText('calendar.viewActivityDetails');
    expect(pill).toHaveAttribute('title', 'activities.allDay · Plant fair');
    expect(pill).not.toHaveTextContent('09:00');
    expect(pill.querySelector('.tabular-nums')).toBeNull();
  });

  it('rounds both ends of a one-day activity', () => {
    render(<ActivityIndicator activity={makeCalendarActivity()} />, { withProviders: false });

    expect(screen.getByLabelText('calendar.viewActivityDetails')).toHaveClass(
      'rounded-l',
      'rounded-r',
    );
  });

  it('keeps the title on the first day and squares the joins of a longer one', () => {
    const { rerender } = render(
      <ActivityIndicator activity={makeCalendarActivity({ isSpanEnd: false })} />,
      { withProviders: false },
    );

    const first = screen.getByLabelText('calendar.viewActivityDetails');
    expect(first).toHaveClass('rounded-l', 'rounded-r-none');
    expect(first).toHaveTextContent('Plant fair');

    rerender(
      <ActivityIndicator activity={makeCalendarActivity({ isSpanStart: false, isSpanEnd: true })} />,
    );

    const last = screen.getByLabelText('calendar.viewActivityDetails');
    expect(last).toHaveClass('rounded-l-none', 'rounded-r');
    expect(last).toHaveTextContent('↔');
    expect(last).not.toHaveTextContent('Plant fair');
  });

  it('becomes a button that opens the activity on a click', () => {
    const onClick = vi.fn();
    const calendarActivity = makeCalendarActivity();
    render(<ActivityIndicator activity={calendarActivity} onClick={onClick} />, {
      withProviders: false,
    });

    const button = screen.getByRole('button', { name: 'calendar.viewActivityDetails' });
    expect(button).toHaveClass('cursor-pointer');
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledWith(calendarActivity.activity);
  });

  it.each(['Enter', ' '])('opens the activity on the %j key', (key) => {
    const onClick = vi.fn();
    const calendarActivity = makeCalendarActivity();
    render(<ActivityIndicator activity={calendarActivity} onClick={onClick} />, {
      withProviders: false,
    });

    const button = screen.getByRole('button', { name: 'calendar.viewActivityDetails' });
    const notPrevented = fireEvent.keyDown(button, { key });

    expect(notPrevented).toBe(false);
    expect(onClick).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledWith(calendarActivity.activity);
  });

  it('leaves every other key to the browser', () => {
    const onClick = vi.fn();
    render(<ActivityIndicator activity={makeCalendarActivity()} onClick={onClick} />, {
      withProviders: false,
    });

    const button = screen.getByRole('button', { name: 'calendar.viewActivityDetails' });
    expect(fireEvent.keyDown(button, { key: 'a' })).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is a compact, touch-sized pill, styled as tappable when it is', () => {
    const { rerender } = render(<ActivityIndicator activity={makeCalendarActivity()} />, {
      withProviders: false,
    });

    const pill = screen.getByLabelText('calendar.viewActivityDetails');
    expect(pill).toHaveClass('flex', 'items-center', 'px-1.5', 'text-xs', 'truncate', 'min-h-[44px]');
    expect(pill).not.toHaveClass('cursor-pointer');

    rerender(<ActivityIndicator activity={makeCalendarActivity()} onClick={vi.fn()} />);

    expect(screen.getByRole('button')).toHaveClass(
      'cursor-pointer',
      'hover:opacity-80',
      'transition-opacity',
      'focus-visible:ring-2',
    );
  });

  it('opens with the handler it was last given', () => {
    const first = vi.fn();
    const second = vi.fn();
    const calendarActivity = makeCalendarActivity();
    const { rerender } = render(<ActivityIndicator activity={calendarActivity} onClick={first} />, {
      withProviders: false,
    });

    rerender(<ActivityIndicator activity={calendarActivity} onClick={second} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Enter' });

    expect(second).toHaveBeenCalledTimes(2);
    expect(first).not.toHaveBeenCalled();
  });
});
