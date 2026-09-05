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
export { db, DB_VERSION, type KikouchouDatabase, type YjsUpdateRow } from './database';

// Utility functions
export {
  // ID generation
  createTripId,
  createRoomId,
  createPersonId,
  createRoomAssignmentId,
  createTransportId,
  createActivityId,
  createGuestGroupId,
  createGuestGroupMemberId,
  createShareId,
  generateId,
  // Timestamp utilities
  now,
  toUnixTimestamp,
  fromUnixTimestamp,
  toISODateString,
  toLocalISODateString,
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
  getTripsByLocation,
} from './repositories/trip-repository';

// Room repository
export {
  createRoom,
  getRoomsByTripId,
  getRoomById,
  /** @deprecated Use updateRoomWithOwnershipCheck instead */
  updateRoom,
  /** @deprecated Use deleteRoomWithOwnershipCheck instead */
  deleteRoom,
  reorderRooms,
  getRoomCount,
  // Import / clone operations
  cloneRoomsToTrip,
  // Transactional operations with ownership validation (CR-2)
  updateRoomWithOwnershipCheck,
  deleteRoomWithOwnershipCheck,
} from './repositories/room-repository';

// Person repository
export {
  createPerson,
  createPersonWithAutoColor,
  getPersonsByTripId,
  getPersonById,
  /** @deprecated Use updatePersonWithOwnershipCheck instead */
  updatePerson,
  /** @deprecated Use deletePersonWithOwnershipCheck instead */
  deletePerson,
  getPersonCount,
  searchPersonsByName,
  // Transactional operations with ownership validation (CR-2)
  updatePersonWithOwnershipCheck,
  deletePersonWithOwnershipCheck,
} from './repositories/person-repository';

// Room assignment repository
export {
  createAssignment,
  getAssignmentsByTripId,
  getAssignmentsByRoomId,
  getAssignmentsByPersonId,
  getAssignmentById,
  /** @deprecated Use updateAssignmentWithOwnershipCheck instead */
  updateAssignment,
  /** @deprecated Use deleteAssignmentWithOwnershipCheck instead */
  deleteAssignment,
  checkAssignmentConflict,
  getAssignmentsForDate,
  getAssignmentCount,
  // Transactional operations with ownership validation (CR-2)
  updateAssignmentWithOwnershipCheck,
  deleteAssignmentWithOwnershipCheck,
} from './repositories/assignment-repository';

// Transport repository
export {
  createTransport,
  getTransportsByTripId,
  getTransportsByPersonId,
  getArrivals,
  getDepartures,
  getTransportById,
  /** @deprecated Use updateTransportWithOwnershipCheck instead */
  updateTransport,
  /** @deprecated Use deleteTransportWithOwnershipCheck instead */
  deleteTransport,
  getUpcomingPickups,
  getTransportsForDate,
  getTransportCount,
  getTransportsByDriverId,
  // Transactional operations with ownership validation (CR-2)
  updateTransportWithOwnershipCheck,
  deleteTransportWithOwnershipCheck,
} from './repositories/transport-repository';

// Activity repository
export {
  createActivity,
  getActivitiesByTripId,
  getActivityById,
  getActivitiesByParticipantId,
  getActivitiesByOrganizerId,
  getActivitiesForDate,
  getActivityCount,
  isActivityFull,
  setActivityParticipation,
  // Transactional operations with ownership validation
  updateActivityWithOwnershipCheck,
  deleteActivityWithOwnershipCheck,
} from './repositories/activity-repository';

// Guest group repository (global — not trip-scoped)
export {
  createGuestGroup,
  getAllGuestGroups,
  getGuestGroupById,
  updateGuestGroup,
  deleteGuestGroup,
  // Trip integration
  importGuestGroupMembers,
  createGuestGroupFromPersons,
} from './repositories/guest-group-repository';
export type { ImportGuestGroupResult } from './repositories/guest-group-repository';

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

// Input sanitization utilities
export {
  MAX_LENGTHS,
  sanitizeText,
  sanitizeOptionalText,
  sanitizeTripData,
  sanitizeRoomData,
  sanitizePersonData,
  sanitizeGuestGroupData,
  sanitizeTransportData,
  sanitizeActivityData,
  normalizeMaxParticipants,
} from './sanitize';
