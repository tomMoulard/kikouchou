/**
 * @fileoverview Tests for the room drag-and-drop wrappers.
 *
 * These components exist only to register a node with dnd-kit and to carry a
 * payload to the drop handler, so "it rendered its children" says almost
 * nothing about them: the previous version of this suite asserted the guest's
 * name was on screen for the default, the disabled and the custom-size cases —
 * the same assertion three times — and every one of them stayed green with the
 * `disabled` and `size` props deleted from the components.
 *
 * What is asserted here instead is the contract dnd-kit itself sees: the id a
 * node is registered under, the data it carries into `onDragEnd`, whether the
 * drop target is disabled, and whether a pointer press actually starts a drag.
 *
 * @module features/rooms/components/__tests__/DnDComponents.test
 */

import { describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { DndContext, useDndContext } from '@dnd-kit/core';
import { fireEvent, render, screen } from '@/test/utils';
import { DroppableAssignment } from '../DroppableAssignment';
import { DraggableRoomAssignment } from '../DraggableRoomAssignment';
import { DraggableGuest } from '../DraggableGuest';
import { DroppableRoom } from '../DroppableRoom';
import type { Person, RoomAssignment, RoomId } from '@/types';

const mockAssignment: RoomAssignment = {
  id: 'a1' as RoomAssignment['id'],
  tripId: 't1' as RoomAssignment['tripId'],
  roomId: 'r1' as RoomAssignment['roomId'],
  personId: 'p1' as RoomAssignment['personId'],
  startDate: '2026-04-01' as RoomAssignment['startDate'],
  endDate: '2026-04-05' as RoomAssignment['endDate'],
};

const mockPerson: Person = {
  id: 'p1' as Person['id'],
  tripId: 't1' as Person['tripId'],
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
};

const ROOM_ID = 'r1' as RoomId;

// ============================================================================
// Harness
// ============================================================================

/**
 * dnd-kit's own view of the tree: which nodes are registered, under which ids,
 * with which payloads. Reading it is the only way to tell a component that
 * calls `useDraggable`/`useDroppable` from one that just renders a `<div>`.
 */
type DndSnapshot = ReturnType<typeof useDndContext>;

let dnd: DndSnapshot | null = null;

function DndProbe(): null {
  // Captured in an effect rather than during render: the lint rules rightly
  // treat writing to an outer binding while rendering as a side effect.
  const context = useDndContext();
  useEffect(() => {
    dnd = context;
  });
  return null;
}

/** The probe's snapshot, asserted non-null so tests read straightforwardly. */
function snapshot(): DndSnapshot {
  if (!dnd) {
    throw new Error('DndProbe did not render');
  }
  return dnd;
}

function renderInDnd(
  children: React.ReactNode,
  onDragStart?: (event: unknown) => void,
): ReturnType<typeof render> {
  dnd = null;
  return render(
    <DndContext onDragEnd={vi.fn()} onDragStart={onDragStart as never}>
      <DndProbe />
      {children}
    </DndContext>,
    { withProviders: false },
  );
}

/** A primary left-button press — what the pointer sensor listens for. */
function pressPointer(element: Element): void {
  fireEvent.pointerDown(element, {
    button: 0,
    isPrimary: true,
    clientX: 0,
    clientY: 0,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('DroppableAssignment', () => {
  it('renders children', () => {
    renderInDnd(
      <DroppableAssignment assignmentId={mockAssignment.id}>
        <span data-testid="child">Content</span>
      </DroppableAssignment>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('registers the wrapper as a drop target carrying the assignment id', () => {
    renderInDnd(
      <DroppableAssignment assignmentId={mockAssignment.id}>
        <span data-testid="child">Content</span>
      </DroppableAssignment>,
    );

    const target = snapshot().droppableContainers.get('assignment-drop-a1');
    expect(target).toBeDefined();
    expect(target?.data.current).toEqual({ assignmentId: 'a1' });
    // The registered node must be the element wrapping the children, not some
    // detached div: a swap drop is resolved by hit-testing that rect.
    expect(target?.node.current).toBe(screen.getByTestId('child').parentElement);
  });
});

describe('DraggableRoomAssignment', () => {
  it('renders label text', () => {
    renderInDnd(
      <DraggableRoomAssignment
        assignment={mockAssignment}
        label="Alice"
        color="#3b82f6"
        style={{ top: 0, left: 0, width: '100px', height: '24px' }}
      />,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('has correct aria-label from accessibilityLabel', () => {
    renderInDnd(
      <DraggableRoomAssignment
        assignment={mockAssignment}
        label="Alice"
        color="#3b82f6"
        style={{ top: 0, left: 0, width: '100px', height: '24px' }}
        accessibilityLabel="Alice: Apr 1 - Apr 5"
      />,
    );
    expect(screen.getByLabelText('Alice: Apr 1 - Apr 5')).toBeInTheDocument();
  });

  it('falls back to label for aria-label when accessibilityLabel is not provided', () => {
    renderInDnd(
      <DraggableRoomAssignment
        assignment={mockAssignment}
        label="Alice"
        color="#3b82f6"
        style={{ top: 0, left: 0, width: '100px', height: '24px' }}
      />,
    );
    expect(screen.getByLabelText('Alice')).toBeInTheDocument();
  });

  it('registers the pill as a draggable carrying the whole assignment', () => {
    renderInDnd(
      <DraggableRoomAssignment
        assignment={mockAssignment}
        label="Alice"
        color="#3b82f6"
        style={{ top: 0, left: 0, width: '100px', height: '24px' }}
      />,
    );

    const node = snapshot().draggableNodes.get('assignment-a1');
    expect(node).toBeDefined();
    // The drop handler moves *this* assignment, so the payload has to be it.
    expect(node?.data.current).toEqual({ assignment: mockAssignment });
    expect(node?.node.current).toBe(screen.getByLabelText('Alice'));
  });
});

describe('DraggableGuest', () => {
  it('renders person badge', () => {
    renderInDnd(
      <DraggableGuest person={mockPerson} startDate="2026-04-01" endDate="2026-04-05" />,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('registers the guest as a draggable carrying the stay window to pre-fill', () => {
    renderInDnd(
      <DraggableGuest person={mockPerson} startDate="2026-04-01" endDate="2026-04-05" />,
    );

    // Found by walking the registry rather than by its id string: the payload
    // is what this asserts, and the id's shape is free to change.
    const nodes = [...snapshot().draggableNodes.values()];
    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    // These three fields become the quick-assign dialog's pre-filled dates.
    expect(node?.data.current).toEqual({
      person: mockPerson,
      startDate: '2026-04-01',
      endDate: '2026-04-05',
    });
    expect(node?.node.current).toBe(screen.getByRole('button', { name: 'Alice' }));
  });

  // A guest housed for only part of their stay gets one bar per gap. Keyed on
  // the person alone, both bars registered under one id and dragging either
  // picked up whichever dnd-kit had kept.
  it('registers one draggable per gap for a partially housed guest', () => {
    renderInDnd(
      <>
        <DraggableGuest person={mockPerson} startDate="2026-04-01" endDate="2026-04-03" bar />
        <DraggableGuest person={mockPerson} startDate="2026-04-06" endDate="2026-04-08" bar />
      </>,
    );

    const nodes = [...snapshot().draggableNodes.values()];
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => (n?.data.current as { startDate: string }).startDate)).toEqual([
      '2026-04-01',
      '2026-04-06',
    ]);
  });

  it('starts a drag on a pointer press', () => {
    const onDragStart = vi.fn();
    renderInDnd(
      <DraggableGuest person={mockPerson} startDate="2026-04-01" endDate="2026-04-05" />,
      onDragStart,
    );

    pressPointer(screen.getByRole('button', { name: 'Alice' }));

    expect(onDragStart).toHaveBeenCalledTimes(1);
  });

  it('refuses to start a drag when disabled', () => {
    const onDragStart = vi.fn();
    renderInDnd(
      <DraggableGuest
        person={mockPerson}
        startDate="2026-04-01"
        endDate="2026-04-05"
        disabled
      />,
      onDragStart,
    );

    const handle = screen.getByRole('button', { name: 'Alice' });
    // dnd-kit withholds the activator listeners entirely when disabled, so the
    // press must not reach a sensor.
    pressPointer(handle);

    expect(onDragStart).not.toHaveBeenCalled();
    expect(handle).toHaveAttribute('aria-disabled', 'true');
    expect(handle).toHaveClass('cursor-not-allowed');
    expect(handle).not.toHaveClass('cursor-grab');
  });

  it('renders the compact badge by default', () => {
    renderInDnd(
      <DraggableGuest person={mockPerson} startDate="2026-04-01" endDate="2026-04-05" />,
    );
    // `sm` is what the timeline's cramped left column needs.
    expect(screen.getByText('Alice')).toHaveClass('text-xs');
  });

  it('renders the larger badge when size="default" is asked for', () => {
    renderInDnd(
      <DraggableGuest
        person={mockPerson}
        startDate="2026-04-01"
        endDate="2026-04-05"
        size="default"
      />,
    );
    expect(screen.getByText('Alice')).toHaveClass('text-sm');
    expect(screen.getByText('Alice')).not.toHaveClass('text-xs');
  });
});

describe('DroppableRoom', () => {
  it('renders children', () => {
    renderInDnd(
      <DroppableRoom roomId={ROOM_ID}>
        <span data-testid="room-child">Room Content</span>
      </DroppableRoom>,
    );
    expect(screen.getByTestId('room-child')).toBeInTheDocument();
  });

  it('registers the room as an enabled drop target carrying its id', () => {
    renderInDnd(
      <DroppableRoom roomId={ROOM_ID}>
        <span data-testid="room-child">Room</span>
      </DroppableRoom>,
    );

    const target = snapshot().droppableContainers.get('room-r1');
    expect(target).toBeDefined();
    expect(target?.data.current).toEqual({ roomId: 'r1' });
    expect(target?.disabled).toBe(false);
    expect(target?.node.current).toBe(screen.getByTestId('room-child').parentElement);
  });

  it('puts a custom className on the registered drop node', () => {
    renderInDnd(
      <DroppableRoom roomId={ROOM_ID} className="custom-class">
        <span data-testid="room-child">Room</span>
      </DroppableRoom>,
    );

    // Not just "some element on the page has the class" — the class has to land
    // on the node dnd-kit measures, because that is what gets the ring styles.
    expect(snapshot().droppableContainers.get('room-r1')?.node.current).toHaveClass(
      'custom-class',
    );
  });

  it('registers a disabled room as a disabled drop target', () => {
    renderInDnd(
      <DroppableRoom roomId={ROOM_ID} disabled>
        <span data-testid="disabled-room">Room</span>
      </DroppableRoom>,
    );

    const target = snapshot().droppableContainers.get('room-r1');
    // A disabled target is skipped by collision detection, so a guest dropped
    // on it lands nowhere rather than being assigned to a locked room.
    expect(target?.disabled).toBe(true);
    expect(target?.node.current).toHaveClass('pointer-events-none');
    expect(target?.node.current).toHaveClass('opacity-50');
  });
});
