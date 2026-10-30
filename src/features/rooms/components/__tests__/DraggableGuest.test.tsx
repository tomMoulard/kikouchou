/**
 * Tests for DraggableGuest.
 *
 * @module features/rooms/components/__tests__/DraggableGuest.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { tripDay } from '@/features/rooms/__tests__/fixture-days';
import { DraggableGuest } from '../DraggableGuest';
import type { HexColor, Person, PersonId, RoomId, TripId } from '@/types';

// dnd-kit needs a DndContext; the drag mechanics are not what these assert.
// `attributes` mirrors what the real hook puts on the node — the pill is a
// plain div, so `role`/`tabIndex` coming from dnd-kit is what makes it
// reachable, and a stub that dropped them would hide a regression in that.
//
// The rest of the hook's answer is a test's to set: being dragged, moved by
// some offset, and the listeners dnd-kit's sensors need to see.
const draggable = vi.hoisted(() => ({
  state: {
    isDragging: false,
    transform: null as { x: number; y: number; scaleX: number; scaleY: number } | null,
    listeners: {} as Record<string, unknown>,
  },
}));

vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    attributes: {
      role: 'button',
      tabIndex: 0,
      'aria-disabled': false,
      'aria-roledescription': 'draggable',
    },
    setNodeRef: vi.fn(),
    ...draggable.state,
  }),
}));

// Echoes the interpolated name, which the suite-wide mock drops, so a menu
// label that lost the guest's name reads differently.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      typeof options === 'object' && options !== null && 'name' in options
        ? `${key}:${String((options as { name: unknown }).name)}`
        : key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/components/shared/PersonBadge', () => ({
  PersonBadge: ({ person }: { person: Person }) => (
    <span data-testid="person-badge">{person.name}</span>
  ),
}));

/**
 * The bar drawn around a chip's drag handle.
 *
 * The handle carries the drag and the accessible name; the bar around it
 * carries the shape and the position, and the menu trigger is the handle's
 * sibling inside it — a button nested in the handle's own `role="button"`
 * would not be reliably reachable.
 */
function barAround(handle: HTMLElement): HTMLElement {
  const bar = handle.closest('[data-unhoused="true"]');
  if (!(bar instanceof HTMLElement)) {
    throw new Error('the drag handle is not inside an unhoused bar');
  }
  return bar;
}

const person: Person = {
  id: 'p1' as PersonId,
  tripId: 'trip-1' as TripId,
  name: 'Marc',
  color: '#ec4899' as HexColor,
};

describe('DraggableGuest', () => {
  beforeEach(() => {
    draggable.state = { isDragging: false, transform: null, listeners: {} };
  });
  describe('badge mode', () => {
    it('renders the person badge', () => {
      render(<DraggableGuest person={person} startDate="2026-07-01" endDate="2026-07-05" />);

      expect(screen.getByTestId('person-badge')).toHaveTextContent('Marc');
    });
  });

  describe('bar mode', () => {
    it('names the guest inside the bar', () => {
      render(
        <DraggableGuest person={person} startDate="2026-07-01" endDate="2026-07-05" bar />,
      );

      // The old treatment was an empty dashed box with the name elsewhere.
      expect(screen.getByRole('button', { name: 'Marc' })).toHaveTextContent('Marc');
    });

    // Same shape and place as a booked room's pill so the two read against each
    // other, but an outline rather than a filled block: this guest has no bed,
    // so the bar is a request and not a booking.
    it('draws an outline rather than the solid block a booking gets', () => {
      render(
        <DraggableGuest person={person} startDate="2026-07-01" endDate="2026-07-05" bar />,
      );

      const bar = barAround(screen.getByRole('button', { name: 'Marc' }));
      expect(bar).toHaveClass('border-dashed');
    });

    it('keeps the guest colour on the outline rather than filling with it', () => {
      render(
        <DraggableGuest person={person} startDate="2026-07-01" endDate="2026-07-05" bar />,
      );

      const bar = barAround(screen.getByRole('button', { name: 'Marc' }));
      expect(bar.style.borderColor).not.toBe('');
      // A wash, not the flat colour — a filled bar would read as booked.
      expect(bar.style.backgroundColor).not.toBe('rgb(236, 72, 153)');
      expect(bar.style.backgroundColor).toMatch(/^rgba\(236, 72, 153, 0\.1/);
    });

    it('positions the bar from the style it is handed', () => {
      render(
        <DraggableGuest
          person={person}
          startDate="2026-07-01"
          endDate="2026-07-05"
          bar
          style={{ left: '10px', width: '120px', top: '2px' }}
        />,
      );

      const bar = barAround(screen.getByRole('button', { name: 'Marc' }));
      expect(bar.style.left).toBe('10px');
      expect(bar.style.width).toBe('120px');
    });

    it('does not render a badge in bar mode', () => {
      render(
        <DraggableGuest person={person} startDate="2026-07-01" endDate="2026-07-05" bar />,
      );

      expect(screen.queryByTestId('person-badge')).not.toBeInTheDocument();
    });
  });

  // A drag is the only way to house a guest today, which leaves out every
  // keyboard and every screen reader. The menu is the pointer-free path, and a
  // tap has to reach it too.
  describe('room menu', () => {
    const rooms = [
      { id: 'r1' as RoomId, name: 'Master', availableSpots: 2 },
      { id: 'r2' as RoomId, name: 'Attic', availableSpots: 0 },
    ];

    it('houses the guest in the room picked from the menu', async () => {
      const user = userEvent.setup();
      const onAssignRoom = vi.fn();
      render(
        <DraggableGuest
          person={person}
          startDate="2026-07-01"
          endDate="2026-07-05"
          bar
          assignableRooms={rooms}
          onAssignRoom={onAssignRoom}
        />,
      );

      await user.click(
        screen.getByRole('button', { name: 'rooms.assignMenu.trigger:Marc' }),
      );
      await user.click(screen.getByRole('menuitem', { name: /Master/ }));

      expect(onAssignRoom).toHaveBeenCalledWith('r1');
    });

    it('opens the same menu when the bar itself is tapped', async () => {
      const user = userEvent.setup();
      render(
        <DraggableGuest
          person={person}
          startDate="2026-07-01"
          endDate="2026-07-05"
          bar
          assignableRooms={rooms}
          onAssignRoom={vi.fn()}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Marc' }));

      expect(screen.getByRole('menuitem', { name: /Master/ })).toBeInTheDocument();
    });

    // A drop on a full room is allowed and warned about afterwards, so the menu
    // must not be stricter than the drag it replaces.
    it('offers a full room, marked as full', async () => {
      const user = userEvent.setup();
      render(
        <DraggableGuest
          person={person}
          startDate="2026-07-01"
          endDate="2026-07-05"
          bar
          assignableRooms={rooms}
          onAssignRoom={vi.fn()}
        />,
      );

      await user.click(
        screen.getByRole('button', { name: 'rooms.assignMenu.trigger:Marc' }),
      );
      const attic = screen.getByRole('menuitem', { name: /Attic/ });

      expect(attic).toHaveTextContent('rooms.full');
      expect(attic).not.toHaveAttribute('data-disabled');
    });

    it('shows no menu when there is no room to offer', () => {
      render(
        <DraggableGuest person={person} startDate="2026-07-01" endDate="2026-07-05" bar />,
      );

      expect(
        screen.queryByRole('button', { name: /rooms.assignMenu.trigger/ }),
      ).not.toBeInTheDocument();
    });
  });

  describe('while it is dragged', () => {
    it('follows the pointer, dimmed above the rest, in both shapes', () => {
      draggable.state = {
        isDragging: true,
        transform: { x: 12, y: 4, scaleX: 1, scaleY: 1 },
        listeners: {},
      };
      const { unmount } = render(
        <DraggableGuest person={person} startDate={tripDay(1)} endDate={tripDay(5)} bar />,
      );

      const handle = screen.getByRole('button', { name: 'Marc' });
      const bar = barAround(handle);
      expect(bar.style.transform).toBe('translate3d(12px, 4px, 0)');
      expect(bar).toHaveClass('opacity-60', 'z-50');
      expect(handle).toHaveClass('cursor-grabbing');
      expect(handle).not.toHaveClass('cursor-grab');
      unmount();

      render(<DraggableGuest person={person} startDate={tripDay(1)} endDate={tripDay(5)} />);
      const badge = screen.getByRole('button', { name: 'Marc' }).parentElement!;
      expect(badge.style.transform).toBe('translate3d(12px, 4px, 0)');
      expect(badge).toHaveClass('opacity-50', 'z-50');
    });

    it('offers a grab cursor and no dimming while it rests', () => {
      render(<DraggableGuest person={person} startDate={tripDay(1)} endDate={tripDay(5)} bar />);

      const handle = screen.getByRole('button', { name: 'Marc' });
      expect(handle).toHaveClass(
        'flex',
        'touch-none',
        'focus-visible:ring-2',
        'cursor-grab',
        'active:cursor-grabbing',
      );
      expect(handle).not.toHaveClass('cursor-grabbing');
      const bar = barAround(handle);
      expect(bar).toHaveClass('absolute', 'border-2', 'transition-opacity');
      expect(bar).not.toHaveClass('opacity-60');
      expect(bar).not.toHaveClass('opacity-50');
    });

    it('rests without dimming in badge mode too', () => {
      render(<DraggableGuest person={person} startDate={tripDay(1)} endDate={tripDay(5)} />);

      const badge = screen.getByRole('button', { name: 'Marc' }).parentElement!;
      expect(badge).toHaveClass('inline-flex', 'items-center');
      expect(badge).not.toHaveClass('opacity-50');
      expect(badge.getAttribute('style')).toBeNull();
    });

    it('still lets dnd-kit see the press that starts a drag', () => {
      const onPointerDown = vi.fn();
      draggable.state = { isDragging: false, transform: null, listeners: { onPointerDown } };
      render(<DraggableGuest person={person} startDate={tripDay(1)} endDate={tripDay(5)} bar />);

      fireEvent.pointerDown(screen.getByRole('button', { name: 'Marc' }));

      expect(onPointerDown).toHaveBeenCalledTimes(1);
    });
  });

  describe('when it cannot be dragged', () => {
    it('says so with the cursor and the dimming, in both shapes', () => {
      const { unmount } = render(
        <DraggableGuest
          person={person}
          startDate={tripDay(1)}
          endDate={tripDay(5)}
          bar
          disabled
          assignableRooms={[{ id: 'r1' as RoomId, name: 'Master', availableSpots: 2 }]}
          onAssignRoom={vi.fn()}
        />,
      );

      const handle = screen.getByRole('button', { name: 'Marc' });
      expect(handle).toHaveClass('cursor-not-allowed');
      expect(handle).not.toHaveClass('cursor-grab');
      expect(barAround(handle)).toHaveClass('opacity-50');
      // Nor does it offer the menu a drag would have replaced.
      expect(
        screen.queryByRole('button', { name: /rooms.assignMenu.trigger/ }),
      ).not.toBeInTheDocument();
      unmount();

      render(
        <DraggableGuest person={person} startDate={tripDay(1)} endDate={tripDay(5)} disabled />,
      );
      expect(screen.getByRole('button', { name: 'Marc' }).parentElement).toHaveClass('opacity-50');
    });
  });

  describe('when it has no menu', () => {
    const rooms = [{ id: 'r1' as RoomId, name: 'Master', availableSpots: 2 }];

    it.each([
      ['no room to offer', [], vi.fn()],
      ['no list of rooms', undefined, vi.fn()],
      ['nobody to tell', rooms, undefined],
    ])('shows no trigger with %s, and a tap opens nothing later', async (_name, offered, onAssignRoom) => {
      const user = userEvent.setup();
      const { rerender } = render(
        <DraggableGuest
          person={person}
          startDate={tripDay(1)}
          endDate={tripDay(5)}
          bar
          assignableRooms={offered}
          onAssignRoom={onAssignRoom}
        />,
      );

      expect(
        screen.queryByRole('button', { name: /rooms.assignMenu.trigger/ }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Marc' }));

      rerender(
        <DraggableGuest
          person={person}
          startDate={tripDay(1)}
          endDate={tripDay(5)}
          bar
          assignableRooms={rooms}
          onAssignRoom={vi.fn()}
        />,
      );
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    });

    it('heads its menu with what it does', async () => {
      const user = userEvent.setup();
      render(
        <DraggableGuest
          person={person}
          startDate={tripDay(1)}
          endDate={tripDay(5)}
          bar
          assignableRooms={rooms}
          onAssignRoom={vi.fn()}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Marc' }));

      expect(screen.getByText('rooms.assignMenu.assignHeading')).toBeInTheDocument();
    });
  });
});

describe('DraggableGuest — a press that travelled', () => {
  it('does not open the menu at the end of a drag', () => {
    render(
      <DraggableGuest
        person={person}
        startDate={tripDay(1)}
        endDate={tripDay(5)}
        bar
        assignableRooms={[{ id: 'r1' as RoomId, name: 'Master', availableSpots: 2 }]}
        onAssignRoom={vi.fn()}
      />,
    );
    const handle = screen.getByRole('button', { name: 'Marc' });

    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0 });
    fireEvent.click(handle, { clientX: 60, clientY: 0 });

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });
});
