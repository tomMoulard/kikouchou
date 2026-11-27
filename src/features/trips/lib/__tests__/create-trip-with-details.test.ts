/**
 * @fileoverview Tests for the writes behind every new trip.
 *
 * These cases used to run through the one-page create form. The form is gone,
 * and the writes are still the wizard's and the template page's, so they are
 * held here, against the helper itself.
 *
 * @module features/trips/lib/__tests__/create-trip-with-details.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TripFormData } from '@/types';

// ============================================================================
// Mocks
// ============================================================================

const mockCreateTrip = vi.fn();
const mockSetCurrentTrip = vi.fn();
const mockCreatePersonWithAutoColor = vi.fn();
const mockCreateRoom = vi.fn();

vi.mock('@/lib/db', () => ({
  createTrip: (...args: unknown[]) => mockCreateTrip(...args),
  setCurrentTrip: (...args: unknown[]) => mockSetCurrentTrip(...args),
  createPersonWithAutoColor: (...args: unknown[]) => mockCreatePersonWithAutoColor(...args),
  createRoom: (...args: unknown[]) => mockCreateRoom(...args),
}));

const mockWriteGuestIdentity = vi.fn<(...args: unknown[]) => boolean>(() => true);

vi.mock('@/lib/sharing/guest-identity', () => ({
  writeGuestIdentity: (...args: unknown[]) => mockWriteGuestIdentity(...args),
}));

vi.mock('@/lib/posthog', () => ({ reportError: vi.fn() }));

import { createTripWithDetails } from '../create-trip-with-details';

// ============================================================================
// Fixtures
// ============================================================================

const FORM = { name: 'New Trip' } as TripFormData;

// ============================================================================
// Tests
// ============================================================================

describe('createTripWithDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateTrip.mockResolvedValue({ id: 'new-trip-1', shareId: 'share-1' });
    mockSetCurrentTrip.mockResolvedValue(undefined);
    mockCreatePersonWithAutoColor.mockResolvedValue(undefined);
    mockCreateRoom.mockResolvedValue({ id: 'room-1' });
    mockWriteGuestIdentity.mockReturnValue(true);
  });

  it('creates the trip and selects it', async () => {
    const outcome = await createTripWithDetails({ form: FORM, guests: [], rooms: [] });

    expect(mockCreateTrip).toHaveBeenCalledWith(FORM);
    expect(mockSetCurrentTrip).toHaveBeenCalledWith('new-trip-1');
    expect(outcome.counts).toEqual({ guests: 0, rooms: 0 });
    expect(outcome.warnings).toEqual([]);
  });

  it('leaves the selection to the caller when asked to', async () => {
    await createTripWithDetails({ form: FORM, guests: [], rooms: [], selectAsCurrent: false });

    expect(mockSetCurrentTrip).not.toHaveBeenCalled();
  });

  it('throws when the trip comes back without an id', async () => {
    mockCreateTrip.mockResolvedValue({ id: undefined });

    await expect(createTripWithDetails({ form: FORM, guests: [], rooms: [] })).rejects.toThrow(
      'Trip creation failed: missing trip ID',
    );
    expect(mockSetCurrentTrip).not.toHaveBeenCalled();
  });

  it('adds the guests in list order', async () => {
    const outcome = await createTripWithDetails({
      form: FORM,
      guests: [{ name: 'Tom' }, { name: 'Marie' }],
      rooms: [],
    });

    expect(mockCreatePersonWithAutoColor.mock.calls).toEqual([
      ['new-trip-1', 'Tom'],
      ['new-trip-1', 'Marie'],
    ]);
    expect(outcome.counts.guests).toBe(2);
  });

  it('becomes the person created from the creator row', async () => {
    mockCreatePersonWithAutoColor
      .mockResolvedValueOnce({ id: 'person-tom', name: 'Tom' })
      .mockResolvedValueOnce({ id: 'person-marie', name: 'Marie' });

    const outcome = await createTripWithDetails({
      form: FORM,
      guests: [{ name: 'Tom', isSelf: true }, { name: 'Marie' }],
      rooms: [],
    });

    expect(mockWriteGuestIdentity).toHaveBeenCalledWith('share-1', {
      personId: 'person-tom',
      tripId: 'new-trip-1',
    });
    expect(outcome.selfPersonId).toBe('person-tom');
  });

  it('stays nobody in particular when no guest is the creator', async () => {
    mockCreatePersonWithAutoColor.mockResolvedValue({ id: 'person-marie', name: 'Marie' });

    await createTripWithDetails({ form: FORM, guests: [{ name: 'Marie' }], rooms: [] });

    expect(mockWriteGuestIdentity).not.toHaveBeenCalled();
  });

  it('keeps the trip and warns when the identity cannot be stored', async () => {
    mockWriteGuestIdentity.mockReturnValue(false);
    mockCreatePersonWithAutoColor.mockResolvedValue({ id: 'person-tom', name: 'Tom' });

    const outcome = await createTripWithDetails({
      form: FORM,
      guests: [{ name: 'Tom', isSelf: true }],
      rooms: [],
    });

    expect(outcome.warnings).toEqual(['identity']);
    expect(mockSetCurrentTrip).toHaveBeenCalledWith('new-trip-1');
  });

  it('keeps the trip and warns when a guest cannot be added', async () => {
    mockCreatePersonWithAutoColor
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Guest failed'));

    const outcome = await createTripWithDetails({
      form: FORM,
      guests: [{ name: 'Tom' }, { name: 'Marie' }],
      rooms: [],
    });

    expect(outcome.counts.guests).toBe(1);
    expect(outcome.warnings).toEqual(['guests']);
    expect(mockSetCurrentTrip).toHaveBeenCalledWith('new-trip-1');
  });

  it('adds the rooms in list order, with their icons', async () => {
    const outcome = await createTripWithDetails({
      form: FORM,
      guests: [],
      rooms: [
        { name: 'Double bed', capacity: 2, icon: 'bed-double' },
        { name: 'Attic', capacity: 1, icon: 'tent' },
      ],
    });

    expect(mockCreateRoom.mock.calls).toEqual([
      ['new-trip-1', { name: 'Double bed', capacity: 2, icon: 'bed-double' }],
      ['new-trip-1', { name: 'Attic', capacity: 1, icon: 'tent' }],
    ]);
    expect(outcome.counts.rooms).toBe(2);
  });

  it('keeps the trip and warns when a room cannot be added', async () => {
    mockCreateRoom
      .mockResolvedValueOnce({ id: 'room-1' })
      .mockRejectedValueOnce(new Error('Room failed'));

    const outcome = await createTripWithDetails({
      form: FORM,
      guests: [],
      rooms: [
        { name: 'Double bed', capacity: 2, icon: 'bed-double' },
        { name: 'Attic', capacity: 1, icon: 'tent' },
      ],
    });

    expect(outcome.counts.rooms).toBe(1);
    expect(outcome.warnings).toEqual(['rooms']);
  });
});
