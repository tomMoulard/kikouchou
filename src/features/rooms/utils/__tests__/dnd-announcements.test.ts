/**
 * @fileoverview Tests for the room drag-and-drop screen reader announcements.
 *
 * The bug these cover: the rooms page passed no `accessibility.announcements`
 * to dnd-kit, so a screen reader read dnd-kit's default text, which is built
 * from the draggable and droppable ids — "Draggable item
 * guest-FH7oeUECm-gDUQzg5teEh-2026-09-11-2026-09-13 was dropped over droppable
 * area room-orvCHpZ2fFihDg9IxNikQ". A guest who cannot see the board learns
 * nothing from that.
 *
 * The suite runs through a real i18next rather than the setup-wide mock, which
 * returns keys verbatim: the sentence the user hears, its plural form and its
 * French wording are the whole point here, and the mock would hide all three.
 *
 * @module features/rooms/utils/__tests__/dnd-announcements.test
 */

import type { Active, Over } from '@dnd-kit/core';
import { describe, it, expect, vi } from 'vitest';

import type {
  ISODateString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  TripId,
} from '@/types';
import type { DraggableGuestData } from '@/features/rooms/components/DraggableGuest';
import type { DraggableRoomAssignmentData } from '@/features/rooms/components/DraggableRoomAssignment';
import type { DroppableRoomData } from '@/features/rooms/components/DroppableRoom';
import type { DroppableAssignmentData } from '@/features/rooms/components/DroppableAssignment';
import { createRealI18n } from '@/test/utils';
import {
  createRoomDragAnnouncements,
  type RoomDragAnnouncementContext,
} from '../dnd-announcements';

// The sentences, not the keys, are what this file asserts.
vi.unmock('i18next');
vi.unmock('react-i18next');

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;

const alice: Person = {
  id: 'FH7oeUECm' as PersonId,
  tripId: TRIP_ID,
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
};

const bob: Person = {
  id: 'gDUQzg5teEh' as PersonId,
  tripId: TRIP_ID,
  name: 'Bob',
  color: '#ef4444' as Person['color'],
};

const master: Room = {
  id: 'orvCHpZ2fFihDg9IxNikQ' as RoomId,
  tripId: TRIP_ID,
  name: 'Master bedroom',
  capacity: 3,
  order: 0,
};

const attic: Room = {
  id: 'room-attic' as RoomId,
  tripId: TRIP_ID,
  name: 'Attic',
  capacity: 2,
  order: 1,
};

/** Bob's assignment: he sleeps in the attic, and can be swapped out of it. */
const bobInAttic: RoomAssignment = {
  id: 'assignment-bob' as RoomAssignmentId,
  tripId: TRIP_ID,
  roomId: attic.id,
  personId: bob.id,
  startDate: '2026-09-11' as ISODateString,
  endDate: '2026-09-13' as ISODateString,
};

/** Alice's assignment, for the "an assigned guest is dragged" cases. */
const aliceInAttic: RoomAssignment = {
  id: 'assignment-alice' as RoomAssignmentId,
  tripId: TRIP_ID,
  roomId: attic.id,
  personId: alice.id,
  startDate: '2026-09-11' as ISODateString,
  endDate: '2026-09-13' as ISODateString,
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Builds the announcement context, with one free spot in the master bedroom
 * unless the test says otherwise.
 */
async function makeContext(
  overrides: Partial<RoomDragAnnouncementContext> = {},
  language: 'en' | 'fr' = 'en',
): Promise<RoomDragAnnouncementContext> {
  const i18n = await createRealI18n(language);
  const persons = [alice, bob];

  return {
    t: (key, options) => i18n.t(key, options ?? {}),
    rooms: [
      { id: master.id, name: master.name, availableSpots: 2 },
      { id: attic.id, name: attic.name, availableSpots: 0 },
    ],
    assignments: [bobInAttic, aliceInAttic],
    personNameOf: (personId) => persons.find((person) => person.id === personId)?.name,
    headcountOf: () => 1,
    confirmsBeforeAssigning: false,
    ...overrides,
  };
}

/** The dnd-kit `active` for an unhoused guest's bar. */
function draggedGuest(person: Person = alice): Active {
  const data: DraggableGuestData = {
    person,
    startDate: '2026-09-11',
    endDate: '2026-09-13',
  };

  return {
    id: `guest-${person.id}-2026-09-11-2026-09-13`,
    data: { current: data },
    rect: { current: { initial: null, translated: null } },
  } as unknown as Active;
}

/** The dnd-kit `active` for an already assigned guest's pill. */
function draggedAssignment(assignment: RoomAssignment = aliceInAttic): Active {
  const data: DraggableRoomAssignmentData = { assignment };

  return {
    id: `assignment-${assignment.id}`,
    data: { current: data },
    rect: { current: { initial: null, translated: null } },
  } as unknown as Active;
}

/** The dnd-kit `over` for a room card or timeline row. */
function overRoom(room: Room = master): Over {
  const data: DroppableRoomData = { roomId: room.id };

  return { id: `room-${room.id}`, data: { current: data }, rect: {}, disabled: false } as unknown as Over;
}

/** The dnd-kit `over` for another guest's pill, which means "swap". */
function overAssignment(assignment: RoomAssignment = bobInAttic): Over {
  const data: DroppableAssignmentData = { assignmentId: assignment.id };

  return {
    id: `assignment-drop-${assignment.id}`,
    data: { current: data },
    rect: {},
    disabled: false,
  } as unknown as Over;
}

// ============================================================================
// Tests
// ============================================================================

describe('createRoomDragAnnouncements', () => {
  describe('a guest dropped on a room', () => {
    it('names the guest, the room and the spots left after the drop', async () => {
      const announcements = createRoomDragAnnouncements(await makeContext());

      expect(announcements.onDragEnd({ active: draggedGuest(), over: overRoom() })).toBe(
        'Alice moved to Master bedroom, 1 spot left.',
      );
    });

    it('never reads an internal id out loud', async () => {
      const announcements = createRoomDragAnnouncements(await makeContext()),
        active = draggedGuest(),
        over = overRoom(),
        spoken = announcements.onDragEnd({ active, over }) ?? '';

      expect(spoken).not.toContain(String(active.id));
      expect(spoken).not.toContain(String(over.id));
      expect(spoken).not.toContain(alice.id);
      expect(spoken).not.toContain(master.id);
    });

    it('uses the plural when more than one spot is left', async () => {
      const announcements = createRoomDragAnnouncements(
        await makeContext({
          rooms: [{ id: master.id, name: master.name, availableSpots: 3 }],
        }),
      );

      expect(announcements.onDragEnd({ active: draggedGuest(), over: overRoom() })).toBe(
        'Alice moved to Master bedroom, 2 spots left.',
      );
    });

    it('counts the guests a single entry stands for', async () => {
      const announcements = createRoomDragAnnouncements(await makeContext({ headcountOf: () => 2 }));

      expect(announcements.onDragEnd({ active: draggedGuest(), over: overRoom() })).toBe(
        'Alice moved to Master bedroom, no spots left.',
      );
    });

    it('says the drop is not final in the view that asks for confirmation', async () => {
      const announcements = createRoomDragAnnouncements(
        await makeContext({ confirmsBeforeAssigning: true }),
      );

      expect(announcements.onDragEnd({ active: draggedGuest(), over: overRoom() })).toBe(
        'Alice dropped on Master bedroom. Confirm the dates to finish the assignment.',
      );
    });
  });

  describe('an assigned guest dropped on a room', () => {
    it('announces the move and the room that receives them', async () => {
      const announcements = createRoomDragAnnouncements(await makeContext());

      expect(announcements.onDragEnd({ active: draggedAssignment(), over: overRoom() })).toBe(
        'Alice moved to Master bedroom, 1 spot left.',
      );
    });

    it('announces a swap with the guest whose pill received the drop', async () => {
      const announcements = createRoomDragAnnouncements(await makeContext());

      expect(
        announcements.onDragEnd({ active: draggedAssignment(), over: overAssignment() }),
      ).toBe('Alice swapped rooms with Bob. Alice is now in Attic.');
    });
  });

  describe('drags that change nothing', () => {
    it('says the guest stayed put when the drop misses every target', async () => {
      const announcements = createRoomDragAnnouncements(await makeContext());

      expect(announcements.onDragEnd({ active: draggedGuest(), over: null })).toBe(
        'Alice was not moved.',
      );
    });

    it('names the guest when the drag is cancelled', async () => {
      const announcements = createRoomDragAnnouncements(await makeContext());

      expect(announcements.onDragCancel({ active: draggedGuest(), over: null })).toBe(
        'Dragging Alice was cancelled. Alice was not moved.',
      );
    });
  });

  describe('while the guest is in the air', () => {
    it('names the guest that was picked up', async () => {
      const announcements = createRoomDragAnnouncements(await makeContext());

      expect(announcements.onDragStart({ active: draggedGuest() })).toBe('Picked up Alice.');
    });

    it('names the room under the guest and its free spots', async () => {
      const announcements = createRoomDragAnnouncements(await makeContext());

      expect(announcements.onDragOver({ active: draggedGuest(), over: overRoom() })).toBe(
        'Alice is over Master bedroom, 2 spots left.',
      );
    });

    it('offers the swap when the guest is over another guest', async () => {
      const announcements = createRoomDragAnnouncements(await makeContext());

      expect(
        announcements.onDragOver({ active: draggedAssignment(), over: overAssignment() }),
      ).toBe('Alice is over Bob in Attic. Drop to swap their rooms.');
    });

    it('says so when the guest is over nothing droppable', async () => {
      const announcements = createRoomDragAnnouncements(await makeContext());

      expect(announcements.onDragOver({ active: draggedGuest(), over: null })).toBe(
        'Alice is not over a room.',
      );
    });
  });

  describe('French', () => {
    it('speaks the drop in the language the page is in', async () => {
      const announcements = createRoomDragAnnouncements(await makeContext({}, 'fr'), );

      expect(announcements.onDragEnd({ active: draggedGuest(), over: overRoom() })).toBe(
        'Alice déplacé vers Master bedroom, 1 place restante.',
      );
    });
  });
});
