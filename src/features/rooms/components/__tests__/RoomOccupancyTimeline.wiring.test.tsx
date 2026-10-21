/**
 * @fileoverview What the room timeline hands to its frame and to each bar.
 *
 * The sibling files render the real frame, whose layout depends on a measured
 * width jsdom does not have. Here the frame is a stub that calls the rows with
 * a viewport the test chooses, and the bars, drop zones and off-screen arrows
 * are stubs that keep their props. That makes the geometry readable: how tall
 * a row is, how many free-bed tracks it draws, which column is today, what a
 * pill's label and menu say.
 *
 * @module features/rooms/components/__tests__/RoomOccupancyTimeline.wiring.test
 */

import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { format } from 'date-fns';

import { tripDate, tripDay } from '@/features/rooms/__tests__/fixture-days';
import { renderPlain } from '@/features/rooms/__tests__/harness';
import { act, screen, within } from '@/test/utils';

import type { TripTimelineFrameProps, TripTimelineViewportContext } from '@/components/shared/TripTimelineFrame';
import type { TimelineOffscreenArrowsProps } from '@/components/shared/TimelineOffscreenArrows';
import { getDateLocale } from '@/lib/i18n/date-locale';
import type { ISODateString, Person, PersonId, Room, RoomAssignment, RoomId, Trip } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Trip',
  startDate: tripDay(1),
  endDate: tripDay(10),
  createdAt: 0,
  updatedAt: 0,
};

const RANGE = { startDate: TRIP.startDate, endDate: TRIP.endDate };

const ATTIC: Room = { id: 'r1' as RoomId, tripId: TRIP.id, name: 'Attic', capacity: 3, order: 0 };
const BARN: Room = { id: 'r2' as RoomId, tripId: TRIP.id, name: 'Barn', capacity: 1, order: 1 };

function guest(id: string, name: string, headcount?: number): Person {
  return {
    id: id as PersonId,
    tripId: TRIP.id,
    name,
    color: '#3b82f6' as Person['color'],
    ...(headcount === undefined ? {} : { headcount }),
  };
}

const ALICE = guest('p1', 'Alice');
const BOB = guest('p2', 'Bob');
const COUPLE = guest('p3', 'The Martins', 2);

function stay(id: string, personId: string, roomId: RoomId, start: string, end: string): RoomAssignment {
  return {
    id: id as RoomAssignment['id'],
    tripId: TRIP.id,
    roomId,
    personId: personId as PersonId,
    startDate: start as ISODateString,
    endDate: end as ISODateString,
  };
}

// ============================================================================
// Mocks
// ============================================================================

const seen = vi.hoisted(() => ({
  frame: undefined as unknown,
  viewport: {} as Record<string, unknown>,
  guests: [] as unknown[],
  pills: [] as unknown[],
  drops: [] as unknown[],
  arrows: [] as unknown[],
}));

vi.mock('react-i18next', () => {
  const value = {
    t: (key: string, fallbackOrOptions?: unknown, maybeOptions?: unknown) => {
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions;
      return options && typeof options === 'object' ? `${key} ${JSON.stringify(options)}` : key;
    },
    i18n: { language: 'en' },
  };
  return { useTranslation: () => value };
});

vi.mock('@/components/shared/TripTimelineFrame', () => ({
  TripTimelineFrame: (props: TripTimelineFrameProps): ReactElement => {
    seen.frame = props;
    const columns = (props.columns ?? []).map((column, index) => ({
      ...column,
      isWeekend: index === 5,
    }));
    const viewport = {
      labelColumnWidth: 140,
      labelsCollapsed: false,
      canvasWidth: 400,
      dayCount: props.days.length,
      dayWidthPx: 40,
      useFractionalColumns: false,
      dayGridTemplateColumns: 'repeat(10, 40px)',
      laneHeightPx: 28,
      cellWidthPx: 40,
      todayColumnIndex: 2,
      columns,
      ...seen.viewport,
    } as TripTimelineViewportContext;
    return (
      <div data-testid="frame">
        {props.leftHeader}
        {props.children(viewport)}
      </div>
    );
  },
}));

vi.mock('@/features/rooms/components/DraggableGuest', () => ({
  DraggableGuest: (props: { readonly person: Person }) => {
    seen.guests.push(props);
    return <div data-testid="guest-bar">{props.person.name}</div>;
  },
}));

vi.mock('@/features/rooms/components/DraggableRoomAssignment', () => ({
  DraggableRoomAssignment: (props: { readonly label: string }) => {
    seen.pills.push(props);
    return <div data-testid="pill">{props.label}</div>;
  },
}));

vi.mock('@/features/rooms/components/DroppableRoom', () => ({
  DroppableRoom: (props: { readonly children?: ReactNode; readonly className?: string }) => {
    seen.drops.push(props);
    return <div data-testid="drop-room" className={props.className}>{props.children}</div>;
  },
}));

vi.mock('@/features/rooms/components/DroppableAssignment', () => ({
  DroppableAssignment: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/shared/TimelineOffscreenArrows', () => ({
  TimelineOffscreenArrows: (props: TimelineOffscreenArrowsProps) => {
    seen.arrows.push(props);
    return null;
  },
}));

import { RoomOccupancyTimeline, type RoomOccupancyTimelineProps } from '../RoomOccupancyTimeline';

// ============================================================================
// Helpers
// ============================================================================

function baseProps(overrides: Partial<RoomOccupancyTimelineProps> = {}): RoomOccupancyTimelineProps {
  return {
    trip: TRIP,
    rooms: [ATTIC, BARN],
    assignments: [],
    arrivals: [],
    departures: [],
    persons: [ALICE, BOB, COUPLE],
    dateLocale: getDateLocale('en'),
    range: RANGE,
    todayKey: tripDay(3),
    ...overrides,
  };
}

const frame = (): TripTimelineFrameProps => seen.frame as TripTimelineFrameProps;

/** The rows, room rows and the unhoused one, by their accessible names. */
function rows(): HTMLElement[] {
  return within(screen.getByRole('list', { name: 'rooms.timeline.rows' })).getAllByRole('listitem');
}

function roomRow(name: string): HTMLElement {
  const row = rows().find((item) => item.getAttribute('aria-label')?.startsWith(name));
  expect(row, `no row for ${name}`).toBeDefined();
  return row!;
}

function labelCell(row: HTMLElement): HTMLElement {
  return row.firstElementChild as HTMLElement;
}

function gridCells(row: HTMLElement): HTMLElement[] {
  return [...row.querySelectorAll('.grid > div')] as HTMLElement[];
}

beforeEach(() => {
  seen.frame = undefined;
  seen.viewport = {};
  seen.guests.length = 0;
  seen.pills.length = 0;
  seen.drops.length = 0;
  seen.arrows.length = 0;
});

// ============================================================================
// Tests
// ============================================================================

describe('RoomOccupancyTimeline — the frame', () => {
  it('labels the frame, its clock and its scrollbar', () => {
    const today = tripDate(3, 14, 30);
    renderPlain(<RoomOccupancyTimeline {...baseProps({ today })} />);

    expect(frame().ariaLabel).toBe('rooms.timeline.ariaLabel');
    expect(frame().nowLabel).toBe('common.currentTime');
    expect(frame().scrollbarLabel).toBe('common.scrollTimeline');
    expect(frame().now).toBe(today);
    expect(frame().todayKey).toBe(tripDay(3));
    expect(screen.getByText('rooms.title')).toHaveClass('text-sm', 'font-medium');
  });

  it('reads the clock itself when it is not told the time', () => {
    renderPlain(<RoomOccupancyTimeline {...baseProps()} />);

    expect(frame().now).toBeInstanceOf(Date);
  });

  it('follows every input after the first render', () => {
    const { rerender } = renderPlain(
      <RoomOccupancyTimeline
        {...baseProps({ assignments: [stay('a1', 'p1', ATTIC.id, tripDay(2), tripDay(5))] })}
      />,
    );
    const daysBefore = frame().days.length;

    const renamed = { ...ALICE, name: 'Alicia' };
    rerender(
      <RoomOccupancyTimeline
        {...baseProps({
          range: { startDate: RANGE.startDate, endDate: tripDay(12) },
          rooms: [BARN, ATTIC],
          persons: [renamed, BOB, COUPLE],
          assignments: [
            stay('a1', 'p1', ATTIC.id, tripDay(2), tripDay(5)),
            stay('a2', 'p3', ATTIC.id, tripDay(2), tripDay(5)),
          ],
          unassignedGuests: [{ person: BOB, startDate: tripDay(1), endDate: tripDay(3) }],
          dateLocale: getDateLocale('fr'),
        })}
      />,
    );

    expect(frame().days.length).toBe(daysBefore + 2);
    expect(frame().columns?.[0]?.topLabel).not.toBe('');
    expect(screen.getAllByTestId('pill').map((pill) => pill.textContent)).toContain('Alicia');
    expect(rows().slice(1).map((row) => row.getAttribute('aria-label')?.split('.')[0])).toEqual([
      'Barn',
      'Attic',
    ]);
    expect(screen.getByTestId('guest-bar')).toHaveTextContent('Bob');
    // Three people in a three-bed attic: nothing left on the pill's menu.
    const lastPill = seen.pills.at(-1) as { assignableRooms: { id: string; availableSpots: number }[] };
    expect(lastPill.assignableRooms).toEqual([{ id: BARN.id, name: 'Barn', availableSpots: 1 }]);
    const guestBar = seen.guests.at(-1) as { assignableRooms: { id: string; availableSpots: number }[] };
    expect(guestBar.assignableRooms.find((room) => room.id === ATTIC.id)?.availableSpots).toBe(0);
  });

  it('names a guest the trip no longer knows', () => {
    renderPlain(
      <RoomOccupancyTimeline
        {...baseProps({ assignments: [stay('a1', 'gone', ATTIC.id, tripDay(2), tripDay(5))] })}
      />,
    );

    expect(screen.getByTestId('pill')).toHaveTextContent('common.unknown');
  });
});

describe('RoomOccupancyTimeline — the row of guests with no bed', () => {
  it('draws a bar over the whole window when no single night is listed', () => {
    renderPlain(
      <RoomOccupancyTimeline
        {...baseProps({
          unassignedGuests: [
            { person: BOB, startDate: tripDay(2), endDate: tripDay(4), unassignedDates: [] },
          ],
        })}
      />,
    );

    expect(screen.getByTestId('guest-bar')).toHaveTextContent('Bob');
    const needs = rows()[0]!;
    expect(needs).toHaveAttribute('aria-label', 'rooms.needsRoom');
    const label = labelCell(needs);
    expect(label).toHaveClass('sticky', 'left-0', 'px-3');
    expect(label).toHaveAttribute('title', 'rooms.needsRoom');
    expect(label).toHaveStyle({ height: '28px' });
    const canvas = label.nextElementSibling as HTMLElement;
    expect(canvas).toHaveStyle({ width: '400px', height: '28px' });
  });

  it('skips a window it cannot read, or one off the axis', () => {
    renderPlain(
      <RoomOccupancyTimeline
        {...baseProps({
          unassignedGuests: [
            { person: BOB, startDate: 'garbage', endDate: tripDay(4) },
            { person: ALICE, startDate: tripDay(32), endDate: tripDay(35) },
          ],
        })}
      />,
    );

    expect(screen.queryByTestId('guest-bar')).not.toBeInTheDocument();
  });

  it('centres its icon once the labels fold', () => {
    seen.viewport = { labelsCollapsed: true };
    renderPlain(
      <RoomOccupancyTimeline
        {...baseProps({ unassignedGuests: [{ person: BOB, startDate: tripDay(2), endDate: tripDay(4) }] })}
      />,
    );

    expect(labelCell(rows()[0]!)).toHaveClass('justify-center', 'px-1');
  });

  it('shades weekends, alternate days and today behind the bars', () => {
    renderPlain(
      <RoomOccupancyTimeline
        {...baseProps({ unassignedGuests: [{ person: BOB, startDate: tripDay(2), endDate: tripDay(4) }] })}
      />,
    );

    const cells = gridCells(rows()[0]!);
    expect(cells).toHaveLength(frame().days.length);
    expect(cells[0]).toHaveClass('min-w-0', 'h-full', 'border-r', 'bg-muted/10');
    expect(cells[1]).not.toHaveClass('bg-muted/10');
    expect(cells[2]).toHaveClass('bg-primary/12');
    expect(cells[3]).not.toHaveClass('bg-primary/12');
    expect(cells[5]).toHaveClass('bg-muted/35');
    expect(cells[5]).toHaveAttribute('data-weekend', 'true');
    expect(cells[4]).not.toHaveAttribute('data-weekend');
    expect(cells[0]!.parentElement).toHaveStyle({ gridTemplateColumns: 'repeat(10, 40px)' });
  });

  it('lets the grid size itself when the frame gives no template', () => {
    seen.viewport = { dayGridTemplateColumns: undefined };
    renderPlain(
      <RoomOccupancyTimeline
        {...baseProps({ unassignedGuests: [{ person: BOB, startDate: tripDay(2), endDate: tripDay(4) }] })}
      />,
    );

    for (const row of rows()) {
      expect(gridCells(row)[0]!.parentElement!.getAttribute('style')).toBeNull();
    }
  });
});

describe('RoomOccupancyTimeline — a room row', () => {
  it('stands as tall as its beds and draws a line between them', () => {
    const { container } = renderPlain(<RoomOccupancyTimeline {...baseProps({ rooms: [ATTIC] })} />);

    const row = roomRow('Attic');
    expect(labelCell(row)).toHaveStyle({ height: '84px' });
    const canvas = within(row).getByTestId('drop-room').firstElementChild as HTMLElement;
    expect(canvas).toHaveStyle({ width: '400px', height: '84px' });
    const lines = [...container.querySelectorAll('.border-muted-foreground\\/25')] as HTMLElement[];
    expect(lines.map((line) => line.style.top)).toEqual(['28px', '56px']);
  });

  it('draws no bed line in a single room', () => {
    const { container } = renderPlain(<RoomOccupancyTimeline {...baseProps({ rooms: [BARN] })} />);

    expect(container.querySelectorAll('.border-muted-foreground\\/25')).toHaveLength(0);
  });

  it('draws one free-bed track per bed nobody is in, under the bars', () => {
    renderPlain(
      <RoomOccupancyTimeline
        {...baseProps({
          rooms: [ATTIC],
          assignments: [stay('a1', 'p1', ATTIC.id, tripDay(1), tripDay(10))],
        })}
      />,
    );

    const tracks = within(roomRow('Attic')).getAllByRole('presentation', { hidden: true });
    expect(tracks).toHaveLength(2);
    expect(tracks.map((track) => [track.style.top, track.style.height])).toEqual([
      ['30px', '24px'],
      ['58px', '24px'],
    ]);
    expect(tracks[0]).toHaveAttribute('title', 'rooms.timeline.freeBedHint');
  });

  it('promises no free bed a couple already fills', () => {
    renderPlain(
      <RoomOccupancyTimeline
        {...baseProps({
          rooms: [ATTIC],
          assignments: [stay('a1', 'p3', ATTIC.id, tripDay(1), tripDay(10))],
        })}
      />,
    );

    expect(within(roomRow('Attic')).getAllByRole('presentation', { hidden: true })).toHaveLength(1);
  });

  it('names a full room by its name alone, with no free track', () => {
    renderPlain(
      <RoomOccupancyTimeline
        {...baseProps({
          rooms: [BARN],
          assignments: [stay('a1', 'p1', BARN.id, tripDay(1), tripDay(10))],
        })}
      />,
    );

    const row = roomRow('Barn');
    expect(row).toHaveAttribute('aria-label', 'Barn');
    expect(within(row).queryAllByRole('presentation', { hidden: true })).toHaveLength(0);
    expect(labelCell(row)).toHaveClass('items-center', 'px-3');
    expect(labelCell(row)).not.toHaveClass('flex-col');
  });

  it('stacks the free-bed note under the name, and folds both away', () => {
    const { rerender } = renderPlain(<RoomOccupancyTimeline {...baseProps({ rooms: [ATTIC] })} />);
    expect(labelCell(roomRow('Attic'))).toHaveClass(
      'sticky',
      'left-0',
      'z-10',
      'border-r',
      'flex-col',
      'gap-0.5',
      'py-1',
    );

    seen.viewport = { labelsCollapsed: true };
    rerender(<RoomOccupancyTimeline {...baseProps({ rooms: [ATTIC], todayKey: undefined })} />);
    expect(labelCell(roomRow('Attic'))).toHaveClass('items-center', 'justify-center', 'px-1');
  });

  it('offers the double click only when there is an editor to open', () => {
    const onEditRoom = vi.fn();
    const { rerender } = renderPlain(<RoomOccupancyTimeline {...baseProps({ rooms: [BARN] })} />);
    expect(labelCell(roomRow('Barn'))).not.toHaveClass('cursor-pointer');

    rerender(<RoomOccupancyTimeline {...baseProps({ rooms: [BARN], onEditRoom })} />);
    expect(labelCell(roomRow('Barn'))).toHaveClass('cursor-pointer', 'select-none');
  });

  it('shades the same columns in a room row', () => {
    renderPlain(<RoomOccupancyTimeline {...baseProps({ rooms: [BARN] })} />);

    const cells = gridCells(roomRow('Barn'));
    expect(cells).toHaveLength(frame().days.length);
    expect(cells[0]).toHaveClass('min-w-0', 'h-full', 'bg-muted/10');
    expect(cells[1]).not.toHaveClass('bg-muted/10');
    expect(cells[2]).toHaveClass('bg-primary/12');
    expect(cells[5]).toHaveClass('bg-muted/35');
    expect(cells[5]).toHaveAttribute('data-weekend', 'true');
    expect(cells[0]!.parentElement).toHaveStyle({ gridTemplateColumns: 'repeat(10, 40px)' });
  });
});

describe('RoomOccupancyTimeline — a booked pill', () => {
  it('reads its stay in the trip’s language', () => {
    renderPlain(
      <RoomOccupancyTimeline
        {...baseProps({
          dateLocale: getDateLocale('fr'),
          assignments: [stay('a1', 'p1', ATTIC.id, tripDay(2), tripDay(5))],
        })}
      />,
    );

    const pill = seen.pills.at(-1) as { accessibilityLabel: string };
    expect(pill.accessibilityLabel).toContain(format(tripDate(2), 'MMM d', { locale: getDateLocale('fr') }));
    expect(pill.accessibilityLabel).not.toContain(format(tripDate(2), 'MMM d', { locale: getDateLocale('en') }));
    expect(pill.accessibilityLabel).toContain('"name":"Alice"');
  });

  it('tells the off-screen arrows where each pill sits, and names the room', () => {
    renderPlain(
      <RoomOccupancyTimeline
        {...baseProps({ assignments: [stay('a1', 'p1', ATTIC.id, tripDay(2), tripDay(5))] })}
      />,
    );

    const attic = (seen.arrows as TimelineOffscreenArrowsProps[]).find((props) =>
      props.leftLabel.includes('Attic'),
    )!;
    expect(attic.bounds).toEqual([{ left: 40, right: 160, centre: 100 }]);
    expect(attic.leftLabel).toBe('rooms.timeline.offscreenLeft {"name":"Attic"}');
    expect(attic.rightLabel).toBe('rooms.timeline.offscreenRight {"name":"Attic"}');
  });

  it('moves a stay to another room from the pill’s menu', () => {
    const onMoveAssignmentToRoom = vi.fn();
    const booking = stay('a1', 'p1', ATTIC.id, tripDay(2), tripDay(5));
    renderPlain(<RoomOccupancyTimeline {...baseProps({ assignments: [booking], onMoveAssignmentToRoom })} />);

    const pill = seen.pills.at(-1) as { onAssignRoom: (roomId: RoomId) => void };
    act(() => {
      pill.onAssignRoom(BARN.id);
    });

    expect(onMoveAssignmentToRoom).toHaveBeenCalledWith(booking, BARN.id);
  });
});

describe('RoomOccupancyTimeline — more of what it follows', () => {
  it('keys every day of a range that grew after the first render', () => {
    const { rerender } = renderPlain(<RoomOccupancyTimeline {...baseProps()} />);

    rerender(
      <RoomOccupancyTimeline
        {...baseProps({ range: { startDate: RANGE.startDate, endDate: tripDay(12) } })}
      />,
    );

    expect(frame().dayKeys).toHaveLength(frame().days.length);
    expect(frame().dayKeys.at(-1)).toBe(tripDay(12));
  });

  it('counts a guest who became a couple after the first render', () => {
    const assignments = [stay('a1', 'p1', BARN.id, tripDay(1), tripDay(10))];
    const { rerender } = renderPlain(
      <RoomOccupancyTimeline {...baseProps({ rooms: [ATTIC, BARN], assignments })} />,
    );

    rerender(
      <RoomOccupancyTimeline
        {...baseProps({ rooms: [ATTIC, BARN], assignments, persons: [{ ...ALICE, headcount: 2 }, BOB] })}
      />,
    );

    expect(roomRow('Barn').getAttribute('aria-label')).toContain('rooms.capacityWarning');
  });

  it('shades every other column, not only the first', () => {
    renderPlain(
      <RoomOccupancyTimeline
        {...baseProps({
          rooms: [BARN],
          unassignedGuests: [{ person: BOB, startDate: tripDay(2), endDate: tripDay(4) }],
        })}
      />,
    );

    for (const row of rows()) {
      expect(gridCells(row)[4]).toHaveClass('bg-muted/10');
    }
  });

  it('writes both ends of a stay in the trip’s language', () => {
    renderPlain(
      <RoomOccupancyTimeline
        {...baseProps({
          dateLocale: getDateLocale('fr'),
          assignments: [stay('a1', 'p1', ATTIC.id, tripDay(2), tripDay(5))],
        })}
      />,
    );

    const pill = seen.pills.at(-1) as { accessibilityLabel: string };
    const fr = getDateLocale('fr');
    const en = getDateLocale('en');
    expect(pill.accessibilityLabel).toContain(format(tripDate(2), 'MMM d', { locale: fr }));
    expect(pill.accessibilityLabel).toContain(format(tripDate(5), 'MMM d', { locale: fr }));
    expect(pill.accessibilityLabel).not.toContain(format(tripDate(2), 'MMM d', { locale: en }));
    expect(pill.accessibilityLabel).not.toContain(format(tripDate(5), 'MMM d', { locale: en }));
  });
});

describe('RoomOccupancyTimeline — keys and a moved range', () => {
  it('gives every repeated part of a row its own key', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderPlain(
      <RoomOccupancyTimeline
        {...baseProps({
          rooms: [ATTIC],
          unassignedGuests: [
            { person: BOB, startDate: tripDay(2), endDate: tripDay(4) },
            { person: ALICE, startDate: tripDay(3), endDate: tripDay(6) },
          ],
        })}
      />,
    );

    // Two guest bars, ten shaded columns per row, two bed lines, three free tracks.
    expect(screen.getAllByTestId('guest-bar')).toHaveLength(2);
    const keyWarnings = consoleError.mock.calls.filter((call) =>
      call.some((part) => String(part).includes('same key')),
    );
    expect(keyWarnings).toEqual([]);
  });

  it('keys the days of a range that moved its start', () => {
    const { rerender } = renderPlain(<RoomOccupancyTimeline {...baseProps()} />);

    rerender(
      <RoomOccupancyTimeline {...baseProps({ range: { startDate: tripDay(3), endDate: RANGE.endDate } })} />,
    );

    expect(frame().dayKeys[0]).toBe(tripDay(3));
    expect(frame().columns?.[0]?.dayKey).toBe(tripDay(3));
  });
});
