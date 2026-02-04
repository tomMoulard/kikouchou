/**
 * Zod validation schemas for Kikoushou form data.
 *
 * These schemas provide runtime validation that matches the TypeScript types
 * defined in @/types. Use these for validating form submissions and API responses.
 *
 * @module lib/validation/schemas
 */

import { z } from 'zod';
import type {
  HexColor,
  ISODateString,
  PersonId,
  RoomIcon,
  RoomId,
  TransportMode,
  TransportType,
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
 * Branded ID schema factory.
 * Creates a schema that accepts any non-empty string as a branded ID.
 */
const brandedIdSchema = <T extends string>() =>
  z.string().min(1, 'ID is required') as unknown as z.ZodType<T>;

/**
 * PersonId validator.
 */
export const personIdSchema = brandedIdSchema<PersonId>();

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
  transportMode: transportModeSchema.optional(),
  transportNumber: z
    .string()
    .max(50, 'Transport number must be 50 characters or less')
    .optional(),
  driverId: personIdSchema.optional(),
  needsPickup: z.boolean(),
  notes: z
    .string()
    .max(500, 'Notes must be 500 characters or less')
    .optional(),
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
