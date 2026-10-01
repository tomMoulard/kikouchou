/**
 * @fileoverview The sample trip a first visit opens on.
 *
 * A brand-new install has nothing to look at, and an empty calendar explains
 * none of what the app does. So the first open writes one trip that uses
 * every feature: a description, a place on the map, rooms, guests with stay
 * dates and headcounts, room moves, arrivals and departures, shared rides and
 * cars, an agenda, and the money lines of each kind.
 *
 * Trip-scoped rows only. A guest group belongs to the account and syncs to
 * the server on sign-in, and the sample is a device-local trip that never
 * leaves the device, so it carries no group.
 *
 * This module only *builds* the rows, as a pure function of the language and
 * of today, so a test can hold it to "every feature" without a database.
 * `seed-sample-trip.ts` writes them.
 *
 * Dates are relative to today, so the sample never goes stale: it starts two
 * weeks out, far enough that no departure reminder or "leave now" notice
 * fires for a trip nobody is on.
 *
 * Adding a trip feature, an entity or a field? Add it here too. The tests in
 * `__tests__/sample-trip.test.ts` fail until you do.
 *
 * @module features/trips/utils/sample-trip
 */

import { addDays } from 'date-fns';

import { toAllDayActivityInstant } from '@/features/activities/utils/activity-utils';

import {
  createActivityId,
  createExpenseId,
  createPersonId,
  createRideId,
  createRoomAssignmentId,
  createRoomId,
  createShareId,
  createTransportId,
  createTripId,
  createVehicleId,
  toLocalISODateString,
} from '@/lib/db/utils';

import type {
  Activity,
  Expense,
  HexColor,
  ISODateString,
  ISODateTimeString,
  Language,
  Person,
  PersonId,
  Ride,
  Room,
  RoomAssignment,
  Transport,
  Trip,
  Vehicle,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** Every row the sample trip writes, one array per table. */
export interface SampleTripRows {
  readonly trip: Trip;
  readonly rooms: readonly Room[];
  readonly persons: readonly Person[];
  readonly roomAssignments: readonly RoomAssignment[];
  readonly vehicles: readonly Vehicle[];
  readonly rides: readonly Ride[];
  readonly transports: readonly Transport[];
  readonly activities: readonly Activity[];
  readonly expenses: readonly Expense[];
}

/** The words of the sample trip, in one language. */
interface SampleTripCopy {
  readonly tripName: string;
  readonly tripLocation: string;
  readonly tripDescription: string;
  readonly rooms: {
    readonly master: { readonly name: string; readonly description: string };
    readonly twin: { readonly name: string; readonly description: string };
    readonly bunk: { readonly name: string; readonly description: string };
    readonly sofa: { readonly name: string; readonly description: string };
    readonly tent: { readonly name: string; readonly description: string };
  };
  readonly persons: {
    readonly camille: string;
    readonly samAlex: string;
    readonly martins: string;
    readonly hugo: string;
    readonly nora: string;
    readonly jules: string;
  };
  readonly notes: {
    readonly camille: string;
    readonly samAlex: string;
    readonly hugo: string;
    readonly nora: string;
  };
  readonly places: {
    readonly station: string;
    readonly airport: string;
    readonly paris: string;
    readonly lyon: string;
    readonly apt: string;
    readonly gordes: string;
    readonly lake: string;
    readonly restaurant: string;
    readonly house: string;
  };
  readonly vehicles: {
    readonly estate: { readonly name: string; readonly luggage: string; readonly notes: string };
    readonly minivan: { readonly name: string; readonly luggage: string; readonly notes: string };
  };
  readonly rides: {
    readonly stationPickup: string;
    readonly airportPickup: string;
    readonly stationDropoff: string;
  };
  readonly transports: {
    readonly samAlexArrival: string;
    readonly julesArrival: string;
    readonly martinsArrival: string;
  };
  readonly activities: {
    readonly market: { readonly title: string; readonly notes: string };
    readonly lavender: { readonly title: string; readonly notes: string };
    readonly lake: { readonly title: string; readonly notes: string };
    readonly hike: { readonly title: string; readonly notes: string };
    readonly village: { readonly title: string; readonly notes: string };
    readonly petanque: { readonly title: string; readonly notes: string };
    readonly cooking: { readonly title: string; readonly notes: string };
    readonly dinner: { readonly title: string; readonly notes: string };
    readonly cinema: { readonly title: string; readonly notes: string };
    readonly cleanup: { readonly title: string; readonly notes: string };
  };
  readonly expenses: {
    readonly rent: { readonly title: string; readonly description: string };
    readonly groceries: { readonly title: string; readonly description: string };
    readonly dinner: { readonly title: string; readonly description: string };
    readonly fuel: { readonly title: string; readonly description: string };
    readonly tickets: { readonly title: string; readonly description: string };
    readonly firewood: { readonly title: string; readonly description: string };
    readonly cleaning: { readonly title: string; readonly description: string };
    readonly deposit: { readonly title: string; readonly description: string };
    readonly settle: { readonly title: string; readonly description: string };
  };
}

// ============================================================================
// Constants
// ============================================================================

/** Days from today to the first day of the sample trip. */
export const SAMPLE_TRIP_LEAD_DAYS = 14;

/** Nights in the sample trip; the last day is the check-out day. */
export const SAMPLE_TRIP_NIGHTS = 5;

const COORDINATES = {
  house: { lat: 43.9116, lon: 5.2003 },
  station: { lat: 43.9216, lon: 4.7861 },
  airport: { lat: 43.4393, lon: 5.2214 },
  paris: { lat: 48.8443, lon: 2.3744 },
  lyon: { lat: 45.7606, lon: 4.8594 },
  apt: { lat: 43.8764, lon: 5.3964 },
  gordes: { lat: 43.9114, lon: 5.2006 },
  lake: { lat: 43.9789, lon: 5.0558 },
  restaurant: { lat: 43.8995, lon: 5.2366 },
} as const;

const COLORS = {
  camille: '#6366f1' as HexColor,
  samAlex: '#f97316' as HexColor,
  martins: '#22c55e' as HexColor,
  hugo: '#14b8a6' as HexColor,
  nora: '#8b5cf6' as HexColor,
  jules: '#ec4899' as HexColor,
} as const;

const PHONES = {
  camille: '+33 6 12 34 56 78',
  samAlex: '+44 7700 900123',
  martins: '+33 6 98 76 54 32',
  nora: '+33 7 11 22 33 44',
  jules: '+33 6 55 44 33 22',
} as const;

const COPY: Readonly<Record<Language, SampleTripCopy>> = {
  en: {
    tripName: 'Sample trip: summer in Provence',
    tripLocation: 'Mas des Oliviers, Gordes',
    tripDescription:
      'This is a sample trip. It shows what Kikouchou can do, so look around, change anything, or delete it from the trip settings.\n\n' +
      '**The house**: the key box is by the blue gate, code 2468. Wi-Fi: `MasOliviers`, password on the fridge.\n\n' +
      '**Bring**: towels, a swimsuit, and something for the barbecue.',
    rooms: {
      master: { name: 'Main bedroom', description: 'Double bed, view on the olive trees.' },
      twin: { name: 'Twin room', description: 'Two single beds, next to the bathroom.' },
      bunk: { name: 'Bunk room', description: 'Bunk bed and a small bed for the kids.' },
      sofa: { name: 'Living room sofa bed', description: 'Opens into a double. First up makes the coffee.' },
      tent: { name: 'Tent in the garden', description: 'Under the fig tree. Bring a sleeping bag.' },
    },
    persons: {
      camille: 'Camille',
      samAlex: 'Sam & Alex',
      martins: 'Léa & Marc Martin',
      hugo: 'Hugo Martin',
      nora: 'Nora',
      jules: 'Jules',
    },
    notes: {
      camille: 'Organiser. Vegetarian.',
      samAlex: 'Coming from London by train.',
      hugo: 'Seven years old. Needs a booster seat in the car.',
      nora: 'Allergic to nuts.',
    },
    places: {
      station: 'Avignon TGV station',
      airport: 'Marseille Provence airport',
      paris: 'Paris Gare de Lyon',
      lyon: 'Lyon',
      apt: 'Apt market square',
      gordes: 'Gordes village',
      lake: 'Lac de l’Isle-sur-la-Sorgue',
      restaurant: 'La Bastide, Goult',
      house: 'Mas des Oliviers',
    },
    vehicles: {
      estate: {
        name: 'Camille’s estate car',
        luggage: 'Large boot: four suitcases.',
        notes: 'Diesel. The key is in the bowl by the door.',
      },
      minivan: {
        name: 'The Martins’ minivan',
        luggage: 'Roof box, room for everything.',
        notes: 'Child seats already fitted.',
      },
    },
    rides: {
      stationPickup: 'Meet at the station exit, by the taxi rank.',
      airportPickup: 'Arrivals hall, terminal 1.',
      stationDropoff: 'Leave at 9:15 to be early for the train.',
    },
    transports: {
      samAlexArrival: 'Change in Lille.',
      julesArrival: 'One checked bag.',
      martinsArrival: 'Stopping for lunch on the way.',
    },
    activities: {
      market: { title: 'Saturday market in Apt', notes: 'Bring baskets. We buy for two dinners.' },
      lavender: { title: 'Lavender garden visit', notes: 'Best before the midday heat.' },
      lake: { title: 'Day at the lake', notes: 'Picnic and swimming. Sunscreen!' },
      hike: { title: 'Hike in the ochre trail', notes: 'Wear old shoes: the ochre stains.' },
      village: { title: 'Walk around Gordes', notes: 'Ice cream on the square after.' },
      petanque: { title: 'Pétanque tournament', notes: 'Teams of two, losers do the dishes.' },
      cooking: { title: 'Ratatouille workshop', notes: 'Hugo is the chef’s assistant.' },
      dinner: { title: 'Dinner at La Bastide', notes: 'Table booked for 8.' },
      cinema: { title: 'Open-air cinema', notes: 'Bring cushions and a blanket.' },
      cleanup: { title: 'Pack up and clean the house', notes: 'Check-out at noon.' },
    },
    expenses: {
      rent: { title: 'House rental', description: 'Five nights, split by the nights each guest stays.' },
      groceries: { title: 'First grocery run', description: 'Two trolleys, wine included.' },
      dinner: { title: 'Dinner at La Bastide', description: 'Each paid for what they ordered.' },
      fuel: { title: 'Fuel and tolls', description: 'Lyon to Gordes and back.' },
      tickets: { title: 'Lavender garden tickets', description: 'Child ticket at half price.' },
      firewood: { title: 'Firewood and charcoal', description: 'For the barbecue.' },
      cleaning: { title: 'Cleaning supplies', description: 'The house had none left.' },
      deposit: { title: 'Deposit returned', description: 'The owner gave the deposit back to Camille.' },
      settle: { title: 'Sam pays Camille back', description: 'Bank transfer.' },
    },
  },
  fr: {
    tripName: 'Voyage exemple : l’été en Provence',
    tripLocation: 'Mas des Oliviers, Gordes',
    tripDescription:
      'Ceci est un voyage exemple. Il montre ce que Kikouchou sait faire : explorez, modifiez ce que vous voulez, ou supprimez-le depuis les paramètres du voyage.\n\n' +
      '**La maison** : la boîte à clés est près du portail bleu, code 2468. Wi-Fi : `MasOliviers`, le mot de passe est sur le frigo.\n\n' +
      '**À apporter** : serviettes, maillot de bain, et de quoi faire un barbecue.',
    rooms: {
      master: { name: 'Chambre principale', description: 'Lit double, vue sur les oliviers.' },
      twin: { name: 'Chambre à deux lits', description: 'Deux lits simples, à côté de la salle de bain.' },
      bunk: { name: 'Chambre des enfants', description: 'Lits superposés et un petit lit.' },
      sofa: { name: 'Canapé-lit du salon', description: 'Se déplie en lit double. Le premier levé fait le café.' },
      tent: { name: 'Tente dans le jardin', description: 'Sous le figuier. Prévoir un sac de couchage.' },
    },
    persons: {
      camille: 'Camille',
      samAlex: 'Sam et Alex',
      martins: 'Léa et Marc Martin',
      hugo: 'Hugo Martin',
      nora: 'Nora',
      jules: 'Jules',
    },
    notes: {
      camille: 'Organisatrice. Végétarienne.',
      samAlex: 'Viennent de Londres en train.',
      hugo: 'Sept ans. A besoin d’un rehausseur en voiture.',
      nora: 'Allergique aux fruits à coque.',
    },
    places: {
      station: 'Gare d’Avignon TGV',
      airport: 'Aéroport Marseille Provence',
      paris: 'Paris Gare de Lyon',
      lyon: 'Lyon',
      apt: 'Place du marché, Apt',
      gordes: 'Village de Gordes',
      lake: 'Lac de l’Isle-sur-la-Sorgue',
      restaurant: 'La Bastide, Goult',
      house: 'Mas des Oliviers',
    },
    vehicles: {
      estate: {
        name: 'Le break de Camille',
        luggage: 'Grand coffre : quatre valises.',
        notes: 'Diesel. La clé est dans le bol près de la porte.',
      },
      minivan: {
        name: 'Le monospace des Martin',
        luggage: 'Coffre de toit, de la place pour tout.',
        notes: 'Sièges enfant déjà installés.',
      },
    },
    rides: {
      stationPickup: 'Rendez-vous à la sortie de la gare, près des taxis.',
      airportPickup: 'Hall des arrivées, terminal 1.',
      stationDropoff: 'Départ à 9 h 15 pour être en avance au train.',
    },
    transports: {
      samAlexArrival: 'Correspondance à Lille.',
      julesArrival: 'Un bagage en soute.',
      martinsArrival: 'Pause déjeuner en route.',
    },
    activities: {
      market: { title: 'Marché du samedi à Apt', notes: 'Prendre les paniers. On achète pour deux dîners.' },
      lavender: { title: 'Visite du jardin de lavande', notes: 'Mieux avant la chaleur de midi.' },
      lake: { title: 'Journée au lac', notes: 'Pique-nique et baignade. Crème solaire !' },
      hike: { title: 'Randonnée au sentier des ocres', notes: 'Vieilles chaussures : l’ocre tache.' },
      village: { title: 'Balade dans Gordes', notes: 'Glace sur la place ensuite.' },
      petanque: { title: 'Tournoi de pétanque', notes: 'Équipes de deux, les perdants font la vaisselle.' },
      cooking: { title: 'Atelier ratatouille', notes: 'Hugo est le commis du chef.' },
      dinner: { title: 'Dîner à La Bastide', notes: 'Table réservée pour 8.' },
      cinema: { title: 'Cinéma en plein air', notes: 'Prendre des coussins et un plaid.' },
      cleanup: { title: 'Rangement et ménage', notes: 'Départ de la maison à midi.' },
    },
    expenses: {
      rent: { title: 'Location de la maison', description: 'Cinq nuits, partagées selon les nuits de chacun.' },
      groceries: { title: 'Premières courses', description: 'Deux caddies, le vin compris.' },
      dinner: { title: 'Dîner à La Bastide', description: 'Chacun a payé ce qu’il a commandé.' },
      fuel: { title: 'Carburant et péages', description: 'Lyon-Gordes aller-retour.' },
      tickets: { title: 'Billets du jardin de lavande', description: 'Billet enfant à moitié prix.' },
      firewood: { title: 'Bois et charbon', description: 'Pour le barbecue.' },
      cleaning: { title: 'Produits ménagers', description: 'La maison n’en avait plus.' },
      deposit: { title: 'Caution rendue', description: 'Le propriétaire a rendu la caution à Camille.' },
      settle: { title: 'Sam rembourse Camille', description: 'Virement bancaire.' },
    },
  },
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * A local wall-clock time on a trip day, as the UTC instant the app stores.
 * Local, because that is what a `datetime-local` input would have produced.
 */
function at(day: Date, hours: number, minutes = 0): ISODateTimeString {
  const local = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hours,
    minutes,
  );
  return local.toISOString() as ISODateTimeString;
}

// ============================================================================
// Builder
// ============================================================================

/**
 * Builds every row of the sample trip, with fresh ids.
 *
 * @param language - The language the user reads the app in
 * @param today - The day the sample is built on; the trip starts two weeks later
 * @returns The rows, one array per table
 */
export function buildSampleTrip(language: Language, today: Date): SampleTripRows {
  const copy = COPY[language];
  const timestamp = today.getTime();

  // Local midnights, then local day keys: these are days the user sees.
  const firstDay = addDays(
    new Date(today.getFullYear(), today.getMonth(), today.getDate()),
    SAMPLE_TRIP_LEAD_DAYS,
  );
  const days = Array.from({ length: SAMPLE_TRIP_NIGHTS + 1 }, (_, index) =>
    addDays(firstDay, index),
  );
  const day = (index: number): Date => days[index]!;
  const key = (index: number): ISODateString => toLocalISODateString(day(index));
  const lastDay = SAMPLE_TRIP_NIGHTS;

  // ---- Trip ---------------------------------------------------------------
  const trip: Trip = {
    id: createTripId(),
    shareId: createShareId(),
    name: copy.tripName,
    location: copy.tripLocation,
    description: copy.tripDescription,
    coordinates: COORDINATES.house,
    startDate: key(0),
    endDate: key(lastDay),
    currency: 'EUR',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const tripId = trip.id;

  // ---- Guests -------------------------------------------------------------
  const ids = {
    camille: createPersonId(),
    samAlex: createPersonId(),
    martins: createPersonId(),
    hugo: createPersonId(),
    nora: createPersonId(),
    jules: createPersonId(),
  } as const;

  const persons: Person[] = [
    {
      id: ids.camille,
      tripId,
      name: copy.persons.camille,
      color: COLORS.camille,
      stayStartDate: key(0),
      stayEndDate: key(lastDay),
      notes: copy.notes.camille,
      phone: PHONES.camille,
    },
    {
      id: ids.samAlex,
      tripId,
      name: copy.persons.samAlex,
      color: COLORS.samAlex,
      stayStartDate: key(0),
      stayEndDate: key(lastDay),
      notes: copy.notes.samAlex,
      phone: PHONES.samAlex,
      headcount: 2,
    },
    {
      id: ids.martins,
      tripId,
      name: copy.persons.martins,
      color: COLORS.martins,
      stayStartDate: key(0),
      stayEndDate: key(lastDay - 1),
      phone: PHONES.martins,
      headcount: 2,
    },
    {
      id: ids.hugo,
      tripId,
      name: copy.persons.hugo,
      color: COLORS.hugo,
      stayStartDate: key(0),
      stayEndDate: key(lastDay - 1),
      notes: copy.notes.hugo,
      childSeat: 'booster',
    },
    {
      id: ids.nora,
      tripId,
      name: copy.persons.nora,
      color: COLORS.nora,
      stayStartDate: key(0),
      stayEndDate: key(lastDay),
      notes: copy.notes.nora,
      phone: PHONES.nora,
    },
    {
      id: ids.jules,
      tripId,
      name: copy.persons.jules,
      color: COLORS.jules,
      stayStartDate: key(2),
      stayEndDate: key(lastDay),
      phone: PHONES.jules,
    },
  ];

  // ---- Rooms --------------------------------------------------------------
  const roomIds = {
    master: createRoomId(),
    twin: createRoomId(),
    bunk: createRoomId(),
    sofa: createRoomId(),
    tent: createRoomId(),
  } as const;

  const rooms: Room[] = [
    { id: roomIds.master, tripId, order: 0, capacity: 2, icon: 'bed-double', ...copy.rooms.master },
    { id: roomIds.twin, tripId, order: 1, capacity: 2, icon: 'bed-twin', ...copy.rooms.twin },
    { id: roomIds.bunk, tripId, order: 2, capacity: 3, icon: 'bunk-bed', ...copy.rooms.bunk },
    { id: roomIds.sofa, tripId, order: 3, capacity: 2, icon: 'sofa', ...copy.rooms.sofa },
    { id: roomIds.tent, tripId, order: 4, capacity: 2, icon: 'tent', ...copy.rooms.tent },
  ];

  // ---- Room assignments: endDate is the check-out day ---------------------
  const assign = (
    roomId: Room['id'],
    personId: PersonId,
    from: number,
    to: number,
  ): RoomAssignment => ({
    id: createRoomAssignmentId(),
    tripId,
    roomId,
    personId,
    startDate: key(from),
    endDate: key(to),
  });

  const roomAssignments: RoomAssignment[] = [
    assign(roomIds.master, ids.camille, 0, lastDay),
    assign(roomIds.twin, ids.samAlex, 0, lastDay),
    assign(roomIds.bunk, ids.martins, 0, lastDay - 1),
    assign(roomIds.bunk, ids.hugo, 0, lastDay - 1),
    // Nora moves from the sofa to the room the Martins leave: one room move.
    assign(roomIds.sofa, ids.nora, 0, lastDay - 1),
    assign(roomIds.bunk, ids.nora, lastDay - 1, lastDay),
    assign(roomIds.tent, ids.jules, 2, lastDay),
  ];

  // ---- Vehicles -----------------------------------------------------------
  const vehicleIds = { estate: createVehicleId(), minivan: createVehicleId() } as const;

  const vehicles: Vehicle[] = [
    {
      id: vehicleIds.estate,
      tripId,
      name: copy.vehicles.estate.name,
      ownerId: ids.camille,
      seatCount: 5,
      childSeats: ['booster'],
      luggageNotes: copy.vehicles.estate.luggage,
      notes: copy.vehicles.estate.notes,
    },
    {
      id: vehicleIds.minivan,
      tripId,
      name: copy.vehicles.minivan.name,
      ownerId: ids.martins,
      seatCount: 7,
      childSeats: ['forwardFacing', 'booster'],
      luggageNotes: copy.vehicles.minivan.luggage,
      notes: copy.vehicles.minivan.notes,
    },
  ];

  // ---- Rides --------------------------------------------------------------
  const rideIds = {
    stationPickup: createRideId(),
    airportPickup: createRideId(),
    stationDropoff: createRideId(),
  } as const;

  const rides: Ride[] = [
    {
      id: rideIds.stationPickup,
      tripId,
      direction: 'pickup',
      meetDatetime: at(day(0), 14, 45),
      location: copy.places.station,
      coordinates: COORDINATES.station,
      leadTimeMinutes: 45,
      driverId: ids.camille,
      vehicleId: vehicleIds.estate,
      notes: copy.rides.stationPickup,
    },
    {
      id: rideIds.airportPickup,
      tripId,
      direction: 'pickup',
      meetDatetime: at(day(2), 11, 30),
      location: copy.places.airport,
      coordinates: COORDINATES.airport,
      leadTimeMinutes: 60,
      driverId: ids.martins,
      vehicleId: vehicleIds.minivan,
      notes: copy.rides.airportPickup,
    },
    {
      id: rideIds.stationDropoff,
      tripId,
      direction: 'dropoff',
      meetDatetime: at(day(lastDay), 10, 0),
      location: copy.places.station,
      coordinates: COORDINATES.station,
      leadTimeMinutes: 45,
      driverId: ids.camille,
      vehicleId: vehicleIds.estate,
      notes: copy.rides.stationDropoff,
    },
  ];

  // ---- Transports ---------------------------------------------------------
  const transports: Transport[] = [
    {
      id: createTransportId(),
      tripId,
      personId: ids.camille,
      type: 'arrival',
      datetime: at(day(0), 11, 0),
      location: copy.places.house,
      coordinates: COORDINATES.house,
      startLocation: copy.places.paris,
      startCoordinates: COORDINATES.paris,
      transportMode: 'car',
      needsPickup: false,
    },
    {
      id: createTransportId(),
      tripId,
      personId: ids.samAlex,
      type: 'arrival',
      datetime: at(day(0), 14, 30),
      location: copy.places.station,
      coordinates: COORDINATES.station,
      transportMode: 'train',
      transportNumber: 'TGV 6105',
      rideId: rideIds.stationPickup,
      needsPickup: true,
      notes: copy.transports.samAlexArrival,
    },
    {
      id: createTransportId(),
      tripId,
      personId: ids.nora,
      type: 'arrival',
      datetime: at(day(0), 14, 40),
      location: copy.places.station,
      coordinates: COORDINATES.station,
      startLocation: copy.places.paris,
      startCoordinates: COORDINATES.paris,
      transportMode: 'train',
      transportNumber: 'TGV 6111',
      rideId: rideIds.stationPickup,
      needsPickup: true,
    },
    {
      id: createTransportId(),
      tripId,
      personId: ids.martins,
      type: 'arrival',
      datetime: at(day(0), 17, 0),
      location: copy.places.house,
      coordinates: COORDINATES.house,
      startLocation: copy.places.lyon,
      startCoordinates: COORDINATES.lyon,
      transportMode: 'car',
      needsPickup: false,
      notes: copy.transports.martinsArrival,
    },
    {
      id: createTransportId(),
      tripId,
      personId: ids.jules,
      type: 'arrival',
      datetime: at(day(2), 11, 15),
      location: copy.places.airport,
      coordinates: COORDINATES.airport,
      transportMode: 'plane',
      transportNumber: 'AF 7664',
      rideId: rideIds.airportPickup,
      needsPickup: true,
      notes: copy.transports.julesArrival,
    },
    {
      id: createTransportId(),
      tripId,
      personId: ids.martins,
      type: 'departure',
      datetime: at(day(lastDay - 1), 16, 0),
      location: copy.places.lyon,
      coordinates: COORDINATES.lyon,
      startLocation: copy.places.house,
      startCoordinates: COORDINATES.house,
      transportMode: 'car',
      needsPickup: false,
    },
    {
      id: createTransportId(),
      tripId,
      personId: ids.samAlex,
      type: 'departure',
      datetime: at(day(lastDay), 10, 52),
      location: copy.places.station,
      coordinates: COORDINATES.station,
      transportMode: 'train',
      transportNumber: 'TGV 6170',
      rideId: rideIds.stationDropoff,
      needsPickup: true,
    },
    {
      id: createTransportId(),
      tripId,
      personId: ids.nora,
      type: 'departure',
      datetime: at(day(lastDay), 11, 4),
      location: copy.places.station,
      coordinates: COORDINATES.station,
      transportMode: 'train',
      transportNumber: 'TGV 6172',
      rideId: rideIds.stationDropoff,
      needsPickup: true,
    },
    {
      id: createTransportId(),
      tripId,
      personId: ids.jules,
      type: 'departure',
      datetime: at(day(lastDay), 15, 0),
      location: copy.places.gordes,
      coordinates: COORDINATES.gordes,
      transportMode: 'bus',
      transportNumber: '15',
      needsPickup: false,
    },
  ];

  // ---- Activities ---------------------------------------------------------
  const everyone = [ids.camille, ids.samAlex, ids.martins, ids.hugo, ids.nora];
  const activity = (
    fields: Omit<Activity, 'id' | 'tripId' | 'allDay'> & { readonly allDay?: boolean },
  ): Activity => ({ id: createActivityId(), tripId, allDay: false, ...fields });

  const activities: Activity[] = [
    activity({
      title: copy.activities.market.title,
      notes: copy.activities.market.notes,
      category: 'market',
      startDatetime: at(day(1), 9, 0),
      endDatetime: at(day(1), 11, 30),
      location: copy.places.apt,
      coordinates: COORDINATES.apt,
      organizerId: ids.camille,
      participantIds: [ids.camille, ids.nora, ids.samAlex],
    }),
    activity({
      title: copy.activities.lavender.title,
      notes: copy.activities.lavender.notes,
      category: 'horticulture',
      startDatetime: at(day(1), 15, 0),
      endDatetime: at(day(1), 17, 0),
      location: copy.places.gordes,
      coordinates: COORDINATES.gordes,
      organizerId: ids.martins,
      participantIds: [ids.martins, ids.hugo, ids.nora],
      maxParticipants: 6,
    }),
    activity({
      title: copy.activities.lake.title,
      notes: copy.activities.lake.notes,
      category: 'beach',
      allDay: true,
      startDatetime: toAllDayActivityInstant(key(2), 'start') ?? at(day(2), 0),
      endDatetime: toAllDayActivityInstant(key(2), 'end') ?? at(day(2), 23, 59),
      location: copy.places.lake,
      coordinates: COORDINATES.lake,
      participantIds: [ids.martins, ids.hugo, ids.samAlex],
    }),
    activity({
      title: copy.activities.hike.title,
      notes: copy.activities.hike.notes,
      category: 'hike',
      startDatetime: at(day(3), 8, 30),
      endDatetime: at(day(3), 12, 0),
      organizerId: ids.jules,
      participantIds: [ids.jules, ids.samAlex, ids.camille],
    }),
    activity({
      title: copy.activities.village.title,
      notes: copy.activities.village.notes,
      category: 'visit',
      startDatetime: at(day(3), 17, 0),
      location: copy.places.gordes,
      coordinates: COORDINATES.gordes,
      participantIds: [ids.nora, ids.jules],
    }),
    activity({
      title: copy.activities.petanque.title,
      notes: copy.activities.petanque.notes,
      category: 'sport',
      startDatetime: at(day(2), 18, 30),
      endDatetime: at(day(2), 20, 0),
      location: copy.places.house,
      organizerId: ids.samAlex,
      participantIds: [ids.samAlex, ids.jules, ids.martins, ids.camille],
      maxParticipants: 8,
    }),
    activity({
      title: copy.activities.cooking.title,
      notes: copy.activities.cooking.notes,
      category: 'workshop',
      startDatetime: at(day(1), 18, 0),
      endDatetime: at(day(1), 19, 30),
      location: copy.places.house,
      organizerId: ids.nora,
      participantIds: [ids.nora, ids.hugo],
      maxParticipants: 4,
    }),
    activity({
      title: copy.activities.dinner.title,
      notes: copy.activities.dinner.notes,
      category: 'meal',
      startDatetime: at(day(3), 20, 0),
      endDatetime: at(day(3), 22, 30),
      location: copy.places.restaurant,
      coordinates: COORDINATES.restaurant,
      organizerId: ids.camille,
      participantIds: [...everyone, ids.jules],
      maxParticipants: 8,
    }),
    activity({
      title: copy.activities.cinema.title,
      notes: copy.activities.cinema.notes,
      category: 'culture',
      startDatetime: at(day(2), 21, 30),
      location: copy.places.gordes,
      coordinates: COORDINATES.gordes,
      participantIds: [ids.camille, ids.nora],
    }),
    activity({
      title: copy.activities.cleanup.title,
      notes: copy.activities.cleanup.notes,
      category: 'other',
      startDatetime: at(day(lastDay), 9, 0),
      endDatetime: at(day(lastDay), 12, 0),
      location: copy.places.house,
      organizerId: ids.camille,
      participantIds: [ids.camille, ids.samAlex, ids.nora, ids.jules],
    }),
  ];

  // ---- Money --------------------------------------------------------------
  const equally = (personIds: readonly PersonId[]) =>
    personIds.map((personId) => ({ personId, value: 1 }));

  const expenses: Expense[] = [
    {
      id: createExpenseId(),
      tripId,
      kind: 'expense',
      category: 'lodging',
      ...copy.expenses.rent,
      date: key(0),
      amount: 1800,
      payerId: ids.camille,
      splitMode: 'nights',
      splits: equally([...everyone, ids.jules]),
    },
    {
      id: createExpenseId(),
      tripId,
      kind: 'expense',
      category: 'groceries',
      ...copy.expenses.groceries,
      date: key(1),
      amount: 214.6,
      payerId: ids.samAlex,
      splitMode: 'equal',
      splits: equally(everyone),
    },
    {
      id: createExpenseId(),
      tripId,
      kind: 'expense',
      category: 'meal',
      ...copy.expenses.dinner,
      date: key(3),
      amount: 312,
      payerId: ids.nora,
      splitMode: 'amounts',
      splits: [
        { personId: ids.camille, value: 42 },
        { personId: ids.samAlex, value: 96 },
        { personId: ids.martins, value: 88 },
        { personId: ids.hugo, value: 18 },
        { personId: ids.nora, value: 34 },
        { personId: ids.jules, value: 34 },
      ],
    },
    {
      id: createExpenseId(),
      tripId,
      kind: 'expense',
      category: 'transport',
      ...copy.expenses.fuel,
      date: key(lastDay - 1),
      amount: 96.4,
      payerId: ids.martins,
      splitMode: 'equal',
      splits: equally([ids.martins, ids.hugo]),
    },
    {
      id: createExpenseId(),
      tripId,
      kind: 'expense',
      category: 'activity',
      ...copy.expenses.tickets,
      date: key(1),
      amount: 45,
      payerId: ids.martins,
      splitMode: 'shares',
      splits: [
        { personId: ids.martins, value: 4 },
        { personId: ids.hugo, value: 1 },
        { personId: ids.nora, value: 2 },
      ],
    },
    {
      id: createExpenseId(),
      tripId,
      kind: 'expense',
      category: 'supplies',
      ...copy.expenses.firewood,
      date: key(2),
      amount: 28.5,
      payerId: ids.jules,
      splitMode: 'equal',
      splits: equally([...everyone, ids.jules]),
    },
    {
      id: createExpenseId(),
      tripId,
      kind: 'expense',
      category: 'other',
      ...copy.expenses.cleaning,
      date: key(lastDay),
      amount: 17.9,
      payerId: ids.camille,
      splitMode: 'equal',
      splits: equally([ids.camille, ids.samAlex, ids.nora, ids.jules]),
    },
    {
      id: createExpenseId(),
      tripId,
      kind: 'income',
      category: 'lodging',
      ...copy.expenses.deposit,
      date: key(lastDay),
      amount: 300,
      payerId: ids.camille,
      splitMode: 'nights',
      splits: equally([...everyone, ids.jules]),
    },
    {
      id: createExpenseId(),
      tripId,
      kind: 'transfer',
      category: 'other',
      ...copy.expenses.settle,
      date: key(lastDay),
      amount: 250,
      payerId: ids.samAlex,
      splitMode: 'amounts',
      splits: [{ personId: ids.camille, value: 250 }],
    },
  ];

  return {
    trip,
    rooms,
    persons,
    roomAssignments,
    vehicles,
    rides,
    transports,
    activities,
    expenses,
  };
}
