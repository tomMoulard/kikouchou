/**
 * @fileoverview Which nights a guest still needs a bed for.
 *
 * @module features/rooms/utils/unassigned-guests
 */

import { eachDayOfInterval, format, parseISO } from 'date-fns';

import { deriveGuestStayDateBounds } from '@/features/persons/utils/guest-presence';
import type { Person, RoomAssignment, Transport } from '@/types';

// ============================================================================
// Public API
// ============================================================================

/**
 * Calculates unassigned dates for a person based on their transports and room assignments.
 * 
 * @param personId - The person's ID
 * @param arrivals - All arrival transports in the trip
 * @param departures - All departure transports in the trip
 * @param assignments - All room assignments in the trip
 * @returns Array of ISO date strings where the person needs a room but has no assignment
 */
export function calculateUnassignedDates(
  person: Person,
  arrivals: readonly Transport[],
  departures: readonly Transport[],
  assignments: readonly RoomAssignment[],
): { startDate: string; endDate: string; unassignedDates: string[] } | null {
  // Explicit stay dates first, transports as the fallback — the app's one
  // derivation of a guest's stay window, shared with the calendar and sidebar.
  const { arrival: arrivalDate, departure: departureDate } = deriveGuestStayDateBounds(
    person,
    arrivals,
    departures,
  );

  // Still no range => we don't know when they need a room
  if (!arrivalDate || !departureDate) {
    return null;
  }

  // Generate all dates person needs a room (arrival night to day before departure)
  // Person arrives on arrivalDate, sleeps that night
  // Person departs on departureDate morning, so last night is (departureDate - 1)
  const start = parseISO(arrivalDate);
  const end = parseISO(departureDate);
  
  // If departure is same day as arrival, no nights stayed
  if (arrivalDate >= departureDate) {
    return null;
  }

  // Get all nights the person needs a room (arrival date to day before departure)
  // Using check-in/check-out model: they sleep from arrivalDate to departureDate-1
  const lastNight = new Date(end);
  lastNight.setDate(lastNight.getDate() - 1);
  
  const datesNeeded = eachDayOfInterval({ start, end: lastNight }).map(
    (d) => format(d, 'yyyy-MM-dd'),
  );

  // Get person's room assignments
  const personAssignments = assignments.filter((a) => a.personId === person.id);

  // Build set of dates covered by assignments
  const coveredDates = new Set<string>();
  for (const assignment of personAssignments) {
    const assignmentStart = parseISO(assignment.startDate);
    const assignmentEnd = parseISO(assignment.endDate);
    
    // Assignment covers nights from startDate to endDate-1 (check-out model)
    const lastCoveredNight = new Date(assignmentEnd);
    lastCoveredNight.setDate(lastCoveredNight.getDate() - 1);
    
    if (assignmentStart <= lastCoveredNight) {
      const coveredNights = eachDayOfInterval({ start: assignmentStart, end: lastCoveredNight });
      for (const night of coveredNights) {
        coveredDates.add(format(night, 'yyyy-MM-dd'));
      }
    }
  }

  // Find unassigned dates
  const unassignedDates = datesNeeded.filter((date) => !coveredDates.has(date));

  if (unassignedDates.length === 0) {
    return null;
  }

  return {
    startDate: arrivalDate,
    endDate: departureDate,
    unassignedDates,
  };
}
