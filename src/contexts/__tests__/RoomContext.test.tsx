/**
 * RoomContext Tests
 *
 * Tests for the RoomContext provider including:
 * - Initial state and loading
 * - CRUD operations (create, update, delete, reorder)
 * - Trip scoping
 * - Error handling
 *
 * @module contexts/__tests__/RoomContext.test
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { TripProvider, useTripContext } from '@/contexts/TripContext';
import { RoomProvider, useRoomContext } from '@/contexts/RoomContext';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { createRoom } from '@/lib/db/repositories/room-repository';
import type { RoomId, TripId, Room } from '@/types';
import { isoDate } from '@/test/utils';

// ============================================================================
// Test Helpers
// ============================================================================

function AllContextsWrapper({ children }: { children: ReactNode }) {
  return (
    <TripProvider>
      <RoomProvider>{children}</RoomProvider>
    </TripProvider>
  );
}

function useCombinedContexts() {
  const trip = useTripContext();
  const room = useRoomContext();
  return { trip, room };
}

async function createTestTripData(name = 'Test Trip'): Promise<TripId> {
  const trip = await createTrip({
    name,
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-30'),
  });
  return trip.id;
}

async function createTestRoom(tripId: TripId, name = 'Test Room'): Promise<Room> {
  return await createRoom(tripId, { name, capacity: 2 });
}

async function waitForLiveQuery(ms = 100): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('RoomContext', () => {
  describe('Initial State', () => {
    it('starts with empty rooms when no trip selected', async () => {
      const { result } = renderHook(() => useRoomContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.rooms).toEqual([]);
    });

    it('starts with error as null', async () => {
      const { result } = renderHook(() => useRoomContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('Loading rooms for a trip', () => {
    it('loads rooms when trip is selected', async () => {
      const tripId = await createTestTripData();
      await createTestRoom(tripId, 'Room A');
      await createTestRoom(tripId, 'Room B');

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.room.rooms).toHaveLength(2);
      });
    });

    it('clears rooms when trip changes', async () => {
      const tripId1 = await createTestTripData('Trip 1');
      const tripId2 = await createTestTripData('Trip 2');
      await createTestRoom(tripId1, 'Room in Trip 1');

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId1);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.room.rooms).toHaveLength(1);
      });

      // Switch to trip 2 (no rooms)
      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId2);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.room.rooms).toHaveLength(0);
      });
    });
  });

  describe('createRoom', () => {
    it('creates room with valid data when trip is selected', async () => {
      const tripId = await createTestTripData();

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId);
      });

      await waitForLiveQuery();

      let createdRoom: Room | undefined;
      await act(async () => {
        createdRoom = await result.current.room.createRoom({
          name: 'New Room',
          capacity: 4,
        });
      });

      expect(createdRoom).toBeDefined();
      expect(createdRoom!.name).toBe('New Room');
      expect(createdRoom!.capacity).toBe(4);
    });

    it('throws error when no trip selected', async () => {
      const { result } = renderHook(() => useRoomContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.createRoom({ name: 'Room', capacity: 2 });
        })
      ).rejects.toThrow('no trip selected');
    });
  });

  describe('updateRoom', () => {
    it('updates room name', async () => {
      const tripId = await createTestTripData();
      const room = await createTestRoom(tripId, 'Original');

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId);
      });

      await waitForLiveQuery();

      await act(async () => {
        await result.current.room.updateRoom(room.id, { name: 'Updated' });
      });

      await waitForLiveQuery();

      await waitFor(() => {
        const updated = result.current.room.rooms.find((r) => r.id === room.id);
        expect(updated?.name).toBe('Updated');
      });
    });

    it('throws error when no trip selected', async () => {
      const { result } = renderHook(() => useRoomContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.updateRoom('room_123' as RoomId, { name: 'x' });
        })
      ).rejects.toThrow('no trip selected');
    });
  });

  describe('deleteRoom', () => {
    it('deletes room', async () => {
      const tripId = await createTestTripData();
      const room = await createTestRoom(tripId, 'To Delete');

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.room.rooms).toHaveLength(1);
      });

      await act(async () => {
        await result.current.room.deleteRoom(room.id);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.room.rooms).toHaveLength(0);
      });
    });

    it('throws error when no trip selected', async () => {
      const { result } = renderHook(() => useRoomContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.deleteRoom('room_123' as RoomId);
        })
      ).rejects.toThrow('no trip selected');
    });
  });

  describe('reorderRooms', () => {
    it('reorders rooms', async () => {
      const tripId = await createTestTripData();
      const roomA = await createTestRoom(tripId, 'Room A');
      const roomB = await createTestRoom(tripId, 'Room B');

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.room.rooms).toHaveLength(2);
      });

      // Reorder: B before A
      await act(async () => {
        await result.current.room.reorderRooms([roomB.id, roomA.id]);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.room.rooms[0]?.id).toBe(roomB.id);
        expect(result.current.room.rooms[1]?.id).toBe(roomA.id);
      });
    });

    it('throws error when no trip selected', async () => {
      const { result } = renderHook(() => useRoomContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.reorderRooms(['r1' as RoomId]);
        })
      ).rejects.toThrow('no trip selected');
    });

    it('throws error for empty array', async () => {
      const tripId = await createTestTripData();

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId);
      });

      await waitForLiveQuery();

      await expect(
        act(async () => {
          await result.current.room.reorderRooms([]);
        })
      ).rejects.toThrow('empty');
    });

    it('throws error for duplicate IDs', async () => {
      const tripId = await createTestTripData();
      const room = await createTestRoom(tripId, 'Room');

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.room.rooms).toHaveLength(1);
      });

      await expect(
        act(async () => {
          await result.current.room.reorderRooms([room.id, room.id]);
        })
      ).rejects.toThrow('Duplicate');
    });

    it('throws error for unknown room IDs', async () => {
      const tripId = await createTestTripData();
      await createTestRoom(tripId, 'Room');

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.room.rooms).toHaveLength(1);
      });

      await expect(
        act(async () => {
          await result.current.room.reorderRooms(['unknown_id' as RoomId]);
        })
      ).rejects.toThrow();
    });
  });

  describe('useRoomContext Hook', () => {
    it('throws error when used outside provider', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useRoomContext());
      }).toThrow('useRoomContext must be used within a RoomProvider');

      consoleSpy.mockRestore();
    });
  });
});
