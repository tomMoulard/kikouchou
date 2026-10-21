import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test/utils';
import { CalendarEventPill } from '../CalendarEventPill';
import type { CalendarEvent } from '../../types';
import type { HexColor, RoomAssignment } from '@/types';

const mockAssignment: RoomAssignment = {
  id: 'a1' as RoomAssignment['id'],
  tripId: 't1' as RoomAssignment['tripId'],
  roomId: 'r1' as RoomAssignment['roomId'],
  personId: 'p1' as RoomAssignment['personId'],
  startDate: '2026-04-01' as RoomAssignment['startDate'],
  endDate: '2026-04-05' as RoomAssignment['endDate'],
};

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    assignment: mockAssignment,
    person: undefined,
    room: undefined,
    label: 'Alice - Room 1',
    color: '#3b82f6' as HexColor,
    textColor: 'white',
    segmentPosition: 'single',
    slotIndex: 0,
    spanId: 'a1',
    totalDays: 5,
    dayOfWeek: 0,
    isRowStart: false,
    isRowEnd: false,
    ...overrides,
  };
}

describe('CalendarEventPill', () => {
  it('renders label for single-day event', () => {
    const onClick = vi.fn();
    render(<CalendarEventPill event={makeEvent()} onClick={onClick} />, { withProviders: false });
    expect(screen.getByText('Alice - Room 1')).toBeInTheDocument();
  });

  it('renders label for start segment', () => {
    const onClick = vi.fn();
    render(
      <CalendarEventPill event={makeEvent({ segmentPosition: 'start' })} onClick={onClick} />,
      { withProviders: false },
    );
    expect(screen.getByText('Alice - Room 1')).toBeInTheDocument();
  });

  it('renders label for end segment', () => {
    const onClick = vi.fn();
    render(
      <CalendarEventPill event={makeEvent({ segmentPosition: 'end' })} onClick={onClick} />,
      { withProviders: false },
    );
    expect(screen.getByText('Alice - Room 1')).toBeInTheDocument();
  });

  it('renders non-breaking space for middle segment', () => {
    const onClick = vi.fn();
    render(
      <CalendarEventPill event={makeEvent({ segmentPosition: 'middle', isRowStart: false })} onClick={onClick} />,
      { withProviders: false },
    );
    // Middle segment shows non-breaking space (\u00A0) instead of label
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('\u00A0');
  });

  it('renders label for middle segment that is also row start (week continuation)', () => {
    const onClick = vi.fn();
    render(
      <CalendarEventPill event={makeEvent({ segmentPosition: 'middle', isRowStart: true })} onClick={onClick} />,
      { withProviders: false },
    );
    expect(screen.getByText('Alice - Room 1')).toBeInTheDocument();
  });

  it('calls onClick with assignment when clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<CalendarEventPill event={makeEvent()} onClick={onClick} />, { withProviders: false });
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledWith(mockAssignment);
  });

  it('calls onClick with assignment on Enter key', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<CalendarEventPill event={makeEvent()} onClick={onClick} />, { withProviders: false });
    const button = screen.getByRole('button');
    button.focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledWith(mockAssignment);
  });

  it('calls onClick with assignment on Space key', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<CalendarEventPill event={makeEvent()} onClick={onClick} />, { withProviders: false });
    const button = screen.getByRole('button');
    button.focus();
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledWith(mockAssignment);
  });

  it('has correct aria-label and title', () => {
    const onClick = vi.fn();
    render(<CalendarEventPill event={makeEvent()} onClick={onClick} />, { withProviders: false });
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', 'Alice - Room 1');
    expect(button).toHaveAttribute('title', 'Alice - Room 1');
  });

  it('applies background color from event', () => {
    const onClick = vi.fn();
    render(
      <CalendarEventPill event={makeEvent({ color: '#ff0000' as HexColor, textColor: 'black' })} onClick={onClick} />,
      { withProviders: false },
    );
    const button = screen.getByRole('button');
    expect(button.style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(button.style.color).toMatch(/^(rgb\(0, 0, 0\)|black)$/);
  });

  it('is a full-width, touch-sized pill', () => {
    render(<CalendarEventPill event={makeEvent()} onClick={vi.fn()} />, { withProviders: false });

    expect(screen.getByRole('button')).toHaveClass(
      'w-full',
      'text-left',
      'text-xs',
      'truncate',
      'min-h-[44px]',
      'cursor-pointer',
      'focus-visible:ring-2',
    );
  });

  // How a stay reads as one bar across several cells: rounded at its two ends
  // and at the week edges, and pulled one pixel over the grid gap everywhere
  // else.
  it.each([
    ['a one-night stay', { segmentPosition: 'single' }, 'rounded', ['-ml-px', '-mr-px'], []],
    ['its first night', { segmentPosition: 'start' }, 'rounded-l', ['-mr-px'], ['-ml-px']],
    ['its last night', { segmentPosition: 'end' }, 'rounded-r', ['-ml-px'], ['-mr-px']],
    ['a night in between', { segmentPosition: 'middle' }, 'rounded-none', ['-ml-px', '-mr-px'], []],
    [
      'a Monday in between',
      { segmentPosition: 'middle', isRowStart: true },
      'rounded-l',
      ['-mr-px'],
      ['-ml-px'],
    ],
    [
      'a Sunday in between',
      { segmentPosition: 'middle', isRowEnd: true },
      'rounded-r',
      ['-ml-px'],
      ['-mr-px'],
    ],
    [
      'a first night on a Sunday',
      { segmentPosition: 'start', isRowEnd: true },
      'rounded',
      [],
      ['-ml-px', '-mr-px'],
    ],
    [
      'a first night on a Monday',
      { segmentPosition: 'start', isRowStart: true },
      'rounded-l',
      ['-mr-px'],
      ['-ml-px'],
    ],
    [
      'a last night on a Sunday',
      { segmentPosition: 'end', isRowEnd: true },
      'rounded-r',
      ['-ml-px'],
      ['-mr-px'],
    ],
  ] as const)('shapes %s', (_, overrides, radius, margins, noMargins) => {
    render(<CalendarEventPill event={makeEvent(overrides)} onClick={vi.fn()} />, {
      withProviders: false,
    });

    const pill = screen.getByRole('button');
    expect(pill).toHaveClass(radius, ...margins);
    for (const margin of noMargins) {
      expect(pill).not.toHaveClass(margin);
    }
  });

  it.each(['Enter', ' '])('opens the stay once on the %j key, and claims the key', (key) => {
    const onClick = vi.fn();
    render(<CalendarEventPill event={makeEvent()} onClick={onClick} />, { withProviders: false });

    expect(fireEvent.keyDown(screen.getByRole('button'), { key })).toBe(false);
    expect(onClick).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledWith(mockAssignment);
  });

  it('fades on hover', () => {
    render(<CalendarEventPill event={makeEvent()} onClick={vi.fn()} />, { withProviders: false });

    expect(screen.getByRole('button')).toHaveClass('transition-opacity', 'hover:opacity-80');
  });

  it('opens the stay it now shows, with the handler it was last given', () => {
    const first = vi.fn();
    const second = vi.fn();
    const moved = { ...mockAssignment, id: 'a2' as RoomAssignment['id'] };
    const { rerender } = render(<CalendarEventPill event={makeEvent()} onClick={first} />, {
      withProviders: false,
    });

    rerender(<CalendarEventPill event={makeEvent({ assignment: moved })} onClick={second} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Enter' });

    expect(second).toHaveBeenNthCalledWith(1, moved);
    expect(second).toHaveBeenNthCalledWith(2, moved);
    expect(first).not.toHaveBeenCalled();
  });

  it('leaves every other key to the browser', () => {
    const onClick = vi.fn();
    render(<CalendarEventPill event={makeEvent()} onClick={onClick} />, { withProviders: false });

    expect(fireEvent.keyDown(screen.getByRole('button'), { key: 'a' })).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
  });
});
