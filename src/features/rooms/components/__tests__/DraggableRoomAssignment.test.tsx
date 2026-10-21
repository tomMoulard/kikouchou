/**
 * @fileoverview A housed guest's pill on the room timeline.
 *
 * DnDComponents.test drives the real dnd-kit for the id and the payload. This
 * file hands the pill dnd-kit's state directly, being dragged or not and
 * moved by some offset, and checks what the pill draws and when its room
 * menu is there to open.
 *
 * @module features/rooms/components/__tests__/DraggableRoomAssignment.test
 */

import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { tripDay } from '@/features/rooms/__tests__/fixture-days';
import { fireEvent, render, screen } from '@/test/utils';
import type { RoomAssignment, RoomId } from '@/types';

const draggable = vi.hoisted(() => ({
  state: {
    isDragging: false,
    transform: null as { x: number; y: number; scaleX: number; scaleY: number } | null,
    listeners: {} as Record<string, unknown>,
  },
}));

vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    attributes: { role: 'button', tabIndex: 0 },
    setNodeRef: vi.fn(),
    ...draggable.state,
  }),
}));

// Echoes the interpolated name, which the suite-wide mock drops.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      typeof options === 'object' && options !== null && 'name' in options
        ? `${key}:${String((options as { name: unknown }).name)}`
        : key,
    i18n: { language: 'en' },
  }),
}));

import { DraggableRoomAssignment } from '../DraggableRoomAssignment';

const STAY: RoomAssignment = {
  id: 'a1' as RoomAssignment['id'],
  tripId: 't1' as RoomAssignment['tripId'],
  roomId: 'r1' as RoomId,
  personId: 'p1' as RoomAssignment['personId'],
  startDate: tripDay(2),
  endDate: tripDay(5),
};

const ROOMS = [{ id: 'r2' as RoomId, name: 'Barn', availableSpots: 1 }];

function reset(patch: Partial<typeof draggable.state> = {}): void {
  draggable.state = { isDragging: false, transform: null, listeners: {}, ...patch };
}

function pill(): HTMLElement {
  return screen.getByRole('button', { name: /Alice/ }).parentElement!;
}

describe('DraggableRoomAssignment', () => {
  it('fills the pill with the guest colour, at its place, in white', () => {
    reset();
    render(
      <DraggableRoomAssignment
        assignment={STAY}
        label="Alice"
        color="#3b82f6"
        style={{ left: '10px', width: '80px' }}
      />,
      { withProviders: false },
    );

    const bar = pill();
    expect(bar.style.left).toBe('10px');
    expect(bar.style.backgroundColor).toBe('rgb(59, 130, 246)');
    expect(bar.style.color).toBe('white');
    expect(bar.style.transform).toBe('');
    expect(bar).toHaveClass('absolute', 'flex', 'rounded-md', 'transition-opacity');
    expect(bar).not.toHaveClass('opacity-60');
    expect(screen.getByRole('button', { name: 'Alice' })).toHaveClass(
      'touch-none',
      'focus-visible:ring-2',
      'cursor-grab',
    );
  });

  it('follows the pointer, dimmed, while it is dragged', () => {
    reset({ isDragging: true, transform: { x: 12, y: 4, scaleX: 1, scaleY: 1 } });
    render(<DraggableRoomAssignment assignment={STAY} label="Alice" color="#3b82f6" style={{}} />, {
      withProviders: false,
    });

    expect(pill().style.transform).toBe('translate3d(12px, 4px, 0)');
    expect(pill()).toHaveClass('opacity-60');
    expect(screen.getByRole('button', { name: 'Alice' })).toHaveClass('cursor-grabbing');
    expect(screen.getByRole('button', { name: 'Alice' })).not.toHaveClass('cursor-grab');
  });

  it('prefers the longer label for its title and its name', () => {
    reset();
    render(
      <DraggableRoomAssignment
        assignment={STAY}
        label="Alice"
        accessibilityLabel="Alice, 2 to 5 July"
        color="#3b82f6"
        style={{}}
      />,
      { withProviders: false },
    );

    expect(screen.getByRole('button', { name: 'Alice, 2 to 5 July' })).toBeInTheDocument();
    expect(pill()).toHaveAttribute('title', 'Alice, 2 to 5 July');
  });

  it('falls back on the short label for its title', () => {
    reset();
    render(<DraggableRoomAssignment assignment={STAY} label="Alice" color="#3b82f6" style={{}} />, {
      withProviders: false,
    });

    expect(pill()).toHaveAttribute('title', 'Alice');
  });

  it('still lets dnd-kit see the press that starts a drag', () => {
    const onPointerDown = vi.fn();
    reset({ listeners: { onPointerDown } });
    render(
      <DraggableRoomAssignment
        assignment={STAY}
        label="Alice"
        color="#3b82f6"
        style={{}}
        assignableRooms={ROOMS}
        onAssignRoom={vi.fn()}
      />,
      { withProviders: false },
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Alice' }));

    expect(onPointerDown).toHaveBeenCalledTimes(1);
  });

  it('opens its menu on a tap, named for the guest, and moves them', async () => {
    reset();
    const onAssignRoom = vi.fn();
    const user = userEvent.setup();
    render(
      <DraggableRoomAssignment
        assignment={STAY}
        label="Alice"
        color="#3b82f6"
        style={{}}
        assignableRooms={ROOMS}
        onAssignRoom={onAssignRoom}
      />,
      { withProviders: false },
    );

    expect(
      screen.getByRole('button', { name: 'rooms.assignMenu.moveTrigger:Alice' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Alice' }));
    expect(screen.getByText('rooms.assignMenu.moveHeading')).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: /Barn/ }));

    expect(onAssignRoom).toHaveBeenCalledWith('r2');
  });

  it.each([
    ['no room to move to', [], vi.fn()],
    ['no list of rooms', undefined, vi.fn()],
    ['nobody to tell', ROOMS, undefined],
  ])('has no menu with %s, and a tap opens none', async (_name, rooms, onAssignRoom) => {
    reset();
    const user = userEvent.setup();
    const { rerender } = render(
      <DraggableRoomAssignment
        assignment={STAY}
        label="Alice"
        color="#3b82f6"
        style={{}}
        assignableRooms={rooms}
        onAssignRoom={onAssignRoom}
      />,
      { withProviders: false },
    );

    expect(screen.queryByRole('button', { name: /moveTrigger/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Alice' }));

    // Given a menu afterwards, it must not spring open from that old tap.
    rerender(
      <DraggableRoomAssignment
        assignment={STAY}
        label="Alice"
        color="#3b82f6"
        style={{}}
        assignableRooms={ROOMS}
        onAssignRoom={vi.fn()}
      />,
    );
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });
});

describe('DraggableRoomAssignment — a press that travelled', () => {
  it('does not open the menu at the end of a drag', () => {
    reset();
    render(
      <DraggableRoomAssignment
        assignment={STAY}
        label="Alice"
        color="#3b82f6"
        style={{}}
        assignableRooms={ROOMS}
        onAssignRoom={vi.fn()}
      />,
      { withProviders: false },
    );
    const handle = screen.getByRole('button', { name: 'Alice' });

    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0 });
    fireEvent.click(handle, { clientX: 60, clientY: 0 });

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });
});
