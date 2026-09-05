/**
 * @fileoverview Yjs ↔ Dexie persistence bridge.
 *
 * Persists raw Yjs binary updates into the yjsUpdates table so the Y.Doc
 * can be reconstructed after a page reload without needing a server.
 * Also syncs the CRDT state back into the existing Dexie tables so the
 * rest of the application continues reading Dexie as before.
 *
 * The document's shape lives in `./doc-model` — this module only moves data
 * between it and Dexie, and owns the trust boundary in `syncDocToDexie`.
 *
 * @module lib/yjs/dexie-bridge
 */

import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import {
  MAX_LENGTHS,
  normalizeChildSeats,
  normalizeLeadTimeMinutes,
  normalizeSeatCount,
  sanitizeOptionalText,
  sanitizeText,
} from '@/lib/db/sanitize';
import { isGuestPhoneSharingEnabled } from '@/lib/flags';
import { toSharedGuest } from '@/lib/sharing/guest-privacy';
import i18n from '@/lib/i18n';
import {
  DOC_SCHEMA_VERSION,
  type DocCollectionName,
  isDeepEqual,
  migrateLegacyArrayCollections,
  readDocCollection,
  readDocSchemaVersion,
  type ReplaceDocCollectionOptions,
  replaceDocCollection,
  stampDocSchemaVersion,
} from './doc-model';
import type {
  Activity,
  ChildSeatKind,
  Person,
  Ride,
  Room,
  RoomAssignment,
  ShareId,
  Transport,
  Trip,
  TripId,
  UnixTimestamp,
  Vehicle,
} from '@/types';
import { CHILD_SEAT_KINDS, RIDE_DIRECTIONS } from '@/types';

const COMPACTION_THRESHOLD = 100;

export const ORIGIN_DEXIE_SYNC = 'dexie-sync';

export type SharedCollectionName = DocCollectionName;
export type { DocCollectionName };
type SharedRecord = Record<string, unknown>;

function stripTripId<T extends { tripId: TripId }>(record: T): SharedRecord {
  const nextRecord = { ...record } as Record<string, unknown>;
  delete nextRecord.tripId;
  return nextRecord;
}

function getMeta(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('meta');
}

/**
 * @param tripId - The **locally resolved** trip. Never `meta.id`, which is
 *   remote-controlled: using it as the write key once let any peer overwrite an
 *   unrelated local trip.
 */
/**
 * The trip's name, from the document if it has a usable one.
 *
 * `meta.get('name')` is peer-controlled and arrives as `unknown`, so both halves
 * of "usable" have to be checked rather than asserted:
 *
 *   - **Type.** Casting it to `string` let a peer store a number in
 *     `db.trips.name`, which is typed `string` everywhere downstream —
 *     `previewName()` then died on `name.trim is not a function` and took the
 *     share dialog with it.
 *   - **Emptiness.** `??` only catches null and undefined, so an empty name was
 *     stored verbatim and rendered as a blank card. The assistant's create-trip
 *     action passes an unvalidated name, so this is reachable without a hostile
 *     peer at all.
 *
 * Deliberately *not* clipped to `MAX_LENGTHS.tripName`. The server permits 200
 * characters and the local form permits 100, so a name between the two is
 * legitimate rather than hostile — and clipping it here would push the shortened
 * value back into the document via `populateDocFromDexie` and rename the trip
 * for the owner who chose it. See the PR for the constraint mismatch itself.
 */
function readTripName(meta: Y.Map<unknown>, existingTrip?: Trip): string {
  const fromDoc = meta.get('name');
  if (typeof fromDoc === 'string' && fromDoc.trim().length > 0) {
    return fromDoc;
  }
  if (existingTrip !== undefined && existingTrip.name.trim().length > 0) {
    return existingTrip.name;
  }
  return i18n.t('trips.untitled');
}

function buildTripRecord(
  doc: Y.Doc,
  tripId: TripId,
  existingTrip?: Trip,
): Trip | null {
  const meta = getMeta(doc);

  const createdAt = meta.get('createdAt');
  const updatedAt = meta.get('updatedAt');

  const trip: Trip = {
    id: tripId,
    // Last resort: a document that has not said what the trip is called yet.
    // This lands in Dexie and is rendered as the trip's *name*, so it goes
    // through i18n like any other string a user reads — a hardcoded 'Shared
    // Trip' put an English label on a French user's trip list.
    //
    // It is a stored name, not a render-time placeholder, because every screen
    // that shows a trip reads `trip.name` straight out of Dexie and an empty one
    // would render as nothing at all. That means `populateDocFromDexie` can push
    // it back into the document, so two devices in two languages could each
    // write their own placeholder; the map converges and either can rename the
    // trip. The real fix is for the bridge not to name trips at all, which needs
    // every renderer to handle a nameless one first.
    name: readTripName(meta, existingTrip),
    startDate:
      (meta.get('startDate') as Trip['startDate']) ??
      existingTrip?.startDate ??
      ('' as Trip['startDate']),
    endDate:
      (meta.get('endDate') as Trip['endDate']) ??
      existingTrip?.endDate ??
      ('' as Trip['endDate']),
    // NEVER take shareId from a peer: it is a UNIQUE Dexie index, so a value
    // colliding with another local trip aborts the whole write transaction and
    // permanently kills sync for this trip.
    shareId: existingTrip?.shareId ?? (tripId.slice(0, 10) as ShareId),
    createdAt:
      ((typeof createdAt === 'number' ? createdAt : existingTrip?.createdAt) as UnixTimestamp | undefined) ??
      (Date.now() as UnixTimestamp),
    updatedAt:
      ((typeof updatedAt === 'number' ? updatedAt : existingTrip?.updatedAt) as UnixTimestamp | undefined) ??
      (Date.now() as UnixTimestamp),
    // Never adopted from the document: it links this trip to its server row and
    // is established locally when the trip is shared or joined.
    ...(existingTrip?.remoteTripId
      ? { remoteTripId: existingTrip.remoteTripId }
      : {}),
  };

  // Bounded, unlike the name above, and the asymmetry is the point.
  //
  // A name between 100 and 200 characters is *legitimate* — the server's check
  // constraint allows it even though the local form does not — so clipping one
  // here would corrupt a real trip. Nothing legitimate produces an over-long
  // location or description: every local writer already caps them at
  // `MAX_LENGTHS`, so a longer one came from a peer that did not, and healing it
  // on the way back into the document is the wanted outcome rather than a
  // hazard.
  //
  // Without this the description was the unbounded payload the whole exercise
  // was about: `sanitizeTripData` guards the form and the repository, but a
  // peer's 50,000-character description went straight into Dexie and was pushed
  // back out by `populateDocFromDexie` for every other device to download.
  const location = meta.get('location');
  const boundedLocation = sanitizeOptionalText(
    typeof location === 'string' ? location : undefined,
    MAX_LENGTHS.tripLocation,
  );
  if (boundedLocation !== undefined) {
    trip.location = boundedLocation;
  }

  const description = meta.get('description');
  const boundedDescription = sanitizeOptionalText(
    typeof description === 'string' ? description : undefined,
    MAX_LENGTHS.tripDescription,
  );
  if (boundedDescription !== undefined) {
    trip.description = boundedDescription;
  }

  const coordinates = meta.get('coordinates');
  if (
    coordinates &&
    typeof coordinates === 'object' &&
    typeof (coordinates as { lat?: unknown }).lat === 'number' &&
    typeof (coordinates as { lon?: unknown }).lon === 'number'
  ) {
    trip.coordinates = {
      lat: (coordinates as { lat: number }).lat,
      lon: (coordinates as { lon: number }).lon,
    };
  }

  return trip;
}

function readCollection(doc: Y.Doc, name: SharedCollectionName): SharedRecord[] {
  return readDocCollection(doc, name);
}

/**
 * Projects one guest out of the document, bounding what the server carried.
 *
 * The document holds other members' writes, so a guest's `phone` arrives from
 * outside this device and has passed no form. Bounding it here — the module's
 * trust boundary — keeps an unbounded string out of Dexie and out of the card
 * that renders it.
 */
function buildGuestRecord(
  guest: SharedRecord,
  tripId: TripId,
  options: { readonly localRow?: Person; readonly sharePhone: boolean },
): Person {
  const person = { ...guest, tripId } as Person;

  if (person.phone !== undefined) {
    const boundedPhone = sanitizeOptionalText(person.phone, MAX_LENGTHS.personPhone);
    if (boundedPhone === undefined) {
      delete person.phone;
    } else {
      person.phone = boundedPhone;
    }
  }

  // A document with no phone for this guest means two different things, and
  // reading it the wrong way costs the user the number they just typed.
  //
  // While `guest-phone-sharing` is off this device never publishes a phone, so
  // the document was never going to carry one and its silence says nothing. The
  // projection `bulkPut`s whole rows, so taking that silence at face value would
  // have this device's own sync loop overwrite its local-only number seconds
  // after the form saved it. Carry the local value forward instead.
  //
  // With the flag on the document *is* where this guest's phone lives, so an
  // absent one is a real deletion — by this device or another member — and must
  // land.
  if (person.phone === undefined && !options.sharePhone && options.localRow?.phone !== undefined) {
    person.phone = options.localRow.phone;
  }

  return person;
}

/**
 * Projects one ride out of the document, bounding what the log carried.
 *
 * A ride arrives from another member's device and has passed no form of ours.
 * Two fields do real damage unbounded, so both are pinned here at the trust
 * boundary rather than at the components that read them:
 *
 * - `leadTimeMinutes` is subtracted from an instant to produce a "leave now"
 *   time. A peer sending 10^9 puts that alert nineteen centuries in the past,
 *   where it is permanently due and permanently on screen.
 * - `direction` drives an icon and a phrase lookup. An unknown value from a
 *   newer peer falls back to `pickup` rather than rendering an empty pill.
 *
 * @param ride - The record as the document holds it
 * @param tripId - The local trip id, which is the only write key
 * @returns A bounded row ready for Dexie
 */
function buildRideRecord(ride: SharedRecord, tripId: TripId): Ride {
  const row = { ...ride, tripId } as Ride;

  row.location = sanitizeText(String(row.location ?? ''), MAX_LENGTHS.rideLocation);
  row.leadTimeMinutes = normalizeLeadTimeMinutes(row.leadTimeMinutes);
  row.notes = sanitizeOptionalText(row.notes, MAX_LENGTHS.rideNotes);

  if (!RIDE_DIRECTIONS.includes(row.direction)) {
    row.direction = 'pickup';
  }

  return row;
}

/**
 * Projects one vehicle out of the document, bounding what the log carried.
 *
 * `seatCount` and `childSeats` are the fields that matter. A seat count is
 * compared against a headcount and rendered; a child-seat list is rendered one
 * badge per entry, so an unbounded array from a peer is a rendering bomb rather
 * than merely wrong data — the shape of the `capacity` bug this codebase
 * already paid for once, where `Array.from({length: capacity})` killed the tab.
 *
 * @param vehicle - The record as the document holds it
 * @param tripId - The local trip id, which is the only write key
 * @returns A bounded row ready for Dexie
 */
function buildVehicleRecord(vehicle: SharedRecord, tripId: TripId): Vehicle {
  const row = { ...vehicle, tripId } as Vehicle;

  row.name = sanitizeText(String(row.name ?? ''), MAX_LENGTHS.vehicleName);
  row.seatCount = normalizeSeatCount(row.seatCount);
  row.luggageNotes = sanitizeOptionalText(
    row.luggageNotes,
    MAX_LENGTHS.vehicleLuggageNotes,
  );
  row.notes = sanitizeOptionalText(row.notes, MAX_LENGTHS.vehicleNotes);

  row.childSeats = Array.isArray(row.childSeats)
    ? normalizeChildSeats(
        row.childSeats.filter((kind): kind is ChildSeatKind =>
          (CHILD_SEAT_KINDS as readonly unknown[]).includes(kind),
        ),
      )
    : undefined;

  return row;
}

async function replaceTripScopedRows<T extends { id: string; tripId: TripId }>(
  currentRows: readonly T[],
  nextRows: readonly T[],
  putMany: (rows: T[]) => Promise<unknown>,
  removeMany: (ids: string[]) => Promise<unknown>,
): Promise<void> {
  if (nextRows.length > 0) {
    await putMany([...nextRows]);
  }

  const nextIds = new Set(nextRows.map((row) => row.id));
  const idsToDelete = currentRows
    .filter((row) => !nextIds.has(row.id))
    .map((row) => row.id);

  if (idsToDelete.length > 0) {
    await removeMany(idsToDelete);
  }
}

export async function loadPersistedUpdates(doc: Y.Doc, tripId: TripId): Promise<void> {
  const rows = await db.yjsUpdates.where('tripId').equals(tripId).toArray();

  Y.transact(doc, () => {
    for (const row of rows) {
      Y.applyUpdate(doc, row.update);
    }
  });

  // A document persisted by an older build stores its collections as arrays.
  // Convert before anything reads it, so the first projection to Dexie sees the
  // trip's real contents rather than five empty maps. Idempotent, and safe to
  // run on every device: the conversion is keyed on each record's own id.
  if (readDocSchemaVersion(doc) < DOC_SCHEMA_VERSION) {
    migrateLegacyArrayCollections(doc);
  }

  if (rows.length >= COMPACTION_THRESHOLD) {
    await compactUpdates(doc, tripId);
  }
}

/**
 * Which trips this document has successfully projected into Dexie.
 *
 * A `WeakMap` on the document, so the answer resets whenever the document is
 * recreated — a trip switch, a reload, a fresh join. That is the right lifetime:
 * a new document has not yet shown that Dexie mirrors it, so it must earn the
 * right to prune again rather than inherit it.
 *
 * This is what stops an invitee's empty Dexie deleting the owner's trip. Until a
 * projection has actually landed, Dexie is not known to be a complete mirror, so
 * nothing derived from it may delete.
 */
const projectedTrips = new WeakMap<Y.Doc, Set<string>>();

function markProjected(doc: Y.Doc, tripId: TripId): void {
  const trips = projectedTrips.get(doc) ?? new Set<string>();
  trips.add(tripId);
  projectedTrips.set(doc, trips);
}

/**
 * Whether Dexie can be trusted as a complete mirror of this document's trip.
 *
 * Exported so the caller that syncs Dexie back into the document can ask rather
 * than assume.
 */
export function isDexieTrustedMirror(doc: Y.Doc, tripId: TripId): boolean {
  return projectedTrips.get(doc)?.has(tripId) === true;
}

export function subscribeToUpdates(doc: Y.Doc, tripId: TripId): () => void {
  let updateCount = 0;

  const handleUpdate = (update: Uint8Array, origin: unknown): void => {
    void db.yjsUpdates.add({ tripId, update }).catch((error) => {
      console.error('[yjs-bridge] Failed to persist update:', error);
    });

    updateCount += 1;
    if (updateCount >= COMPACTION_THRESHOLD) {
      updateCount = 0;
      void compactUpdates(doc, tripId).catch((error) => {
        console.error('[yjs-bridge] Failed to compact updates:', error);
      });
    }

    if (origin !== ORIGIN_DEXIE_SYNC) {
      void syncDocToDexie(doc, tripId);
    }
  };

  doc.on('update', handleUpdate);
  return () => {
    doc.off('update', handleUpdate);
  };
}

export async function compactUpdates(doc: Y.Doc, tripId: TripId): Promise<void> {
  const snapshot = Y.encodeStateAsUpdate(doc);

  await db.transaction('rw', db.yjsUpdates, async () => {
    await db.yjsUpdates.where('tripId').equals(tripId).delete();
    await db.yjsUpdates.add({ tripId, update: snapshot });
  });
}

/**
 * Projects a document into Dexie.
 *
 * @param tripId - Which local trip this document is for. The caller resolves it
 *   locally — from the selected trip — and it is the **only** id used as a write
 *   key, which is what stops a document ever reaching a trip it was not opened
 *   for. Nothing in the payload is an address.
 *
 * This used to additionally refuse a document whose `meta.id` did not equal
 * `tripId`, which looked like defence in depth and was in fact a data-loss bug.
 * Local trip ids are per-device nanoids: when an invitee joins,
 * `materialiseJoinedTrip` mints a new one, so a document authored by the owner
 * carries the owner's id and can never equal the invitee's. The comparison
 * therefore refused every remote update for every joined trip — and it was a
 * race rather than a clean failure, because both devices write `meta.id` when
 * they populate the document from Dexie, so the two ids fought over one key by
 * last-writer-wins and whichever device lost silently stopped projecting.
 *
 * The security property it appeared to provide is provided by the write key
 * instead, and `meta.id` is no longer written or read at all.
 */
export async function syncDocToDexie(
  doc: Y.Doc,
  tripId: TripId,
): Promise<TripId | null> {
  const ownerTrip = await db.trips.get(tripId);
  if (!ownerTrip) {
    // Projection updates a trip that already exists; it never creates one.
    // Creation is `materialiseJoinedTrip`'s job on the join path and the user's
    // otherwise, both of which establish the local id before any document is
    // opened for it. Without this, a document could conjure a trip row under any
    // id a caller passed — which is the constraint the old `meta.id` comparison
    // was incidentally providing, restored here in a form that does not depend
    // on two devices agreeing on a local id they cannot agree on.
    return null;
  }

  // A document written by an older build keeps its collections in `Y.Array`s,
  // so every `…ById` map reads as legitimately empty. Projecting that would
  // delete every guest, room, assignment, transport and activity of a trip
  // whose data is intact — the emptiness is a schema mismatch, not a deletion.
  // `loadPersistedUpdates` converts local documents on open; this guards the
  // remaining case, a peer that has not upgraded yet.
  const schemaVersion = readDocSchemaVersion(doc);
  if (schemaVersion < DOC_SCHEMA_VERSION) {
    console.warn(
      '[yjs] refusing remote update: doc schema v%d predates v%d',
      schemaVersion,
      DOC_SCHEMA_VERSION,
    );
    return null;
  }

  const nextTrip = buildTripRecord(doc, tripId, ownerTrip);
  if (!nextTrip) {
    return null;
  }

  try {
    await db.transaction(
      'rw',
      [
        db.trips,
        db.persons,
        db.rooms,
        db.roomAssignments,
        db.transports,
        db.rides,
        db.vehicles,
        db.activities,
      ],
      async () => {
        await db.trips.put(nextTrip);

        const currentGuests = await db.persons.where('tripId').equals(tripId).toArray();
        const currentRooms = await db.rooms
          .where('[tripId+order]')
          .between([tripId, -Infinity], [tripId, Infinity])
          .toArray();
        const currentAssignments = await db.roomAssignments
          .where('[tripId+startDate]')
          .between([tripId, ''], [tripId, '\uffff'])
          .toArray();
        const currentTransport = await db.transports
          .where('[tripId+datetime]')
          .between([tripId, ''], [tripId, '\uffff'])
          .toArray();
        const currentRides = await db.rides
          .where('[tripId+meetDatetime]')
          .between([tripId, ''], [tripId, '\uffff'])
          .toArray();
        const currentVehicles = await db.vehicles
          .where('tripId')
          .equals(tripId)
          .toArray();
        const currentActivities = await db.activities
          .where('[tripId+startDatetime]')
          .between([tripId, ''], [tripId, '\uffff'])
          .toArray();

        const sharePhone = isGuestPhoneSharingEnabled();
        const localGuestsById = new Map(currentGuests.map((row) => [row.id as string, row]));
        const nextGuests = readCollection(doc, 'guests').map((guest) =>
          buildGuestRecord(guest, tripId, {
            localRow: localGuestsById.get(String(guest.id)),
            sharePhone,
          }),
        );
        const nextRooms = readCollection(doc, 'rooms').map(
          (room) => ({ ...room, tripId } as Room),
        );
        const nextAssignments = readCollection(doc, 'roomAssignments').map(
          (assignment) => ({ ...assignment, tripId } as RoomAssignment),
        );
        const nextTransport = readCollection(doc, 'transport').map(
          (transport) => ({ ...transport, tripId } as Transport),
        );
        const nextRides = readCollection(doc, 'rides').map((ride) =>
          buildRideRecord(ride, tripId),
        );
        const nextVehicles = readCollection(doc, 'vehicles').map((vehicle) =>
          buildVehicleRecord(vehicle, tripId),
        );
        const nextActivities = readCollection(doc, 'activities').map(
          (activity) => ({ ...activity, tripId } as Activity),
        );

        await replaceTripScopedRows(
          currentGuests,
          nextGuests,
          (rows) => db.persons.bulkPut(rows),
          (ids) => db.persons.bulkDelete([...ids]),
        );
        await replaceTripScopedRows(
          currentRooms,
          nextRooms,
          (rows) => db.rooms.bulkPut(rows),
          (ids) => db.rooms.bulkDelete([...ids]),
        );
        await replaceTripScopedRows(
          currentAssignments,
          nextAssignments,
          (rows) => db.roomAssignments.bulkPut(rows),
          (ids) => db.roomAssignments.bulkDelete([...ids]),
        );
        await replaceTripScopedRows(
          currentTransport,
          nextTransport,
          (rows) => db.transports.bulkPut(rows),
          (ids) => db.transports.bulkDelete([...ids]),
        );
        await replaceTripScopedRows(
          currentRides,
          nextRides,
          (rows) => db.rides.bulkPut(rows),
          (ids) => db.rides.bulkDelete([...ids]),
        );
        await replaceTripScopedRows(
          currentVehicles,
          nextVehicles,
          (rows) => db.vehicles.bulkPut(rows),
          (ids) => db.vehicles.bulkDelete([...ids]),
        );
        await replaceTripScopedRows(
          currentActivities,
          nextActivities,
          (rows) => db.activities.bulkPut(rows),
          (ids) => db.activities.bulkDelete([...ids]),
        );
      },
    );
  } catch (error) {
    console.error('[yjs-bridge] Failed to sync Y.Doc → Dexie:', error);
  }

  // Dexie now mirrors this document for this trip, which is the only basis on
  // which anything derived from Dexie may delete from it.
  markProjected(doc, tripId);

  return tripId;
}

export const applyDocToDexie = syncDocToDexie;

export async function populateDocFromDexie(doc: Y.Doc, tripId: TripId): Promise<void> {
  const [trip, guests, rooms, assignments, transport, rides, vehicles, activities] =
    await Promise.all([
      db.trips.get(tripId),
      db.persons.where('tripId').equals(tripId).toArray(),
      db.rooms
        .where('[tripId+order]')
        .between([tripId, -Infinity], [tripId, Infinity])
        .toArray(),
      db.roomAssignments
        .where('[tripId+startDate]')
        .between([tripId, ''], [tripId, '\uffff'])
        .toArray(),
      db.transports
        .where('[tripId+datetime]')
        .between([tripId, ''], [tripId, '\uffff'])
        .toArray(),
      db.rides
        .where('[tripId+meetDatetime]')
        .between([tripId, ''], [tripId, '\uffff'])
        .toArray(),
      db.vehicles.where('tripId').equals(tripId).toArray(),
      db.activities
        .where('[tripId+startDatetime]')
        .between([tripId, ''], [tripId, '\uffff'])
        .toArray(),
    ]);

  if (!trip) {
    return;
  }

  Y.transact(doc, () => {
    const meta = getMeta(doc);
    // Deliberately no `id`. It was this device's local trip id, which differs
    // per device for a shared trip, so writing it made two devices contend over
    // one key for no reader's benefit — and pushed that contention to the
    // server as a real edit.
    meta.set('name', trip.name);
    meta.set('startDate', trip.startDate);
    meta.set('endDate', trip.endDate);
    meta.set('shareId', trip.shareId);
    meta.set('createdAt', trip.createdAt);
    meta.set('updatedAt', trip.updatedAt);
    if (trip.location !== undefined) meta.set('location', trip.location);
    if (trip.description !== undefined) meta.set('description', trip.description);
    if (trip.coordinates !== undefined) meta.set('coordinates', trip.coordinates);

    stampDocSchemaVersion(doc);

    const sources: readonly [
      DocCollectionName,
      readonly { id: string; tripId: TripId }[],
    ][] = [
      // Redacted on the way out, never on the way into Dexie: the phone stays
      // in this device's IndexedDB whatever the flag says.
      [
        'guests',
        guests.map((guest) => toSharedGuest(guest, { sharePhone: isGuestPhoneSharingEnabled() })),
      ],
      ['rooms', rooms],
      ['roomAssignments', assignments],
      ['transport', transport],
      ['rides', rides],
      ['vehicles', vehicles],
      ['activities', activities],
    ];

    for (const [name, rows] of sources) {
      // Seeding, never reconciling. This runs on mount with whatever Dexie
      // happens to hold, which on a freshly joined device is nothing while the
      // document may already carry the owner's whole trip. Pruning here deleted
      // it for everybody.
      replaceDocCollection(
        doc,
        name,
        rows.map((row) => stripTripId(row) as SharedRecord & { id: string }),
        { allowDeletions: false },
      );
    }
  });
}

/**
 * Pushes a Dexie collection into the document, upserting each row and — only
 * when the mirror is trustworthy — removing the ids that are gone.
 *
 * This used to clear the whole `Y.Array` and rebuild it, which made every local
 * change collide with every concurrent remote one: the merge kept both peers'
 * deletions and both peers' inserts, and `bulkPut` then silently dropped an
 * edit or restored a deleted row. Per-entity writes keep unrelated edits out of
 * each other's way — see `./doc-model`.
 *
 * The removal half is gated on this document having actually projected into
 * Dexie for this trip. Before that, Dexie is not known to mirror the document,
 * and pruning it would delete the owner's rooms and guests for every member —
 * an invitee whose projection was refused, or had not run yet, has an empty
 * Dexie and a full document, and the difference is not a deletion anyone asked
 * for.
 *
 * The decision is the caller's, not this function's: whoever holds the trip id
 * asks {@link isDexieTrustedMirror} and passes the answer. Hiding that policy in
 * here would make it invisible at the call sites whose data it protects, and
 * would leave a legitimately synced device unable to state that it is one.
 */
export function syncDexieToDoc(
  doc: Y.Doc,
  table: SharedCollectionName,
  items: SharedRecord[],
  { allowDeletions }: ReplaceDocCollectionOptions,
): void {
  const identified = items.filter(
    (item): item is SharedRecord & { id: string } =>
      typeof item.id === 'string' && item.id.length > 0,
  );

  // Applied here rather than at the call site on purpose. This is the narrow
  // waist every live Dexie change passes through on its way to the document and
  // therefore to the server, so redacting here is the one edit a future caller
  // cannot forget to make.
  const entities =
    table === 'guests'
      ? identified.map((guest) =>
          toSharedGuest(guest, { sharePhone: isGuestPhoneSharingEnabled() }),
        )
      : identified;

  if (!allowDeletions && entities.length === 0) {
    // Nothing to add and no standing to remove: the whole call is a no-op, and
    // saying so beats writing an empty transaction on every live-query tick.
    return;
  }

  Y.transact(
    doc,
    () => {
      replaceDocCollection(doc, table, entities, { allowDeletions });
    },
    ORIGIN_DEXIE_SYNC,
  );
}

export function syncTripMetaToDoc(doc: Y.Doc, updates: Record<string, unknown>): void {
  const meta = getMeta(doc);
  const entries = Object.entries(updates).filter(
    ([key]) => key !== 'id' && key !== 'shareId' && key !== 'createdAt',
  );

  const hasChanges = entries.some(([key, value]) => {
    if (value === undefined) {
      return meta.has(key);
    }
    return !isDeepEqual(meta.get(key), value);
  });

  if (!hasChanges) {
    return;
  }

  Y.transact(
    doc,
    () => {
      for (const [key, value] of entries) {
        if (value === undefined) {
          meta.delete(key);
        } else {
          meta.set(key, value);
        }
      }
    },
    ORIGIN_DEXIE_SYNC,
  );
}
