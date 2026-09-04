/**
 * Tests for DraggableGuest.
 *
 * @module features/rooms/components/__tests__/DraggableGuest.test
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DraggableGuest } from '../DraggableGuest';
import type { HexColor, Person, PersonId, TripId } from '@/types';

// dnd-kit needs a DndContext; the drag mechanics are not what these assert.
// `attributes` mirrors what the real hook puts on the node — the pill is a
// plain div, so `role`/`tabIndex` coming from dnd-kit is what makes it
// reachable, and a stub that dropped them would hide a regression in that.
vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    attributes: {
      role: 'button',
      tabIndex: 0,
      'aria-disabled': false,
      'aria-roledescription': 'draggable',
    },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  }),
}));

vi.mock('@/components/shared/PersonBadge', () => ({
  PersonBadge: ({ person }: { person: Person }) => (
    <span data-testid="person-badge">{person.name}</span>
  ),
}));

const person: Person = {
  id: 'p1' as PersonId,
  tripId: 'trip-1' as TripId,
  name: 'Marc',
  color: '#ec4899' as HexColor,
};

describe('DraggableGuest', () => {
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

      const bar = screen.getByRole('button', { name: 'Marc' });
      expect(bar).toHaveClass('border-dashed');
      expect(bar).toHaveAttribute('data-unhoused', 'true');
    });

    it('keeps the guest colour on the outline rather than filling with it', () => {
      render(
        <DraggableGuest person={person} startDate="2026-07-01" endDate="2026-07-05" bar />,
      );

      const bar = screen.getByRole('button', { name: 'Marc' });
      expect(bar.style.borderColor).not.toBe('');
      // A wash, not the flat colour — a filled bar would read as booked.
      expect(bar.style.backgroundColor).not.toBe('rgb(236, 72, 153)');
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

      const bar = screen.getByRole('button', { name: 'Marc' });
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
});
