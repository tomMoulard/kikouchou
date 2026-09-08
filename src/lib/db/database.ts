/**
 * Kikouchou PWA - Dexie Database Schema
 *
 * This module defines the IndexedDB database schema using Dexie.js v4.
 * The database stores all trip-related data locally for offline-first operation.
 *
 * @module lib/db/database
 */

import Dexie, { type Table } from 'dexie';
import type {
  Activity,
  AppSettings,
  GuestGroup,
  Person,
  Ride,
  Room,
  RoomAssignment,
  Transport,
  Trip,
  Vehicle,
} from '@/types';

/** Current database schema version */
export const DB_VERSION = 10;

// ============================================================================
// Yjs Persistence Types
// ============================================================================

/**
 * Stores raw Yjs CRDT updates for offline persistence and compaction.
 * Each row is a single binary update for a given P2P room.
 */
export interface YjsUpdateRow {
  /** Auto-incremented primary key */
  id?: number;
  /**
   * The trip this update belongs to.
   *
   * Was the WebRTC room id until schema 8. Keying on the trip is what it should
   * always have been: the document is per-trip, and routing it through a room id
   * meant the local persistence layer could not be read without first resolving
   * a credential that only existed because of the transport.
   */
  tripId: string;
  /** Raw Yjs binary update (Uint8Array) */
  update: Uint8Array;
}

/**
 * One local Yjs update awaiting delivery to the server.
 *
 * Written on every local edit and deleted once the server accepts it, so edits
 * made offline survive a closed tab. It is a delivery queue, not the durability
 * record — `yjsUpdates` is that, and the provider's start-up reconciliation
 * (diffing the document against the server's known state vector) is what makes a
 * lost outbox row recoverable rather than lost data.
 */
export interface YjsOutboxRow {
  /** Auto-incremented primary key; also the send order. */
  id?: number;
  /** Local trip this update belongs to. */
  tripId: string;
  /** Raw Yjs binary update. */
  update: Uint8Array;
  /** When it was queued, for diagnostics and stuck-queue detection. */
  queuedAt: number;
}

/**
 * How far this device has consumed a trip's server-side log.
 */
export interface SyncCursorRow {
  /** Local trip id — one cursor per trip. */
  tripId: string;
  /**
   * Highest `trip_doc_updates.id` applied. A pull asks for `id > this`.
   *
   * Advanced only by a completed pull, never by a Realtime payload: Realtime can
   * in principle deliver out of order, and a cursor jumped forward on row 5
   * would silently skip row 4 forever.
   */
  lastSeenUpdateId: number;
  /**
   * State vector of everything the server is known to hold.
   *
   * Recorded only after a push succeeds with nothing left queued. On the next
   * start, `Y.encodeStateAsUpdate(doc, thisVector)` is exactly what the server
   * lacks — which makes the very first upload (no vector stored yet, so the
   * diff is the whole document) and catching up after a crash the same code.
   */
  serverStateVector?: Uint8Array;
  /** Last time a pull or push completed, for the sync badge. */
  syncedAt?: number;
}

/**
 * A trip participant's account, cached so the roster renders offline.
 *
 * The server copy in `trip_members` stays authoritative; this is a projection,
 * and the unique constraint there is what actually stops two accounts claiming
 * the same participant.
 */
export interface TripMemberRow {
  /** Local trip id. */
  tripId: string;
  /** Supabase auth user id. */
  userId: string;
  /** Person id inside the document this account claims to be, if it has. */
  personId?: string;
  joinedAt: number;
}

/**
 * What this device has already seen, and already announced, about one ride.
 *
 * Two jobs, one row, because both answer the same question — "is this news?" —
 * and both are answered per device:
 *
 * - `seenDatetime` is the watermark that makes "Alice moved 17:00 → 19:00"
 *   possible at all. `Transport` carries no `updatedAt` and no history, so a
 *   change is only visible as a difference from what this phone last recorded.
 * - `firedAtMs` stops the same "leave now" being announced on every clock tick,
 *   every tab focus and every re-render.
 *
 * Deliberately **not** a document collection. A notification another device
 * already showed is a fact about that device, and syncing it would mean the
 * first phone to open the app silently suppresses everybody else's alerts.
 */
export interface RideNoticeRow {
  /**
   * Primary key, `${kind}:${subjectId}` — e.g. `leave:ride_abc`,
   * `moved:transport_xyz`. Composed rather than compound so a notice can be
   * addressed without knowing which of the two ids it hangs off.
   */
  key: string;
  /** Local trip id, carrying this row through `deleteTrip`'s cascade. */
  tripId: string;
  /**
   * The leg datetime this device last showed the user, ISO 8601.
   * Present on watermark rows; a difference from the live value is the change.
   */
  seenDatetime?: string;
  /** When this device last announced this notice, epoch ms. */
  firedAtMs?: number;
}

/**
 * Kikouchou IndexedDB database class.
 *
 * Provides typed access to all application data tables with optimized
 * indexes for common query patterns.
 *
 * @example
 * ```typescript
 * import { db } from '@/lib/db/database';
 *
 * // Add a new trip
 * await db.trips.add(trip);
 *
 * // Get all rooms for a trip ordered by display order
 * const rooms = await db.rooms
 *   .where('[tripId+order]')
 *   .between([tripId, Dexie.minKey], [tripId, Dexie.maxKey])
 *   .toArray();
 *
 * // Get a trip by share ID
 * const trip = await db.trips.where('shareId').equals(shareId).first();
 * ```
 *
 * ## Schema Version History
 *
 * ### Version 1 (Initial)
 * - Created all core tables: trips, rooms, persons, roomAssignments, transports, settings
 * - Added compound indexes for efficient trip-scoped queries
 * - Added shareId index on trips for sharing feature
 */
export class KikouchouDatabase extends Dexie {
  /**
   * Trips table - stores vacation/holiday events.
   * Primary key: id (TripId)
   * Indexes: &shareId (unique), startDate, createdAt
   */
  trips!: Table<Trip, string>;

  /**
   * Rooms table - stores rooms within vacation houses.
   * Primary key: id (RoomId)
   * Indexes: [tripId+order] for ordered room lists within a trip
   */
  rooms!: Table<Room, string>;

  /**
   * Persons table - stores trip participants.
   * Primary key: id (PersonId)
   * Indexes: tripId, [tripId+name] for searching within a trip
   */
  persons!: Table<Person, string>;

  /**
   * Room assignments table - links persons to rooms for date ranges.
   * Primary key: id (RoomAssignmentId)
   * Compound indexes: [tripId+startDate], [tripId+personId], [tripId+roomId]
   */
  roomAssignments!: Table<RoomAssignment, string>;

  /**
   * Transports table - stores arrival/departure events.
   * Primary key: id (TransportId)
   * Compound indexes: [tripId+datetime], [tripId+personId], [tripId+type]
   */
  transports!: Table<Transport, string>;

  /**
   * Rides table - stores the car journeys that serve transport legs.
   * Primary key: id (RideId)
   * Indexes: tripId, driverId (cascade), vehicleId (cascade)
   * Compound index: [tripId+meetDatetime] for the chronological read
   *
   * Passengers are not stored here: a leg points at its ride through
   * `Transport.rideId`, because the shared document merges an array field
   * atomically and two guests joining one car offline would lose a join.
   */
  rides!: Table<Ride, string>;

  /**
   * Vehicles table - stores the cars available to a trip.
   * Primary key: id (VehicleId)
   * Indexes: tripId, ownerId (cascade)
   */
  vehicles!: Table<Vehicle, string>;

  /**
   * Ride notices - device-local record of what this phone has already shown.
   * Primary key: key
   * Indexes: tripId, for the delete cascade
   *
   * See {@link RideNoticeRow}. Never a document collection: a notification
   * another device already fired is not a fact about the trip.
   */
  rideNotices!: Table<RideNoticeRow, string>;

  /**
   * Activities table - stores the shared trip agenda (outings, events, meals).
   * Primary key: id (ActivityId)
   * Compound indexes: [tripId+startDatetime], [tripId+category]
   * Multi-entry index: *participantIds (activities a given guest joined)
   */
  activities!: Table<Activity, string>;

  /**
   * Settings table - stores application settings (singleton).
   * Primary key: id (always 'settings')
   */
  settings!: Table<AppSettings, string>;

  /**
   * Yjs updates table - stores raw CRDT binary updates for P2P sync persistence.
   * Primary key: ++id (auto-increment)
   * Indexes: roomId for loading all updates of a given P2P room
   */
  yjsUpdates!: Table<YjsUpdateRow, number>;

  /** Local updates not yet accepted by the server. See {@link YjsOutboxRow}. */
  yjsOutbox!: Table<YjsOutboxRow, number>;

  /** Per-trip position in the server log. See {@link SyncCursorRow}. */
  syncCursors!: Table<SyncCursorRow, string>;

  /** Cached server roster. See {@link TripMemberRow}. */
  tripMembers!: Table<TripMemberRow, [string, string]>;

  /**
   * Guest groups - reusable rosters imported into trips.
   * Primary key: id (GuestGroupId)
   * Indexes: name (list order), remoteGroupId (reconciling a pull)
   *
   * The one entity table that is **not** trip-scoped, so it deliberately has no
   * `tripId` index and takes no part in `deleteTrip`'s cascade: deleting a trip
   * must not delete the group its guests came from.
   */
  guestGroups!: Table<GuestGroup, string>;

  /**
   * @param name - Database name. Defaults to the real one; a test passes its own
   *   so it can build a fixture at an older schema version and then observe the
   *   upgrade. Without this seam the migrations were untestable: every instance
   *   opened the same database, so a fixture written at v7 under another name was
   *   invisible to the class that performs the upgrade.
   */
  constructor(name = 'kikouchou') {
    super(name);

    /**
     * Schema Version 1 - Initial schema
     *
     * Index notation:
     * - 'field' = indexed field
     * - '[field1+field2]' = compound index for multi-field queries
     * - '&field' = unique index
     *
     * Note: Primary key (id) must be listed first. All IDs are externally
     * generated using nanoid, so no auto-increment (++id) is used.
     *
     * Optimization: Single-column indexes that are the first element of compound
     * indexes are omitted (compound indexes can serve those queries).
     */
    this.version(1).stores({
      trips: 'id, &shareId, startDate, createdAt',
      rooms: 'id, [tripId+order]',
      persons: 'id, tripId, [tripId+name]',
      roomAssignments:
        'id, roomId, [tripId+startDate], [tripId+personId], [tripId+roomId]',
      transports: 'id, [tripId+datetime], [tripId+personId], [tripId+type]',
      settings: 'id',
    });

    /**
     * Schema Version 2 - Add indexes for cascade delete operations
     *
     * Added:
     * - personId index on roomAssignments (for deletePerson cascade delete)
     * - personId index on transports (for deletePerson cascade delete)
     * - driverId index on transports (for deletePerson driverId cleanup)
     */
    this.version(2).stores({
      // Trips: &shareId enforces uniqueness for sharing feature
      trips: 'id, &shareId, startDate, createdAt',

      // Rooms: [tripId+order] compound covers tripId-only and ordered queries
      rooms: 'id, [tripId+order]',

      // Persons: tripId for listing, [tripId+name] for searching within trip
      persons: 'id, tripId, [tripId+name]',

      // Room assignments: compound indexes for efficient trip-scoped queries
      // roomId index for cascade delete in room-repository
      // personId index for cascade delete in person-repository
      roomAssignments:
        'id, roomId, personId, [tripId+startDate], [tripId+personId], [tripId+roomId]',

      // Transports: compound indexes for efficient trip-scoped queries
      // [tripId+type] kept for filtering arrivals/departures
      // personId index for cascade delete in person-repository
      // driverId index for clearing driver references in person-repository
      transports: 'id, personId, driverId, [tripId+datetime], [tripId+personId], [tripId+type]',

      // Settings: singleton key-value store
      settings: 'id',
    });

    /**
     * Schema Version 3 - Add room icon field
     *
     * Added:
     * - icon field on rooms (optional, for visual identification)
     *
     * Note: No data migration needed - field is optional and defaults to 'bed-double' in UI
     */
    this.version(3).stores({
      // Schema unchanged - icon field doesn't require indexing
      trips: 'id, &shareId, startDate, createdAt',
      rooms: 'id, [tripId+order]',
      persons: 'id, tripId, [tripId+name]',
      roomAssignments:
        'id, roomId, personId, [tripId+startDate], [tripId+personId], [tripId+roomId]',
      transports: 'id, personId, driverId, [tripId+datetime], [tripId+personId], [tripId+type]',
      settings: 'id',
    });

    /**
     * Schema Version 4 - Add P2P sync support
     *
     * Added:
     * - yjsUpdates table for persisting Yjs CRDT binary updates (offline-first P2P sync)
     * - p2pRoomId field on trips (optional, for P2P room identification)
     *
     * The yjsUpdates table uses auto-increment (++id) because rows are
     * append-only binary blobs, not user-facing entities.
     */
    this.version(4).stores({
      trips: 'id, &shareId, startDate, createdAt',
      rooms: 'id, [tripId+order]',
      persons: 'id, tripId, [tripId+name]',
      roomAssignments:
        'id, roomId, personId, [tripId+startDate], [tripId+personId], [tripId+roomId]',
      transports: 'id, personId, driverId, [tripId+datetime], [tripId+personId], [tripId+type]',
      settings: 'id',
      yjsUpdates: '++id, roomId',
    });

    /**
     * Schema Version 5 - Add indexed P2P room lookup
     *
     * Added:
     * - p2pRoomId index on trips for shared-link imports
     */
    this.version(5).stores({
      trips: 'id, &shareId, p2pRoomId, startDate, createdAt',
      rooms: 'id, [tripId+order]',
      persons: 'id, tripId, [tripId+name]',
      roomAssignments:
        'id, roomId, personId, [tripId+startDate], [tripId+personId], [tripId+roomId]',
      transports: 'id, personId, driverId, [tripId+datetime], [tripId+personId], [tripId+type]',
      settings: 'id',
      yjsUpdates: '++id, roomId',
    });

    /**
     * Schema Version 6 - Add the shared activity agenda
     *
     * Added:
     * - activities table for trip outings and events guests can join
     *   - [tripId+startDatetime] for the chronological agenda and timeline
     *   - [tripId+category] for filtering by kind of activity
     *   - organizerId for clearing references when a guest is deleted
     *   - *participantIds (multi-entry) for "activities this guest joined"
     *
     * No data migration needed - the table starts empty for existing trips.
     */
    this.version(6).stores({
      trips: 'id, &shareId, p2pRoomId, startDate, createdAt',
      rooms: 'id, [tripId+order]',
      persons: 'id, tripId, [tripId+name]',
      roomAssignments:
        'id, roomId, personId, [tripId+startDate], [tripId+personId], [tripId+roomId]',
      transports: 'id, personId, driverId, [tripId+datetime], [tripId+personId], [tripId+type]',
      activities:
        'id, tripId, organizerId, *participantIds, [tripId+startDatetime], [tripId+category]',
      settings: 'id',
      yjsUpdates: '++id, roomId',
    });

    /**
     * Schema Version 7 - Server-backed sync
     *
     * Added:
     * - remoteTripId index on trips, linking a local trip to its server row and
     *   making the first upload idempotent
     * - yjsOutbox for local updates the server has not accepted yet
     * - syncCursors for each trip's position in the server log
     * - tripMembers as an offline-readable projection of the server roster
     *
     * p2pRoomId and p2pEncryptionKey stay on Trip for one release so an install
     * mid-migration is not broken; Phase 8 drops them with the rest of the
     * WebRTC path.
     */
    this.version(7).stores({
      trips: 'id, &shareId, p2pRoomId, remoteTripId, startDate, createdAt',
      rooms: 'id, [tripId+order]',
      persons: 'id, tripId, [tripId+name]',
      roomAssignments:
        'id, roomId, personId, [tripId+startDate], [tripId+personId], [tripId+roomId]',
      transports: 'id, personId, driverId, [tripId+datetime], [tripId+personId], [tripId+type]',
      activities:
        'id, tripId, organizerId, *participantIds, [tripId+startDatetime], [tripId+category]',
      settings: 'id',
      yjsUpdates: '++id, roomId',
      yjsOutbox: '++id, tripId',
      syncCursors: 'tripId',
      tripMembers: '[tripId+userId], tripId, userId',
    });

    /**
     * Schema Version 8 - Retire the WebRTC transport
     *
     * Changed:
     * - yjsUpdates is keyed on `tripId` rather than the WebRTC `roomId`, and
     *   existing rows are re-keyed by resolving each room id back to its trip
     * - trips loses the p2pRoomId index
     *
     * A row whose room id matches no trip is dropped: it belonged to a trip that
     * no longer exists, and without a trip there is nothing to project it into.
     */
    this.version(8)
      .stores({
        trips: 'id, &shareId, remoteTripId, startDate, createdAt',
        rooms: 'id, [tripId+order]',
        persons: 'id, tripId, [tripId+name]',
        roomAssignments:
          'id, roomId, personId, [tripId+startDate], [tripId+personId], [tripId+roomId]',
        transports: 'id, personId, driverId, [tripId+datetime], [tripId+personId], [tripId+type]',
        activities:
          'id, tripId, organizerId, *participantIds, [tripId+startDatetime], [tripId+category]',
        settings: 'id',
        yjsUpdates: '++id, tripId',
        yjsOutbox: '++id, tripId',
        syncCursors: 'tripId',
        tripMembers: '[tripId+userId], tripId, userId',
      })
      .upgrade(async (transaction) => {
        // Build room id -> trip id from the rows that still carry it. Read
        // through the raw table because `p2pRoomId` is gone from the Trip type.
        const roomToTrip = new Map<string, string>();
        await transaction
          .table('trips')
          .toCollection()
          .each((trip: { id: string; p2pRoomId?: string }) => {
            if (typeof trip.p2pRoomId === 'string' && trip.p2pRoomId.length > 0) {
              roomToTrip.set(trip.p2pRoomId, trip.id);
            }
          });

        // Read out, clear, write back — deliberately NOT `Collection.modify`.
        //
        // `modify` round-trips each row through a clone that loses the
        // Uint8Array prototype: the stored value comes back as a plain
        // `{0:1, 1:2, …}` object, so `Y.applyUpdate` can no longer read it and
        // every trip's CRDT history is silently destroyed while the rows
        // themselves look fine. Measured, and pinned in
        // `dexie-binary-rows.test.ts`. The ordinary write path preserves the
        // typed array, so the rows are re-added rather than edited in place.
        const updates = transaction.table('yjsUpdates');
        const existing = (await updates.toArray()) as {
          roomId?: unknown;
          update: Uint8Array;
        }[];

        const rekeyed: { tripId: string; update: Uint8Array }[] = [];
        let dropped = 0;
        for (const row of existing) {
          const tripId =
            typeof row.roomId === 'string' ? roomToTrip.get(row.roomId) : undefined;
          if (tripId === undefined) {
            // No trip owns this room any more, so nothing could ever read it.
            dropped += 1;
            continue;
          }
          rekeyed.push({ tripId, update: row.update });
        }

        await updates.clear();
        if (rekeyed.length > 0) {
          // Auto-increment assigns fresh ids; nothing references the old ones.
          await updates.bulkAdd(rekeyed);
        }

        if (dropped > 0) {
          console.info(
            '[db] schema 8 dropped %d Yjs updates whose trip no longer exists',
            dropped,
          );
        }
      });

    /**
     * Schema Version 9 - Guest groups
     *
     * Added:
     * - guestGroups: reusable rosters that live beside trips rather than inside
     *   one, so a family is typed once and imported into each new trip
     *   - `name` for the alphabetical list the page renders
     *   - `remoteGroupId` for reconciling a pull against what this device
     *     already uploaded
     *
     * No data migration: the table starts empty, and nothing that existed
     * before refers to it. Note the absence of a `tripId` index — it is
     * intentional and the reason this table is not in `deleteTrip`'s cascade.
     */
    this.version(9).stores({
      trips: 'id, &shareId, remoteTripId, startDate, createdAt',
      rooms: 'id, [tripId+order]',
      persons: 'id, tripId, [tripId+name]',
      roomAssignments:
        'id, roomId, personId, [tripId+startDate], [tripId+personId], [tripId+roomId]',
      transports: 'id, personId, driverId, [tripId+datetime], [tripId+personId], [tripId+type]',
      activities:
        'id, tripId, organizerId, *participantIds, [tripId+startDatetime], [tripId+category]',
      settings: 'id',
      guestGroups: 'id, name, remoteGroupId',
      yjsUpdates: '++id, tripId',
      yjsOutbox: '++id, tripId',
      syncCursors: 'tripId',
      tripMembers: '[tripId+userId], tripId, userId',
    });

    /**
     * Schema Version 10 - Rides, vehicles and the notice watermark
     *
     * Added:
     * - `rides`: the car journey that serves one or more transport legs
     *   - plain `tripId` so the cascade and every trip query can see a row even
     *     if it is missing the second half of a compound index
     *   - `driverId` for the cascade that clears a deleted guest's driving
     *   - `vehicleId` for the cascade that clears a deleted car
     *   - `[tripId+meetDatetime]` for the chronological read
     * - `vehicles`: a car available to the trip, `tripId` + `ownerId` for the
     *   same two reasons
     * - `rideId` index on `transports`: "who is in this car" is a lookup by the
     *   ride, and membership lives on the leg
     * - `rideNotices`: device-local record of what this phone has already shown
     *   and already seen. `key` is the primary key; `tripId` carries the cascade
     *
     * **No data migration.** A transport that already carries a `driverId` is
     * *read* as a one-passenger ride by `resolveRides()` rather than converted.
     * An `.upgrade()` that invented `Ride` rows would run on whichever device
     * happened to open the app first and push its guesses into the shared
     * document as though the group had agreed them — the same failure mode
     * `transport-datetime` refuses for timezones. Reading the old shape costs a
     * branch; writing it costs everyone's data.
     */
    this.version(10).stores({
      trips: 'id, &shareId, remoteTripId, startDate, createdAt',
      rooms: 'id, [tripId+order]',
      persons: 'id, tripId, [tripId+name]',
      roomAssignments:
        'id, roomId, personId, [tripId+startDate], [tripId+personId], [tripId+roomId]',
      transports:
        'id, personId, driverId, rideId, [tripId+datetime], [tripId+personId], [tripId+type]',
      rides: 'id, tripId, driverId, vehicleId, [tripId+meetDatetime]',
      vehicles: 'id, tripId, ownerId',
      activities:
        'id, tripId, organizerId, *participantIds, [tripId+startDatetime], [tripId+category]',
      settings: 'id',
      guestGroups: 'id, name, remoteGroupId',
      rideNotices: 'key, tripId',
      yjsUpdates: '++id, tripId',
      yjsOutbox: '++id, tripId',
      syncCursors: 'tripId',
      tripMembers: '[tripId+userId], tripId, userId',
    });

    // An idle tab holding an older schema version blocks a newer tab's upgrade
    // transaction indefinitely. Without these two handlers the newer tab's
    // db.open() never resolves *or rejects*, so a caller awaiting it hangs
    // forever — see the render gate in main.tsx.
    this.on('versionchange', () => {
      // Another tab wants to upgrade: let go so it can.
      this.close();
      return false;
    });

    this.on('blocked', () => {
      console.warn(
        '[db] upgrade blocked by another open tab — close other Kikouchou tabs',
      );
    });
  }
}

/**
 * Singleton database instance.
 *
 * Use this exported instance throughout the application to ensure
 * a single database connection is shared.
 *
 * @example
 * ```typescript
 * import { db } from '@/lib/db/database';
 *
 * // Use directly
 * const trips = await db.trips.toArray();
 *
 * // Or with dexie-react-hooks
 * const trips = useLiveQuery(() => db.trips.toArray());
 * ```
 */
export const db = new KikouchouDatabase();
