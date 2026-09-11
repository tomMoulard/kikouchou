/**
 * @fileoverview Creates a trip with its first guests and rooms, in one call.
 *
 * The one-page form and the first-trip wizard collect the same things — the
 * trip, a guest list, a room list, maybe a previous trip to copy rooms from —
 * and used to be the only place the writes lived. Now both hand a draft to
 * this function, so the two experiences cannot drift on what "create a trip"
 * means, and the comparison PostHog draws between them is about the screens
 * and nothing else.
 *
 * Everything after the trip row is best effort: a guest or a room that fails
 * is reported as a warning for the caller to show, never a rolled-back trip.
 *
 * @module features/trips/lib/create-trip-with-details
 */

import type { NewTripGuest, NewTripRoom } from '@/features/trips/components/TripForm';
import {
  cloneRoomsToTrip,
  createPerson,
  createPersonWithAutoColor,
  createRoom,
  createTrip,
  setCurrentTrip,
} from '@/lib/db';
import { writeGuestIdentity } from '@/lib/sharing/guest-identity';
import { markTripOrganised } from '@/features/trips/hooks/usePlanOwnTripPrompt';
import type { PersonId, Trip, TripFormData, TripId } from '@/types';
import { reportError } from '@/lib/posthog';

// ============================================================================
// Type Definitions
// ============================================================================

/** Everything either creation screen collects before the first write. */
export interface TripDraft {
  readonly form: TripFormData;
  readonly guests: readonly NewTripGuest[];
  readonly rooms: readonly NewTripRoom[];
  /** A previous trip whose rooms are copied, when the user picked one. */
  readonly importSourceTripId?: TripId | null;
  /**
   * Whether to select the new trip as the current one here.
   *
   * The form does, then navigates. The wizard must not: selecting a trip
   * remounts the route element (`YjsTripSync` swaps it on the no-trip → trip
   * transition), which would throw the wizard away before its done screen.
   * It selects the trip when the user opens it instead. Defaults to true.
   */
  readonly selectAsCurrent?: boolean;
}

/** What went wrong after the trip itself was saved. */
export type TripCreationWarning = 'rooms-import' | 'guests' | 'rooms' | 'identity';

export interface TripCreationOutcome {
  readonly trip: Trip;
  /** The guest the "You" row created, now this device's identity on the trip. */
  readonly selfPersonId: PersonId | undefined;
  readonly counts: {
    readonly guests: number;
    readonly importedGuests: number;
    readonly rooms: number;
    readonly importedRooms: boolean;
  };
  readonly warnings: readonly TripCreationWarning[];
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Saves the trip, then its guests and rooms in list order, then who you are.
 *
 * Sequential on purpose: `createPersonWithAutoColor` picks its colour from the
 * trip's *current* person count and `createRoom` places the new room last, so
 * a `Promise.all` would hand every guest the same colour and every room the
 * same order.
 *
 * @param draft - What the screen collected
 * @returns The trip, the identity, the counts, and the warnings to show
 * @throws When the trip row itself could not be created
 */
export async function createTripWithDetails(draft: TripDraft): Promise<TripCreationOutcome> {
  const trip = await createTrip(draft.form);
  if (!trip?.id) {
    throw new Error('Trip creation failed: missing trip ID');
  }

  const warnings: TripCreationWarning[] = [];

  let importedRooms = false;
  if (draft.importSourceTripId) {
    try {
      await cloneRoomsToTrip(draft.importSourceTripId, trip.id);
      importedRooms = true;
    } catch (error) {
      console.error('Failed to clone rooms from import source:', error);
      warnings.push('rooms-import');
    }
  }

  let guests = 0;
  let importedGuests = 0;
  let selfPersonId: PersonId | undefined;
  for (const guest of draft.guests) {
    try {
      let person;
      if (guest.color) {
        // From a saved group: it brings its own colour and whatever else was
        // stored with it.
        person = await createPerson(trip.id, {
          name: guest.name,
          color: guest.color,
          ...(guest.headcount === undefined ? {} : { headcount: guest.headcount }),
          ...(guest.notes === undefined ? {} : { notes: guest.notes }),
          ...(guest.phone === undefined ? {} : { phone: guest.phone }),
        });
        importedGuests += 1;
      } else {
        person = await createPersonWithAutoColor(trip.id, guest.name);
      }
      if (guest.isSelf) {
        selfPersonId = person?.id;
      }
      guests += 1;
    } catch (error) {
      // Counted, not raised: the trip is already made and the caller reports
      // "some guests could not be added" from the tally below. The reason was
      // going nowhere, though, so somebody finishing the wizard with guests
      // missing left no trace of why.
      reportError(error, { source: 'create-trip-with-details.guest' });
    }
  }
  if (guests < draft.guests.length) {
    warnings.push('guests');
  }

  let rooms = 0;
  for (const room of draft.rooms) {
    try {
      await createRoom(trip.id, {
        name: room.name,
        capacity: room.capacity,
        icon: room.icon,
      });
      rooms += 1;
    } catch (error) {
      reportError(error, { source: 'create-trip-with-details.room' });
    }
  }
  if (rooms < draft.rooms.length) {
    warnings.push('rooms');
  }

  // Become the person the "You" row created. Nothing to store when the user
  // cleared the row: a host arranging a trip they are not on is nobody in
  // particular, and that is the right answer.
  if (selfPersonId && !writeGuestIdentity(trip.shareId, { personId: selfPersonId, tripId: trip.id })) {
    warnings.push('identity');
  }

  // Remembered separately from that identity, because the identity cannot tell
  // an organiser from a guest: both are written through the same key. Without
  // this, filling the "You" row made the organiser's own trip read as a joined
  // one, and the trip list offered to teach them how to plan a trip.
  markTripOrganised();

  // Selected now so the calendar can show it the moment the screen navigates.
  if (draft.selectAsCurrent !== false) {
    await setCurrentTrip(trip.id);
  }

  return {
    trip,
    selfPersonId,
    counts: { guests, importedGuests, rooms, importedRooms },
    warnings,
  };
}
