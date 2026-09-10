/**
 * Zod validation schemas for Kikouchou form data.
 *
 * These schemas provide runtime validation that matches the TypeScript types
 * defined in @/types. Use these for validating form submissions and API responses.
 *
 * @module lib/validation/schemas
 */

import { z } from 'zod';
import {
  ACTIVITY_CATEGORIES,
  EXPENSE_CATEGORIES,
  EXPENSE_KINDS,
  EXPENSE_SPLIT_MODES,
  MAX_ACTIVITY_PARTICIPANTS,
  MAX_EXPENSE_AMOUNT,
  MAX_EXPENSE_SPLITS,
  MAX_EXPENSE_SPLIT_VALUE,
  MAX_GUEST_GROUP_MEMBERS,
  MAX_LEAD_TIME_MINUTES,
  MAX_PERSON_HEADCOUNT,
  MAX_VEHICLE_SEAT_COUNT,
  MIN_LEAD_TIME_MINUTES,
  MIN_PERSON_HEADCOUNT,
  MIN_VEHICLE_SEAT_COUNT,
} from '@/types';
import type {
  ActivityCategory,
  ExpenseCategory,
  ExpenseKind,
  ExpenseSplitMode,
  HexColor,
  ISODateString,
  PersonId,
  RideId,
  RoomIcon,
  RoomId,
  TransportMode,
  TransportType,
  VehicleId,
} from '@/types';

// ============================================================================
// Primitive Validators
// ============================================================================

/**
 * ISO date string validator (YYYY-MM-DD format).
 * Validates format and ensures the date is real (e.g., rejects Feb 30).
 */
export const isoDateStringSchema = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/, {
    message: 'Invalid date format. Expected YYYY-MM-DD',
  })
  .refine(
    (str) => {
      const parsed = new Date(`${str}T00:00:00.000Z`);
      if (isNaN(parsed.getTime())) return false;
      const year = parseInt(str.slice(0, 4), 10);
      const month = parseInt(str.slice(5, 7), 10);
      const day = parseInt(str.slice(8, 10), 10);
      return (
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() + 1 === month &&
        parsed.getUTCDate() === day
      );
    },
    { message: 'Invalid date. Date does not exist.' },
  ) as unknown as z.ZodType<ISODateString>;

/**
 * ISO datetime string validator.
 * Accepts full ISO 8601 format with timezone (e.g., "2024-07-15T14:30:00.000Z").
 */
export const isoDateTimeStringSchema = z
  .string()
  .regex(
    /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/,
    { message: 'Invalid datetime format. Expected ISO 8601 format.' },
  )
  .refine(
    (str) => {
      const parsed = new Date(str);
      return !isNaN(parsed.getTime());
    },
    { message: 'Invalid datetime value.' },
  );

/**
 * Hex color validator (#RRGGBB format).
 */
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, {
    message: 'Invalid color format. Expected #RRGGBB',
  }) as unknown as z.ZodType<HexColor>;

/**
 * Room icon validator.
 */
export const roomIconSchema = z.enum([
  'bed-double',
  'bed-single',
  'bath',
  'sofa',
  'tent',
  'caravan',
  'warehouse',
  'home',
  'door-open',
  'baby',
  'armchair',
]) satisfies z.ZodType<RoomIcon>;

/**
 * Transport type validator.
 */
export const rideDirectionSchema = z.enum(['pickup', 'dropoff'], {
  message: 'Direction must be pickup or dropoff',
});

export const childSeatKindSchema = z.enum(
  ['rearFacing', 'forwardFacing', 'booster'],
  { message: 'Unknown child seat kind' },
);

export const transportTypeSchema = z.enum([
  'arrival',
  'departure',
]) satisfies z.ZodType<TransportType>;

/**
 * Transport mode validator.
 */
export const transportModeSchema = z.enum([
  'train',
  'plane',
  'car',
  'bus',
  'other',
]) satisfies z.ZodType<TransportMode>;

/**
 * Activity category validator.
 */
export const activityCategorySchema = z.enum(
  ACTIVITY_CATEGORIES as unknown as [ActivityCategory, ...ActivityCategory[]],
) satisfies z.ZodType<ActivityCategory>;

/**
 * Expense kind validator.
 */
export const expenseKindSchema = z.enum(
  EXPENSE_KINDS as unknown as [ExpenseKind, ...ExpenseKind[]],
) satisfies z.ZodType<ExpenseKind>;

/**
 * Expense category validator.
 */
export const expenseCategorySchema = z.enum(
  EXPENSE_CATEGORIES as unknown as [ExpenseCategory, ...ExpenseCategory[]],
) satisfies z.ZodType<ExpenseCategory>;

/**
 * Expense split mode validator.
 */
export const expenseSplitModeSchema = z.enum(
  EXPENSE_SPLIT_MODES as unknown as [ExpenseSplitMode, ...ExpenseSplitMode[]],
) satisfies z.ZodType<ExpenseSplitMode>;

/**
 * Currency code validator: ISO 4217's three uppercase letters.
 *
 * The shape rather than a list of codes. The trip form offers a dozen, and a
 * group spending in a currency it does not list should be able to store the
 * code rather than be told it is invalid; what must not get through is a value
 * `Intl.NumberFormat` throws on.
 */
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Currency must be a three-letter ISO 4217 code');

/**
 * Branded ID schema factory.
 * Creates a schema that accepts any non-empty string as a branded ID.
 */
const brandedIdSchema = <T extends string>() =>
  z.string().min(1, 'ID is required') as unknown as z.ZodType<T>;

/**
 * PersonId validator.
 */
export const personIdSchema = brandedIdSchema<PersonId>();
export const rideIdSchema = brandedIdSchema<RideId>();
export const vehicleIdSchema = brandedIdSchema<VehicleId>();

/**
 * RoomId validator.
 */
export const roomIdSchema = brandedIdSchema<RoomId>();

// ============================================================================
// GPS Coordinates Schema
// ============================================================================

/**
 * GPS coordinates validator.
 */
export const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

// ============================================================================
// Form Data Schemas
// ============================================================================

/**
 * Trip form data schema.
 *
 * Validates:
 * - name: required, 1-100 characters
 * - location: optional, max 200 characters
 * - startDate: required, valid ISO date
 * - endDate: required, valid ISO date, must be >= startDate
 * - description: optional, max 1000 characters
 * - coordinates: optional GPS coordinates
 */
export const TripFormDataSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Name is required')
      .max(100, 'Name must be 100 characters or less'),
    location: z
      .string()
      .max(200, 'Location must be 200 characters or less')
      .optional(),
    startDate: isoDateStringSchema,
    endDate: isoDateStringSchema,
    description: z
      .string()
      .max(1000, 'Description must be 1000 characters or less')
      .optional(),
    coordinates: coordinatesSchema.optional(),
    currency: currencyCodeSchema.optional(),
  })
  .refine((data) => data.startDate <= data.endDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

/**
 * Room form data schema.
 *
 * Validates:
 * - name: required, 1-100 characters
 * - capacity: required, positive integer (minimum 1)
 * - description: optional, max 500 characters
 * - icon: optional, valid room icon
 */
export const RoomFormDataSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or less'),
  capacity: z
    .number()
    .int('Capacity must be a whole number')
    .min(1, 'Capacity must be at least 1'),
  description: z
    .string()
    .max(500, 'Description must be 500 characters or less')
    .optional(),
  icon: roomIconSchema.optional(),
});

/**
 * Person form data schema.
 *
 * Validates:
 * - name: required, 1-100 characters
 * - color: required, valid hex color
 * - stayStartDate: optional, valid ISO date
 * - stayEndDate: optional, valid ISO date
 * - If both stay dates provided, stayEndDate must be >= stayStartDate
 * - phone: optional, max 32 characters
 * - headcount: optional, whole number between 1 and 99
 */
export const PersonFormDataSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Name is required')
      .max(100, 'Name must be 100 characters or less'),
    color: hexColorSchema,
    stayStartDate: isoDateStringSchema.optional(),
    stayEndDate: isoDateStringSchema.optional(),
    // Length is the only constraint. A pattern would reject valid numbers long
    // before it caught an invalid one — extensions, national prefixes and the
    // "(0)" French numbers carry are all legitimate and all differently shaped.
    phone: z
      .string()
      .max(32, 'Phone number must be 32 characters or less')
      .optional(),
    headcount: z
      .number()
      .int('Headcount must be a whole number')
      .min(MIN_PERSON_HEADCOUNT, `Headcount must be at least ${MIN_PERSON_HEADCOUNT}`)
      .max(MAX_PERSON_HEADCOUNT, `Headcount must be ${MAX_PERSON_HEADCOUNT} or less`)
      .optional(),
    childSeat: childSeatKindSchema.optional(),
  })
  .refine(
    (data) => {
      // If both dates are provided, ensure end >= start
      if (data.stayStartDate && data.stayEndDate) {
        return data.stayStartDate <= data.stayEndDate;
      }
      return true;
    },
    {
      message: 'Stay end date must be on or after stay start date',
      path: ['stayEndDate'],
    },
  );

/**
 * Room assignment form data schema.
 *
 * Validates:
 * - roomId: required, valid room ID
 * - personId: required, valid person ID
 * - startDate: required, valid ISO date
 * - endDate: required, valid ISO date, must be >= startDate
 */
export const RoomAssignmentFormDataSchema = z
  .object({
    roomId: roomIdSchema,
    personId: personIdSchema,
    startDate: isoDateStringSchema,
    endDate: isoDateStringSchema,
  })
  .refine((data) => data.startDate <= data.endDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

/**
 * Transport form data schema.
 *
 * Validates:
 * - personId: required, valid person ID
 * - type: required, 'arrival' or 'departure'
 * - datetime: required, valid ISO datetime
 * - location: required, 1-200 characters
 * - transportMode: optional, valid transport mode
 * - transportNumber: optional, max 50 characters
 * - driverId: optional, valid person ID
 * - needsPickup: required, boolean
 * - coordinates: optional GPS coordinates (end point)
 * - startLocation: optional starting place label
 * - startCoordinates: optional GPS coordinates for start
 * - notes: optional, max 500 characters
 */
export const TransportFormDataSchema = z.object({
  personId: personIdSchema,
  type: transportTypeSchema,
  datetime: isoDateTimeStringSchema,
  location: z
    .string()
    .min(1, 'Location is required')
    .max(200, 'Location must be 200 characters or less'),
  coordinates: coordinatesSchema.optional(),
  startLocation: z
    .string()
    .max(200, 'Starting place must be 200 characters or less')
    .optional(),
  startCoordinates: coordinatesSchema.optional(),
  transportMode: transportModeSchema.optional(),
  transportNumber: z
    .string()
    .max(50, 'Transport number must be 50 characters or less')
    .optional(),
  driverId: personIdSchema.optional(),
  rideId: rideIdSchema.optional(),
  needsPickup: z.boolean(),
  notes: z
    .string()
    .max(500, 'Notes must be 500 characters or less')
    .optional(),
});

/**
 * Vehicle form data schema.
 *
 * Every capacity field is optional, and that is the product decision rather
 * than laxness: a car nobody has measured still names itself on a ride card,
 * and a missing `seatCount` means "not known" — no warning is ever raised
 * against an absent limit.
 */
export const VehicleFormDataSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or less'),
  ownerId: personIdSchema.optional(),
  seatCount: z
    .number()
    .int('Seats must be a whole number')
    .min(MIN_VEHICLE_SEAT_COUNT, `Seats must be at least ${MIN_VEHICLE_SEAT_COUNT}`)
    .max(MAX_VEHICLE_SEAT_COUNT, `Seats must be ${MAX_VEHICLE_SEAT_COUNT} or less`)
    .optional(),
  childSeats: z.array(childSeatKindSchema).max(MAX_VEHICLE_SEAT_COUNT).optional(),
  luggageNotes: z
    .string()
    .max(500, 'Luggage note must be 500 characters or less')
    .optional(),
  notes: z.string().max(1000, 'Notes must be 1000 characters or less').optional(),
});

/**
 * Ride form data schema.
 *
 * No passenger list, deliberately: membership is a scalar on each leg
 * (`Transport.rideId`), because the shared document merges an array field
 * atomically and two guests joining one car offline would lose a join.
 *
 * `leadTimeMinutes` allows zero — a guest already standing at the station
 * leaves now — which is why its floor is 0 rather than 1.
 */
export const RideFormDataSchema = z.object({
  direction: rideDirectionSchema,
  meetDatetime: isoDateTimeStringSchema,
  location: z
    .string()
    .min(1, 'Location is required')
    .max(200, 'Location must be 200 characters or less'),
  coordinates: coordinatesSchema.optional(),
  leadTimeMinutes: z
    .number()
    .int('Lead time must be a whole number of minutes')
    .min(MIN_LEAD_TIME_MINUTES)
    .max(MAX_LEAD_TIME_MINUTES, `Lead time must be ${MAX_LEAD_TIME_MINUTES} minutes or less`)
    .optional(),
  driverId: personIdSchema.optional(),
  vehicleId: vehicleIdSchema.optional(),
  notes: z.string().max(1000, 'Notes must be 1000 characters or less').optional(),
});

/**
 * Activity form data schema.
 *
 * Validates:
 * - title: required, 1-100 characters
 * - category: required, valid activity category
 * - startDatetime: required, valid ISO datetime
 * - endDatetime: optional, valid ISO datetime, must be >= startDatetime
 * - allDay: required, boolean
 * - location: optional, max 200 characters
 * - coordinates: optional GPS coordinates
 * - participantIds: required array of person IDs (may be empty)
 * - organizerId: optional, valid person ID
 * - maxParticipants: optional, whole number >= 1
 * - notes: optional, max 1000 characters
 */
export const ActivityFormDataSchema = z
  .object({
    title: z
      .string()
      .min(1, 'Title is required')
      .max(100, 'Title must be 100 characters or less'),
    category: activityCategorySchema,
    startDatetime: isoDateTimeStringSchema,
    endDatetime: isoDateTimeStringSchema.optional(),
    allDay: z.boolean(),
    location: z
      .string()
      .max(200, 'Location must be 200 characters or less')
      .optional(),
    coordinates: coordinatesSchema.optional(),
    participantIds: z.array(personIdSchema),
    organizerId: personIdSchema.optional(),
    maxParticipants: z
      .number()
      .int('Participant cap must be a whole number')
      .min(1, 'Participant cap must be at least 1')
      .max(MAX_ACTIVITY_PARTICIPANTS, `Participant cap must be ${MAX_ACTIVITY_PARTICIPANTS} or less`)
      .optional(),
    notes: z
      .string()
      .max(1000, 'Notes must be 1000 characters or less')
      .optional(),
  })
  .refine(
    (data) =>
      data.endDatetime === undefined ||
      new Date(data.endDatetime).getTime() >= new Date(data.startDatetime).getTime(),
    {
      message: 'End must be on or after start',
      path: ['endDatetime'],
    },
  )
  .refine(
    (data) =>
      data.maxParticipants === undefined ||
      data.participantIds.length <= data.maxParticipants,
    {
      message: 'There are more participants than the cap allows',
      path: ['maxParticipants'],
    },
  );

/**
 * Expense form data schema.
 *
 * Validates:
 * - kind: required, one of expense / income / transfer
 * - category: required, a known expense category
 * - title: required, 1-100 characters
 * - date: required, a real calendar day
 * - amount: required, above zero and at most MAX_EXPENSE_AMOUNT
 * - payerId: required, a person id
 * - splitMode: required, one of the four split rules
 * - splits: required array (may be empty), one entry per guest at most
 * - description: optional, max 1000 characters
 *
 * Two rules are checked across fields, because both decide whether the line can
 * be divided at all rather than whether one field is well formed:
 *
 * - a `transfer` names exactly one guest, the one being paid, and it is not the
 *   payer — a line from a guest to themselves moves no money and would render
 *   as a settling payment nobody has to make;
 * - an `amounts` split has to add up to the amount, to the cent. The rule is the
 *   one the person typing it thinks they are following, and a total that is out
 *   by fifty is a typo rather than a rounding difference.
 */
export const ExpenseFormDataSchema = z
  .object({
    kind: expenseKindSchema,
    category: expenseCategorySchema,
    title: z
      .string()
      .min(1, 'Title is required')
      .max(100, 'Title must be 100 characters or less'),
    date: isoDateStringSchema,
    amount: z
      .number()
      .positive('Amount must be above zero')
      .max(MAX_EXPENSE_AMOUNT, `Amount must be ${MAX_EXPENSE_AMOUNT} or less`),
    payerId: personIdSchema,
    splitMode: expenseSplitModeSchema,
    splits: z
      .array(
        z.object({
          personId: personIdSchema,
          value: z
            .number()
            .min(0, 'A share cannot be negative')
            .max(
              MAX_EXPENSE_SPLIT_VALUE,
              `A share must be ${MAX_EXPENSE_SPLIT_VALUE} or less`,
            ),
        }),
      )
      .max(MAX_EXPENSE_SPLITS, `A line holds at most ${MAX_EXPENSE_SPLITS} shares`),
    description: z
      .string()
      .max(1000, 'Description must be 1000 characters or less')
      .optional(),
  })
  .refine(
    (data) =>
      data.kind !== 'transfer' ||
      (data.splits.length === 1 && data.splits[0]?.personId !== data.payerId),
    {
      message: 'A transfer goes to exactly one other guest',
      path: ['splits'],
    },
  )
  .refine(
    (data) => {
      if (data.splitMode !== 'amounts' || data.splits.length === 0) {
        return true;
      }
      const typed = data.splits.reduce(
        (total, split) => total + Math.round(split.value * 100),
        0,
      );
      return typed === Math.round(data.amount * 100);
    },
    {
      message: 'The amounts must add up to the total',
      path: ['splits'],
    },
  );

/**
 * Guest group member schema.
 *
 * Deliberately the same bounds as {@link PersonFormDataSchema} on the fields
 * they share: a member becomes a `Person` on import, so anything accepted here
 * must survive that write unchanged.
 *
 * Validates:
 * - name: required, 1-100 characters
 * - color: required, valid hex color
 * - headcount: optional, whole number between 1 and 99
 * - notes: optional, max 2000 characters
 * - phone: optional, max 32 characters
 * - childSeat: optional, one of the known child seat kinds
 */
export const GuestGroupMemberFormDataSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or less'),
  color: hexColorSchema,
  headcount: z
    .number()
    .int('Headcount must be a whole number')
    .min(MIN_PERSON_HEADCOUNT, `Headcount must be at least ${MIN_PERSON_HEADCOUNT}`)
    .max(MAX_PERSON_HEADCOUNT, `Headcount must be ${MAX_PERSON_HEADCOUNT} or less`)
    .optional(),
  notes: z
    .string()
    .max(2000, 'Notes must be 2000 characters or less')
    .optional(),
  phone: z
    .string()
    .max(32, 'Phone number must be 32 characters or less')
    .optional(),
  childSeat: childSeatKindSchema.optional(),
});

/**
 * Guest group form data schema.
 *
 * Validates:
 * - name: required, 1-100 characters
 * - members: required array (may be empty — a group is named before it is
 *   filled), each a valid member, at most MAX_GUEST_GROUP_MEMBERS of them
 */
export const GuestGroupFormDataSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or less'),
  members: z
    .array(GuestGroupMemberFormDataSchema)
    .max(
      MAX_GUEST_GROUP_MEMBERS,
      `A group holds at most ${MAX_GUEST_GROUP_MEMBERS} members`,
    ),
});

// ============================================================================
// Type Exports
// ============================================================================

/**
 * Inferred types from schemas.
 * These should match the TypeScript types in @/types.
 */
export type TripFormDataInput = z.input<typeof TripFormDataSchema>;
export type RoomFormDataInput = z.input<typeof RoomFormDataSchema>;
export type PersonFormDataInput = z.input<typeof PersonFormDataSchema>;
export type RoomAssignmentFormDataInput = z.input<
  typeof RoomAssignmentFormDataSchema
>;
export type TransportFormDataInput = z.input<typeof TransportFormDataSchema>;
export type RideFormDataInput = z.input<typeof RideFormDataSchema>;
export type VehicleFormDataInput = z.input<typeof VehicleFormDataSchema>;
export type ActivityFormDataInput = z.input<typeof ActivityFormDataSchema>;
export type ExpenseFormDataInput = z.input<typeof ExpenseFormDataSchema>;
export type GuestGroupFormDataInput = z.input<typeof GuestGroupFormDataSchema>;
export type GuestGroupMemberFormDataInput = z.input<
  typeof GuestGroupMemberFormDataSchema
>;
