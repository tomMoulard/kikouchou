// ============================================================================
// Kikouchou PWA - Type Definitions
// A vacation house room assignment and arrivals/departures tracking application
// ============================================================================

// ============================================================================
// Branded Types for Type-Safe IDs
// ============================================================================

/**
 * Branded type pattern for nominal typing.
 * Prevents accidentally mixing IDs of different entity types.
 */
declare const __brand: unique symbol;

/**
 * Creates a branded type that is structurally a string but nominally distinct.
 * Exported for consumers who need to create custom branded types.
 * @template T - The brand identifier
 */
export type Brand<T extends string> = string & { readonly [__brand]: T };

/** Type-safe Trip identifier (nanoid generated) */
export type TripId = Brand<'TripId'>;

/** Type-safe Room identifier (nanoid generated) */
export type RoomId = Brand<'RoomId'>;

/** Type-safe Person identifier (nanoid generated) */
export type PersonId = Brand<'PersonId'>;

/** Type-safe RoomAssignment identifier (nanoid generated) */
export type RoomAssignmentId = Brand<'RoomAssignmentId'>;

/** Type-safe Transport identifier (nanoid generated) */
export type TransportId = Brand<'TransportId'>;

/** Type-safe Activity identifier (nanoid generated) */
export type ActivityId = Brand<'ActivityId'>;

/** Type-safe Ride identifier (nanoid generated) */
export type RideId = Brand<'RideId'>;

/** Type-safe Vehicle identifier (nanoid generated) */
export type VehicleId = Brand<'VehicleId'>;

/** Type-safe Share identifier (shorter nanoid for sharing URLs) */
export type ShareId = Brand<'ShareId'>;

/** Type-safe GuestGroup identifier (nanoid generated) */
export type GuestGroupId = Brand<'GuestGroupId'>;

/** Type-safe GuestGroupMember identifier (nanoid generated) */
export type GuestGroupMemberId = Brand<'GuestGroupMemberId'>;

// ============================================================================
// Primitive Utility Types
// ============================================================================

/**
 * ISO 8601 date string in YYYY-MM-DD format (branded type).
 *
 * A calendar day as the viewer sees it. Use `toISODateStringFromString()` to
 * create one from a validated string and `toLocalISODateString()` from a Date;
 * `toISODateString()` reads UTC components and is not the day-key convention
 * (see `lib/utils/trip-days`).
 *
 * @example "2024-07-15"
 */
export type ISODateString = Brand<'ISODateString'>;

/**
 * ISO 8601 datetime string with timezone.
 * @example "2024-07-15T14:30:00.000Z"
 */
export type ISODateTimeString = string;

/**
 * Hexadecimal color string (branded type).
 * Use `toHexColor()` to create from a validated string.
 * @example "#ef4444"
 */
export type HexColor = Brand<'HexColor'>;

/**
 * Unix timestamp in milliseconds.
 * @example 1720000000000
 */
export type UnixTimestamp = number;

// ============================================================================
// Enumeration Types
// ============================================================================

/**
 * Transport event type indicating direction of travel.
 */
export type TransportType = 'arrival' | 'departure';

/**
 * Mode of transportation for arrivals and departures.
 */
export type TransportMode = 'train' | 'plane' | 'car' | 'bus' | 'other';

/**
 * Which way a car journey runs relative to the house.
 *
 * `pickup` fetches guests from a station or airport and brings them back;
 * `dropoff` takes them out to one. It is the ride's own direction, not the
 * direction of the legs it serves — a ride that drops Tom at the airport and
 * collects Alice on the way home is two rides, because it is two meetings.
 */
export type RideDirection = 'pickup' | 'dropoff';

/**
 * All ride directions, in the order they are offered in the form.
 */
export const RIDE_DIRECTIONS: readonly RideDirection[] = [
  'pickup',
  'dropoff',
] as const;

/**
 * Kind of child restraint a guest needs in a car.
 *
 * Deliberately *declared* rather than derived. Which seat a child needs is a
 * legal question answered by national regulation (R129/i-Size against the older
 * R44), it depends on height as well as age and weight, and it changes. The app
 * stores no birthdate and no weight, and encoding a compliance table in a
 * holiday-house planner would be a promise it cannot keep. The parent knows the
 * answer; this records it.
 */
export type ChildSeatKind = 'rearFacing' | 'forwardFacing' | 'booster';

/**
 * All child seat kinds, in increasing order of child size.
 */
export const CHILD_SEAT_KINDS: readonly ChildSeatKind[] = [
  'rearFacing',
  'forwardFacing',
  'booster',
] as const;

/**
 * Minutes before a ride's meeting time that the driver must set off, when the
 * ride does not say otherwise.
 */
export const DEFAULT_LEAD_TIME_MINUTES = 30;

/**
 * Bounds for {@link Ride.leadTimeMinutes}.
 *
 * Zero is allowed — a guest already at the station leaves now — and the upper
 * bound exists because this value is subtracted from an instant and rendered:
 * an unbounded one arriving over sync would put a "leave now" alert years in
 * the past and keep it permanently on screen.
 */
export const MIN_LEAD_TIME_MINUTES = 0;
export const MAX_LEAD_TIME_MINUTES = 24 * 60;

/**
 * Bounds for {@link Vehicle.seatCount}.
 *
 * The upper bound is a minibus, not a coach, and it is a guard rather than a
 * product limit: an unbounded capacity arriving from a peer used to reach
 * `Array.from({length: capacity})` elsewhere in this codebase and permanently
 * OOM the tab.
 */
export const MIN_VEHICLE_SEAT_COUNT = 1;
export const MAX_VEHICLE_SEAT_COUNT = 99;

/**
 * Kind of shared activity planned during a trip.
 *
 * Categories drive the icon and colour used on the activity list, the
 * activity timeline and the calendar, so guests can scan the agenda at a glance.
 */
export type ActivityCategory =
  | 'horticulture' // Garden visits, plant fairs, greenhouse tours
  | 'visit'        // Sightseeing, museums, monuments
  | 'hike'         // Walks, hikes, bike rides
  | 'beach'        // Beach, pool, swimming
  | 'sport'        // Sports and games outdoors
  | 'meal'         // Shared meals, restaurants, barbecues
  | 'culture'      // Concerts, cinema, festivals
  | 'market'       // Markets, groceries, shopping
  | 'workshop'     // Workshops, cooking, crafts
  | 'other';       // Anything else

/**
 * All activity categories, in the order they are offered in the form.
 */
export const ACTIVITY_CATEGORIES: readonly ActivityCategory[] = [
  'horticulture',
  'visit',
  'hike',
  'beach',
  'sport',
  'meal',
  'culture',
  'market',
  'workshop',
  'other',
] as const;

/**
 * Default category used when none is selected.
 */
export const DEFAULT_ACTIVITY_CATEGORY: ActivityCategory = 'other';

/**
 * Category colour used for activity pills on the calendar and timeline.
 * Pre-validated hex colours cast to the branded type.
 */
export const ACTIVITY_CATEGORY_COLORS: Readonly<Record<ActivityCategory, HexColor>> = {
  horticulture: '#16a34a' as HexColor, // Green
  visit: '#0ea5e9' as HexColor,        // Sky
  hike: '#65a30d' as HexColor,         // Lime
  beach: '#06b6d4' as HexColor,        // Cyan
  sport: '#f97316' as HexColor,        // Orange
  meal: '#e11d48' as HexColor,         // Rose
  culture: '#8b5cf6' as HexColor,      // Violet
  market: '#d97706' as HexColor,       // Amber
  workshop: '#0891b2' as HexColor,     // Teal
  other: '#6b7280' as HexColor,        // Grey
} as const;

/**
 * Returns the display colour for an activity category, falling back to the
 * neutral colour for records stored with an unknown category.
 *
 * @param category - The activity category (may be undefined on legacy records)
 * @returns A hex colour for the category
 */
export function getActivityCategoryColor(
  category: ActivityCategory | undefined,
): HexColor {
  return (
    (category && ACTIVITY_CATEGORY_COLORS[category]) ??
    ACTIVITY_CATEGORY_COLORS.other
  );
}

/**
 * Room icon type for visual identification across views.
 * Icons are from lucide-react library.
 */
export type RoomIcon =
  | 'bed-double'   // Default bedroom
  | 'bed-single'   // Single bed room
  | 'bath'         // Bathroom
  | 'sofa'         // Living room
  | 'tent'         // Tent/outdoor
  | 'caravan'      // Mobile home
  | 'warehouse'    // Garage/storage
  | 'home'         // General room
  | 'door-open'    // Entryway
  | 'baby'         // Kids room
  | 'armchair';    // Lounge

/**
 * Default room icon when none is selected.
 */
export const DEFAULT_ROOM_ICON: RoomIcon = 'bed-double';

/**
 * Supported application languages.
 */
export type Language = 'en' | 'fr';

/**
 * Supported on-device assistant model presets.
 *
 * These are symbolic preset identifiers stored in user settings; the concrete
 * Hugging Face model IDs live in the assistant feature module.
 */
export type AssistantModelId =
  | 'gemma-3-1b'
  | 'gemma-4-e2b'
  | 'gemma-4-e4b';

// ============================================================================
// Base Interfaces
// ============================================================================

/**
 * Base interface for all entities with an identifier.
 */
export interface Identifiable {
  /** Unique identifier generated by nanoid */
  readonly id: string;
}

/**
 * Base interface for entities that belong to a specific trip.
 *
 * @indexing Dexie.js schema should include compound indexes:
 * - For Room: `[tripId+order]`
 * - For RoomAssignment: `[tripId+startDate]`, `[tripId+personId]`, `[tripId+roomId]`
 * - For Transport: `[tripId+datetime]`, `[tripId+personId]`, `[tripId+type]`
 * - For Ride: `[tripId+meetDatetime]`
 * - For Vehicle: `tripId`
 * - For Activity: `[tripId+startDatetime]`, `[tripId+category]`, `*participantIds`
 */
export interface TripScoped {
  /** Foreign key reference to the parent Trip */
  readonly tripId: TripId;
}

/**
 * Represents a date range with start and end dates.
 * Used for trips and room assignments.
 *
 * @constraint startDate must be on or before endDate (validated at runtime)
 */
export interface DateRange {
  /**
   * Start date in ISO format (YYYY-MM-DD).
   * @example "2024-07-15"
   */
  startDate: ISODateString;

  /**
   * End date in ISO format (YYYY-MM-DD).
   * @example "2024-07-22"
   */
  endDate: ISODateString;
}

/**
 * Mixin for entities with creation and update timestamps.
 */
export interface WithTimestamps {
  /** Unix timestamp (ms) when the entity was created */
  readonly createdAt: UnixTimestamp;
  /** Unix timestamp (ms) when the entity was last updated */
  updatedAt: UnixTimestamp;
}

// ============================================================================
// Core Entity Interfaces
// ============================================================================

/**
 * A vacation or holiday event that groups rooms, persons, and logistics.
 *
 * @description The Trip is the root entity in Kikouchou. All other entities
 * (rooms, persons, assignments, transports) belong to a specific trip.
 *
 * @example
 * ```typescript
 * const trip: Trip = {
 *   id: 'abc123' as TripId,
 *   name: 'Summer vacation 2024',
 *   location: 'Beach house, Brittany',
 *   startDate: '2024-07-15',
 *   endDate: '2024-07-22',
 *   shareId: 'xyz789' as ShareId,
 *   createdAt: 1720000000000,
 *   updatedAt: 1720000000000,
 * };
 * ```
 */
export interface Trip extends Identifiable, WithTimestamps {
  /** Unique trip identifier */
  readonly id: TripId;

  /**
   * Display name for the trip.
   * @example "Summer vacation 2024"
   */
  name: string;

  /**
   * Optional location description.
   * @example "Beach house, Brittany"
   */
  location?: string;

  /**
   * Start date of the trip in ISO format (YYYY-MM-DD).
   * Must be on or before endDate.
   * @example "2024-07-15"
   */
  startDate: ISODateString;

  /**
   * End date of the trip in ISO format (YYYY-MM-DD).
   * Must be on or after startDate.
   * @example "2024-07-22"
   */
  endDate: ISODateString;

  /**
   * Unique identifier for sharing the trip via URL or QR code.
   * Shorter than regular IDs for convenience (10 characters).
   */
  readonly shareId: ShareId;

  /**
   * Optional description or notes for the trip.
   * Can include instructions, links (e.g., tricount), or other useful information.
   * @example "Instructions: Check-in after 3pm. Tricount: https://tricount.com/..."
   */
  description?: string;

  /**
   * Optional GPS coordinates for the trip location.
   * Used for displaying map previews on trip cards.
   * @example { lat: 48.8566, lon: 2.3522 }
   */
  coordinates?: {
    readonly lat: number;
    readonly lon: number;
  };

  /**
   * Server-side `trips.id` once this trip has been uploaded.
   *
   * Absent means local-only, which is the normal state for a trip nobody has
   * shared — not a pending action. Its presence is what makes the sync provider
   * mount at all.
   *
   * Set once and never changed: the server row is keyed on
   * `(owner_id, local_id)`, so re-uploading the same trip resolves to the same
   * row rather than creating a second one.
   */
  remoteTripId?: string;
}

/**
 * A room or sleeping area in the vacation house.
 *
 * @description Rooms belong to a trip and can have persons assigned to them
 * for specific date ranges. The order field controls display sorting.
 *
 * @see {@link Trip} - Parent entity
 * @see {@link RoomAssignment} - Links persons to rooms
 *
 * @example
 * ```typescript
 * const room: Room = {
 *   id: 'room123' as RoomId,
 *   tripId: 'trip456' as TripId,
 *   name: 'Master bedroom',
 *   capacity: 2,
 *   description: 'King bed with ensuite bathroom',
 *   order: 0,
 * };
 * ```
 */
export interface Room extends Identifiable, TripScoped {
  /** Unique room identifier */
  readonly id: RoomId;

  /**
   * Display name for the room.
   * @example "Master bedroom"
   */
  name: string;

  /**
   * Number of beds/sleeping spots in the room.
   * Must be a positive integer (minimum: 1).
   */
  capacity: number;

  /**
   * Optional description or notes about the room.
   * @example "King bed with ensuite bathroom"
   */
  description?: string;

  /**
   * Display order for sorting rooms.
   * Lower numbers appear first. Must be a non-negative integer.
   */
  order: number;

  /**
   * Optional icon for visual identification.
   * Defaults to 'bed-double' when not specified.
   * @see {@link RoomIcon}
   * @example "bed-double"
   */
  icon?: RoomIcon;
}

/**
 * A participant in a trip.
 *
 * @description Persons are people participating in a trip. Each person has
 * a unique color for visual identification on the calendar view.
 *
 * @see {@link Trip} - Parent entity
 * @see {@link RoomAssignment} - Assigns persons to rooms
 * @see {@link Transport} - Person's arrival/departure logistics
 *
 * @example
 * ```typescript
 * const person: Person = {
 *   id: 'person123' as PersonId,
 *   tripId: 'trip456' as TripId,
 *   name: 'Marie',
 *   color: '#ef4444',
 * };
 * ```
 */
export interface Person extends Identifiable, TripScoped {
  /** Unique person identifier */
  readonly id: PersonId;

  /**
   * Display name of the person.
   * @example "Marie"
   */
  name: string;

  /**
   * Hex color code for calendar display.
   * Used to visually distinguish this person's assignments.
   * @example "#ef4444"
   */
  color: HexColor;

  /**
   * Optional stay start date (ISO format, YYYY-MM-DD).
   * When the person is expected to arrive at the trip.
   * @example "2024-07-15"
   */
  stayStartDate?: ISODateString;

  /**
   * Optional stay end date (ISO format, YYYY-MM-DD).
   * When the person is expected to leave the trip.
   * @example "2024-07-22"
   */
  stayEndDate?: ISODateString;

  /**
   * Optional free-text notes (allergies, diet, accessibility, etc.).
   */
  notes?: string;

  /**
   * Optional phone number, so the others on the trip can reach this guest —
   * the one picking them up at the station most of all.
   *
   * Stored exactly as it was typed or as the address book held it, never
   * reformatted: numbers arrive in a dozen national conventions and rewriting
   * them is how a working number stops working. It is a contact string, not a
   * key — nothing matches or dials on it automatically.
   *
   * It syncs with the rest of the trip, so every member of the trip can read
   * it. Only enter a number the person is happy to share with the group.
   *
   * @example "+33 6 12 34 56 78"
   */
  phone?: string;

  /**
   * Number of real people this participant stands for.
   *
   * A guest entry is often a couple or a family tracked under one name
   * ("Alice+Auré"). Headcounts (meals, groceries) must count 2, while rooms,
   * transports and the calendar still show a single row.
   *
   * Defaults to 1 when unset (all records created before this field existed).
   * Read it through {@link getPersonHeadcount} instead of accessing directly.
   *
   * @example 2
   */
  headcount?: number;

  /**
   * The child restraint this guest needs in a car, when they need one.
   *
   * Absent means no seat is required — which is the answer for every adult, so
   * the field stays empty for most of a trip's roster. It is a property of the
   * child rather than of a journey, so it is entered once here and every ride
   * that carries them tallies it automatically.
   *
   * A child who needs a seat should be their own guest row rather than part of
   * a parent's {@link headcount}: a headcount of 2 says how many bodies to
   * count, never which of them is small.
   *
   * @see {@link ChildSeatKind}
   * @example "booster"
   */
  childSeat?: ChildSeatKind;
}

/**
 * Links a person to a room for a specific date range.
 *
 * @description Room assignments represent when a person sleeps in a specific
 * room. A person cannot be assigned to multiple rooms for overlapping dates.
 *
 * @see {@link Trip} - Parent entity
 * @see {@link Room} - The assigned room
 * @see {@link Person} - The assigned person
 *
 * @example
 * ```typescript
 * const assignment: RoomAssignment = {
 *   id: 'assign123' as RoomAssignmentId,
 *   tripId: 'trip456' as TripId,
 *   roomId: 'room789' as RoomId,
 *   personId: 'person012' as PersonId,
 *   startDate: '2024-07-15',
 *   endDate: '2024-07-19',
 * };
 * ```
 */
export interface RoomAssignment extends Identifiable, TripScoped {
  /** Unique assignment identifier */
  readonly id: RoomAssignmentId;

  /**
   * Reference to the room being assigned.
   * @see {@link Room}
   */
  roomId: RoomId;

  /**
   * Reference to the person being assigned.
   * @see {@link Person}
   */
  personId: PersonId;

  /**
   * First night of the assignment in ISO format (YYYY-MM-DD).
   * Must be within the trip's date range and on or before endDate.
   * @example "2024-07-15"
   */
  startDate: ISODateString;

  /**
   * Last night of the assignment in ISO format (YYYY-MM-DD).
   * Must be within the trip's date range and on or after startDate.
   * @example "2024-07-19"
   */
  endDate: ISODateString;
}

/**
 * An arrival or departure event for a trip participant.
 *
 * @description Transports track when and how persons arrive at or depart from
 * the trip location. They can include pickup/dropoff logistics.
 *
 * @see {@link Trip} - Parent entity
 * @see {@link Person} - The traveling person
 * @see {@link Person} - Optional driver for pickup/dropoff (driverId)
 *
 * @example
 * ```typescript
 * const transport: Transport = {
 *   id: 'trans123' as TransportId,
 *   tripId: 'trip456' as TripId,
 *   personId: 'person789' as PersonId,
 *   type: 'arrival',
 *   datetime: '2024-07-15T14:30:00.000Z',
 *   location: 'Gare Montparnasse',
 *   transportMode: 'train',
 *   transportNumber: 'TGV 8541',
 *   driverId: 'person012' as PersonId,
 *   needsPickup: true,
 *   notes: 'Platform 12',
 * };
 * ```
 */
export interface Transport extends Identifiable, TripScoped {
  /** Unique transport identifier */
  readonly id: TransportId;

  /**
   * Reference to the traveling person.
   * @see {@link Person}
   */
  personId: PersonId;

  /**
   * Whether this is an arrival or departure event.
   */
  type: TransportType;

  /**
   * Date and time of arrival/departure in ISO 8601 format with timezone.
   * @example "2024-07-15T14:30:00.000Z"
   */
  datetime: ISODateTimeString;

  /**
   * Location name (station, airport, address, etc.).
   * @example "Gare Montparnasse"
   */
  location: string;

  /**
   * Optional GPS coordinates for the transport location.
   * Used for displaying transport locations on maps.
   * @example { lat: 48.8566, lon: 2.3522 }
   */
  coordinates?: {
    readonly lat: number;
    readonly lon: number;
  };

  /**
   * Optional starting point for this leg (e.g. origin station, home).
   * When set with {@link coordinates}, maps can draw a route between start and end.
   */
  startLocation?: string;

  /**
   * Optional GPS coordinates for the starting point.
   */
  startCoordinates?: {
    readonly lat: number;
    readonly lon: number;
  };

  /**
   * Mode of transportation.
   * @example "train"
   */
  transportMode?: TransportMode;

  /**
   * Train number, flight number, or other identifier.
   * @example "TGV 8541" or "AF1234"
   */
  transportNumber?: string;

  /**
   * The car journey carrying this leg, when one has been arranged.
   *
   * Membership is a scalar on the leg rather than a passenger array on
   * {@link Ride}, and that is load-bearing rather than stylistic. The shared
   * document merges an array field atomically (see `lib/yjs/doc-model`), so two
   * guests joining the same car while both offline would keep only one of the
   * two joins — the bug that shape already produced for activity participants.
   * Each guest writing one field on their own record cannot collide.
   *
   * @see {@link Ride}
   */
  rideId?: RideId;

  /**
   * Reference to the person responsible for pickup/dropoff.
   *
   * @deprecated Legacy single-passenger form, kept because records created
   * before {@link Ride} existed still carry it and no upgrade invents rides for
   * them — an upgrade running on one device would launder that device's guess
   * into the shared document. A transport with a `driverId` and no
   * {@link rideId} is *read* as a one-passenger ride by `resolveRides()`; new
   * arrangements always create a `Ride`.
   *
   * @see {@link Person}
   */
  driverId?: PersonId;

  /**
   * Whether this transport needs someone to provide a ride.
   * When true, displays in the "upcoming pickups" section.
   */
  needsPickup: boolean;

  /**
   * Additional notes about the transport.
   * @example "Platform 12" or "Terminal 2E"
   */
  notes?: string;
}

/**
 * A car available to the trip.
 *
 * @description Somebody's own car or the one hired for the week. A vehicle is
 * entered once and picked per {@link Ride}, so "the rented Espace" does not get
 * retyped for every airport run and "which car has the boosters in it" has an
 * answer.
 *
 * Every capacity field is optional. A vehicle nobody has measured is still
 * useful — it names the car on a ride card — and a missing `seatCount` means
 * "not known", never "zero seats": no warning is raised against an absent limit.
 *
 * @see {@link Trip} - Parent entity
 * @see {@link Ride} - The journeys that use it
 * @see {@link Person} - The owner (ownerId)
 *
 * @example
 * ```typescript
 * const vehicle: Vehicle = {
 *   id: 'veh123' as VehicleId,
 *   tripId: 'trip456' as TripId,
 *   name: 'Espace de location',
 *   isRental: true,
 *   seatCount: 7,
 *   childSeats: ['booster', 'booster'],
 *   luggageNotes: 'Coffre pris par la poussette',
 * };
 * ```
 */
export interface Vehicle extends Identifiable, TripScoped {
  /** Unique vehicle identifier */
  readonly id: VehicleId;

  /**
   * Display name, however the group refers to the car.
   * @example "Espace de location" or "la Clio de Guillaume"
   */
  name: string;

  /**
   * Reference to the guest whose car this is.
   *
   * Absent for a hire car, or for one nobody on the trip owns. It does not
   * imply anything about who drives — a ride names its own driver.
   *
   * @see {@link Person}
   */
  ownerId?: PersonId;

  /**
   * Whether this is a hire car.
   *
   * A rental can be left at the destination, so a departure run that drops it
   * at the airport needs no return leg. That is the difference the flag exists
   * to record.
   */
  isRental?: boolean;

  /**
   * How many people the car carries, **driver included**.
   *
   * Compared against the sum of the passengers' `headcount`, never against the
   * number of guest rows: one row can stand for a couple.
   *
   * @see {@link MAX_VEHICLE_SEAT_COUNT}
   * @example 7
   */
  seatCount?: number;

  /**
   * The child restraints physically installed in, or travelling with, this car.
   *
   * One entry per seat, so two boosters are `['booster', 'booster']`. A ride
   * warns when the children it carries need a seat this list does not hold.
   */
  childSeats?: ChildSeatKind[];

  /**
   * Free text about what the car will take in the way of luggage.
   *
   * Deliberately not a number. Nothing is counted against it: the app has no
   * per-guest bag count and inventing one would make every guest fill in a
   * field to silence a warning nobody asked for.
   *
   * @example "Grand coffre, mais la galerie n'est pas montée"
   */
  luggageNotes?: string;

  /**
   * Additional notes about the vehicle.
   * @example "Boîte automatique — Aurélia ne peut pas la conduire"
   */
  notes?: string;
}

/**
 * A car journey serving one or more guests' arrival or departure legs.
 *
 * @description A {@link Transport} is a guest's own leg — Alice's TGV lands at
 * 17:02. A ride is the car that meets it: who drives, in what, from when. They
 * are separate because they are separate facts about different people at
 * different times, and because one car serves several legs at once.
 *
 * Passengers are **not** listed here. A leg points at its ride through
 * {@link Transport.rideId}; see that field for why the arrow runs that way.
 *
 * The driver may be one of the passengers. Three guests taking the hire car to
 * the airport and leaving it there is a ride whose `driverId` owns one of the
 * legs pointing at it — no chauffeur, no separate return. Nothing stores that
 * fact; `resolveRides()` derives it, so it cannot go stale.
 *
 * @see {@link Trip} - Parent entity
 * @see {@link Transport} - The legs it serves
 * @see {@link Vehicle} - The car
 * @see {@link Person} - The driver (driverId)
 *
 * @example
 * ```typescript
 * const ride: Ride = {
 *   id: 'ride123' as RideId,
 *   tripId: 'trip456' as TripId,
 *   direction: 'pickup',
 *   meetDatetime: '2024-07-15T15:02:00.000Z',
 *   location: 'Lyon Part-Dieu',
 *   leadTimeMinutes: 30,
 *   driverId: 'person789' as PersonId,
 *   vehicleId: 'veh123' as VehicleId,
 * };
 * ```
 */
export interface Ride extends Identifiable, TripScoped {
  /** Unique ride identifier */
  readonly id: RideId;

  /**
   * Whether the car is fetching guests or taking them away.
   */
  direction: RideDirection;

  /**
   * When the car must be at the meeting point, ISO 8601 with timezone.
   *
   * This is the *rendez-vous*, not the departure from the house — subtract
   * {@link leadTimeMinutes} for that. Keeping the meeting time as the stored
   * value means a change to the lead time never moves the appointment.
   *
   * @example "2024-07-15T15:02:00.000Z"
   */
  meetDatetime: ISODateTimeString;

  /**
   * Where the car meets its passengers.
   * @example "Lyon Part-Dieu"
   */
  location: string;

  /**
   * Optional GPS coordinates for the meeting point, for maps and directions.
   */
  coordinates?: {
    readonly lat: number;
    readonly lon: number;
  };

  /**
   * Minutes before {@link meetDatetime} that the driver has to set off.
   *
   * Typed by whoever knows the road, not computed from coordinates: the
   * estimate would need a routing service and a network connection at exactly
   * the moment the app is most likely to be offline, and it would still be
   * worse than the driver's own answer.
   *
   * Absent means {@link DEFAULT_LEAD_TIME_MINUTES}.
   *
   * @see {@link MAX_LEAD_TIME_MINUTES}
   * @example 30
   */
  leadTimeMinutes?: number;

  /**
   * Reference to the guest driving.
   *
   * May be one of the passengers — see the note on self-driven rides above.
   * Absent means the ride still needs somebody to volunteer, which is what puts
   * it in the "needs a driver" list.
   *
   * @see {@link Person}
   */
  driverId?: PersonId;

  /**
   * Reference to the car being used.
   *
   * Absent until one is chosen; capacity and child-seat checks simply have
   * nothing to compare against until then.
   *
   * @see {@link Vehicle}
   */
  vehicleId?: VehicleId;

  /**
   * Additional notes about the journey.
   * @example "Passer prendre le pain en redescendant"
   */
  notes?: string;
}

/**
 * A shared activity planned during a trip.
 *
 * @description Activities are the trip agenda: a garden fair, a hike, a market
 * run, a shared meal. Any guest can be listed as a participant, so the group
 * knows who is joining what and when.
 *
 * @see {@link Trip} - Parent entity
 * @see {@link Person} - Organizer and participants
 *
 * @example
 * ```typescript
 * const activity: Activity = {
 *   id: 'act123' as ActivityId,
 *   tripId: 'trip456' as TripId,
 *   title: 'Fête des plantes de Saint-Jean',
 *   category: 'horticulture',
 *   startDatetime: '2024-07-16T09:00:00.000Z',
 *   endDatetime: '2024-07-16T12:00:00.000Z',
 *   allDay: false,
 *   location: 'Château de Saint-Jean',
 *   organizerId: 'person789' as PersonId,
 *   participantIds: ['person789' as PersonId],
 * };
 * ```
 */
export interface Activity extends Identifiable, TripScoped {
  /** Unique activity identifier */
  readonly id: ActivityId;

  /**
   * Short title shown on the agenda, timeline and calendar.
   * @example "Fête des plantes de Saint-Jean"
   */
  title: string;

  /**
   * Kind of activity, driving the icon and colour used across views.
   * @see {@link ActivityCategory}
   */
  category: ActivityCategory;

  /**
   * Start of the activity in ISO 8601 format with timezone.
   * For all-day activities this is midnight local time on the first day.
   * @example "2024-07-16T09:00:00.000Z"
   */
  startDatetime: ISODateTimeString;

  /**
   * Optional end of the activity in ISO 8601 format with timezone.
   * Must be on or after {@link startDatetime}. Multi-day activities are
   * rendered as a span on the timeline and the calendar.
   * @example "2024-07-16T12:00:00.000Z"
   */
  endDatetime?: ISODateTimeString;

  /**
   * Whether the activity covers whole days rather than a time slot.
   * All-day activities hide their times in every view.
   */
  allDay: boolean;

  /**
   * Optional place name (garden, market, trailhead, restaurant…).
   * @example "Château de Saint-Jean"
   */
  location?: string;

  /**
   * Optional GPS coordinates for the activity location.
   * Enables the "get directions" action.
   */
  coordinates?: {
    readonly lat: number;
    readonly lon: number;
  };

  /**
   * Guests who signed up for this activity.
   * Empty means the activity is open and nobody has joined yet.
   * @see {@link Person}
   */
  participantIds: PersonId[];

  /**
   * Optional guest who proposed and leads the activity.
   * @see {@link Person}
   */
  organizerId?: PersonId;

  /**
   * Optional cap on the number of participants (e.g. seats in a car,
   * tickets booked). Undefined means unlimited.
   */
  maxParticipants?: number;

  /**
   * Free-text notes: booking links, price, what to bring…
   * @example "10 € l'entrée. Prévoir des bottes."
   */
  notes?: string;
}

/**
 * One person inside a {@link GuestGroup}.
 *
 * @description A member is a *template* for a guest, not a guest. Importing a
 * group copies the member's fields onto a brand-new {@link Person} scoped to the
 * trip; nothing links the two afterwards, so editing either one leaves the other
 * alone.
 *
 * Members are embedded in their group rather than given a table of their own:
 * nothing references a member id, and a member is only ever read as part of its
 * group.
 *
 * @see {@link GuestGroup} - Parent entity
 * @see {@link Person} - What a member becomes once imported
 *
 * @example
 * ```typescript
 * const member: GuestGroupMember = {
 *   id: 'member123' as GuestGroupMemberId,
 *   name: 'Tom + Léa',
 *   color: '#ef4444' as HexColor,
 *   headcount: 2,
 * };
 * ```
 */
export interface GuestGroupMember extends Identifiable {
  /** Unique member identifier */
  readonly id: GuestGroupMemberId;

  /**
   * Display name, copied onto the guest on import.
   * @example "Tom + Léa"
   */
  name: string;

  /**
   * Hex colour the imported guest starts with.
   * @example "#ef4444"
   */
  color: HexColor;

  /**
   * Number of real people this member stands for — a couple tracked under one
   * name is `2`. Carried onto the imported guest's own `headcount`.
   *
   * Defaults to 1 when unset. Read it through {@link getPersonHeadcount}, which
   * takes anything carrying an optional headcount.
   *
   * @example 2
   */
  headcount?: number;

  /**
   * Free-text notes that travel with the person between trips: allergies,
   * diet, accessibility. Copied onto the imported guest.
   */
  notes?: string;

  /**
   * Optional phone number, copied onto the imported guest.
   *
   * A phone number is the most trip-independent thing about a person and the
   * most tedious to retype, so it is exactly what a saved roster is for. Stored
   * as typed, never reformatted — see {@link Person.phone}.
   *
   * @example "+33 6 12 34 56 78"
   */
  phone?: string;
}

/**
 * A reusable roster of people that lives beside trips rather than inside one.
 *
 * @description Groups answer the "same family, every summer" case: build
 * "Family" once, then import whoever is coming into each new trip instead of
 * retyping them. A group is **global** — it belongs to the device (and, once
 * signed in, to the account) rather than to a trip, which is why it is the only
 * entity here that is neither {@link TripScoped} nor part of the trip document.
 *
 * Importing is a one-off copy: see {@link GuestGroupMember}.
 *
 * @see {@link GuestGroupMember} - The people in the group
 *
 * @example
 * ```typescript
 * const group: GuestGroup = {
 *   id: 'group123' as GuestGroupId,
 *   name: 'Family',
 *   members: [tomAndLea, alice, camille],
 *   createdAt: 1720000000000,
 *   updatedAt: 1720000000000,
 * };
 * ```
 */
export interface GuestGroup extends Identifiable, WithTimestamps {
  /** Unique group identifier */
  readonly id: GuestGroupId;

  /**
   * Display name for the group.
   * @example "Family"
   */
  name: string;

  /**
   * The people in the group, in the order the user arranged them.
   * Bounded by {@link MAX_GUEST_GROUP_MEMBERS}.
   */
  members: GuestGroupMember[];

  /**
   * Server `guest_groups.id`, present once this device has uploaded the group.
   *
   * Load-bearing for deletion: a pull prunes a local group **only** when it
   * carries this and the server no longer lists it. A group that has never been
   * pushed is not evidence that anything was deleted, so it is never pruned.
   */
  remoteGroupId?: string;
}

/**
 * Application settings stored as a singleton record.
 *
 * @description Stores user preferences and application state.
 * There is exactly one AppSettings record with id='settings'.
 *
 * @example
 * ```typescript
 * const settings: AppSettings = {
 *   id: 'settings',
 *   language: 'fr',
 *   currentTripId: 'trip456' as TripId,
 * };
 * ```
 */
export interface AppSettings extends Identifiable {
  /**
   * Singleton identifier - always 'settings'.
   * @readonly
   */
  readonly id: 'settings';

  /**
   * User's preferred language.
   * @default 'fr'
   */
  language: Language;

  /**
   * ID of the last viewed trip for session restoration.
   * Undefined if no trip has been viewed yet.
   */
  currentTripId?: TripId;

  /**
   * Preferred local assistant model preset.
   * Undefined means "use the app default".
   */
  assistantModelId?: AssistantModelId;

  /**
   * Which guest this device's owner *is*, per trip: `{ [tripId]: personId }`.
   *
   * Device-local and never synced — it says who is holding this phone, which is
   * not a fact about the trip and must not travel to anybody else's copy of it.
   * Two people sharing a tablet are one device with one answer, and that is the
   * correct behaviour: the tablet shows one person's rides at a time.
   *
   * A plain record rather than a table because it is read on every render of
   * the transport views and holds one short string per trip. It is the explicit
   * answer only; `lib/identity/trip-identity` falls back to the share-link
   * identity and then to the claimed trip membership when this is empty.
   */
  myPersonIdByTripId?: Record<string, string>;
}

// ============================================================================
// Form Data Types (for create/edit operations)
// ============================================================================

/**
 * Data required to create or update a Trip.
 * Excludes auto-generated fields (id, shareId, timestamps).
 *
 * @see {@link Trip}
 */
export interface TripFormData {
  /** Display name for the trip */
  name: string;
  /** Optional location description */
  location?: string;
  /** Start date in ISO format (YYYY-MM-DD) */
  startDate: ISODateString;
  /** End date in ISO format (YYYY-MM-DD) */
  endDate: ISODateString;
  /** Optional description or notes for the trip */
  description?: string;
  /** Optional GPS coordinates for the trip location */
  coordinates?: {
    readonly lat: number;
    readonly lon: number;
  };
}

/**
 * Data required to create or update a Room.
 * Excludes auto-generated fields (id, tripId, order).
 *
 * @see {@link Room}
 */
export interface RoomFormData {
  /** Display name for the room */
  name: string;
  /** Number of beds/sleeping spots (minimum: 1) */
  capacity: number;
  /** Optional description or notes */
  description?: string;
  /** Optional icon for visual identification */
  icon?: RoomIcon;
}

/**
 * Data required to create or update a Person.
 * Excludes auto-generated fields (id, tripId).
 *
 * @see {@link Person}
 */
export interface PersonFormData {
  /** Display name of the person */
  name: string;
  /** Hex color code for calendar display */
  color: HexColor;
  /** Optional stay start date (ISO format, YYYY-MM-DD) */
  stayStartDate?: ISODateString;
  /** Optional stay end date (ISO format, YYYY-MM-DD) */
  stayEndDate?: ISODateString;
  /** Optional notes (allergies, diet, etc.) */
  notes?: string;
  /** Optional phone number, shared with everyone on the trip */
  phone?: string;
  /** Number of real people this guest stands for (defaults to 1) */
  headcount?: number;
  /** The child restraint this guest needs in a car, when they need one */
  childSeat?: ChildSeatKind;
}

/**
 * Data required to create or update a {@link GuestGroupMember}.
 * Excludes the auto-generated id.
 *
 * @see {@link GuestGroupMember}
 */
export interface GuestGroupMemberFormData {
  /** Display name of the member */
  name: string;
  /** Hex colour the imported guest starts with */
  color: HexColor;
  /** Number of real people this member stands for (defaults to 1) */
  headcount?: number;
  /** Optional notes (allergies, diet, etc.) */
  notes?: string;
  /** Optional phone number, copied onto the imported guest */
  phone?: string;
}

/**
 * Data required to create or update a {@link GuestGroup}.
 * Excludes auto-generated fields (id, timestamps, remoteGroupId).
 *
 * @see {@link GuestGroup}
 */
export interface GuestGroupFormData {
  /** Display name of the group */
  name: string;
  /** The people in the group, in display order */
  members: GuestGroupMemberFormData[];
}

/**
 * Data required to create or update a RoomAssignment.
 * Excludes auto-generated fields (id, tripId).
 *
 * @see {@link RoomAssignment}
 */
export interface RoomAssignmentFormData {
  /** Reference to the room being assigned */
  roomId: RoomId;
  /** Reference to the person being assigned */
  personId: PersonId;
  /** First night of the assignment (YYYY-MM-DD) */
  startDate: ISODateString;
  /** Last night of the assignment (YYYY-MM-DD) */
  endDate: ISODateString;
}

/**
 * Data required to create or update a Transport.
 * Excludes auto-generated fields (id, tripId).
 *
 * @see {@link Transport}
 */
export interface TransportFormData {
  /** Reference to the traveling person */
  personId: PersonId;
  /** Whether this is an arrival or departure */
  type: TransportType;
  /** Date and time in ISO 8601 format */
  datetime: ISODateTimeString;
  /** Location name (station, airport, etc.) */
  location: string;
  /** Optional GPS coordinates for the transport location */
  coordinates?: {
    readonly lat: number;
    readonly lon: number;
  };
  /** Optional starting place name for this leg */
  startLocation?: string;
  /** Optional GPS coordinates for the starting place */
  startCoordinates?: {
    readonly lat: number;
    readonly lon: number;
  };
  /** Mode of transportation */
  transportMode?: TransportMode;
  /** Train/flight number or other identifier */
  transportNumber?: string;
  /** The car journey carrying this leg, when one has been arranged */
  rideId?: RideId;
  /** @deprecated Legacy single-passenger driver — see {@link Transport.driverId} */
  driverId?: PersonId;
  /** Whether pickup/dropoff is needed */
  needsPickup: boolean;
  /** Additional notes */
  notes?: string;
}

/**
 * Data required to create or update a Vehicle.
 * Excludes auto-generated fields (id, tripId).
 *
 * @see {@link Vehicle}
 */
export interface VehicleFormData {
  /** Display name of the car */
  name: string;
  /** Optional reference to the guest whose car it is */
  ownerId?: PersonId;
  /** Whether this is a hire car */
  isRental?: boolean;
  /** How many people it carries, driver included */
  seatCount?: number;
  /** The child restraints it carries, one entry per seat */
  childSeats?: ChildSeatKind[];
  /** Free text about luggage room */
  luggageNotes?: string;
  /** Additional notes */
  notes?: string;
}

/**
 * Data required to create or update a Ride.
 * Excludes auto-generated fields (id, tripId).
 *
 * @see {@link Ride}
 */
export interface RideFormData {
  /** Whether the car is fetching guests or taking them away */
  direction: RideDirection;
  /** When the car must be at the meeting point, ISO 8601 with timezone */
  meetDatetime: ISODateTimeString;
  /** Where the car meets its passengers */
  location: string;
  /** Optional GPS coordinates for the meeting point */
  coordinates?: {
    readonly lat: number;
    readonly lon: number;
  };
  /** Minutes before the meeting time that the driver sets off */
  leadTimeMinutes?: number;
  /** Optional reference to the guest driving */
  driverId?: PersonId;
  /** Optional reference to the car being used */
  vehicleId?: VehicleId;
  /** Additional notes */
  notes?: string;
}

/**
 * Data required to create or update an Activity.
 * Excludes auto-generated fields (id, tripId).
 *
 * @see {@link Activity}
 */
export interface ActivityFormData {
  /** Short title shown on the agenda */
  title: string;
  /** Kind of activity */
  category: ActivityCategory;
  /** Start in ISO 8601 format with timezone */
  startDatetime: ISODateTimeString;
  /** Optional end in ISO 8601 format with timezone */
  endDatetime?: ISODateTimeString;
  /** Whether the activity covers whole days */
  allDay: boolean;
  /** Optional place name */
  location?: string;
  /** Optional GPS coordinates for the activity location */
  coordinates?: {
    readonly lat: number;
    readonly lon: number;
  };
  /** Guests who signed up */
  participantIds: PersonId[];
  /** Optional guest leading the activity */
  organizerId?: PersonId;
  /** Optional cap on participants */
  maxParticipants?: number;
  /** Free-text notes */
  notes?: string;
}

// ============================================================================
// Utility Types for Common Operations
// ============================================================================

/**
 * Union of all trip-scoped entity types.
 */
export type TripEntity =
  | Room
  | Person
  | RoomAssignment
  | Transport
  | Ride
  | Vehicle
  | Activity;

/**
 * Union of all entity types in the application.
 */
export type AnyEntity = Trip | TripEntity | GuestGroup | AppSettings;

/**
 * Extracts the ID type from an entity type.
 * @template T - The entity type
 */
export type EntityId<T extends Identifiable> = T['id'];

/**
 * Makes specified properties of T optional.
 * @template T - The base type
 * @template K - Keys to make optional
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Makes specified properties of T required.
 * @template T - The base type
 * @template K - Keys to make required
 */
export type RequiredBy<T, K extends keyof T> = Omit<T, K> &
  Required<Pick<T, K>>;

/**
 * Creates a type for partial updates to an entity.
 * Preserves id and tripId as readonly, makes other fields optional.
 * @template T - The entity type extending TripScoped
 */
/**
 * Creates a type for partial updates to a trip-scoped entity.
 * Preserves id and tripId as readonly, makes other fields optional.
 * @template T - The entity type extending TripScoped
 */
export type EntityUpdate<T extends TripScoped & Identifiable> = Readonly<
  Pick<T, 'id' | 'tripId'>
> &
  Partial<Omit<T, 'id' | 'tripId'>>;

/**
 * Creates a type for partial updates to a Trip entity.
 * Preserves id as readonly, excludes shareId and createdAt from updates.
 */
export type TripUpdate = Readonly<Pick<Trip, 'id'>> &
  Partial<Omit<Trip, 'id' | 'shareId' | 'createdAt'>>;

/**
 * Default color palette for person assignment.
 * Used when automatically assigning colors to new persons.
 * These are pre-validated hex colors cast to the branded type.
 */
export const DEFAULT_PERSON_COLORS: readonly HexColor[] = [
  '#ef4444' as HexColor, // Red
  '#f97316' as HexColor, // Orange
  '#eab308' as HexColor, // Yellow
  '#22c55e' as HexColor, // Green
  '#14b8a6' as HexColor, // Teal
  '#3b82f6' as HexColor, // Blue
  '#8b5cf6' as HexColor, // Violet
  '#ec4899' as HexColor, // Pink
];

/**
 * Gets a default person color by index, cycling through the palette.
 * Use this helper to avoid undefined checks with `noUncheckedIndexedAccess`.
 * @param index - The index (will be wrapped using modulo)
 * @returns A hex color from the default palette
 */
export function getDefaultPersonColor(index: number): HexColor {
  const safeIndex = Math.abs(index) % DEFAULT_PERSON_COLORS.length;

  return DEFAULT_PERSON_COLORS[safeIndex]!;
}

/**
 * Headcount used for guests that have no explicit `headcount` (one person).
 */
export const DEFAULT_PERSON_HEADCOUNT = 1;

/**
 * Smallest headcount a guest entry may represent.
 */
export const MIN_PERSON_HEADCOUNT = 1;

/**
 * Largest headcount a single guest entry may represent.
 * Beyond this, guests should be split into several entries.
 */
export const MAX_PERSON_HEADCOUNT = 99;

/**
 * Clamps a raw headcount input to a whole number within the allowed range.
 * Returns the default headcount for undefined, non-finite, or invalid values.
 *
 * @param value - Raw headcount (form input, imported changeset, legacy record)
 * @returns A whole number between {@link MIN_PERSON_HEADCOUNT} and {@link MAX_PERSON_HEADCOUNT}
 */
export function normalizePersonHeadcount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_PERSON_HEADCOUNT;
  }

  const rounded = Math.round(value);
  if (rounded < MIN_PERSON_HEADCOUNT) {
    return MIN_PERSON_HEADCOUNT;
  }

  return rounded > MAX_PERSON_HEADCOUNT ? MAX_PERSON_HEADCOUNT : rounded;
}

/**
 * Number of real people a guest entry stands for.
 * Legacy records without the field count as one person.
 *
 * @param person - The guest (or any object carrying an optional headcount)
 * @returns The guest's headcount, at least 1
 */
export function getPersonHeadcount(person: { readonly headcount?: number }): number {
  return normalizePersonHeadcount(person.headcount);
}

/**
 * Largest number of participants a single activity may cap itself at.
 * Beyond that the cap is meaningless and treated as "unlimited".
 */
export const MAX_ACTIVITY_PARTICIPANTS = 999;

/**
 * Largest number of members a single {@link GuestGroup} may hold.
 *
 * A group is a family or a circle of friends, not a mailing list, and the whole
 * record travels as one row — local, and as one `jsonb` column on the server.
 * Bounding it here is what stops a group grown by a remote write from becoming
 * a row nothing can render.
 */
export const MAX_GUEST_GROUP_MEMBERS = 50;

/**
 * Default application settings.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  id: 'settings',
  language: 'fr',
  currentTripId: undefined,
} as const;
