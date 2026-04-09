/**
 * @fileoverview Tests for DroppableAssignment component.
 * @module features/rooms/components/__tests__/DroppableAssignment.test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DroppableAssignment } from '../DroppableAssignment';
import type { RoomAssignmentId } from '@/types';

// ============================================================================
// Mocks
// ============================================================================

const mockSetNodeRef = vi.fn() as ReturnType<typeof vi.fn> & { _lastArgs?: unknown };
vi.mock('@dnd-kit/core', () => ({
  useDroppable: vi.fn((args: { id: string; data: unknown }) => {
    // Store the last call args for assertions
    mockSetNodeRef._lastArgs = args;
    return {
      setNodeRef: mockSetNodeRef,
      isOver: false,
      active: null,
      over: null,
    };
  }),
}));

// ============================================================================
// Tests
// ============================================================================

describe('DroppableAssignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children', () => {
    render(
      <DroppableAssignment assignmentId={'a1' as RoomAssignmentId}>
        <span>Child Content</span>
      </DroppableAssignment>
    );
    expect(screen.getByText('Child Content')).toBeInTheDocument();
  });

  it('creates a droppable with correct id format', async () => {
    const { useDroppable } = await import('@dnd-kit/core');

    render(
      <DroppableAssignment assignmentId={'a1' as RoomAssignmentId}>
        <span>Test</span>
      </DroppableAssignment>
    );

    expect(useDroppable).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assignment-drop-a1',
        data: { assignmentId: 'a1' },
      })
    );
  });

  it('passes setNodeRef to the wrapper div', () => {
    render(
      <DroppableAssignment assignmentId={'a2' as RoomAssignmentId}>
        <span>Wrapper test</span>
      </DroppableAssignment>
    );

    // The setNodeRef should have been called with the div element
    expect(mockSetNodeRef).toHaveBeenCalled();
  });

  it('wraps children in a div element', () => {
    const { container } = render(
      <DroppableAssignment assignmentId={'a3' as RoomAssignmentId}>
        <span data-testid="inner">Inside</span>
      </DroppableAssignment>
    );

    const inner = screen.getByTestId('inner');
    expect(inner.parentElement?.tagName).toBe('DIV');
    expect(container.firstChild?.nodeName).toBe('DIV');
  });

  it('renders multiple children', () => {
    render(
      <DroppableAssignment assignmentId={'a4' as RoomAssignmentId}>
        <span>First</span>
        <span>Second</span>
      </DroppableAssignment>
    );
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });
});
