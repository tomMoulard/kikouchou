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
import type { Activity, Person, Room, RoomAssignment, Transport, TripId } from '@/types';

import { ensureTripP2pCredentials } from './ensure-trip-p2p-credentials';
import { P2PSyncPresence } from './P2PSyncPresence';
import { YjsProvider, useYjsContext } from './YjsProvider';
import { populateDocFromDexie, syncDexieToDoc, syncTripMetaToDoc } from './dexie-bridge';
import { resolveTripPresenceProfile } from './presence';

function stripTripId<T extends { tripId?: unknown }>(
  items: readonly T[],
): Record<string, unknown>[] {
  return items.map((item) => {
    const nextItem = { ...(item as T & Record<string, unknown>) };
    delete nextItem.tripId;
    return nextItem;
  });
}

const YjsSyncObserver = memo(function YjsSyncObserver({
  tripId,
}: {
  readonly tripId: TripId;
}): null {
  const yjs = useYjsContext();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!yjs?.loaded || initializedRef.current) {
      return;
    }

    initializedRef.current = true;
    const meta = yjs.doc.getMap('meta');
    if (meta.get('id')) {
      return;
    }

    void populateDocFromDexie(yjs.doc, tripId).catch((error) => {
      console.error('[YjsTripSync] Failed to populate Y.Doc from Dexie:', error);
    });
  }, [tripId, yjs?.doc, yjs?.loaded]);

  const trip = useLiveQuery(() => db.trips.get(tripId), [tripId]);
  const persons = useLiveQuery(
    () => db.persons.where('tripId').equals(tripId).toArray(),
    [tripId],
  );
  const rooms = useLiveQuery(
    () =>
      db.rooms
        .where('[tripId+order]')
        .between([tripId, Dexie.minKey], [tripId, Dexie.maxKey])
        .toArray(),
    [tripId],
  );
  const roomAssignments = useLiveQuery(
    () =>
      db.roomAssignments
        .where('[tripId+startDate]')
        .between([tripId, Dexie.minKey], [tripId, Dexie.maxKey])
        .toArray(),
    [tripId],
  );
  const transports = useLiveQuery(
    () =>
      db.transports
        .where('[tripId+datetime]')
        .between([tripId, Dexie.minKey], [tripId, Dexie.maxKey])
        .toArray(),
    [tripId],
  );
  const activities = useLiveQuery(
    () =>
      db.activities
        .where('[tripId+startDatetime]')
        .between([tripId, Dexie.minKey], [tripId, Dexie.maxKey])
        .toArray(),
    [tripId],
  );

  useEffect(() => {
    if (!yjs?.loaded || !trip) {
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
    });
  }, [
    trip,
    trip?.coordinates,
    trip?.description,
    trip?.endDate,
    trip?.location,
    trip?.name,
    trip?.startDate,
    trip?.updatedAt,
    yjs?.doc,
    yjs?.loaded,
  ]);

  useEffect(() => {
    if (!yjs?.loaded || !persons) {
      return;
    }

    syncDexieToDoc(yjs.doc, 'guests', stripTripId(persons as readonly Person[]));
  }, [persons, yjs?.doc, yjs?.loaded]);

  useEffect(() => {
    if (!yjs?.loaded || !rooms) {
      return;
    }

    syncDexieToDoc(yjs.doc, 'rooms', stripTripId(rooms as readonly Room[]));
  }, [rooms, yjs?.doc, yjs?.loaded]);

  useEffect(() => {
    if (!yjs?.loaded || !roomAssignments) {
      return;
    }

    syncDexieToDoc(
      yjs.doc,
      'roomAssignments',
      stripTripId(roomAssignments as readonly RoomAssignment[]),
    );
  }, [roomAssignments, yjs?.doc, yjs?.loaded]);

  useEffect(() => {
    if (!yjs?.loaded || !transports) {
      return;
    }

    syncDexieToDoc(
      yjs.doc,
      'transport',
      stripTripId(transports as readonly Transport[]),
    );
  }, [transports, yjs?.doc, yjs?.loaded]);

  useEffect(() => {
    if (!yjs?.loaded || !activities) {
      return;
    }

    syncDexieToDoc(
      yjs.doc,
      'activities',
      stripTripId(activities as readonly Activity[]),
    );
  }, [activities, yjs?.doc, yjs?.loaded]);

  return null;
});

interface TripYjsSyncBindingProps {
  readonly tripId: TripId;
  readonly roomId: string;
  readonly encryptionKey: string;
  readonly userName?: string;
  readonly userColor?: string;
  readonly showPresence?: boolean;
  readonly children?: ReactNode;
}

const TripYjsSyncBinding = memo(function TripYjsSyncBinding({
  tripId,
  roomId,
  encryptionKey,
  userName,
  userColor,
  showPresence = false,
  children,
}: TripYjsSyncBindingProps): ReactElement {
  return (
    <YjsProvider
      roomId={roomId}
      encryptionKey={encryptionKey}
      userName={userName}
      userColor={userColor}
    >
      <YjsSyncObserver tripId={tripId} />
      {showPresence ? <P2PSyncPresence /> : null}
      {children}
    </YjsProvider>
  );
});

const YjsTripSync = memo(function YjsTripSync({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement {
  const { currentTrip } = useTripContext();

  /** Create P2P room credentials as soon as a trip is selected so Yjs can connect without opening Share. */
  useEffect(() => {
    if (!currentTrip?.id) {
      return;
    }
    if (currentTrip.p2pRoomId && currentTrip.p2pEncryptionKey) {
      return;
    }

    let cancelled = false;
    void ensureTripP2pCredentials(currentTrip.id).catch((err) => {
      if (!cancelled) {
        console.error('[YjsTripSync] Failed to ensure P2P credentials:', err);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    currentTrip?.id,
    currentTrip?.p2pRoomId,
    currentTrip?.p2pEncryptionKey,
  ]);

  const presence = useLiveQuery(
    async () => (currentTrip ? resolveTripPresenceProfile(currentTrip) : null),
    [currentTrip?.id, currentTrip?.shareId, currentTrip?.updatedAt],
  );

  if (
    !currentTrip?.id ||
    !currentTrip.p2pRoomId ||
    !currentTrip.p2pEncryptionKey
  ) {
    return <>{children}</>;
  }

  return (
    <TripYjsSyncBinding
      tripId={currentTrip.id}
      roomId={currentTrip.p2pRoomId}
      encryptionKey={currentTrip.p2pEncryptionKey}
      userName={presence?.name}
      userColor={presence?.color}
      showPresence={true}
    >
      {children}
    </TripYjsSyncBinding>
  );
});

export { TripYjsSyncBinding, YjsTripSync };
