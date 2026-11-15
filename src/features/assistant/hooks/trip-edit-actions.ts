/**
 * @fileoverview The assistant's edit actions that came after the first batch.
 *
 * `executeActionBatch` in `useTripActions.ts` is one switch over every action,
 * and it already ran ESLint out of memory once. The actions here edit what the
 * first batch could only add or remove (a guest, a room, an assignment, a leg,
 * a car, a shopping item), manage saved guest groups, and reach the server for
 * an invite link or a template. The switch hands every action it does not
 * know to {@link runEditAction}.
 *
 * Every case follows the rules of the rest of the executor: it resolves the
 * target against the trip the batch writes to, drops an id that belongs to
 * another trip, parses the merged record against its Zod schema before
 * writing, and returns one summary line per change for the chat.
 *
 * @module features/assistant/hooks/trip-edit-actions
 */

import { type TFunction } from 'i18next';

import { getTripInviteLink } from '@/features/sharing/utils/invite-link';
import {
  publishTripTemplate,
  unpublishTripTemplate,
} from '@/features/sharing/utils/template-link';
import {
  checkAssignmentConflict,
  deleteCheckedShoppingItems,
  duplicateRoomWithOwnershipCheck,
  getAssignmentById,
  getGuestGroupById,
  getPersonById,
  getPersonsByTripId,
  getRoomById,
  getShoppingItemById,
  getTransportById,
  getTripById,
  getVehicleById,
  personToGroupMember,
  setTransportSharedLeg,
  updateAssignmentWithOwnershipCheck,
  updatePersonWithOwnershipCheck,
  updateShoppingItemWithOwnershipCheck,
  updateTransportWithOwnershipCheck,
  updateVehicleWithOwnershipCheck,
} from '@/lib/db';
import { isCalendarDayString } from '@/lib/db/sanitize';
import { notify } from '@/lib/notifications';
import { captureDeletion } from '@/lib/posthog';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  ShoppingItemFormDataSchema,
  TransportFormDataSchema,
  VehicleFormDataSchema,
} from '@/lib/validation/schemas';
import {
  type ChildSeatKind,
  type DietaryTag,
  type GuestGroup,
  type GuestGroupFormData,
  type GuestGroupId,
  type GuestGroupMemberFormData,
  type HexColor,
  type ISODateString,
  type ISODateTimeString,
  type Person,
  type PersonFormData,
  type PersonId,
  type RoomAssignmentId,
  type RoomId,
  type ShoppingItemFormData,
  type ShoppingItemId,
  type TransportFormData,
  type TransportId,
  type TransportMode,
  type TransportType,
  type TripId,
  type VehicleFormData,
  type VehicleId,
} from '@/types';

import type { LLMAction } from '../action-schema';

// ============================================================================
// Type Definitions
// ============================================================================

/** The guest group writes, taken from `useGuestGroups` so each one syncs. */
export interface GuestGroupWrites {
  readonly createFromPersons: (name: string, persons: readonly Person[]) => Promise<GuestGroup>;
  readonly update: (id: GuestGroupId, data: GuestGroupFormData) => Promise<void>;
  readonly remove: (id: GuestGroupId) => Promise<void>;
}

/** What an edit action reads from the batch. */
export interface EditActionContext {
  readonly t: TFunction;
  /** The trip the batch writes to, after any createTrip or selectTrip. */
  readonly tripId: TripId | null;
  readonly mealPlanner: boolean;
  /** The `ent-trip-templates` flag, decided and on. */
  readonly templatesEnabled: boolean;
  /** The signed-in account, or null. */
  readonly userId: string | null;
  readonly notifySuccess: (onlineMessage: string) => void;
  readonly guestGroups: GuestGroupWrites;
}

// ============================================================================
// Helpers
// ============================================================================

/** A hex colour as the app stores it. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * A trimmed, non-empty string, or undefined.
 *
 * @param value - A field the model wrote
 * @returns The text, or undefined when there is none
 */
function textOf(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The guest when the id names one of this trip, undefined otherwise.
 *
 * @param raw - An id the model wrote
 * @param tripId - The trip the batch writes to
 * @returns The guest, or undefined
 */
async function guestOfTrip(raw: unknown, tripId: TripId): Promise<Person | undefined> {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const person = await getPersonById(raw as PersonId);
  return person && person.tripId === tripId ? person : undefined;
}

/**
 * A server client for the signed-in account, or null after saying why not.
 *
 * @param context - The batch context
 * @returns The client and the account, or null
 */
async function serverFor(
  context: EditActionContext,
): Promise<{ client: NonNullable<Awaited<ReturnType<typeof getSupabaseClient>>>; userId: string } | null> {
  if (context.userId === null) {
    notify.error(context.t('assistant.needsAccount'));
    return null;
  }
  const client = await getSupabaseClient();
  if (!client) {
    notify.error(context.t('assistant.sharingUnavailable'));
    return null;
  }
  return { client, userId: context.userId };
}

// ============================================================================
// Runner
// ============================================================================

/**
 * Runs one edit action.
 *
 * @param action - A validated action
 * @param context - The batch context
 * @returns `null` for an action this module does not know, an empty list when
 *   it refused (and already said why), or the summary lines of what it did
 */
export async function runEditAction(
  action: LLMAction,
  context: EditActionContext,
): Promise<readonly string[] | null> {
  const { t, tripId, notifySuccess } = context;
  const d = action.data;

  /** The trip the action needs, or null after saying there is none. */
  const needTrip = (): TripId | null => {
    if (!tripId) {
      notify.error(t('assistant.noTripForAction'));
    }
    return tripId;
  };

  switch (action.action) {
    // ---- Guests -------------------------------------------------------------
    case 'updateGuest': {
      const tid = needTrip();
      if (!tid) return [];
      const person = await guestOfTrip(d.personId, tid);
      if (!person) {
        notify.error(t('assistant.guestNotFound'));
        return [];
      }

      const patch: Partial<PersonFormData> = {};
      const name = textOf(d.name);
      if (name !== undefined) patch.name = name;

      if (d.clearStay === true) {
        // `undefined` is how the guest form clears a stay: Dexie drops the key.
        patch.stayStartDate = undefined;
        patch.stayEndDate = undefined;
      } else if (d.stayStartDate !== undefined || d.stayEndDate !== undefined) {
        const start = d.stayStartDate ?? person.stayStartDate;
        const end = d.stayEndDate ?? person.stayEndDate;
        if (
          (start !== undefined && !isCalendarDayString(start)) ||
          (end !== undefined && !isCalendarDayString(end)) ||
          (typeof start === 'string' && typeof end === 'string' && end < start)
        ) {
          notify.error(t('assistant.invalidDate'));
          return [];
        }
        if (d.stayStartDate !== undefined) patch.stayStartDate = start as ISODateString;
        if (d.stayEndDate !== undefined) patch.stayEndDate = end as ISODateString;
      }

      if (typeof d.headcount === 'number') patch.headcount = d.headcount;
      if (typeof d.phone === 'string') patch.phone = d.phone;
      if (typeof d.notes === 'string') patch.notes = d.notes;
      if (d.childSeat === 'none') {
        patch.childSeat = undefined;
      } else if (typeof d.childSeat === 'string') {
        // The repository drops anything that is not one of the three kinds.
        patch.childSeat = d.childSeat as ChildSeatKind;
      }
      if (d.color !== undefined) {
        if (typeof d.color !== 'string' || !HEX_COLOR.test(d.color)) {
          notify.error(t('assistant.invalidColor'));
          return [];
        }
        patch.color = d.color.toLowerCase() as HexColor;
      }
      if (d.dietaryTags !== undefined || d.dietaryNote !== undefined) {
        // Same rule as the guest form: no meal planner, no diet fields, so an
        // edit here never clears a diet another member typed.
        if (!context.mealPlanner) {
          notify.error(t('assistant.mealPlannerOff'));
        } else {
          if (Array.isArray(d.dietaryTags)) patch.dietaryTags = d.dietaryTags as DietaryTag[];
          if (typeof d.dietaryNote === 'string') patch.dietaryNote = d.dietaryNote;
        }
      }

      if (Object.keys(patch).length === 0) return [];
      await updatePersonWithOwnershipCheck(person.id, tid, patch);
      notifySuccess(t('persons.updateSuccess'));
      return [t('assistant.actionDetails.updateGuest', { name: patch.name ?? person.name })];
    }

    // ---- Guest groups -------------------------------------------------------
    case 'createGuestGroup': {
      const tid = needTrip();
      if (!tid) return [];
      const name = textOf(d.name);
      const guests = await getPersonsByTripId(tid);
      const wanted = Array.isArray(d.personIds) ? new Set(d.personIds as string[]) : null;
      const members = wanted ? guests.filter((guest) => wanted.has(guest.id)) : guests;
      if (name === undefined || members.length === 0) {
        notify.error(t('assistant.guestNotFound'));
        return [];
      }
      await context.guestGroups.createFromPersons(name, members);
      notifySuccess(t('guestGroups.createSuccess'));
      return [t('assistant.actionDetails.createGuestGroup', { name, count: members.length })];
    }

    case 'updateGuestGroup': {
      const group = await getGuestGroupById(d.groupId as GuestGroupId);
      if (!group) {
        notify.error(t('assistant.guestGroupNotFound'));
        return [];
      }
      const removed = new Set(Array.isArray(d.removeMemberIds) ? (d.removeMemberIds as string[]) : []);
      // Kept members carry their ids along; the repository matches ids by
      // position, as it does for the group form.
      const members: GuestGroupMemberFormData[] = group.members.filter(
        (member) => !removed.has(member.id),
      );

      if (Array.isArray(d.addPersonIds) && d.addPersonIds.length > 0) {
        const tid = needTrip();
        if (!tid) return [];
        for (const raw of d.addPersonIds) {
          const guest = await guestOfTrip(raw, tid);
          if (!guest) {
            notify.error(t('assistant.guestNotFound'));
            continue;
          }
          members.push(personToGroupMember(guest));
        }
      }

      const name = textOf(d.name) ?? group.name;
      if (name === group.name && members.length === group.members.length && removed.size === 0) {
        return [];
      }
      await context.guestGroups.update(group.id, { name, members });
      notifySuccess(t('guestGroups.updateSuccess'));
      return [t('assistant.actionDetails.updateGuestGroup', { name })];
    }

    case 'removeGuestGroup': {
      const group = await getGuestGroupById(d.groupId as GuestGroupId);
      if (!group) {
        notify.error(t('assistant.guestGroupNotFound'));
        return [];
      }
      await context.guestGroups.remove(group.id);
      captureDeletion('guest_group_deleted', { source: 'assistant' });
      notifySuccess(t('guestGroups.deleteSuccess'));
      return [t('assistant.actionDetails.removeGuestGroup', { name: group.name })];
    }

    // ---- Rooms --------------------------------------------------------------
    case 'duplicateRoom': {
      const tid = needTrip();
      if (!tid) return [];
      const room = await getRoomById(d.roomId as RoomId);
      if (!room || room.tripId !== tid) {
        notify.error(t('assistant.roomNotFound'));
        return [];
      }
      const copy = await duplicateRoomWithOwnershipCheck(room.id, tid);
      notifySuccess(t('rooms.duplicateSuccess', { name: copy.name }));
      return [t('assistant.actionDetails.duplicateRoom', { name: copy.name })];
    }

    // ---- Room assignments ---------------------------------------------------
    case 'updateAssignment': {
      const tid = needTrip();
      if (!tid) return [];
      const assignment = await getAssignmentById(d.assignmentId as RoomAssignmentId);
      if (!assignment || assignment.tripId !== tid) {
        notify.error(t('assistant.assignmentNotFound'));
        return [];
      }
      let room = await getRoomById(assignment.roomId);
      if (d.roomId !== undefined) {
        room = await getRoomById(d.roomId as RoomId);
        if (!room || room.tripId !== tid) {
          notify.error(t('assistant.roomNotFound'));
          return [];
        }
      }
      const start = d.startDate ?? assignment.startDate;
      const end = d.endDate ?? assignment.endDate;
      // The end is the check-out day, so a stay covers at least one night.
      if (!isCalendarDayString(start) || !isCalendarDayString(end) || end <= start) {
        notify.error(t('assistant.invalidDate'));
        return [];
      }
      if (await checkAssignmentConflict(tid, assignment.personId, start, end, assignment.id)) {
        notify.error(t('assistant.assignmentConflict'));
        return [];
      }
      await updateAssignmentWithOwnershipCheck(assignment.id, tid, {
        ...(room && { roomId: room.id }),
        startDate: start as ISODateString,
        endDate: end as ISODateString,
      });
      const person = await getPersonById(assignment.personId);
      notifySuccess(t('assignments.updateSuccess'));
      return [
        t('assistant.actionDetails.updateAssignment', {
          person: person?.name ?? '...',
          room: room?.name ?? '...',
          start,
          end,
        }),
      ];
    }

    // ---- Transport ----------------------------------------------------------
    case 'updateTransport': {
      const tid = needTrip();
      if (!tid) return [];
      const leg = await getTransportById(d.transportId as TransportId);
      if (!leg || leg.tripId !== tid) {
        notify.error(t('assistant.transportNotFound'));
        return [];
      }
      const patch: Partial<TransportFormData> = {
        ...(d.type !== undefined && { type: d.type as TransportType }),
        ...(d.datetime !== undefined && { datetime: d.datetime as ISODateTimeString }),
        // A new place drops the pin resolved from the old one, as updateTrip does.
        ...(d.location !== undefined && { location: String(d.location), coordinates: undefined }),
        ...(d.startLocation !== undefined && {
          startLocation: String(d.startLocation),
          startCoordinates: undefined,
        }),
        ...(d.transportMode !== undefined && { transportMode: d.transportMode as TransportMode }),
        ...(d.transportNumber !== undefined && { transportNumber: String(d.transportNumber) }),
        ...(d.needsPickup !== undefined && { needsPickup: d.needsPickup === true }),
        ...(d.notes !== undefined && { notes: String(d.notes) }),
      };
      if (Object.keys(patch).length === 0) return [];

      const merged = { ...leg, ...patch };
      const validation = TransportFormDataSchema.safeParse({
        personId: merged.personId,
        type: merged.type,
        datetime: merged.datetime,
        location: merged.location,
        startLocation: merged.startLocation,
        transportMode: merged.transportMode,
        transportNumber: merged.transportNumber,
        needsPickup: merged.needsPickup,
        notes: merged.notes,
      });
      if (!validation.success) {
        console.warn('[AI Assistant] Rejected updateTransport:', validation.error.issues);
        notify.error(t('assistant.invalidTransport'));
        return [];
      }
      // The repository copies the train's own fields to every leg of it.
      await updateTransportWithOwnershipCheck(leg.id, tid, patch);
      notifySuccess(t('transports.updateSuccess'));
      return [t('assistant.actionDetails.updateTransport', { location: merged.location })];
    }

    case 'leaveTransport': {
      const tid = needTrip();
      if (!tid) return [];
      const leg = await getTransportById(d.transportId as TransportId);
      if (!leg || leg.tripId !== tid) {
        notify.error(t('assistant.transportNotFound'));
        return [];
      }
      await setTransportSharedLeg(leg.id, tid, null);
      const person = await getPersonById(leg.personId);
      notifySuccess(t('transports.updateSuccess'));
      return [t('assistant.actionDetails.leaveTransport', { person: person?.name ?? '...' })];
    }

    // ---- Cars ---------------------------------------------------------------
    case 'updateVehicle': {
      const tid = needTrip();
      if (!tid) return [];
      const vehicle = await getVehicleById(d.vehicleId as VehicleId);
      if (!vehicle || vehicle.tripId !== tid) {
        notify.error(t('assistant.vehicleNotFound'));
        return [];
      }
      let ownerId = vehicle.ownerId;
      if (d.ownerId !== undefined) {
        const owner = await guestOfTrip(d.ownerId, tid);
        if (!owner) {
          notify.error(t('assistant.guestNotFound'));
          return [];
        }
        ownerId = owner.id;
      }
      const merged: VehicleFormData = {
        name: textOf(d.name) ?? vehicle.name,
        ...(ownerId !== undefined && { ownerId }),
        ...(d.seatCount !== undefined
          ? { seatCount: Number(d.seatCount) }
          : vehicle.seatCount !== undefined && { seatCount: vehicle.seatCount }),
        // The validator already dropped any restraint outside CHILD_SEAT_KINDS.
        ...(d.childSeats !== undefined
          ? { childSeats: d.childSeats as ChildSeatKind[] }
          : vehicle.childSeats !== undefined && { childSeats: [...vehicle.childSeats] }),
        ...(d.luggageNotes !== undefined
          ? { luggageNotes: String(d.luggageNotes) }
          : vehicle.luggageNotes !== undefined && { luggageNotes: vehicle.luggageNotes }),
        ...(d.notes !== undefined
          ? { notes: String(d.notes) }
          : vehicle.notes !== undefined && { notes: vehicle.notes }),
      };
      const validation = VehicleFormDataSchema.safeParse(merged);
      if (!validation.success) {
        console.warn('[AI Assistant] Rejected updateVehicle:', validation.error.issues);
        notify.error(t('assistant.invalidVehicle'));
        return [];
      }
      await updateVehicleWithOwnershipCheck(vehicle.id, tid, merged);
      notifySuccess(t('vehicles.updateSuccess'));
      return [t('assistant.actionDetails.updateVehicle', { name: merged.name })];
    }

    // ---- Shopping list (meal planner) ---------------------------------------
    case 'updateShoppingItem': {
      const tid = needTrip();
      if (!tid) return [];
      const item = await getShoppingItemById(d.itemId as ShoppingItemId);
      if (!item || item.tripId !== tid) {
        notify.error(t('assistant.shoppingItemNotFound'));
        return [];
      }
      const patch: Partial<ShoppingItemFormData> = {};
      const name = textOf(d.name);
      if (name !== undefined) patch.name = name;
      // An empty quantity clears it: a key passed as undefined is removed.
      if (typeof d.quantity === 'string') patch.quantity = textOf(d.quantity);
      if (typeof d.checked === 'boolean') patch.checked = d.checked;
      if (d.buyerId !== undefined) {
        const buyer = await guestOfTrip(d.buyerId, tid);
        if (!buyer) {
          notify.error(t('assistant.guestNotFound'));
          return [];
        }
        patch.buyerId = buyer.id;
      }
      if (Object.keys(patch).length === 0) return [];

      const merged = { ...item, ...patch };
      const validation = ShoppingItemFormDataSchema.safeParse({
        name: merged.name,
        checked: merged.checked,
        ...(merged.quantity !== undefined && { quantity: merged.quantity }),
        ...(merged.buyerId !== undefined && { buyerId: merged.buyerId }),
      });
      if (!validation.success) {
        console.warn('[AI Assistant] Rejected updateShoppingItem:', validation.error.issues);
        notify.error(t('assistant.invalidShoppingItem'));
        return [];
      }
      await updateShoppingItemWithOwnershipCheck(item.id, tid, patch);
      return [t('assistant.actionDetails.updateShoppingItem', { name: merged.name })];
    }

    case 'clearBoughtItems': {
      const tid = needTrip();
      if (!tid) return [];
      const count = await deleteCheckedShoppingItems(tid);
      if (count === 0) return [];
      captureDeletion('shopping_item_deleted', { source: 'assistant', count });
      return [t('assistant.actionDetails.clearBoughtItems', { count })];
    }

    // ---- Sharing ------------------------------------------------------------
    case 'createInviteLink': {
      const tid = needTrip();
      if (!tid) return [];
      const trip = await getTripById(tid);
      if (!trip) {
        notify.error(t('assistant.noTripForAction'));
        return [];
      }
      const server = await serverFor(context);
      if (!server) return [];
      const result = await getTripInviteLink(server.client, server.userId, tid, trip.endDate ?? null);
      if (result.kind !== 'invite') {
        notify.error(
          result.kind === 'needs-account'
            ? t('assistant.needsAccount')
            : t('assistant.sharingFailed', { message: result.message }),
        );
        return [];
      }
      return [t('assistant.actionDetails.createInviteLink', { url: result.url })];
    }

    case 'publishTemplate':
    case 'unpublishTemplate': {
      if (!context.templatesEnabled) {
        notify.error(t('assistant.templatesOff'));
        return [];
      }
      const tid = needTrip();
      if (!tid) return [];
      const trip = await getTripById(tid);
      if (!trip) {
        notify.error(t('assistant.noTripForAction'));
        return [];
      }
      const server = await serverFor(context);
      if (!server) return [];

      if (action.action === 'publishTemplate') {
        const result = await publishTripTemplate(server.client, server.userId, trip);
        if (result.status === 'error') {
          notify.error(t('assistant.sharingFailed', { message: result.message }));
          return [];
        }
        return [t('assistant.actionDetails.publishTemplate', { url: result.url })];
      }

      const result = await unpublishTripTemplate(server.client, server.userId, tid);
      if (result.status === 'error') {
        notify.error(t('assistant.sharingFailed', { message: result.message }));
        return [];
      }
      if (result.status === 'not-on-server') return [];
      return [t('assistant.actionDetails.unpublishTemplate')];
    }

    default:
      return null;
  }
}
