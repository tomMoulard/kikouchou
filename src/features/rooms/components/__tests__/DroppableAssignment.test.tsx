/**
 * @fileoverview Tests for DroppableAssignment component.
 *
 * This suite used to replace `@dnd-kit/core` with a stub and then assert things
 * that hold for any wrapper at all — `parentElement?.tagName === 'DIV'`,
 * `container.firstChild?.nodeName === 'DIV'`. Deleting the `useDroppable` call
 * from the component and returning a plain `<div>` kept every one of them
 * green, which is the opposite of what a drop-target test is for.
 *
 * The real dnd-kit runs here instead, and the assertions read the registry it
 * keeps: a swap drop is resolved by looking an assignment up in
 * `droppableContainers`, so that registry — id, payload, measured node, and
 * removal on unmount — *is* the component's behaviour.
 *
 * @module features/rooms/components/__tests__/DroppableAssignment.test
 */

import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { DndContext, useDndContext } from '@dnd-kit/core';
import { render, screen } from '@/test/utils';
import { DroppableAssignment } from '../DroppableAssignment';
import type { RoomAssignmentId } from '@/types';

// ============================================================================
// Harness
// ============================================================================

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

function snapshot(): DndSnapshot {
  if (!dnd) {
    throw new Error('DndProbe did not render');
  }
  return dnd;
}

function renderInDnd(children: React.ReactNode): ReturnType<typeof render> {
  dnd = null;
  return render(
    <DndContext>
      <DndProbe />
      {children}
    </DndContext>,
    { withProviders: false },
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('DroppableAssignment', () => {
  it('renders children', () => {
    renderInDnd(
      <DroppableAssignment assignmentId={'a1' as RoomAssignmentId}>
        <span>Child Content</span>
      </DroppableAssignment>,
    );
    expect(screen.getByText('Child Content')).toBeInTheDocument();
  });

  it('renders multiple children', () => {
    renderInDnd(
      <DroppableAssignment assignmentId={'a4' as RoomAssignmentId}>
        <span>First</span>
        <span>Second</span>
      </DroppableAssignment>,
    );
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('registers a drop target under the assignment-scoped id', () => {
    renderInDnd(
      <DroppableAssignment assignmentId={'a1' as RoomAssignmentId}>
        <span>Test</span>
      </DroppableAssignment>,
    );

    // The `assignment-drop-` prefix is what tells the drop handler this is a
    // swap onto an existing booking rather than a drop onto a room row.
    expect([...snapshot().droppableContainers.keys()]).toContain('assignment-drop-a1');
  });

  it('carries the assignment id to the drop handler as data', () => {
    renderInDnd(
      <DroppableAssignment assignmentId={'a1' as RoomAssignmentId}>
        <span>Test</span>
      </DroppableAssignment>,
    );

    expect(snapshot().droppableContainers.get('assignment-drop-a1')?.data.current).toEqual({
      assignmentId: 'a1',
    });
  });

  it('registers the element that wraps the children as the measured node', () => {
    renderInDnd(
      <DroppableAssignment assignmentId={'a3' as RoomAssignmentId}>
        <span data-testid="inner">Inside</span>
      </DroppableAssignment>,
    );

    // dnd-kit hit-tests this node's rect, so an unregistered wrapper is a pill
    // nothing can be dropped on — invisible in the DOM, fatal to the feature.
    const node = snapshot().droppableContainers.get('assignment-drop-a3')?.node.current;
    expect(node).toBe(screen.getByTestId('inner').parentElement);
  });

  it('keeps one target per assignment when several are on screen', () => {
    renderInDnd(
      <>
        <DroppableAssignment assignmentId={'a1' as RoomAssignmentId}>
          <span>One</span>
        </DroppableAssignment>
        <DroppableAssignment assignmentId={'a2' as RoomAssignmentId}>
          <span>Two</span>
        </DroppableAssignment>
      </>,
    );

    const ids = [...snapshot().droppableContainers.keys()];
    expect(ids).toContain('assignment-drop-a1');
    expect(ids).toContain('assignment-drop-a2');
    expect(snapshot().droppableContainers.get('assignment-drop-a2')?.node.current).toBe(
      screen.getByText('Two').parentElement,
    );
  });

  it('unregisters the target when the pill leaves the timeline', () => {
    const { rerender } = renderInDnd(
      <DroppableAssignment assignmentId={'a1' as RoomAssignmentId}>
        <span>Test</span>
      </DroppableAssignment>,
    );
    expect(snapshot().droppableContainers.get('assignment-drop-a1')).toBeDefined();

    // The probe stays mounted so it can report the registry after the pill goes.
    rerender(
      <DndContext>
        <DndProbe />
      </DndContext>,
    );

    // A stale target would keep answering hit tests for a bar that is gone.
    expect(snapshot().droppableContainers.get('assignment-drop-a1')).toBeUndefined();
  });
});
