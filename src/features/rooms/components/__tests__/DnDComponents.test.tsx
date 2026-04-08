import { describe, expect, it, vi } from 'vitest';
import { DndContext } from '@dnd-kit/core';
import { render, screen } from '@/test/utils';
import { DroppableAssignment } from '../DroppableAssignment';
import { DraggableRoomAssignment } from '../DraggableRoomAssignment';
import { DraggableGuest } from '../DraggableGuest';
import { DroppableRoom } from '../DroppableRoom';
import type { Person, RoomAssignment } from '@/types';

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

function DndWrapper({ children }: { readonly children: React.ReactNode }) {
  return (
    <DndContext onDragEnd={vi.fn()}>
      {children}
    </DndContext>
  );
}

describe('DroppableAssignment', () => {
  it('renders children', () => {
    render(
      <DndWrapper>
        <DroppableAssignment assignmentId={mockAssignment.id}>
          <span data-testid="child">Content</span>
        </DroppableAssignment>
      </DndWrapper>,
      { withProviders: false },
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
});

describe('DraggableRoomAssignment', () => {
  it('renders label text', () => {
    render(
      <DndWrapper>
        <DraggableRoomAssignment
          assignment={mockAssignment}
          label="Alice"
          color="#3b82f6"
          style={{ top: 0, left: 0, width: '100px', height: '24px' }}
        />
      </DndWrapper>,
      { withProviders: false },
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('has correct aria-label from accessibilityLabel', () => {
    render(
      <DndWrapper>
        <DraggableRoomAssignment
          assignment={mockAssignment}
          label="Alice"
          color="#3b82f6"
          style={{ top: 0, left: 0, width: '100px', height: '24px' }}
          accessibilityLabel="Alice: Apr 1 - Apr 5"
        />
      </DndWrapper>,
      { withProviders: false },
    );
    expect(screen.getByLabelText('Alice: Apr 1 - Apr 5')).toBeInTheDocument();
  });

  it('falls back to label for aria-label when accessibilityLabel is not provided', () => {
    render(
      <DndWrapper>
        <DraggableRoomAssignment
          assignment={mockAssignment}
          label="Alice"
          color="#3b82f6"
          style={{ top: 0, left: 0, width: '100px', height: '24px' }}
        />
      </DndWrapper>,
      { withProviders: false },
    );
    expect(screen.getByLabelText('Alice')).toBeInTheDocument();
  });
});

describe('DraggableGuest', () => {
  it('renders person badge', () => {
    render(
      <DndWrapper>
        <DraggableGuest
          person={mockPerson}
          startDate="2026-04-01"
          endDate="2026-04-05"
        />
      </DndWrapper>,
      { withProviders: false },
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('renders with disabled state', () => {
    render(
      <DndWrapper>
        <DraggableGuest
          person={mockPerson}
          startDate="2026-04-01"
          endDate="2026-04-05"
          disabled
        />
      </DndWrapper>,
      { withProviders: false },
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('renders with custom size', () => {
    render(
      <DndWrapper>
        <DraggableGuest
          person={mockPerson}
          startDate="2026-04-01"
          endDate="2026-04-05"
          size="default"
        />
      </DndWrapper>,
      { withProviders: false },
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });
});

describe('DroppableRoom', () => {
  it('renders children', () => {
    render(
      <DndWrapper>
        <DroppableRoom roomId={'r1' as import('@/types').RoomId}>
          <span data-testid="room-child">Room Content</span>
        </DroppableRoom>
      </DndWrapper>,
      { withProviders: false },
    );
    expect(screen.getByTestId('room-child')).toBeInTheDocument();
  });

  it('renders with custom className', () => {
    const { container } = render(
      <DndWrapper>
        <DroppableRoom roomId={'r1' as import('@/types').RoomId} className="custom-class">
          <span>Room</span>
        </DroppableRoom>
      </DndWrapper>,
      { withProviders: false },
    );
    expect(container.querySelector('.custom-class')).toBeTruthy();
  });

  it('renders with disabled state', () => {
    render(
      <DndWrapper>
        <DroppableRoom roomId={'r1' as import('@/types').RoomId} disabled>
          <span data-testid="disabled-room">Room</span>
        </DroppableRoom>
      </DndWrapper>,
      { withProviders: false },
    );
    expect(screen.getByTestId('disabled-room')).toBeInTheDocument();
  });
});
