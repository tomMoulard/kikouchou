/**
 * The `guest-phone-sharing` flag on the QR changeset path.
 *
 * A changeset is the other way a guest record leaves this device — scanned off
 * this screen onto someone else's phone — so it obeys the same flag the
 * document writers do, and the receiving side inherits the same asymmetry: an
 * absent phone is the sender's silence, not a deletion it had standing to make.
 *
 * @module lib/sharing/__tests__/guest-phone-changeset.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db/database';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { hexColor, isoDate } from '@/test/utils';
import type { Person, Trip } from '@/types';

const isGuestPhoneSharingEnabled = vi.fn(() => false);
vi.mock('@/lib/flags', () => ({
  isGuestPhoneSharingEnabled: () => isGuestPhoneSharingEnabled(),
}));

import { buildHostChangeset } from '@/lib/sharing/export-service';
import { applyMerge } from '@/lib/sharing/merge-applicator';

// ============================================================================
// Helpers
// ============================================================================

async function makeTrip(): Promise<Trip> {
  return createTrip({
    name: 'Brittany',
    startDate: isoDate('2026-07-15'),
    endDate: isoDate('2026-07-22'),
  });
}

beforeEach(() => {
  isGuestPhoneSharingEnabled.mockReturnValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Export
// ============================================================================

describe('buildHostChangeset', () => {
  it('leaves the phone out while sharing is off', async () => {
    const trip = await makeTrip();
    await createPerson(trip.id, {
      name: 'Mary',
      color: hexColor('#3b82f6'),
      phone: '+33 6 12 34 56 78',
    });

    const changeset = await buildHostChangeset(trip);

    expect(changeset?.added.persons).toHaveLength(1);
    expect(changeset?.added.persons[0]?.phone).toBeUndefined();
    // Only the phone is withheld; the guest still travels.
    expect(changeset?.added.persons[0]?.name).toBe('Mary');
  });

  it('carries the phone while sharing is on', async () => {
    isGuestPhoneSharingEnabled.mockReturnValue(true);
    const trip = await makeTrip();
    await createPerson(trip.id, {
      name: 'Mary',
      color: hexColor('#3b82f6'),
      phone: '+33 6 12 34 56 78',
    });

    const changeset = await buildHostChangeset(trip);

    expect(changeset?.added.persons[0]?.phone).toBe('+33 6 12 34 56 78');
  });

  it('does not redact the row still sitting in IndexedDB', async () => {
    // The builder reads live Dexie rows; redacting one in place would delete the
    // local copy the flag exists to preserve.
    const trip = await makeTrip();
    const guest = await createPerson(trip.id, {
      name: 'Mary',
      color: hexColor('#3b82f6'),
      phone: '+33 6 12 34 56 78',
    });

    await buildHostChangeset(trip);

    expect((await db.persons.get(guest.id))?.phone).toBe('+33 6 12 34 56 78');
  });
});

// ============================================================================
// Import
// ============================================================================

describe('applyMerge', () => {
  it('keeps a local phone a redacted changeset could not carry', async () => {
    const trip = await makeTrip();
    const guest = await createPerson(trip.id, {
      name: 'Mary',
      color: hexColor('#3b82f6'),
      phone: '+33 6 12 34 56 78',
    });

    // What a sender with the flag off produces: the same guest, phone withheld.
    const fromPeer: Person = {
      id: guest.id,
      tripId: trip.id,
      name: 'Mary Poppins',
      color: hexColor('#ef4444'),
    };

    await applyMerge({
      autoApply: { persons: [fromPeer], assignments: [], transports: [], rooms: [] },
      conflicts: [],
      warnings: [],
      summary: { added: 1, modified: 0, conflicts: 0 },
    } as unknown as Parameters<typeof applyMerge>[0]);

    const stored = await db.persons.get(guest.id);
    // The edit lands...
    expect(stored?.name).toBe('Mary Poppins');
    // ...without taking the number with it.
    expect(stored?.phone).toBe('+33 6 12 34 56 78');
  });

  it('accepts a phone the changeset does carry', async () => {
    const trip = await makeTrip();
    const guest = await createPerson(trip.id, {
      name: 'Mary',
      color: hexColor('#3b82f6'),
    });

    const fromPeer: Person = {
      id: guest.id,
      tripId: trip.id,
      name: 'Mary',
      color: hexColor('#3b82f6'),
      phone: '0612345678',
    };

    await applyMerge({
      autoApply: { persons: [fromPeer], assignments: [], transports: [], rooms: [] },
      conflicts: [],
      warnings: [],
      summary: { added: 1, modified: 0, conflicts: 0 },
    } as unknown as Parameters<typeof applyMerge>[0]);

    expect((await db.persons.get(guest.id))?.phone).toBe('0612345678');
  });
});
