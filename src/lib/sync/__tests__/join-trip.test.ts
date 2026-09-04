/**
 * Join-flow tests.
 *
 * The server's trip row is written by another user, so it is remote-supplied
 * input by the same standard as a WebRTC peer's document — which is why most of
 * these are about bounding it rather than about the happy path.
 *
 * @module lib/sync/__tests__/join-trip.test
 */

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import {
  claimParticipant,
  fetchClaimedParticipants,
  materialiseJoinedTrip,
} from '@/lib/sync/join-trip';
import { syncDocToDexie } from '@/lib/yjs/dexie-bridge';
import { DOC_SCHEMA_VERSION } from '@/lib/yjs/doc-model';
import type { ShareId, TripId, UnixTimestamp } from '@/types';
import { toLocalISODateString } from '@/lib/db/utils';
import { isoDate } from '@/test/utils';
import frTranslations from '@/locales/fr/translation.json';

/**
 * Resolve translations against the real French bundle, not the global mock.
 *
 * `src/test/setup.ts` mocks `t` as `(key) => key`. Under that mock every
 * assertion about a translated name is tautological: the code under test stores
 * the literal 'trips.untitled' and the test compares it against the literal
 * 'trips.untitled', so the two agree for the wrong reason and the test cannot
 * tell a real translation from a raw key persisted as a trip's name — which is
 * exactly the failure mode a translate-at-write design invites.
 *
 * `fr` because it is this app's fallback language: the string below is what a
 * user with no stored preference actually sees. A key the bundle does not carry
 * resolves to itself and fails the comparison, which is the point.
 */
vi.mock('@/lib/i18n', async () => {
  const fr = (await import('@/locales/fr/translation.json')).default as Record<
    string,
    unknown
  >;
  const translate = (key: string): string => {
    const value = key
      .split('.')
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        fr,
      );
    return typeof value === 'string' ? value : key;
  };
  return {
    default: { t: translate, language: 'fr', changeLanguage: vi.fn() },
    i18nReady: Promise.resolve(),
    changeLanguage: vi.fn(),
    getCurrentLanguage: vi.fn().mockReturnValue('fr'),
    isLanguageSupported: vi.fn().mockReturnValue(true),
    isI18nInitialized: vi.fn().mockReturnValue(true),
    SUPPORTED_LANGUAGES: ['en', 'fr'],
    DEFAULT_LANGUAGE: 'fr',
    LANGUAGE_STORAGE_KEY: 'i18nextLng',
  };
});

// ============================================================================
// Helpers
// ============================================================================

const REMOTE_TRIP_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

/** A client whose `trips` select returns the given preview row. */
function clientWithTrip(row: unknown, error: unknown = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row, error }) }),
      }),
    }),
  } as never;
}

// ============================================================================
// materialiseJoinedTrip
// ============================================================================

describe('materialiseJoinedTrip', () => {
  it('creates a local trip from the server preview', async () => {
    const client = clientWithTrip({
      name: 'Brittany',
      start_date: '2026-07-15',
      end_date: '2026-07-22',
    });

    const result = await materialiseJoinedTrip(client, REMOTE_TRIP_ID);

    expect(result.status).toBe('joined');
    const trip = await db.trips.get((result as { tripId: TripId }).tripId);
    expect(trip).toMatchObject({
      name: 'Brittany',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
      remoteTripId: REMOTE_TRIP_ID,
    });
  });

  it('mints its own shareId rather than adopting one', async () => {
    const client = clientWithTrip({
      name: 'Brittany',
      start_date: '2026-07-15',
      end_date: '2026-07-22',
      // A hostile or careless server row cannot dictate this: shareId is a
      // unique Dexie index, and a collision aborts the write transaction.
      share_id: 'collide123',
    });

    const result = await materialiseJoinedTrip(client, REMOTE_TRIP_ID);
    const trip = await db.trips.get((result as { tripId: TripId }).tripId);

    expect(trip?.shareId).not.toBe('collide123');
    expect(trip?.shareId).toHaveLength(10);
  });

  it('is idempotent when the trip is already on the device', async () => {
    const client = clientWithTrip({
      name: 'Brittany',
      start_date: '2026-07-15',
      end_date: '2026-07-22',
    });

    const first = await materialiseJoinedTrip(client, REMOTE_TRIP_ID);
    const second = await materialiseJoinedTrip(client, REMOTE_TRIP_ID);

    // Opening the same link twice must not produce two trips.
    expect(second.status).toBe('already-local');
    expect((second as { tripId: TripId }).tripId).toBe(
      (first as { tripId: TripId }).tripId,
    );
    expect(await db.trips.where('remoteTripId').equals(REMOTE_TRIP_ID).count()).toBe(1);
  });

  it('creates one trip, not two, when two callers race for the same one', async () => {
    // Check-then-act, and no longer driven by a person: signing in sweeps the
    // whole account onto the device, in every open tab at once. Two passes
    // interleaved between the look-up and the write would each see nothing and
    // each add a row — one server trip, two local copies, two documents behind
    // them. The pair runs inside one Dexie transaction so the second waits.
    const client = clientWithTrip({
      name: 'Brittany',
      start_date: '2026-07-15',
      end_date: '2026-07-22',
    });

    const [first, second] = await Promise.all([
      materialiseJoinedTrip(client, REMOTE_TRIP_ID),
      materialiseJoinedTrip(client, REMOTE_TRIP_ID),
    ]);

    expect(await db.trips.where('remoteTripId').equals(REMOTE_TRIP_ID).count()).toBe(1);
    // Both callers get a usable trip id, and it is the same one.
    expect((first as { tripId: TripId }).tripId).toBe(
      (second as { tripId: TripId }).tripId,
    );
  });

  it('finds a trip already linked by an earlier session', async () => {
    const now = Date.now() as UnixTimestamp;
    await db.trips.add({
      id: 'pre-existing' as TripId,
      name: 'Already here',
      startDate: isoDate('2026-07-15'),
      endDate: isoDate('2026-07-22'),
      shareId: 'preexist12' as ShareId,
      createdAt: now,
      updatedAt: now,
      remoteTripId: REMOTE_TRIP_ID,
    });

    const result = await materialiseJoinedTrip(clientWithTrip(null), REMOTE_TRIP_ID);

    expect(result).toEqual({ status: 'already-local', tripId: 'pre-existing' });
  });

  it('still joins when the preview cannot be read', async () => {
    // The document is the source of truth and will arrive shortly; refusing to
    // join because a cosmetic preview failed would be the wrong trade.
    const result = await materialiseJoinedTrip(
      clientWithTrip(null, { message: 'boom' }),
      REMOTE_TRIP_ID,
    );

    expect(result.status).toBe('joined');
    const trip = await db.trips.get((result as { tripId: TripId }).tripId);
    expect(trip?.remoteTripId).toBe(REMOTE_TRIP_ID);
  });

  it('bounds an over-long name from the server', async () => {
    const client = clientWithTrip({
      name: 'x'.repeat(5000),
      start_date: '2026-07-15',
      end_date: '2026-07-22',
    });

    const result = await materialiseJoinedTrip(client, REMOTE_TRIP_ID);
    const trip = await db.trips.get((result as { tripId: TripId }).tripId);

    // Matches the server's own 200-character check constraint.
    expect(trip?.name).toHaveLength(200);
  });

  it.each([
    ['a malformed date', 'not-a-date'],
    ['an empty date', ''],
    ['a datetime where a date belongs', '2026-07-15T00:00:00Z'],
  ])('falls back to today for %s', async (_label, value) => {
    const client = clientWithTrip({
      name: 'Brittany',
      start_date: value,
      end_date: value,
    });

    const result = await materialiseJoinedTrip(client, REMOTE_TRIP_ID);
    const trip = await db.trips.get((result as { tripId: TripId }).tripId);

    // An unparseable date would poison every date-range query for this trip.
    expect(trip?.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // …and "today" is the viewer's day, since `Trip.startDate` is a local day key.
    expect(trip?.startDate).toBe(toLocalISODateString(new Date()));
    expect(trip?.endDate).toBe(toLocalISODateString(new Date()));
  });

  // Regression: the fallback read `new Date().toISOString().slice(0, 10)`, the
  // UTC day. Pinned to half past midnight and half past eleven local, that is
  // the wrong day for every viewer ahead of UTC and behind it respectively —
  // the placeholder trip opened on a day the user was not looking at.
  it.each([
    ['just after local midnight', 0, 30],
    ['just before local midnight', 23, 30],
  ])('derives today locally when the clock reads %s', async (_label, hour, minute) => {
    // The clock only. Vitest's default set also fakes `queueMicrotask`, and
    // `materialiseJoinedTrip` now does its look-up and its write inside one
    // Dexie transaction — whose zone tracking assumes its continuation runs in
    // the same microtask tick. Faking that queue defers the continuation to the
    // fake clock, and Dexie aborts with "Transaction committed too early". This
    // test is about which day it is, so `Date` is all it ever needed.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2026, 6, 15, hour, minute));

      const client = clientWithTrip({ name: 'Brittany', start_date: '', end_date: '' });
      const result = await materialiseJoinedTrip(client, REMOTE_TRIP_ID);
      const trip = await db.trips.get((result as { tripId: TripId }).tripId);

      expect(trip?.startDate).toBe('2026-07-15');
      expect(trip?.endDate).toBe('2026-07-15');
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The name a join writes is persisted, not rendered on the fly: every screen
   * that shows a trip reads `trip.name` straight out of Dexie. So it has to be a
   * real string, and in an app whose fallback language is French it has to be a
   * translated one — 'Shared trip' put an English label on a French user's trip
   * list, and the second spelling ('Shared Trip', from the CRDT bridge) meant the
   * same guest saw a different name depending on how they got in.
   */
  it('names an unnamed trip through i18n rather than in English', async () => {
    const client = clientWithTrip({ start_date: '2026-07-15', end_date: '2026-07-22' });

    const result = await materialiseJoinedTrip(client, REMOTE_TRIP_ID);
    const trip = await db.trips.get((result as { tripId: TripId }).tripId);

    // The resolved French string, not the key — see the mock at the top. Storing
    // 'trips.untitled' as a trip's name would pass a key-echoing assertion and
    // put a raw i18n key on the user's trip list.
    expect(trip?.name).toBe(frTranslations.trips.untitled);
    expect(trip?.name).not.toBe('Shared trip');
    expect(trip?.name).not.toBe('Shared Trip');
    expect(trip?.name).not.toBe('trips.untitled');
  });

  /**
   * The invariant the fix exists for, asserted across both writers rather than
   * asserted about the locale files.
   *
   * A previous version of this test only checked that `trips.untitled` was
   * present in both bundles, which would still have passed if the bridge were
   * changed to a different key — the two paths could diverge silently, which is
   * the bug (two spellings of 'Shared trip') in a new costume.
   */
  it('gives a nameless trip the same name the CRDT bridge gives it', async () => {
    const joined = await materialiseJoinedTrip(clientWithTrip(null), REMOTE_TRIP_ID);
    const joinedTrip = await db.trips.get((joined as { tripId: TripId }).tripId);

    // A local row with no name — what the assistant's create-trip action
    // produces from an LLM that emits an empty one — projected from a document
    // that does not name the trip either.
    const bridgeTripId = 'bridge-trip' as TripId;
    const now = Date.now() as UnixTimestamp;
    await db.trips.add({
      id: bridgeTripId,
      name: '',
      startDate: isoDate('2026-07-15'),
      endDate: isoDate('2026-07-22'),
      shareId: 'bridgeshr1' as ShareId,
      createdAt: now,
      updatedAt: now,
    });
    const doc = new Y.Doc();
    doc.getMap('meta').set('schema', DOC_SCHEMA_VERSION);
    await syncDocToDexie(doc, bridgeTripId);

    const bridgeTrip = await db.trips.get(bridgeTripId);
    expect(bridgeTrip?.name).toBe(joinedTrip?.name);
    expect(bridgeTrip?.name).toBe(frTranslations.trips.untitled);
  });

  it.each([
    ['no preview row at all', null],
    ['a row with no name', { start_date: '2026-07-15', end_date: '2026-07-22' }],
    ['a blank name', { name: '', start_date: '2026-07-15', end_date: '2026-07-22' }],
    [
      'a whitespace-only name',
      { name: '   \n ', start_date: '2026-07-15', end_date: '2026-07-22' },
    ],
    [
      'a name of the wrong type',
      { name: 42, start_date: '2026-07-15', end_date: '2026-07-22' },
    ],
  ])('resolves %s to one fallback name', async (_label, row) => {
    const result = await materialiseJoinedTrip(clientWithTrip(row), REMOTE_TRIP_ID);
    const trip = await db.trips.get((result as { tripId: TripId }).tripId);

    // One substitution point, so every missing-name path agrees. Three separate
    // literals used to disagree with each other in casing alone.
    expect(trip?.name).toBe(frTranslations.trips.untitled);
  });
});

// ============================================================================
// claimParticipant
// ============================================================================

describe('claimParticipant', () => {
  /**
   * Models PostgREST honestly, which the previous double did not: the builder
   * is awaitable on its own, and `select()` is what makes the affected rows
   * come back. An UPDATE with no `select()` compiles to a plain UPDATE, and in
   * SQL that succeeds with zero rows affected and reports no error — so a fake
   * that terminated at `eq()` could not express the case that mattered.
   */
  function clientWithUpdate(
    result: { rows?: unknown[] | null; error?: unknown } = {},
  ) {
    const { rows = [{ person_id: 'person-alice' }], error = null } = result;
    const terminal = {
      select: () => Promise.resolve({ data: rows, error }),
      then: (resolve: (value: { data: null; error: unknown }) => unknown) =>
        resolve({ data: null, error }),
    };
    const update = vi.fn(() => ({ eq: () => ({ eq: () => terminal }) }));
    return { client: { from: () => ({ update }) } as never, update };
  }

  const claim = (client: never) =>
    claimParticipant(client, REMOTE_TRIP_ID, 'user-1', 'person-alice');

  it('confirms the claim from the row the server actually wrote', async () => {
    const { client } = clientWithUpdate();

    await expect(claim(client)).resolves.toEqual({ status: 'claimed' });
  });

  it('does not report success when the update matched no row', async () => {
    // Happens whenever the roster row is not visible to this account: redeem
    // never completed, the session belongs to a different user than the one
    // that redeemed, or RLS filters the row out. Reporting success would leave
    // the identity null while the UI moved on, and an unclaimed participant
    // still looks free — so the next person to join could claim the same name.
    const { client } = clientWithUpdate({ rows: [] });

    await expect(claim(client)).resolves.toEqual({ status: 'not-a-member' });
  });

  it('reports a taken participant rather than an opaque error', async () => {
    // The unique constraint is the enforcement point, so a conflict is an
    // expected outcome to explain — not a bug to pre-check for, which would
    // leave a race between the check and the write.
    const { client } = clientWithUpdate({
      error: { code: '23505', message: 'duplicate key' },
    });

    await expect(claim(client)).resolves.toEqual({ status: 'taken' });
  });

  it('surfaces any other failure', async () => {
    const { client } = clientWithUpdate({
      error: { code: '42501', message: 'denied' },
    });

    await expect(claim(client)).resolves.toEqual({ status: 'error', message: 'denied' });
  });

  it('writes only the person id', async () => {
    const { client, update } = clientWithUpdate();

    await claim(client);

    const [values] = update.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(values).toEqual({ person_id: 'person-alice' });
  });
});

// ============================================================================
// fetchClaimedParticipants
// ============================================================================

describe('fetchClaimedParticipants', () => {
  function clientWithMembers(rows: unknown, error: unknown = null) {
    return {
      from: () => ({
        select: () => ({ eq: async () => ({ data: rows, error }) }),
      }),
    } as never;
  }

  it("excludes the caller's own claim so they can keep it", async () => {
    const client = clientWithMembers([
      { user_id: 'user-1', person_id: 'person-alice' },
      { user_id: 'user-2', person_id: 'person-bob' },
    ]);

    const claimed = await fetchClaimedParticipants(client, REMOTE_TRIP_ID, 'user-1');

    expect(claimed.has('person-bob')).toBe(true);
    expect(claimed.has('person-alice')).toBe(false);
  });

  it('ignores members who have not claimed anyone', async () => {
    const client = clientWithMembers([
      { user_id: 'user-2', person_id: null },
      { user_id: 'user-3', person_id: 'person-carol' },
    ]);

    const claimed = await fetchClaimedParticipants(client, REMOTE_TRIP_ID, 'user-1');

    expect([...claimed]).toEqual(['person-carol']);
  });

  it('returns an empty set when the roster cannot be read', async () => {
    const client = clientWithMembers(null, { message: 'boom' });

    // Better to offer every name and let the unique constraint reject one than
    // to block the identity step entirely.
    await expect(
      fetchClaimedParticipants(client, REMOTE_TRIP_ID, 'user-1'),
    ).resolves.toEqual(new Set());
  });
});
