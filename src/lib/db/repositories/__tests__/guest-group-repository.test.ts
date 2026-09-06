/**
 * Integration tests for the Guest Group Repository.
 *
 * Covers CRUD, the copy semantics of an import, and the two invariants that are
 * easy to break later: member ids survive an edit, and a group outlives the
 * trips its members were imported into.
 *
 * @module lib/db/repositories/__tests__/guest-group-repository.test
 */
import { describe, it, expect } from 'vitest';

import { db } from '@/lib/db/database';
import {
  createGuestGroup,
  createGuestGroupFromPersons,
  deleteGuestGroup,
  getAllGuestGroups,
  getGuestGroupById,
  importGuestGroupMembers,
  updateGuestGroup,
} from '@/lib/db/repositories/guest-group-repository';
import { createPerson, getPersonsByTripId } from '@/lib/db/repositories/person-repository';
import { createTrip, deleteTrip } from '@/lib/db/repositories/trip-repository';
import { MAX_GUEST_GROUP_MEMBERS, getPersonHeadcount } from '@/types';
import type { GuestGroupFormData, GuestGroupMemberId, TripId } from '@/types';
import { hexColor, isoDate } from '@/test/utils';

// ============================================================================
// Test Data Factories
// ============================================================================

function familyGroupData(
  overrides?: Partial<GuestGroupFormData>,
): GuestGroupFormData {
  return {
    name: 'Family',
    members: [
      { name: 'Tom + Léa', color: hexColor('#ef4444'), headcount: 2 },
      { name: 'Alice', color: hexColor('#3b82f6') },
      { name: 'Camille', color: hexColor('#22c55e'), notes: 'Peanut allergy' },
    ],
    ...overrides,
  };
}

async function createTestTrip(name = 'Brittany'): Promise<TripId> {
  const trip = await createTrip({
    name,
    startDate: isoDate('2026-07-15'),
    endDate: isoDate('2026-07-22'),
  });
  return trip.id;
}

// ============================================================================
// CRUD
// ============================================================================

describe('createGuestGroup', () => {
  it('stores the group with an id and timestamps', async () => {
    const group = await createGuestGroup(familyGroupData());

    expect(group.id).toBeTruthy();
    expect(group.name).toBe('Family');
    expect(group.members).toHaveLength(3);
    expect(group.createdAt).toBe(group.updatedAt);

    const stored = await getGuestGroupById(group.id);
    expect(stored?.members[0]?.name).toBe('Tom + Léa');
  });

  it('gives every member its own id', async () => {
    const group = await createGuestGroup(familyGroupData());

    const ids = new Set(group.members.map((member) => member.id));
    expect(ids.size).toBe(3);
  });

  it('trims and bounds the group name', async () => {
    const group = await createGuestGroup(
      familyGroupData({ name: `  ${'F'.repeat(150)}  ` }),
    );

    expect(group.name).toHaveLength(100);
  });

  it('clips a member list beyond the maximum', async () => {
    const tooMany = Array.from({ length: MAX_GUEST_GROUP_MEMBERS + 5 }, (_, i) => ({
      name: `Guest ${i}`,
      color: hexColor('#ef4444'),
    }));

    const group = await createGuestGroup(familyGroupData({ members: tooMany }));

    expect(group.members).toHaveLength(MAX_GUEST_GROUP_MEMBERS);
  });

  it('accepts a group with no members yet', async () => {
    const group = await createGuestGroup({ name: 'Ski crew', members: [] });

    expect(group.members).toEqual([]);
  });
});

describe('getAllGuestGroups', () => {
  it('orders groups by name', async () => {
    await createGuestGroup(familyGroupData({ name: 'Ski crew' }));
    await createGuestGroup(familyGroupData({ name: 'Family' }));

    const groups = await getAllGuestGroups();

    expect(groups.map((group) => group.name)).toEqual(['Family', 'Ski crew']);
  });

  it('returns an empty list when nothing has been created', async () => {
    expect(await getAllGuestGroups()).toEqual([]);
  });
});

describe('updateGuestGroup', () => {
  it('keeps member ids stable across an edit', async () => {
    const group = await createGuestGroup(familyGroupData());
    const originalIds = group.members.map((member) => member.id);

    await updateGuestGroup(group.id, {
      name: 'Family',
      members: [
        { name: 'Tom + Léa', color: hexColor('#ef4444'), headcount: 2 },
        { name: 'Alice Martin', color: hexColor('#3b82f6') },
        { name: 'Camille', color: hexColor('#22c55e'), notes: 'Peanut allergy' },
      ],
    });

    const updated = await getGuestGroupById(group.id);
    expect(updated?.members.map((member) => member.id)).toEqual(originalIds);
    expect(updated?.members[1]?.name).toBe('Alice Martin');
  });

  it('advances updatedAt but not createdAt', async () => {
    const group = await createGuestGroup(familyGroupData());

    await updateGuestGroup(group.id, { name: 'The Family', members: [] });

    const updated = await getGuestGroupById(group.id);
    expect(updated?.createdAt).toBe(group.createdAt);
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(group.updatedAt);
  });

  it('throws for a group that does not exist', async () => {
    await expect(
      updateGuestGroup('missing' as never, { name: 'Nope', members: [] }),
    ).rejects.toThrow(/not found/);
  });
});

describe('deleteGuestGroup', () => {
  it('removes the group', async () => {
    const group = await createGuestGroup(familyGroupData());

    await deleteGuestGroup(group.id);

    expect(await getGuestGroupById(group.id)).toBeUndefined();
  });
});

// ============================================================================
// Trip Integration
// ============================================================================

describe('importGuestGroupMembers', () => {
  it('creates one guest per selected member', async () => {
    const tripId = await createTestTrip(),
      group = await createGuestGroup(familyGroupData()),
      selected = [group.members[0]!.id, group.members[1]!.id];

    const { persons, skippedMemberIds } = await importGuestGroupMembers(
      tripId,
      group.id,
      selected,
    );

    expect(skippedMemberIds).toEqual([]);
    expect(persons.map((person) => person.name)).toEqual(['Tom + Léa', 'Alice']);

    const guests = await getPersonsByTripId(tripId);
    expect(guests).toHaveLength(2);
  });

  it('imports every member when no selection is given', async () => {
    const tripId = await createTestTrip(),
      group = await createGuestGroup(familyGroupData());

    const { persons } = await importGuestGroupMembers(tripId, group.id);

    expect(persons).toHaveLength(3);
  });

  it('carries headcount and notes onto the guest', async () => {
    const tripId = await createTestTrip(),
      group = await createGuestGroup(familyGroupData());

    const { persons } = await importGuestGroupMembers(tripId, group.id);

    const couple = persons.find((person) => person.name === 'Tom + Léa')!,
      camille = persons.find((person) => person.name === 'Camille')!,
      alice = persons.find((person) => person.name === 'Alice')!;

    expect(getPersonHeadcount(couple)).toBe(2);
    expect(camille.notes).toBe('Peanut allergy');
    // A headcount of one is left absent rather than written explicitly, so an
    // imported guest and a hand-typed one are the same record.
    expect(alice.headcount).toBeUndefined();
    expect(alice.notes).toBeUndefined();
  });

  it('is a copy: editing the guest leaves the group alone', async () => {
    const tripId = await createTestTrip(),
      group = await createGuestGroup(familyGroupData());

    const { persons } = await importGuestGroupMembers(tripId, group.id, [
      group.members[1]!.id,
    ]);

    await db.persons.update(persons[0]!.id, { name: 'Alice (renamed)' });

    const untouched = await getGuestGroupById(group.id);
    expect(untouched?.members[1]?.name).toBe('Alice');
  });

  it('scopes the guests to the trip that asked for them', async () => {
    const tripA = await createTestTrip('A'),
      tripB = await createTestTrip('B'),
      group = await createGuestGroup(familyGroupData());

    await importGuestGroupMembers(tripA, group.id);

    expect(await getPersonsByTripId(tripB)).toEqual([]);
  });

  it('reports a member id the group no longer holds instead of failing', async () => {
    const tripId = await createTestTrip(),
      group = await createGuestGroup(familyGroupData()),
      stale = 'gone' as GuestGroupMemberId;

    const { persons, skippedMemberIds } = await importGuestGroupMembers(
      tripId,
      group.id,
      [group.members[0]!.id, stale],
    );

    expect(persons).toHaveLength(1);
    expect(skippedMemberIds).toEqual([stale]);
  });

  it('throws for a group that does not exist', async () => {
    const tripId = await createTestTrip();

    await expect(
      importGuestGroupMembers(tripId, 'missing' as never),
    ).rejects.toThrow(/not found/);
  });

  it('leaves the group standing when the trip is deleted', async () => {
    const tripId = await createTestTrip(),
      group = await createGuestGroup(familyGroupData());

    await importGuestGroupMembers(tripId, group.id);
    await deleteTrip(tripId);

    const survivor = await getGuestGroupById(group.id);
    expect(survivor?.members).toHaveLength(3);
  });
});

describe('createGuestGroupFromPersons', () => {
  it('captures the guests of a trip as members', async () => {
    const tripId = await createTestTrip();

    await createPerson(tripId, {
      name: 'Tom + Léa',
      color: hexColor('#ef4444'),
      headcount: 2,
    });
    await createPerson(tripId, {
      name: 'Alice',
      color: hexColor('#3b82f6'),
      notes: 'Vegetarian',
      stayStartDate: isoDate('2026-07-16'),
    });

    const guests = await getPersonsByTripId(tripId),
      group = await createGuestGroupFromPersons('Family', guests);

    expect(group.members.map((member) => member.name)).toEqual(['Alice', 'Tom + Léa']);

    const alice = group.members.find((member) => member.name === 'Alice')!;
    expect(alice.notes).toBe('Vegetarian');
    // Stay dates belong to a trip, not to a person, so they do not travel.
    expect(alice).not.toHaveProperty('stayStartDate');
  });

  it('carries a phone number both ways', async () => {
    const source = await createTestTrip('source'),
      target = await createTestTrip('target');

    await createPerson(source, {
      name: 'Alice',
      color: hexColor('#3b82f6'),
      phone: '+33 6 12 34 56 78',
    });

    // A phone number is the most trip-independent thing about a guest and the
    // most tedious to retype, so losing it on the way through a group would
    // defeat the point of saving one.
    const group = await createGuestGroupFromPersons(
      'Family',
      await getPersonsByTripId(source),
    );
    expect(group.members[0]?.phone).toBe('+33 6 12 34 56 78');

    const { persons } = await importGuestGroupMembers(target, group.id);
    expect(persons[0]?.phone).toBe('+33 6 12 34 56 78');
  });

  it('carries a declared child seat both ways', async () => {
    const source = await createTestTrip('source'),
      target = await createTestTrip('target');

    await createPerson(source, {
      name: 'Lila',
      color: hexColor('#22c55e'),
      childSeat: 'booster',
    });

    // Which restraint a child needs changes about once every two years, not
    // once per holiday. Dropping it here would make the family roster hand back
    // an adult-shaped guest every summer, and the ride's seat tally read zero.
    const group = await createGuestGroupFromPersons(
      'Family',
      await getPersonsByTripId(source),
    );
    expect(group.members[0]?.childSeat).toBe('booster');

    const { persons } = await importGuestGroupMembers(target, group.id);
    expect(persons[0]?.childSeat).toBe('booster');
  });

  it('gives an adult member no child seat on either leg of the round trip', async () => {
    const source = await createTestTrip('source'),
      target = await createTestTrip('target');

    await createPerson(source, { name: 'Tom', color: hexColor('#ef4444') });

    const group = await createGuestGroupFromPersons(
      'Family',
      await getPersonsByTripId(source),
    );
    expect(group.members[0]?.childSeat).toBeUndefined();

    const { persons } = await importGuestGroupMembers(target, group.id);
    // The imported guest carries no key at all, so a ride asks for no seat and
    // the field reads the same as a hand-typed adult's.
    expect(persons[0]).not.toHaveProperty('childSeat');
  });

  it('round-trips through an import without losing a headcount', async () => {
    const source = await createTestTrip('source'),
      target = await createTestTrip('target');

    await createPerson(source, {
      name: 'Tom + Léa',
      color: hexColor('#ef4444'),
      headcount: 2,
    });

    const group = await createGuestGroupFromPersons(
      'Family',
      await getPersonsByTripId(source),
    );
    const { persons } = await importGuestGroupMembers(target, group.id);

    expect(getPersonHeadcount(persons[0]!)).toBe(2);
  });
});
