/**
 * @fileoverview Tests for pickup grouping utility functions.
 *
 * Tests the groupPickupsByProximity function which groups unassigned pickups
 * at the same station within a configurable time window.
 *
 * @module features/transports/utils/__tests__/pickup-utils.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { groupPickupsByProximity } from '../pickup-utils';
import type { Transport } from '@/types';
import type { PersonId, TransportId, TripId } from '@/types';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a mock transport with sensible defaults for testing.
 */
function makeTransport(overrides: Partial<Transport> = {}): Transport {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}` as TransportId,
    tripId: 'trip-1' as TripId,
    personId: 'person-1' as PersonId,
    type: 'arrival',
    datetime: new Date(Date.now() + 3600_000).toISOString(), // 1 hour from now
    location: 'Gare de Vannes',
    needsPickup: true,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('groupPickupsByProximity', () => {
  beforeEach(() => {
    // Fix "now" to a known time for predictable tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Empty / No-match cases
  // --------------------------------------------------------------------------

  it('returns empty array when no pickups provided', () => {
    expect(groupPickupsByProximity([])).toEqual([]);
  });

  it('returns empty array when no pickups need a ride', () => {
    const pickups = [
      makeTransport({ needsPickup: false }),
      makeTransport({ needsPickup: true, driverId: 'driver-1' as PersonId }),
    ];
    expect(groupPickupsByProximity(pickups)).toEqual([]);
  });

  it('excludes past pickups', () => {
    const pickups = [
      makeTransport({
        datetime: '2026-07-15T09:00:00.000Z', // 1 hour in the past
        needsPickup: true,
      }),
    ];
    expect(groupPickupsByProximity(pickups)).toEqual([]);
  });

  it('excludes pickups with invalid datetime', () => {
    const pickups = [
      makeTransport({
        datetime: 'not-a-date',
        needsPickup: true,
      }),
    ];
    expect(groupPickupsByProximity(pickups)).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // Single pickup (standalone)
  // --------------------------------------------------------------------------

  it('returns a single group for one unassigned pickup', () => {
    const transport = makeTransport({
      datetime: '2026-07-15T14:00:00.000Z',
      location: 'Gare de Vannes',
      needsPickup: true,
    });
    const result = groupPickupsByProximity([transport]);

    expect(result).toHaveLength(1);
    expect(result[0]!.pickups).toHaveLength(1);
    expect(result[0]!.displayStation).toBe('Gare de Vannes');
    expect(result[0]!.station).toBe('gare de vannes');
  });

  // --------------------------------------------------------------------------
  // Grouping logic
  // --------------------------------------------------------------------------

  it('groups pickups at the same station within time window', () => {
    const pickups = [
      makeTransport({
        id: 't-1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
        personId: 'p-1' as PersonId,
      }),
      makeTransport({
        id: 't-2' as TransportId,
        datetime: '2026-07-15T14:30:00.000Z',
        location: 'Gare de Vannes',
        personId: 'p-2' as PersonId,
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(1);
    expect(result[0]!.pickups).toHaveLength(2);
  });

  it('does NOT group pickups at different stations', () => {
    const pickups = [
      makeTransport({
        id: 't-1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
      makeTransport({
        id: 't-2' as TransportId,
        datetime: '2026-07-15T14:10:00.000Z',
        location: 'Aeroport de Nantes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(2);
    expect(result[0]!.pickups).toHaveLength(1);
    expect(result[1]!.pickups).toHaveLength(1);
  });

  it('does NOT group pickups outside time window', () => {
    const pickups = [
      makeTransport({
        id: 't-1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
      makeTransport({
        id: 't-2' as TransportId,
        datetime: '2026-07-15T16:00:00.000Z', // 2 hours later
        location: 'Gare de Vannes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(2);
  });

  it('uses case-insensitive station matching', () => {
    const pickups = [
      makeTransport({
        id: 't-1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
      makeTransport({
        id: 't-2' as TransportId,
        datetime: '2026-07-15T14:20:00.000Z',
        location: 'gare de vannes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(1);
    expect(result[0]!.pickups).toHaveLength(2);
  });

  it('trims whitespace for station matching', () => {
    const pickups = [
      makeTransport({
        id: 't-1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: ' Gare de Vannes ',
      }),
      makeTransport({
        id: 't-2' as TransportId,
        datetime: '2026-07-15T14:20:00.000Z',
        location: 'Gare de Vannes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(1);
    expect(result[0]!.pickups).toHaveLength(2);
  });

  // --------------------------------------------------------------------------
  // Sorting
  // --------------------------------------------------------------------------

  it('sorts groups by earliest pickup datetime', () => {
    const pickups = [
      makeTransport({
        id: 't-late' as TransportId,
        datetime: '2026-07-15T18:00:00.000Z',
        location: 'Aeroport de Nantes',
      }),
      makeTransport({
        id: 't-early' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(2);
    expect(result[0]!.displayStation).toBe('Gare de Vannes');
    expect(result[1]!.displayStation).toBe('Aeroport de Nantes');
  });

  it('sorts pickups within a group by datetime', () => {
    const pickups = [
      makeTransport({
        id: 't-2' as TransportId,
        datetime: '2026-07-15T14:30:00.000Z',
        location: 'Gare de Vannes',
      }),
      makeTransport({
        id: 't-1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(1);
    expect(result[0]!.pickups[0]!.id).toBe('t-1');
    expect(result[0]!.pickups[1]!.id).toBe('t-2');
  });

  // --------------------------------------------------------------------------
  // Time window metadata
  // --------------------------------------------------------------------------

  it('sets correct startTime and endTime for groups', () => {
    const pickups = [
      makeTransport({
        id: 't-1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
      makeTransport({
        id: 't-2' as TransportId,
        datetime: '2026-07-15T14:45:00.000Z',
        location: 'Gare de Vannes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(1);
    expect(result[0]!.startTime).toBe('2026-07-15T14:00:00.000Z');
    expect(result[0]!.endTime).toBe('2026-07-15T14:45:00.000Z');
  });

  it('startTime equals endTime for single-pickup groups', () => {
    const pickups = [
      makeTransport({
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result[0]!.startTime).toBe(result[0]!.endTime);
  });

  // --------------------------------------------------------------------------
  // Configurable time window
  // --------------------------------------------------------------------------

  it('respects custom time window', () => {
    const pickups = [
      makeTransport({
        id: 't-1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
      makeTransport({
        id: 't-2' as TransportId,
        datetime: '2026-07-15T14:20:00.000Z',
        location: 'Gare de Vannes',
      }),
    ];

    // 30 minute window - should group
    expect(groupPickupsByProximity(pickups, 30)).toHaveLength(1);

    // 10 minute window - should NOT group
    expect(groupPickupsByProximity(pickups, 10)).toHaveLength(2);
  });

  // --------------------------------------------------------------------------
  // Filtering behavior
  // --------------------------------------------------------------------------

  it('excludes assigned pickups (with driverId)', () => {
    const pickups = [
      makeTransport({
        id: 't-unassigned' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
        needsPickup: true,
        driverId: undefined,
      }),
      makeTransport({
        id: 't-assigned' as TransportId,
        datetime: '2026-07-15T14:10:00.000Z',
        location: 'Gare de Vannes',
        needsPickup: true,
        driverId: 'driver-1' as PersonId,
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(1);
    expect(result[0]!.pickups).toHaveLength(1);
    expect(result[0]!.pickups[0]!.id).toBe('t-unassigned');
  });

  it('excludes non-pickup transports', () => {
    const pickups = [
      makeTransport({
        datetime: '2026-07-15T14:00:00.000Z',
        needsPickup: true,
      }),
      makeTransport({
        datetime: '2026-07-15T14:10:00.000Z',
        needsPickup: false,
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(1);
    expect(result[0]!.pickups).toHaveLength(1);
  });

  // --------------------------------------------------------------------------
  // Complex scenarios
  // --------------------------------------------------------------------------

  it('handles multiple groups at different stations with overlapping times', () => {
    const pickups = [
      makeTransport({
        id: 't-v1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
      makeTransport({
        id: 't-n1' as TransportId,
        datetime: '2026-07-15T14:10:00.000Z',
        location: 'Aeroport de Nantes',
      }),
      makeTransport({
        id: 't-v2' as TransportId,
        datetime: '2026-07-15T14:30:00.000Z',
        location: 'Gare de Vannes',
      }),
      makeTransport({
        id: 't-n2' as TransportId,
        datetime: '2026-07-15T14:40:00.000Z',
        location: 'Aeroport de Nantes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(2);
    // First group: Vannes (earliest at 14:00)
    expect(result[0]!.displayStation).toBe('Gare de Vannes');
    expect(result[0]!.pickups).toHaveLength(2);
    // Second group: Nantes (earliest at 14:10)
    expect(result[1]!.displayStation).toBe('Aeroport de Nantes');
    expect(result[1]!.pickups).toHaveLength(2);
  });
});
