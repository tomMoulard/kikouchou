/**
 * Database Module
 *
 * Barrel export for all database functionality.
 * Import from '@/lib/db' for convenient access to the database,
 * utility functions, and all repository operations.
 *
 * @module lib/db
 *
 * @example
 * ```typescript
 * import {
 *   db,
 *   createTrip,
 *   getRoomsByTripId,
 *   checkAssignmentConflict,
 * } from '@/lib/db';
 * ```
 */

// Database instance
export { db, DB_VERSION, type KikoushouDatabase } from './database';

// Utility functions
export {
  // ID generation
  createTripId,
  createRoomId,
  createPersonId,
  createRoomAssignmentId,
  createTransportId,
  createShareId,
  generateId,
  // Timestamp utilities
  now,
  toUnixTimestamp,
  fromUnixTimestamp,
  toISODateString,
  toISODateTimeString,
  // Parsing functions
  parseISODateString,
  parseISODateTimeString,
  // Validation type guards
  isValidISODateString,
  isValidISODateTimeString,
  isValidHexColor,
  // Database record helpers
  createTimestamps,
  updateTimestamp,
} from './utils';

// Trip repository
export {
  createTrip,
  getAllTrips,
  getTripById,
  getTripByShareId,
  updateTrip,
  deleteTrip,
} from './repositories/trip-repository';

// Room repository
export {
  createRoom,
  getRoomsByTripId,
  getRoomById,
  updateRoom,
  deleteRoom,
  reorderRooms,
  getRoomCount,
} from './repositories/room-repository';

// Person repository
export {
  createPerson,
  createPersonWithAutoColor,
  getPersonsByTripId,
  getPersonById,
  updatePerson,
  deletePerson,
  getPersonCount,
  searchPersonsByName,
} from './repositories/person-repository';

// Room assignment repository
export {
  createAssignment,
  getAssignmentsByTripId,
  getAssignmentsByRoomId,
  getAssignmentsByPersonId,
  getAssignmentById,
  updateAssignment,
  deleteAssignment,
  checkAssignmentConflict,
  getAssignmentsForDate,
  getAssignmentCount,
} from './repositories/assignment-repository';

// Transport repository
export {
  createTransport,
  getTransportsByTripId,
  getTransportsByPersonId,
  getArrivals,
  getDepartures,
  getTransportById,
  updateTransport,
  deleteTransport,
  getUpcomingPickups,
  getTransportsForDate,
  getTransportCount,
  getTransportsByDriverId,
} from './repositories/transport-repository';

// Settings repository
export {
  getSettings,
  ensureSettings,
  updateSettings,
  setCurrentTrip,
  setLanguage,
  getCurrentTripId,
  getLanguage,
  resetSettings,
} from './repositories/settings-repository';
