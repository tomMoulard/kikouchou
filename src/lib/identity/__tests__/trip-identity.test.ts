/**
 * @fileoverview Guards "which of these guests am I".
 *
 * The precedence is the whole point, and so is the refusal to hand back a
 * dangling id: filtering a transport list down to nothing reads to the user as
 * "you have no travel", which is a different and worse claim than "we do not
 * know who you are".
 *
 * @module lib/identity/__tests__/trip-identity.test
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/lib/db/database';
import { setMyPersonId } from '@/lib/db';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { toHexColor, toISODateStringFromString } from '@/lib/db/utils';
import { getGuestIdentityStorageKey } from '@/lib/sharing/guest-identity';
import { installTestLocalStorage } from '@/test/utils';
import {
  cacheClaimedPersonId,
  readClaimedPersonId,
  resolveTripIdentity,
} from '../trip-identity';
import type { PersonId, ShareId, Trip, TripId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const USER_ID = 'auth-user-1';

let trip: Trip, tom: PersonId, alice: PersonId;

beforeEach(async () => {
  // jsdom exposes no localStorage here by default, and the share-link half of
  // the identity lives in it.
  installTestLocalStorage();

  trip = await createTrip({
    name: 'Summer',
    startDate: toISODateStringFromString('2026-07-15'),
    endDate: toISODateStringFromString('2026-07-22'),
  });

  tom = (await createPerson(trip.id, { name: 'Tom', color: toHexColor('#3b82f6') })).id;
  alice = (await createPerson(trip.id, { name: 'Alice', color: toHexColor('#ef4444') }))
    .id;
});

/** Writes the identity the share-link wizard would have stored. */
function storeShareLinkIdentity(shareId: ShareId, personId: PersonId, tripId: TripId) {
  window.localStorage.setItem(
    getGuestIdentityStorageKey(shareId),
    JSON.stringify({ personId, tripId }),
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('resolveTripIdentity', () => {
  it('knows nobody when nothing has been said', async () => {
    expect(await resolveTripIdentity(trip)).toEqual({
      personId: undefined,
      source: undefined,
    });
  });

  it('returns nobody without a trip', async () => {
    expect(await resolveTripIdentity(undefined)).toEqual({
      personId: undefined,
      source: undefined,
    });
  });

  it('reads the share-link identity', async () => {
    storeShareLinkIdentity(trip.shareId, alice, trip.id);

    expect(await resolveTripIdentity(trip)).toEqual({
      personId: alice,
      source: 'shareLink',
    });
  });

  it('ignores a share-link identity stored for a different trip', async () => {
    storeShareLinkIdentity(trip.shareId, alice, 'some-other-trip' as TripId);

    expect((await resolveTripIdentity(trip)).personId).toBeUndefined();
  });

  it('reads the account’s claimed participant', async () => {
    await cacheClaimedPersonId(trip.id, USER_ID, tom);

    expect(await resolveTripIdentity(trip, USER_ID)).toEqual({
      personId: tom,
      source: 'account',
    });
  });

  it('ignores the claim when no account is signed in', async () => {
    await cacheClaimedPersonId(trip.id, USER_ID, tom);

    expect((await resolveTripIdentity(trip)).personId).toBeUndefined();
  });

  it('lets an explicit choice beat both', async () => {
    storeShareLinkIdentity(trip.shareId, alice, trip.id);
    await cacheClaimedPersonId(trip.id, USER_ID, alice);
    await setMyPersonId(trip.id, tom);

    expect(await resolveTripIdentity(trip, USER_ID)).toEqual({
      personId: tom,
      source: 'explicit',
    });
  });

  it('prefers the share link over the account claim', async () => {
    storeShareLinkIdentity(trip.shareId, alice, trip.id);
    await cacheClaimedPersonId(trip.id, USER_ID, tom);

    expect((await resolveTripIdentity(trip, USER_ID)).source).toBe('shareLink');
  });

  it('falls through a source naming a guest the trip no longer holds', async () => {
    await setMyPersonId(trip.id, 'deleted-guest' as PersonId);
    storeShareLinkIdentity(trip.shareId, alice, trip.id);

    expect(await resolveTripIdentity(trip)).toEqual({
      personId: alice,
      source: 'shareLink',
    });
  });

  it('refuses a guest belonging to another trip', async () => {
    const other = await createTrip({
        name: 'Other',
        startDate: toISODateStringFromString('2026-08-01'),
        endDate: toISODateStringFromString('2026-08-05'),
      }),
      stranger = (
        await createPerson(other.id, { name: 'Stranger', color: toHexColor('#000000') })
      ).id;

    await setMyPersonId(trip.id, stranger);

    expect((await resolveTripIdentity(trip)).personId).toBeUndefined();
  });

  it('keeps one trip’s answer when another is set', async () => {
    const other = await createTrip({
      name: 'Other',
      startDate: toISODateStringFromString('2026-08-01'),
      endDate: toISODateStringFromString('2026-08-05'),
    });

    await setMyPersonId(trip.id, tom);
    await setMyPersonId(other.id, 'someone' as PersonId);

    expect((await resolveTripIdentity(trip)).personId).toBe(tom);
  });

  it('forgets an explicit choice when cleared', async () => {
    await setMyPersonId(trip.id, tom);
    await setMyPersonId(trip.id, undefined);

    expect((await resolveTripIdentity(trip)).personId).toBeUndefined();
  });
});

describe('cacheClaimedPersonId', () => {
  it('writes the membership row the join path never used to write', async () => {
    await cacheClaimedPersonId(trip.id, USER_ID, tom);

    expect(await db.tripMembers.get([trip.id, USER_ID])).toMatchObject({
      tripId: trip.id,
      userId: USER_ID,
      personId: tom,
    });
  });

  it('records a skipped claim as a member who is nobody in particular', async () => {
    await cacheClaimedPersonId(trip.id, USER_ID, undefined);

    expect(await readClaimedPersonId(trip.id, USER_ID)).toBeUndefined();
  });
});
