/**
 * @fileoverview Screen reader announcements for the room drag-and-drop board.
 *
 * dnd-kit announces every drag through a live region, and its default text is
 * built from the ids it was given: "Draggable item
 * guest-FH7oeUECm-gDUQzg5teEh-2026-09-11-2026-09-13 was dropped over droppable
 * area room-orvCHpZ2fFihDg9IxNikQ". Those ids exist for dnd-kit, not for the
 * person listening, so this module turns each drag event into the same fact the
 * sighted user reads off the board: who moved, which room received them, and
 * how much room is left there.
 *
 * The builders are pure and take their facts as parameters, so the wording, the
 * plural forms and the French catalogue can be asserted without rendering the
 * page or simulating a pointer.
 *
 * @module features/rooms/utils/dnd-announcements
 */

import type { Announcements } from '@dnd-kit/core';

import type { DraggableGuestData } from '@/features/rooms/components/DraggableGuest';
import type { DraggableRoomAssignmentData } from '@/features/rooms/components/DraggableRoomAssignment';
import type { DroppableAssignmentData } from '@/features/rooms/components/DroppableAssignment';
import type { DroppableRoomData } from '@/features/rooms/components/DroppableRoom';
import type { HeadcountResolver } from '@/features/rooms/utils/capacity-utils';
import type { PersonId, RoomAssignment, RoomId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * The `t` the announcements speak through.
 *
 * Declared here rather than imported from i18next so this module can be called
 * with any resolver, including the one a test builds.
 */
export type AnnouncementTranslator = (key: string, options?: Record<string, unknown>) => string;

/**
 * A drop target, as the announcements need to describe it.
 */
export interface DragAnnouncementRoom {
  /** The room ID */
  readonly id: RoomId;
  /** The name the user reads on the card */
  readonly name: string;
  /** Free spots **before** the dragged guest lands */
  readonly availableSpots: number;
}

/**
 * Everything the announcements need to name people and rooms.
 */
export interface RoomDragAnnouncementContext {
  /** Translator for the `assignments.dragAnnouncements.*` keys */
  readonly t: AnnouncementTranslator;
  /** Every room on the board, with its free spots before the drop */
  readonly rooms: readonly DragAnnouncementRoom[];
  /** Every assignment on the board, to resolve a swap target */
  readonly assignments: readonly RoomAssignment[];
  /** Resolves a guest's display name */
  readonly personNameOf: (personId: PersonId) => string | undefined;
  /** Resolves how many people a guest entry stands for */
  readonly headcountOf: HeadcountResolver;
  /**
   * Whether a drop only opens the confirmation dialog.
   *
   * The cards view asks for the dates before it writes the assignment, so
   * "moved to" would be a lie there.
   */
  readonly confirmsBeforeAssigning: boolean;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/** Reads the guest payload a {@link DraggableGuest} carries. */
function guestOf(data: unknown): DraggableGuestData | undefined {
  const guest = data as DraggableGuestData | undefined;
  return guest?.person ? guest : undefined;
}

/** Reads the assignment payload a {@link DraggableRoomAssignment} carries. */
function assignmentOf(data: unknown): RoomAssignment | undefined {
  return (data as DraggableRoomAssignmentData | undefined)?.assignment;
}

/** Reads the room payload a {@link DroppableRoom} carries. */
function roomIdOf(data: unknown): RoomId | undefined {
  return (data as DroppableRoomData | undefined)?.roomId;
}

/** Reads the assignment payload a {@link DroppableAssignment} carries. */
function targetAssignmentIdOf(data: unknown): RoomAssignment['id'] | undefined {
  return (data as DroppableAssignmentData | undefined)?.assignmentId;
}

// ============================================================================
// Builder
// ============================================================================

/**
 * Builds the dnd-kit announcements for the rooms board.
 *
 * @param context - The names and counts to speak
 * @returns Announcements to pass as `accessibility.announcements` to DndContext
 *
 * @example
 * ```tsx
 * <DndContext accessibility={{ announcements }}>
 * ```
 */
export function createRoomDragAnnouncements(
  context: RoomDragAnnouncementContext,
): Announcements {
  const { t, rooms, assignments, personNameOf, headcountOf, confirmsBeforeAssigning } = context,

    unknownGuest = (): string => t('assignments.dragAnnouncements.unknownGuest'),
    unknownRoom = (): string => t('assignments.dragAnnouncements.unknownRoom'),

    /** The name to speak for whatever is in the air, guest bar or room pill. */
    draggedGuestName = (data: unknown): string => {
      const guest = guestOf(data);
      if (guest) {
        return guest.person.name;
      }

      const assignment = assignmentOf(data);
      if (assignment) {
        return personNameOf(assignment.personId) ?? unknownGuest();
      }

      return unknownGuest();
    },

    /** The person the drag stands for, when there is one. */
    draggedPersonId = (data: unknown): PersonId | undefined =>
      guestOf(data)?.person.id ?? assignmentOf(data)?.personId,

    roomOf = (roomId: RoomId | undefined): DragAnnouncementRoom | undefined =>
      roomId === undefined ? undefined : rooms.find((room) => room.id === roomId),

    /**
     * "1 spot left." / "no spots left." — the sentence tail both the hovering
     * and the landed announcement end on.
     *
     * @param room - The room being described
     * @param arriving - People the drop adds, or 0 while nothing has landed
     */
    spotsPhrase = (room: DragAnnouncementRoom, arriving: number): string => {
      const left = Math.max(0, room.availableSpots - arriving);

      return left === 0
        ? t('assignments.dragAnnouncements.roomFull')
        : t('assignments.dragAnnouncements.spotsLeft', { count: left });
    };

  return {
    onDragStart({ active }) {
      return t('assignments.dragAnnouncements.pickedUp', { guest: draggedGuestName(active.data.current) });
    },

    onDragOver({ active, over }) {
      const guest = draggedGuestName(active.data.current);

      if (!over) {
        return t('assignments.dragAnnouncements.overNothing', { guest });
      }

      const room = roomOf(roomIdOf(over.data.current));
      if (room) {
        return t('assignments.dragAnnouncements.overRoom', { guest, room: room.name, spots: spotsPhrase(room, 0) });
      }

      const targetId = targetAssignmentIdOf(over.data.current),
        target = assignments.find((assignment) => assignment.id === targetId);

      if (target) {
        return t('assignments.dragAnnouncements.overSwap', {
          guest,
          target: personNameOf(target.personId) ?? unknownGuest(),
          room: roomOf(target.roomId)?.name ?? unknownRoom(),
        });
      }

      return t('assignments.dragAnnouncements.overNothing', { guest });
    },

    onDragEnd({ active, over }) {
      const guest = draggedGuestName(active.data.current);

      if (!over) {
        return t('assignments.dragAnnouncements.notMoved', { guest });
      }

      const room = roomOf(roomIdOf(over.data.current));
      if (room) {
        if (confirmsBeforeAssigning && guestOf(active.data.current)) {
          return t('assignments.dragAnnouncements.droppedPending', { guest, room: room.name });
        }

        const personId = draggedPersonId(active.data.current),
          arriving = personId === undefined ? 1 : headcountOf(personId);

        return t('assignments.dragAnnouncements.dropped', {
          guest,
          room: room.name,
          spots: spotsPhrase(room, arriving),
        });
      }

      const targetId = targetAssignmentIdOf(over.data.current),
        target = assignments.find((assignment) => assignment.id === targetId);

      // Only a pill can swap: an unhoused guest has no room to give away.
      if (target && assignmentOf(active.data.current)) {
        return t('assignments.dragAnnouncements.swapped', {
          guest,
          target: personNameOf(target.personId) ?? unknownGuest(),
          room: roomOf(target.roomId)?.name ?? unknownRoom(),
        });
      }

      return t('assignments.dragAnnouncements.notMoved', { guest });
    },

    onDragCancel({ active }) {
      return t('assignments.dragAnnouncements.cancelled', { guest: draggedGuestName(active.data.current) });
    },
  };
}
