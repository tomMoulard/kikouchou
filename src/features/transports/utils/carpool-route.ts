/**
 * @fileoverview Whether a guest waits close enough to a carpool's road to be
 * collected on the way.
 *
 * A carpool runs from the driver's home to the house, or back. The app has no
 * routing service, and it must answer while offline, so the road is
 * approximated by the straight line between its two ends. That is crude for
 * the shape of a motorway, but it answers the question a guest actually asks,
 * "is Lyon roughly on the way from Paris to Marseille", and it never proposes a
 * driver who would have to turn round.
 *
 * Nothing here refuses a carpool for lack of data. With a coordinate missing,
 * nobody can prove the stop is off the route, so the caller keeps the offer.
 *
 * @module features/transports/utils/carpool-route
 */

// ============================================================================
// Type Definitions
// ============================================================================

/** A point on the globe, in degrees. */
export interface RoutePoint {
  readonly lat: number;
  readonly lon: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * How far from the straight route a stop may be and still be offered.
 *
 * Wide enough for the gap between a motorway and the straight line on a
 * typical 300 to 800 km drive, and narrow enough that a guest in Bordeaux is
 * not offered the Paris to Lyon car.
 */
export const CARPOOL_DETOUR_KM = 30;

/** Mean Earth radius, in kilometres. */
const EARTH_RADIUS_KM = 6371;

// ============================================================================
// Geometry
// ============================================================================

/**
 * Distance from a point to the segment between two others, in kilometres.
 *
 * Uses an equirectangular projection centred on the segment. The error stays
 * under one percent at the distances a car covers in a day, far below
 * {@link CARPOOL_DETOUR_KM}.
 *
 * @param point - The stop
 * @param start - One end of the route
 * @param end - The other end of the route
 * @returns The shortest distance from the stop to the route, in km
 */
export function distanceToRouteKm(
  point: RoutePoint,
  start: RoutePoint,
  end: RoutePoint,
): number {
  const referenceLat = (((start.lat + end.lat) / 2) * Math.PI) / 180,
    project = (p: RoutePoint): { x: number; y: number } => ({
      x: ((p.lon * Math.PI) / 180) * Math.cos(referenceLat) * EARTH_RADIUS_KM,
      y: ((p.lat * Math.PI) / 180) * EARTH_RADIUS_KM,
    }),
    a = project(start),
    b = project(end),
    p = project(point),
    dx = b.x - a.x,
    dy = b.y - a.y,
    lengthSquared = dx * dx + dy * dy,
    // A route whose two ends coincide is a point; the stop is measured to it.
    ratio =
      lengthSquared === 0
        ? 0
        : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));

  return Math.hypot(p.x - (a.x + ratio * dx), p.y - (a.y + ratio * dy));
}

/**
 * Whether a stop lies along a carpool's route.
 *
 * @param stop - Where the guest waits, when known
 * @param farEnd - The ride's own coordinates: the driver's start or end
 * @param house - The trip's coordinates
 * @returns False only when all three are known and the stop is too far off
 */
export function isStopAlongRoute(
  stop: RoutePoint | undefined,
  farEnd: RoutePoint | undefined,
  house: RoutePoint | undefined,
): boolean {
  if (stop === undefined || farEnd === undefined || house === undefined) {
    return true;
  }
  return distanceToRouteKm(stop, farEnd, house) <= CARPOOL_DETOUR_KM;
}
