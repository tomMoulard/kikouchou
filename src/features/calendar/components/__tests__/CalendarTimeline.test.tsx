/**
 * @fileoverview Tests for CalendarTimeline component.
 * @module features/calendar/components/__tests__/CalendarTimeline.test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CalendarTimeline } from '../CalendarTimeline';
import type {
  Activity,
  HexColor,
  ISODateString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  Transport,
  Trip,
  TripId,
} from '@/types';
import { enUS, fr } from 'date-fns/locale';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback;
      return key;
    },
  }),
}));

// ============================================================================
// Test Data
// ============================================================================

function makeTrip(): Trip {
  return {
    id: 'trip-1' as TripId,
    shareId: 'share-1' as Trip['shareId'],
    name: 'Test Trip',
    startDate: '2026-01-05' as ISODateString,
    endDate: '2026-01-10' as ISODateString,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makePerson(name: string, id = 'p1'): Person {
  return {
    id: id as PersonId,
    tripId: 'trip-1' as TripId,
    name,
    color: '#3b82f6' as HexColor,
  };
}

function makeRoom(): Room {
  return {
    id: 'room-1' as RoomId,
    tripId: 'trip-1' as TripId,
    name: 'Room A',
    capacity: 2,
    order: 0,
  };
}

function makeAssignment(personId: string): RoomAssignment {
  return {
    id: 'a1' as RoomAssignmentId,
    tripId: 'trip-1' as TripId,
    roomId: 'room-1' as RoomId,
    personId: personId as PersonId,
    startDate: '2026-01-06' as ISODateString,
    endDate: '2026-01-09' as ISODateString,
  };
}

/** A leg for the guest `p1`, offset-less so its day does not move with the runner. */
function makeLeg(type: 'arrival' | 'departure'): Transport {
  return {
    id: `leg-${type}` as Transport['id'],
    tripId: 'trip-1' as TripId,
    personId: 'p1' as PersonId,
    type,
    datetime: '2026-01-07T10:00:00',
    location: 'Station',
    needsPickup: false,
  };
}

function makeActivity(startDatetime: string): Activity {
  return {
    id: 'activity-1' as Activity['id'],
    tripId: 'trip-1' as TripId,
    title: 'Plant fair',
    category: 'horticulture',
    startDatetime,
    allDay: false,
    participantIds: [],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('CalendarTimeline', () => {
  const defaultProps = {
    trip: makeTrip(),
    persons: [makePerson('Alice')],
    rooms: [makeRoom()],
    assignments: [] as RoomAssignment[],
    arrivals: [] as Transport[],
    departures: [] as Transport[],
    activities: [] as Activity[],
    dateLocale: enUS,
    today: new Date('2026-01-07'),
    onAssignmentClick: vi.fn(),
    onTransportClick: vi.fn(),
  };

  it('renders the timeline frame with correct aria label', () => {
    render(<CalendarTimeline {...defaultProps} />);
    expect(screen.getByRole('region', { name: 'Timeline calendar' })).toBeInTheDocument();
  });

  it('renders left header with Guests label', () => {
    render(<CalendarTimeline {...defaultProps} />);
    expect(screen.getByText('Guests')).toBeInTheDocument();
  });

  it('renders person row in the timeline', () => {
    render(<CalendarTimeline {...defaultProps} />);
    // The person name should appear as a row label
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows empty state when there are no guests, assignments, arrivals or departures', () => {
    render(<CalendarTimeline {...defaultProps} persons={[]} />);
    expect(screen.getByText('calendar.noAssignments')).toBeInTheDocument();
    // The same EmptyState the month view uses, so switching views does not
    // change how "nothing here yet" is presented. This file's `t` mock returns
    // the fallback when one is given, hence the English string here.
    expect(screen.getByText('Nothing scheduled yet')).toBeInTheDocument();
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Nothing scheduled yet');
  });

  // A guest with no dates of their own is taken to be there for the whole trip,
  // so their row is drawn and the timeline is not empty — it used to say
  // "nothing scheduled" over a guest list the host had just filled in.
  it('does not show empty state for a guest with no dates of their own', () => {
    render(<CalendarTimeline {...defaultProps} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('calendar.noAssignments')).not.toBeInTheDocument();
  });

  it('does not show empty state when assignments exist', () => {
    render(
      <CalendarTimeline
        {...defaultProps}
        assignments={[makeAssignment('p1')]}
      />
    );
    expect(screen.queryByText('calendar.noAssignments')).not.toBeInTheDocument();
  });

  it('renders timeline rows as list items', () => {
    render(
      <CalendarTimeline
        {...defaultProps}
        persons={[makePerson('Alice', 'p1'), makePerson('Bob', 'p2')]}
      />
    );
    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(2);
  });

  it('renders the timeline rows list', () => {
    render(<CalendarTimeline {...defaultProps} />);
    expect(screen.getByRole('list', { name: 'Timeline rows' })).toBeInTheDocument();
  });

  // An empty calendar is usually an empty trip, so the empty state offers the
  // two things that have to exist before anything can be scheduled.
  it('offers to add guests and rooms from the empty state', async () => {
    const user = userEvent.setup();
    const onAddGuests = vi.fn();
    const onAddRooms = vi.fn();

    render(
      <CalendarTimeline
        {...defaultProps}
        persons={[]}
        onAddGuests={onAddGuests}
        onAddRooms={onAddRooms}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add guests' }));
    await user.click(screen.getByRole('button', { name: 'Add rooms' }));

    expect(onAddGuests).toHaveBeenCalledTimes(1);
    expect(onAddRooms).toHaveBeenCalledTimes(1);
  });

  // Regression: the empty state used to render inside the frame's scrolling
  // canvas, which is as wide as the trip is long (~1450px for 32 days). Its
  // `mx-auto` centred it on that canvas rather than on the screen, so on a
  // phone the message — and, once they existed, both buttons — sat hundreds of
  // pixels off to the right and could not be reached without scrolling.
  it('renders the empty state outside the horizontally scrolling canvas', () => {
    render(
      <CalendarTimeline
        {...defaultProps}
        persons={[]}
        onAddGuests={vi.fn()}
        onAddRooms={vi.fn()}
      />
    );

    // The frame's scroll container is the element carrying the collapse flag.
    const scroller = document.querySelector('[data-labels-collapsed]');
    expect(scroller).not.toBeNull();

    const emptyState = screen.getByRole('status');
    expect(scroller!.contains(emptyState)).toBe(false);

    // Both actions live with it, so they travel out of the canvas too.
    for (const name of ['Add guests', 'Add rooms']) {
      const button = screen.getByRole('button', { name });
      expect(scroller!.contains(button)).toBe(false);
    }
  });

  // `CalendarPage` draws the trip-setup checklist under the frame instead, and
  // two stacked empty states is what this flag exists to avoid.
  it('drops its own empty state when the caller asks it to', () => {
    render(<CalendarTimeline {...defaultProps} persons={[]} hideEmptyState />);
    expect(screen.queryByText('Nothing scheduled yet')).not.toBeInTheDocument();
    // The frame itself still renders — the flag hides the message, not the view.
    expect(screen.getByRole('region', { name: 'Timeline calendar' })).toBeInTheDocument();
  });

  it('keeps the empty state text-only when no handlers are given', () => {
    render(<CalendarTimeline {...defaultProps} persons={[]} />);
    expect(screen.getByText('Nothing scheduled yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add guests' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add rooms' })).not.toBeInTheDocument();
  });

  it('does not offer the empty-state actions once the timeline has content', () => {
    render(
      <CalendarTimeline
        {...defaultProps}
        assignments={[makeAssignment('p1')]}
        onAddGuests={vi.fn()}
        onAddRooms={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Add guests' })).not.toBeInTheDocument();
  });

  it('counts the people on site under each day they are there', () => {
    const alice = {
      ...makePerson('Alice'),
      headcount: 2,
      stayStartDate: '2026-01-06' as ISODateString,
      stayEndDate: '2026-01-08' as ISODateString,
    };
    render(<CalendarTimeline {...defaultProps} persons={[alice]} />);

    expect(screen.queryByTestId('timeline-headcount-2026-01-05')).not.toBeInTheDocument();
    const headcount = screen.getByTestId('timeline-headcount-2026-01-06');
    expect(headcount).toHaveTextContent('2{{count}} people on site');
    expect(headcount).toHaveAttribute('title', '{{count}} people on site');
    expect(headcount).toHaveClass('mt-1', 'text-xs', 'text-muted-foreground');
  });

  it.each([
    ['an arrival', { arrivals: [makeLeg('arrival')] }],
    ['a departure', { departures: [makeLeg('departure')] }],
    ['an activity', { activities: [makeActivity('2026-01-07T10:00:00')] }],
  ])('is not empty when it holds only %s', (_, extra) => {
    render(<CalendarTimeline {...defaultProps} persons={[]} {...extra} />);

    expect(screen.queryByText('Nothing scheduled yet')).not.toBeInTheDocument();
  });

  it('draws the shared agenda under the guests when it can open it', () => {
    render(
      <CalendarTimeline
        {...defaultProps}
        activities={[makeActivity('2026-01-07T10:00:00')]}
        onActivityClick={vi.fn()}
      />,
    );

    expect(screen.getByText('activities.title')).toBeInTheDocument();
    expect(screen.getAllByRole('list', { name: 'Timeline rows' })).toHaveLength(2);
  });

  it('leaves the agenda out when nothing can open it', () => {
    render(
      <CalendarTimeline {...defaultProps} activities={[makeActivity('2026-01-07T10:00:00')]} />,
    );

    expect(screen.queryByText('activities.title')).not.toBeInTheDocument();
  });

  it('widens the axis to reach a leg before the trip', () => {
    render(
      <CalendarTimeline
        {...defaultProps}
        arrivals={[{ ...makeLeg('arrival'), datetime: '2026-01-03T10:00:00' }]}
      />,
    );

    expect(screen.getByRole('button', { name: /Station/ })).toBeInTheDocument();
    expect(screen.getAllByTitle(/Outside the trip dates/).length).toBeGreaterThan(0);
  });

  it('widens the axis to reach a stay after the trip', () => {
    render(
      <CalendarTimeline
        {...defaultProps}
        persons={[]}
        assignments={[
          { ...makeAssignment('p1'), startDate: '2026-01-12' as ISODateString, endDate: '2026-01-14' as ISODateString },
        ]}
        activities={[makeActivity('2026-01-15T10:00:00')]}
        onActivityClick={vi.fn()}
      />,
    );

    expect(screen.getAllByTitle(/Outside the trip dates/).length).toBeGreaterThan(0);
    expect(screen.getByTitle(/Plant fair/)).toBeInTheDocument();
  });

  it('is not empty while a stay is booked, even with no guest rows', () => {
    render(<CalendarTimeline {...defaultProps} persons={[]} assignments={[makeAssignment('p1')]} />);

    expect(screen.queryByText('Nothing scheduled yet')).not.toBeInTheDocument();
  });

  it('is empty for a guest whose stay falls off the axis', () => {
    const gone = {
      ...makePerson('Alice'),
      stayStartDate: '2025-12-01' as ISODateString,
      stayEndDate: '2025-12-05' as ISODateString,
    };
    render(<CalendarTimeline {...defaultProps} persons={[gone]} />);

    expect(screen.getByText('Nothing scheduled yet')).toBeInTheDocument();
  });

  it('names a stay in a room that is gone as unknown', () => {
    render(
      <CalendarTimeline {...defaultProps} rooms={[]} assignments={[makeAssignment('p1')]} />,
    );

    expect(screen.getAllByTitle(/^common\.unknown/).length).toBeGreaterThan(0);
  });

  it('names the line for now and the scrollbar', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(120);
    render(<CalendarTimeline {...defaultProps} />);

    expect(screen.getByTestId('timeline-now-marker')).toHaveAttribute('title', 'Current time');
    expect(screen.getByRole('slider', { name: 'Scroll the timeline' })).toBeInTheDocument();
  });

  it('draws no agenda band when there is no activity', () => {
    render(<CalendarTimeline {...defaultProps} onActivityClick={vi.fn()} />);

    expect(screen.queryByText('activities.title')).not.toBeInTheDocument();
  });

  it('spans the agenda header across the label column and the canvas', () => {
    render(
      <CalendarTimeline
        {...defaultProps}
        activities={[makeActivity('2026-01-07T10:00:00')]}
        onActivityClick={vi.fn()}
      />,
    );

    const canvasWidth = parseFloat(screen.getAllByRole('group')[0]!.style.width);
    expect(screen.getByText('activities.title')).toHaveStyle({ width: `${200 + canvasWidth}px` });
  });

  it('gives each agenda row its own key', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <CalendarTimeline
        {...defaultProps}
        activities={[
          makeActivity('2026-01-07T10:00:00'),
          { ...makeActivity('2026-01-08T10:00:00'), id: 'activity-2' as Activity['id'], category: 'meal' },
        ]}
        onActivityClick={vi.fn()}
      />,
    );

    expect(
      consoleError.mock.calls.filter((call) => String(call[0]).includes('same key')),
    ).toEqual([]);
    consoleError.mockRestore();
  });

  it('redraws when the trip and what is booked on it change', () => {
    const { rerender } = render(<CalendarTimeline {...defaultProps} />);
    expect(screen.queryByTestId('timeline-headcount-2026-01-11')).not.toBeInTheDocument();

    const bob = makePerson('Bob', 'p2');
    rerender(
      <CalendarTimeline
        {...defaultProps}
        trip={{ ...makeTrip(), endDate: '2026-01-12' as ISODateString }}
        persons={[makePerson('Alice'), bob]}
        assignments={[makeAssignment('p1')]}
        arrivals={[{ ...makeLeg('arrival'), datetime: '2026-01-03T10:00:00' }]}
        activities={[makeActivity('2026-01-13T10:00:00')]}
        onActivityClick={vi.fn()}
      />,
    );

    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Station/ })).toBeInTheDocument();
    expect(screen.getByTitle(/Plant fair/)).toBeInTheDocument();
    expect(screen.getByTestId('timeline-headcount-2026-01-11')).toHaveTextContent('2');
    // The 11th is inside the trip now, the 13th, which only the activity needs, is not.
    expect(screen.getByText('11').closest('[data-outside-trip="true"]')).toBeNull();
    expect(screen.getByText('13').closest('[data-outside-trip="true"]')).not.toBeNull();
  });

  it('keys each column by its own day when the axis grows backwards', () => {
    const { rerender } = render(<CalendarTimeline {...defaultProps} />);

    // A leg two days before the trip, for nobody on the guest list: the axis
    // now starts on the 3rd, and Alice is still there from the 5th.
    rerender(
      <CalendarTimeline
        {...defaultProps}
        arrivals={[
          { ...makeLeg('arrival'), personId: 'nobody' as PersonId, datetime: '2026-01-03T10:00:00' },
        ]}
      />,
    );

    const fifth = screen.getByTitle(/^Monday, January 5th, 2026/);
    expect(within(fifth).getByTestId('timeline-headcount-2026-01-05')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-headcount-2026-01-03')).not.toBeInTheDocument();
  });

  it('relabels its columns when the language changes', () => {
    const { rerender } = render(<CalendarTimeline {...defaultProps} />);
    expect(screen.getAllByTitle(/^Monday, January 5th, 2026/).length).toBeGreaterThan(0);

    rerender(<CalendarTimeline {...defaultProps} dateLocale={fr} />);

    expect(screen.getAllByTitle(/^lundi 5 janvier 2026/).length).toBeGreaterThan(0);
  });

  it('offers no zoom and no button back to now', () => {
    render(<CalendarTimeline {...defaultProps} />);

    expect(screen.queryByTestId('timeline-scale-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('timeline-now-button')).not.toBeInTheDocument();
  });
});
