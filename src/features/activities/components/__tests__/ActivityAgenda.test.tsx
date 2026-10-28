/**
 * @fileoverview Tests for the day-by-day activity planning.
 * @module features/activities/components/__tests__/ActivityAgenda.test
 */

import { describe, it, expect, vi } from 'vitest';
import { enUS } from 'date-fns/locale';

import { render, screen, within } from '@/test/utils';
import type { Activity, ActivityId, PersonId, TripId } from '@/types';

import { ActivityAgenda } from '../ActivityAgenda';

// ============================================================================
// Test Data
// ============================================================================

function at(day: number, hour: number, minute = 0): string {
  return new Date(2024, 6, day, hour, minute).toISOString();
}

function makeActivity(id: string, overrides: Partial<Activity> = {}): Activity {
  return {
    id: id as ActivityId,
    tripId: 'trip-1' as TripId,
    title: id,
    category: 'sport',
    startDatetime: at(16, 9),
    allDay: false,
    participantIds: [],
    ...overrides,
  };
}

function renderAgenda(
  activities: readonly Activity[],
  overrides: Partial<Parameters<typeof ActivityAgenda>[0]> = {},
) {
  const onActivityClick = vi.fn();
  const result = render(
    <ActivityAgenda
      activities={activities}
      dateLocale={enUS}
      today={new Date(2024, 6, 17, 12)}
      onActivityClick={onActivityClick}
      {...overrides}
    />,
    { withProviders: false },
  );
  return { ...result, onActivityClick };
}

function day(dateKey: string): HTMLElement {
  return screen.getByTestId(`activity-agenda-day-${dateKey}`);
}

// ============================================================================
// Tests
// ============================================================================

describe('ActivityAgenda', () => {
  it('renders nothing when no activity has a day', () => {
    const { container } = renderAgenda([makeActivity('broken', { startDatetime: 'nope' })]);

    expect(container).toBeEmptyDOMElement();
  });

  it('heads each day with its date and lists its activities in order', () => {
    renderAgenda([
      makeActivity('Dinner', { startDatetime: at(16, 20) }),
      makeActivity('Kayak', { startDatetime: at(16, 14), endDatetime: at(16, 16, 30) }),
      makeActivity('Horse', { startDatetime: at(17, 9) }),
    ]);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Tuesday, July 16th, 2024' }),
    ).toBeInTheDocument();
    const firstDay = within(day('2024-07-16')).getAllByRole('button');
    expect(firstDay.map((button) => button.textContent)).toEqual([
      expect.stringContaining('Kayak'),
      expect.stringContaining('Dinner'),
    ]);
    expect(firstDay[0]).toHaveTextContent('14:0016:30');
    expect(within(day('2024-07-17')).getByRole('button')).toHaveTextContent('Horse');
  });

  it('uses the heading level it is given', () => {
    renderAgenda([makeActivity('Kayak')], { headingLevel: 3 });

    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('July 16th');
  });

  it('marks today, and only today', () => {
    renderAgenda([
      makeActivity('Kayak', { startDatetime: at(16, 14) }),
      makeActivity('Horse', { startDatetime: at(17, 9) }),
    ]);

    expect(within(day('2024-07-17')).getByText('calendar.today')).toBeInTheDocument();
    expect(within(day('2024-07-16')).queryByText('calendar.today')).not.toBeInTheDocument();
  });

  it('says "all day" for a whole-day plan', () => {
    renderAgenda([makeActivity('Boat', { startDatetime: at(16, 0), allDay: true })]);

    expect(screen.getByRole('button')).toHaveTextContent('activities.allDay');
  });

  it('says which day of a multi-day activity each day is', () => {
    renderAgenda([
      makeActivity('Trek', { startDatetime: at(16, 10), endDatetime: at(17, 16) }),
    ]);

    // The first day of a timed activity keeps its clock time, with no end time,
    // which falls on another day.
    expect(within(day('2024-07-16')).getByRole('button')).toHaveTextContent(/^10:00Trek/);
    expect(within(day('2024-07-17')).getByRole('button')).toHaveTextContent(
      'activities.agenda.dayOfSpan',
    );
  });

  it('shows the place and how many go', () => {
    renderAgenda([
      makeActivity('Kayak', {
        location: 'Lac de Vassivière',
        participantIds: ['p1' as PersonId, 'p2' as PersonId],
      }),
    ]);

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Lac de Vassivière');
    expect(within(button).getByTitle('activities.participantCount')).toHaveTextContent('2');
  });

  it('shows the seats taken out of the cap', () => {
    renderAgenda([
      makeActivity('Kayak', { participantIds: ['p1' as PersonId], maxParticipants: 4 }),
    ]);

    expect(
      within(screen.getByRole('button')).getByTitle('activities.participantCountCapped'),
    ).toHaveTextContent('1/4');
  });

  it('shows no count for an open activity nobody joined', () => {
    renderAgenda([makeActivity('Kayak')]);

    expect(screen.queryByTitle(/activities.participantCount/)).not.toBeInTheDocument();
  });

  it('names the category for a screen reader', () => {
    renderAgenda([makeActivity('Kayak')]);

    expect(screen.getByLabelText('activities.categories.sport')).toBeInTheDocument();
  });

  it('opens the activity that was clicked', async () => {
    const kayak = makeActivity('Kayak');
    const { user, onActivityClick } = renderAgenda([kayak, makeActivity('Horse', { startDatetime: at(17, 9) })]);

    await user.click(screen.getByRole('button', { name: /Kayak/ }));

    expect(onActivityClick).toHaveBeenCalledTimes(1);
    expect(onActivityClick).toHaveBeenCalledWith(kayak);
  });
});
