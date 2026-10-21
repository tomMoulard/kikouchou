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

// ============================================================================
// Payloads it does not recognise, read through an echoing translator
// ============================================================================

describe('room drag announcements, for payloads that carry nothing it knows', () => {
  /** Says which sentence was picked and with what, so the choice is visible. */
  function echoContext(overrides: Partial<RoomDragAnnouncementContext> = {}) {
    return createRoomDragAnnouncements({
      t: (key, options) => (options ? `${key} ${JSON.stringify(options)}` : key),
      rooms: [{ id: master.id, name: master.name, availableSpots: 2 }],
      assignments: [bobInAttic],
      personNameOf: (personId) => (personId === bob.id ? 'Bob' : undefined),
      headcountOf: () => 2,
      confirmsBeforeAssigning: false,
      ...overrides,
    });
  }

  const empty = (): Active =>
    ({ id: 'x', data: { current: undefined }, rect: { current: {} } }) as unknown as Active;
  const blankOver = (data: unknown): Over =>
    ({ id: 'y', data: { current: data }, rect: {}, disabled: false }) as unknown as Over;
  type Event<K extends 'onDragStart' | 'onDragOver' | 'onDragEnd'> = Parameters<
    NonNullable<ReturnType<typeof createRoomDragAnnouncements>[K]>
  >[0];

  it('calls a drag with no payload an unknown guest', () => {
    const announcements = echoContext();

    expect(announcements.onDragStart({ active: empty() } as Event<'onDragStart'>)).toContain(
      '"guest":"assignments.dragAnnouncements.unknownGuest"',
    );
  });

  it('calls a pill whose guest has gone an unknown guest', () => {
    const announcements = echoContext();

    expect(
      announcements.onDragStart({
        active: draggedAssignment(aliceInAttic),
      } as Event<'onDragStart'>),
    ).toContain('"guest":"assignments.dragAnnouncements.unknownGuest"');
  });

  it('says a drag over a target with no payload is over nothing', () => {
    const announcements = echoContext();

    expect(
      announcements.onDragOver({ active: empty(), over: blankOver(undefined) } as Event<'onDragOver'>),
    ).toMatch(/^assignments\.dragAnnouncements\.overNothing /);
    expect(
      announcements.onDragOver({ active: empty(), over: blankOver({}) } as Event<'onDragOver'>),
    ).toMatch(/^assignments\.dragAnnouncements\.overNothing /);
  });

  it('says a drop on a target with no payload moved nothing', () => {
    const announcements = echoContext();

    expect(
      announcements.onDragEnd({ active: empty(), over: blankOver(undefined) } as Event<'onDragEnd'>),
    ).toMatch(/^assignments\.dragAnnouncements\.notMoved /);
    expect(
      announcements.onDragEnd({ active: draggedAssignment(), over: blankOver({}) } as Event<'onDragEnd'>),
    ).toMatch(/^assignments\.dragAnnouncements\.notMoved /);
  });

  it('counts one person for a drop that names nobody', () => {
    const announcements = echoContext();

    // Two spots, one person: one left. A guest of two would leave none.
    expect(
      announcements.onDragEnd({ active: empty(), over: overRoom(master) } as Event<'onDragEnd'>),
    ).toContain('"spots":"assignments.dragAnnouncements.spotsLeft {\\"count\\":1}"');
  });

  it('names an unknown room for a stay in a room it was not told about', () => {
    const announcements = echoContext();

    expect(
      announcements.onDragOver({
        active: draggedAssignment(aliceInAttic),
        over: overAssignment(bobInAttic),
      } as Event<'onDragOver'>),
    ).toContain('"room":"assignments.dragAnnouncements.unknownRoom"');
    expect(
      announcements.onDragEnd({
        active: draggedAssignment(aliceInAttic),
        over: overAssignment(bobInAttic),
      } as Event<'onDragEnd'>),
    ).toContain('"room":"assignments.dragAnnouncements.unknownRoom"');
  });

  it('does not call a guest bar dropped on a stay a swap', () => {
    const announcements = echoContext();

    expect(
      announcements.onDragEnd({
        active: draggedGuest(alice),
        over: overAssignment(bobInAttic),
      } as Event<'onDragEnd'>),
    ).toMatch(/^assignments\.dragAnnouncements\.notMoved /);
  });

  it('says a guest bar is only pending, and a pill moved, in the view that confirms first', () => {
    const announcements = echoContext({ confirmsBeforeAssigning: true });

    expect(
      announcements.onDragEnd({ active: draggedGuest(alice), over: overRoom(master) } as Event<'onDragEnd'>),
    ).toMatch(/^assignments\.dragAnnouncements\.droppedPending /);
    expect(
      announcements.onDragEnd({
        active: draggedAssignment(bobInAttic),
        over: overRoom(master),
      } as Event<'onDragEnd'>),
    ).toMatch(/^assignments\.dragAnnouncements\.dropped /);
  });
});

describe('room drag announcements, the fallbacks still name the guest', () => {
  it('names the guest when it lands nowhere it knows', () => {
    const announcements = createRoomDragAnnouncements({
      t: (key, options) => (options ? `${key} ${JSON.stringify(options)}` : key),
      rooms: [],
      assignments: [],
      personNameOf: () => undefined,
      headcountOf: () => 1,
      confirmsBeforeAssigning: false,
    });
    const target = {
      id: 'y',
      data: { current: {} },
      rect: {},
      disabled: false,
    } as unknown as Over;

    expect(
      announcements.onDragOver?.({ active: draggedGuest(alice), over: target } as Parameters<
        NonNullable<typeof announcements.onDragOver>
      >[0]),
    ).toBe('assignments.dragAnnouncements.overNothing {"guest":"Alice"}');
    expect(
      announcements.onDragEnd?.({ active: draggedGuest(alice), over: target } as Parameters<
        NonNullable<typeof announcements.onDragEnd>
      >[0]),
    ).toBe('assignments.dragAnnouncements.notMoved {"guest":"Alice"}');
  });
});
