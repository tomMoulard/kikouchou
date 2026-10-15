/**
 * @fileoverview Guards the straight-line test that offers a carpool to a guest
 * waiting near its road.
 *
 * @module features/transports/utils/__tests__/carpool-route.test
 */

import { describe, expect, it } from 'vitest';

import {
  CARPOOL_DETOUR_KM,
  distanceToRouteKm,
  isStopAlongRoute,
} from '../carpool-route';

// ============================================================================
// Fixtures
// ============================================================================

const LYON = { lat: 45.7606, lon: 4.8594 },
  VALENCE = { lat: 44.9913, lon: 4.9786 },
  BORDEAUX = { lat: 44.8378, lon: -0.5792 },
  HOUSE = { lat: 43.9116, lon: 5.2003 };

// ============================================================================
// Tests
// ============================================================================

describe('distanceToRouteKm', () => {
  it('measures zero for a point on either end', () => {
    expect(distanceToRouteKm(LYON, LYON, HOUSE)).toBeCloseTo(0, 5);
    expect(distanceToRouteKm(HOUSE, LYON, HOUSE)).toBeCloseTo(0, 5);
  });

  it('measures a town on the way as close to the route', () => {
    expect(distanceToRouteKm(VALENCE, LYON, HOUSE)).toBeLessThan(CARPOOL_DETOUR_KM);
  });

  it('measures a town off the way as far from the route', () => {
    expect(distanceToRouteKm(BORDEAUX, LYON, HOUSE)).toBeGreaterThan(300);
  });

  it('measures to the nearest end beyond the route, not to the infinite line', () => {
    const beyondHouse = { lat: 43.0, lon: 5.4 };

    expect(distanceToRouteKm(beyondHouse, LYON, HOUSE)).toBeGreaterThan(90);
  });

  it('measures to the point when both ends coincide', () => {
    expect(distanceToRouteKm(VALENCE, LYON, LYON)).toBeGreaterThan(80);
  });
});

describe('isStopAlongRoute', () => {
  it('keeps a stop near the route', () => {
    expect(isStopAlongRoute(VALENCE, LYON, HOUSE)).toBe(true);
  });

  it('refuses a stop far from the route', () => {
    expect(isStopAlongRoute(BORDEAUX, LYON, HOUSE)).toBe(false);
  });

  it('keeps the stop when any of the three points is unknown', () => {
    expect(isStopAlongRoute(undefined, LYON, HOUSE)).toBe(true);
    expect(isStopAlongRoute(BORDEAUX, undefined, HOUSE)).toBe(true);
    expect(isStopAlongRoute(BORDEAUX, LYON, undefined)).toBe(true);
  });
});
