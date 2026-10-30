/**
 * @fileoverview Droppable assignment target for swap operations.
 *
 * @module features/rooms/components/DroppableAssignment
 */

import { type ReactElement, type ReactNode, memo } from 'react';
import { useDroppable } from '@dnd-kit/core';

import type { RoomAssignmentId } from '@/types';

export interface DroppableAssignmentData {
  readonly assignmentId: RoomAssignmentId;
}

interface DroppableAssignmentProps {
  readonly assignmentId: RoomAssignmentId;
  readonly children: ReactNode;
}

const DroppableAssignment = memo(function DroppableAssignment({
  assignmentId,
  children,
}: DroppableAssignmentProps): ReactElement {
  const droppableId = `assignment-drop-${assignmentId}`;
  const { setNodeRef } = useDroppable({
    id: droppableId,
    data: { assignmentId } satisfies DroppableAssignmentData,
  });

  return <div ref={setNodeRef}>{children}</div>;
});

export { DroppableAssignment };

