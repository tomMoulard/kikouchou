/**
 * @fileoverview Creates a trip with its first guests and rooms, in one call.
 *
 * The wizard on `/trips/new` and the trip template page both create a trip
 * through it: the trip, the creator's own guest row, and the rooms a template
 * carries. The writes live here so the two paths cannot drift on what
 * "create a trip" means.
 *
 * Everything after the trip row is best effort: a guest or a room that fails
 * is reported as a warning for the caller to show, never a rolled-back trip.
 *
 * @module features/trips/lib/create-trip-with-details
 */

import {
  createPersonWithAutoColor,
  createRoom,
  createTrip,
  setCurrentTrip,
} from '@/lib/db';
import { setRoomPhoto, setTripPhoto } from '@/lib/db/repositories/photo-repository';
import { writeGuestIdentity } from '@/lib/sharing/guest-identity';
import { markTripOrganised } from '@/features/trips/hooks/usePlanOwnTripPrompt';
import type { PersonId, RoomBedLayout, RoomIcon, Trip, TripFormData } from '@/types';
import { reportError } from '@/lib/posthog';
import { recordTripCreated } from '@/lib/achievements/store';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * A guest the new trip starts with. The trip assigns a colour from the
 * palette.
 */
export interface NewTripGuest {
  readonly name: string;
  /**
   * Set on the creator's own row, and only on it.
   *
   * The person it creates is who this browser is on the new trip, and the
   * trip stores that as its guest identity.
   */
  readonly isSelf?: boolean;
}

/**
 * A room the new trip starts with: a template's, carried through the wizard.
 */
export interface NewTripRoom {
  readonly name: string;
  readonly capacity: number;
  /** Which glyph the room shows in every list and timeline. */
  readonly icon: RoomIcon;
  /** The room's notes. */
  readonly description?: string;
  /** A photo saved with the room. */
  readonly photo?: Blob;
  /** The beds, as the template describes them. */
  readonly bedLayouts?: RoomBedLayout[];
  /** Sleeping spots that are not beds. */
  readonly extraSpots?: number;
}

/** Everything the creation screen collects before the first write. */
export interface TripDraft {
  readonly form: TripFormData;
  readonly guests: readonly NewTripGuest[];
  readonly rooms: readonly NewTripRoom[];
  /** The cover photo, already prepared: a template's. */
  readonly photo?: Blob;
  /**
   * Whether to select the new trip as the current one here.
   *
   * The wizard must not: selecting a trip remounts the route element
   * (`YjsTripSync` swaps it on the no-trip → trip transition), which would
   * throw the wizard away before its invite screen. It selects the trip when
   * the user opens it instead. Defaults to true.
   */
  readonly selectAsCurrent?: boolean;
}

/** What went wrong after the trip itself was saved. */
export type TripCreationWarning = 'guests' | 'rooms' | 'photos' | 'identity';

export interface TripCreationOutcome {
  readonly trip: Trip;
  /** The guest the "You" row created, now this device's identity on the trip. */
  readonly selfPersonId: PersonId | undefined;
  readonly counts: {
    readonly guests: number;
    readonly rooms: number;
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
  let photosFailed = false;

  if (draft.photo) {
    try {
      await setTripPhoto(trip.id, draft.photo);
    } catch (error) {
      reportError(error, { source: 'create-trip-with-details.photo' });
      photosFailed = true;
    }
  }

  let guests = 0;
  let selfPersonId: PersonId | undefined;
  for (const guest of draft.guests) {
    try {
      const person = await createPersonWithAutoColor(trip.id, guest.name);
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
      const created = await createRoom(trip.id, {
        name: room.name,
        capacity: room.capacity,
        icon: room.icon,
        ...(room.description === undefined ? {} : { description: room.description }),
        ...(room.bedLayouts === undefined ? {} : { bedLayouts: room.bedLayouts }),
        ...(room.extraSpots === undefined ? {} : { extraSpots: room.extraSpots }),
      });
      rooms += 1;
      if (room.photo) {
        try {
          await setRoomPhoto(trip.id, created.id, room.photo);
        } catch (error) {
          reportError(error, { source: 'create-trip-with-details.room-photo' });
          photosFailed = true;
        }
      }
    } catch (error) {
      reportError(error, { source: 'create-trip-with-details.room' });
    }
  }
  if (rooms < draft.rooms.length) {
    warnings.push('rooms');
  }
  if (photosFailed) {
    warnings.push('photos');
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

  // Not awaited: an achievement never holds up the screen that follows.
  void recordTripCreated();

  // Selected now so the calendar can show it the moment the screen navigates.
  if (draft.selectAsCurrent !== false) {
    await setCurrentTrip(trip.id);
  }

  return {
    trip,
    selfPersonId,
    counts: { guests, rooms },
    warnings,
  };
}
