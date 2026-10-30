/**
 * @fileoverview How a room card looks while something is dragged over the board.
 *
 * DnDComponents.test drives the real dnd-kit and asserts what it registers. A
 * real drag cannot be landed over a node in jsdom, whose boxes are all zero,
 * so this file hands the component dnd-kit's answer directly: nothing being
 * dragged, something dragged elsewhere, something dragged over this room.
 *
 * @module features/rooms/components/__tests__/DroppableRoom.test
 */

import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';
import type { RoomId } from '@/types';

const droppable = vi.hoisted(() => ({
  state: { isOver: false, active: null as unknown },
}));

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: vi.fn(), ...droppable.state }),
}));

import { DroppableRoom } from '../DroppableRoom';

function renderRoom(isOver: boolean, active: unknown, disabled = false): HTMLElement {
  droppable.state = { isOver, active };
  render(
    <DroppableRoom roomId={'r1' as RoomId} disabled={disabled} className="extra">
      <span>Attic</span>
    </DroppableRoom>,
    { withProviders: false },
  );
  return screen.getByText('Attic').parentElement!;
}

describe('DroppableRoom', () => {
  it('looks like itself while nothing is dragged', () => {
    const zone = renderRoom(false, null);

    expect(zone).toHaveClass('relative', 'transition-all', 'duration-200', 'extra');
    expect(zone).not.toHaveClass('opacity-80');
    expect(zone).not.toHaveClass('ring-2');
    expect(screen.queryByText('assignments.dropHere')).not.toBeInTheDocument();
  });

  it('steps back while a guest is dragged somewhere else', () => {
    const zone = renderRoom(false, { id: 'guest-1' });

    expect(zone).toHaveClass('opacity-80');
    expect(zone).not.toHaveClass('ring-2');
  });

  it('lights up, and says to drop, while a guest is over it', () => {
    const zone = renderRoom(true, { id: 'guest-1' });

    expect(zone).toHaveClass('ring-2', 'ring-primary', 'ring-offset-2');
    expect(zone).not.toHaveClass('opacity-80');
    const label = screen.getByText('assignments.dropHere');
    const overlay = label.parentElement!;
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(overlay).toHaveClass('absolute', 'inset-0', 'pointer-events-none', 'bg-primary/10', 'flex');
  });

  it('greys out when it takes no drop', () => {
    const zone = renderRoom(false, null, true);

    expect(zone).toHaveClass('opacity-50', 'pointer-events-none');
  });
});
