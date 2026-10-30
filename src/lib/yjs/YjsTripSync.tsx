/**
 * @fileoverview Yjs trip sync bridge component.
 *
 * Mounts a YjsProvider when the current trip has P2P credentials,
 * and keeps the Y.Doc in sync with Dexie data changes.
 *
 * @module lib/yjs/YjsTripSync
 */

import { type ReactElement, type ReactNode, memo, useEffect, useRef } from 'react';
import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';

import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { SupabaseTripSync } from '@/lib/sync/SupabaseTripSync';
import type {
  Activity,
  Expense,
  Meal,
  Person,
  Ride,
  Room,
  RoomAssignment,
  ShoppingItem,
  Transport,
  TripId,
  Vehicle,
} from '@/types';

import { YjsProvider, useYjsContext } from './YjsProvider';
import {
  isDexieTrustedMirror,
  populateDocFromDexie,
  syncDexieToDoc,
  syncTripMetaToDoc,
} from './dexie-bridge';
import type { DocCollectionName } from './doc-model';

function stripTripId<T extends { tripId?: unknown }>(
  items: readonly T[],
): Record<string, unknown>[] {
  return items.map((item) => {
    const nextItem = { ...(item as T & Record<string, unknown>) };
    delete nextItem.tripId;
    return nextItem;
  });
}

/**
 * A trip's rows, or `null` when what is in hand does not belong to it.
 *
 * `useLiveQuery` does not clear its result when its deps change: `useObservable`
 * holds the last value in a ref and only seeds it while `hasResult` is false,
 * which it has not been since the first trip. So for the whole gap between
 * re-subscribing and the new query emitting, it keeps returning the **previous**
 * trip's rows under the new trip's id.
 *
 * That gap overlaps the document swap, and the overlap is not a narrow one.
 * `useTripDoc` publishes the new document as soon as `loadPersistedUpdates`
 * resolves, which for a freshly joined trip is a read of an empty update log —
 * so it reliably wins the race against a live query going through Dexie's
 * observability layer. Every sync effect below then fires on exactly the wrong
 * pair: the trip that was just opened, and the guests of the one just left.
 *
 * Writing those into the document is not a display glitch. They become genuine
 * CRDT content — persisted, queued to the outbox, pushed to every other member —
 * and the next projection moves them for real, because `syncDocToDexie` writes
 * back through `bulkPut` keyed on each row's own id and so rewrites the existing
 * row's `tripId` rather than adding a copy. The trip that was left loses its
 * guests, its rooms and its transport, for everybody.
 *
 * Tagging the result with the trip it was read for is what closes that window: a
 * stale value can then be recognised as stale rather than merely looking like a
 * plausible one.
 */
function useTripScopedRows<T>(
  tripId: TripId,
  read: (tripId: TripId) => Promise<T[]>,
): readonly T[] | null {
  const result = useLiveQuery(
    async () => ({ tripId, rows: await read(tripId) }),
    [tripId],
  );

  return result?.tripId === tripId ? result.rows : null;
}

const YjsSyncObserver = memo(function YjsSyncObserver({
  tripId,
  readOnly,
}: {
  readonly tripId: TripId;
  /**
   * A viewer trip: the document is the server's, replayed, and nothing from
   * Dexie may be written into it.
   *
   * Every effect below that writes into the document is skipped while this is
   * set. The hazard is not cosmetic. A viewer's Dexie rows are a projection
   * taken at some earlier moment; writing them back as new CRDT items would put
   * that moment's values ahead of whatever the members wrote since, and the day
   * the viewer signs in `reconcile()` would push them over everybody's copy.
   * `populateDocFromDexie` is the worst offender — it runs on every open — but
   * the per-collection effects fire on any Dexie write too.
   */
  readonly readOnly: boolean;
}): null {
  const yjs = useYjsContext();
  /**
   * Which trip has been populated, not merely *whether* one has.
   *
   * A plain boolean latched true on the first trip and never reset, because this
   * component is reused across trips rather than remounted. The second trip's
   * document then never had `meta.id` set — and `syncTripMetaToDoc` deliberately
   * never sets it — so `syncDocToDexie` rejected every remote update for it, and
   * that trip silently stopped receiving other people's changes.
   */
  const populatedForRef = useRef<TripId | null>(null);

  const trip = useLiveQuery(() => db.trips.get(tripId), [tripId]);

  useEffect(() => {
    if (readOnly || !yjs?.loaded || trip?.id !== tripId || populatedForRef.current === tripId) {
      return;
    }

    populatedForRef.current = tripId;

    // A trip the server holds is seeded by the server, never from here.
    //
    // On a freshly joined device the only row is the placeholder `join-trip`
    // wrote — "Untitled trip", today to today, when the preview failed — and
    // the document is empty until the first pull. Seeding it from that row put
    // the placeholder into the document as CRDT items concurrent with the
    // owner's, which Yjs resolves by client id: the placeholder renamed and
    // re-dated the trip for every member about half the time. The same seed on
    // an owner's shared trip merely re-wrote values the document already held,
    // as fresh items pushed to the server on every open. The first upload
    // (`lib/sync/upload-document`) seeds its own document and is unaffected.
    if (trip.remoteTripId !== undefined) {
      return;
    }

    const meta = yjs.doc.getMap('meta');
    if (meta.get('id')) {
      return;
    }

    void populateDocFromDexie(yjs.doc, tripId).catch((error) => {
      console.error('[YjsTripSync] Failed to populate Y.Doc from Dexie:', error);
    });
  }, [readOnly, trip, tripId, yjs?.doc, yjs?.loaded]);
  const persons = useTripScopedRows<Person>(tripId, (id) =>
    db.persons.where('tripId').equals(id).toArray(),
  );
  const rooms = useTripScopedRows<Room>(tripId, (id) =>
    db.rooms
      .where('[tripId+order]')
      .between([id, Dexie.minKey], [id, Dexie.maxKey])
      .toArray(),
  );
  const roomAssignments = useTripScopedRows<RoomAssignment>(tripId, (id) =>
    db.roomAssignments
      .where('[tripId+startDate]')
      .between([id, Dexie.minKey], [id, Dexie.maxKey])
      .toArray(),
  );
  const transports = useTripScopedRows<Transport>(tripId, (id) =>
    db.transports
      .where('[tripId+datetime]')
      .between([id, Dexie.minKey], [id, Dexie.maxKey])
      .toArray(),
  );
  const rides = useTripScopedRows<Ride>(tripId, (id) =>
    db.rides
      .where('[tripId+meetDatetime]')
      .between([id, Dexie.minKey], [id, Dexie.maxKey])
      .toArray(),
  );
  const vehicles = useTripScopedRows<Vehicle>(tripId, (id) =>
    db.vehicles.where('tripId').equals(id).toArray(),
  );
  const activities = useTripScopedRows<Activity>(tripId, (id) =>
    db.activities
      .where('[tripId+startDatetime]')
      .between([id, Dexie.minKey], [id, Dexie.maxKey])
      .toArray(),
  );
  const expenses = useTripScopedRows<Expense>(tripId, (id) =>
    db.expenses
      .where('[tripId+date]')
      .between([id, Dexie.minKey], [id, Dexie.maxKey])
      .toArray(),
  );
  // Through the plain `tripId` index: the meal planner is behind a flag, but
  // its rows are published by every device, flag on or off. A device that
  // held them back would let the projection read their absence as deletions.
  const meals = useTripScopedRows<Meal>(tripId, (id) =>
    db.meals.where('tripId').equals(id).toArray(),
  );
  const shoppingItems = useTripScopedRows<ShoppingItem>(tripId, (id) =>
    db.shoppingItems.where('tripId').equals(id).toArray(),
  );

  /**
   * Every document collection this component publishes, checked at compile time.
   *
   * `syncDocToDexie` deletes every local row the document does not hold, so a
   * collection that is projected *in* without being published *out* is not
   * merely unsynced — it is deleted on the next update from any member of the
   * trip. Rides and vehicles shipped that way and cost a working car.
   *
   * `satisfies` is what makes the next one a build error instead: adding a name
   * to `DocCollectionName` without adding an effect below fails to compile here.
   * The value is otherwise unused, and deliberately so — the effects still read
   * their own rows, because a single combined effect would republish all seven
   * collections every time any one of them ticked.
   */
  const publishedCollections = {
    guests: persons,
    rooms,
    roomAssignments,
    transport: transports,
    rides,
    vehicles,
    activities,
    expenses,
    meals,
    shoppingItems,
  } satisfies Record<DocCollectionName, unknown>;
  void publishedCollections;

  useEffect(() => {
    // The trip carries its own id, so it needs no tagging to be checked — but it
    // goes stale in exactly the same window, and writing the previous trip's
    // name and dates into this document renames the trip for every member.
    if (readOnly || !yjs?.loaded || trip?.id !== tripId) {
      return;
    }

    // A trip the server holds, whose document this device has not received
    // yet: the row is the placeholder `join-trip` wrote, or a projection from
    // an earlier session, and writing it into an empty document would make it
    // contend with the owner's own meta the moment the first pull lands.
    // Nothing is lost by waiting — the projection rewrites the row from the
    // document, and that write re-runs this effect with values that match.
    if (trip.remoteTripId !== undefined && !yjs.doc.getMap('meta').has('name')) {
      return;
    }

    syncTripMetaToDoc(yjs.doc, {
      name: trip.name,
      startDate: trip.startDate,
      endDate: trip.endDate,
      updatedAt: trip.updatedAt,
      location: trip.location,
      description: trip.description,
      coordinates: trip.coordinates,
      currency: trip.currency,
      // Whether the trip has been put away. `undefined` removes the key, which
      // is how a trip nobody ever archived stays free of it; `false` is a real
      // write that says a member took it back out.
      archived: trip.archived,
      // The cover photo's id. The bytes go through Storage (`lib/photos`).
      photoId: trip.photoId,
    });
  }, [
    readOnly,
    trip,
    trip?.archived,
    trip?.coordinates,
    trip?.currency,
    trip?.description,
    trip?.endDate,
    trip?.location,
    trip?.name,
    trip?.photoId,
    trip?.startDate,
    trip?.updatedAt,
    tripId,
    yjs?.doc,
    yjs?.loaded,
  ]);

  useEffect(() => {
    if (readOnly || !yjs?.loaded || !persons) {
      return;
    }

    syncDexieToDoc(yjs.doc, 'guests', stripTripId(persons), {
      allowDeletions: isDexieTrustedMirror(yjs.doc, tripId),
    });
  }, [readOnly, persons, tripId, yjs?.doc, yjs?.loaded]);

  useEffect(() => {
    if (readOnly || !yjs?.loaded || !rooms) {
      return;
    }

    syncDexieToDoc(yjs.doc, 'rooms', stripTripId(rooms), {
      allowDeletions: isDexieTrustedMirror(yjs.doc, tripId),
    });
  }, [readOnly, rooms, tripId, yjs?.doc, yjs?.loaded]);

  useEffect(() => {
    if (readOnly || !yjs?.loaded || !roomAssignments) {
      return;
    }

    syncDexieToDoc(yjs.doc, 'roomAssignments', stripTripId(roomAssignments), {
      allowDeletions: isDexieTrustedMirror(yjs.doc, tripId),
    });
  }, [readOnly, roomAssignments, tripId, yjs?.doc, yjs?.loaded]);

  useEffect(() => {
    if (readOnly || !yjs?.loaded || !transports) {
      return;
    }

    syncDexieToDoc(yjs.doc, 'transport', stripTripId(transports), {
      allowDeletions: isDexieTrustedMirror(yjs.doc, tripId),
    });
  }, [readOnly, transports, tripId, yjs?.doc, yjs?.loaded]);

  useEffect(() => {
    if (readOnly || !yjs?.loaded || !rides) {
      return;
    }

    syncDexieToDoc(yjs.doc, 'rides', stripTripId(rides), {
      allowDeletions: isDexieTrustedMirror(yjs.doc, tripId),
    });
  }, [readOnly, rides, tripId, yjs?.doc, yjs?.loaded]);

  useEffect(() => {
    if (readOnly || !yjs?.loaded || !vehicles) {
      return;
    }

    syncDexieToDoc(yjs.doc, 'vehicles', stripTripId(vehicles), {
      allowDeletions: isDexieTrustedMirror(yjs.doc, tripId),
    });
  }, [readOnly, vehicles, tripId, yjs?.doc, yjs?.loaded]);

  useEffect(() => {
    if (readOnly || !yjs?.loaded || !activities) {
      return;
    }

    syncDexieToDoc(yjs.doc, 'activities', stripTripId(activities), {
      allowDeletions: isDexieTrustedMirror(yjs.doc, tripId),
    });
  }, [readOnly, activities, tripId, yjs?.doc, yjs?.loaded]);

  useEffect(() => {
    if (readOnly || !yjs?.loaded || !expenses) {
      return;
    }

    syncDexieToDoc(yjs.doc, 'expenses', stripTripId(expenses), {
      allowDeletions: isDexieTrustedMirror(yjs.doc, tripId),
    });
  }, [readOnly, expenses, tripId, yjs?.doc, yjs?.loaded]);

  useEffect(() => {
    if (readOnly || !yjs?.loaded || !meals) {
      return;
    }

    syncDexieToDoc(yjs.doc, 'meals', stripTripId(meals), {
      allowDeletions: isDexieTrustedMirror(yjs.doc, tripId),
    });
  }, [readOnly, meals, tripId, yjs?.doc, yjs?.loaded]);

  useEffect(() => {
    if (readOnly || !yjs?.loaded || !shoppingItems) {
      return;
    }

    syncDexieToDoc(yjs.doc, 'shoppingItems', stripTripId(shoppingItems), {
      allowDeletions: isDexieTrustedMirror(yjs.doc, tripId),
    });
  }, [readOnly, shoppingItems, tripId, yjs?.doc, yjs?.loaded]);

  return null;
});

interface TripYjsSyncBindingProps {
  readonly tripId: TripId;
  /** Server `trips.id`. Absent means the trip is local-only. */
  readonly remoteTripId?: string;
  /** The invite token a viewer trip is read through. Absent for a member trip. */
  readonly viewerToken?: string;
  readonly children?: ReactNode;
}

/**
 * Opens the trip's document and attaches the server sync to it.
 *
 * There is one transport now, so there is nothing to choose between: the
 * document is always local and durable, and the server provider mounts on top
 * when the trip has been shared and somebody is signed in.
 */
const TripYjsSyncBinding = memo(function TripYjsSyncBinding({
  tripId,
  remoteTripId,
  viewerToken,
  children,
}: TripYjsSyncBindingProps): ReactElement {
  return (
    <YjsProvider tripId={tripId}>
      <YjsSyncObserver tripId={tripId} readOnly={viewerToken !== undefined} />
      <SupabaseTripSync
        tripId={tripId}
        remoteTripId={remoteTripId}
        viewerToken={viewerToken}
      >
        {children}
      </SupabaseTripSync>
    </YjsProvider>
  );
});

const YjsTripSync = memo(function YjsTripSync({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement {
  const { currentTrip } = useTripContext();

  // Every trip gets a document, shared or not: it is the local durability layer,
  // not a feature of sharing. Previously this had to mint WebRTC credentials
  // first, which coupled offline persistence to a transport.
  if (!currentTrip?.id) {
    return <>{children}</>;
  }

  return (
    <TripYjsSyncBinding
      viewerToken={currentTrip.viewerToken}
      tripId={currentTrip.id}
      {...(currentTrip.remoteTripId ? { remoteTripId: currentTrip.remoteTripId } : {})}
    >
      {children}
    </TripYjsSyncBinding>
  );
});

export { TripYjsSyncBinding, YjsTripSync };
