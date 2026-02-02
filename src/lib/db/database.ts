/**
 * Kikoushou PWA - Dexie Database Schema
 *
 * This module defines the IndexedDB database schema using Dexie.js v4.
 * The database stores all trip-related data locally for offline-first operation.
 *
 * @module lib/db/database
 */

import Dexie, { type Table } from 'dexie';

/** Current database schema version */
export const DB_VERSION = 3;
import type {
  AppSettings,
  Person,
  Room,
  RoomAssignment,
  Transport,
  Trip,
} from '@/types';

/**
 * Kikoushou IndexedDB database class.
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
export class KikoushouDatabase extends Dexie {
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
   * Settings table - stores application settings (singleton).
   * Primary key: id (always 'settings')
   */
  settings!: Table<AppSettings, string>;

  constructor() {
    super('kikoushou');

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
export const db = new KikoushouDatabase();
