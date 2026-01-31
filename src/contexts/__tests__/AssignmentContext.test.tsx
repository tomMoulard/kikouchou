/**
 * AssignmentContext Tests
 *
 * Tests for the AssignmentContext provider including:
 * - CRUD operations
 * - Filter functions (by room, by person)
 * - Conflict checking
 * - Trip scoping
 *
 * @module contexts/__tests__/AssignmentContext.test
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { TripProvider, useTripContext } from '@/contexts/TripContext';
import { AssignmentProvider, useAssignmentContext } from '@/contexts/AssignmentContext';
import { RoomProvider } from '@/contexts/RoomContext';
import { PersonProvider } from '@/contexts/PersonContext';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { createRoom } from '@/lib/db/repositories/room-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import type { PersonId, RoomId, TripId, ISODateString, RoomAssignment } from '@/types';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Wrapper component that provides all required contexts.
 */
function AllContextsWrapper({ children }: { children: ReactNode }) {
  return (
    <TripProvider>
      <RoomProvider>
        <PersonProvider>
          <AssignmentProvider>{children}</AssignmentProvider>
        </PersonProvider>
      </RoomProvider>
    </TripProvider>
  );
}

/**
 * Combined hook to access both Trip and Assignment contexts.
 */
function useCombinedContexts() {
  const trip = useTripContext();
  const assignment = useAssignmentContext();
  return { trip, assignment };
}

/**
 * Helper to create a test trip.
 */
async function createTestTripData(name = 'Test Trip'): Promise<TripId> {
  const trip = await createTrip({
    name,
    startDate: '2024-07-15',
    endDate: '2024-07-30',
  });
  return trip.id;
}

/**
 * Helper to create a test room.
 */
async function createTestRoom(tripId: TripId, name = 'Test Room'): Promise<RoomId> {
  const room = await createRoom(tripId, { name, capacity: 2 });
  return room.id;
}

/**
 * Helper to create a test person.
 */
async function createTestPerson(tripId: TripId, name = 'Test Person'): Promise<PersonId> {
  const person = await createPerson(tripId, { name, color: '#ef4444' });
  return person.id;
}

/**
 * Small delay to allow live queries to update.
 */
async function waitForLiveQuery(ms = 100): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Initial State Tests
// ============================================================================

describe('AssignmentContext', () => {
  describe('Initial State', () => {
    it('starts with empty assignments when no trip selected', async () => {
      const { result } = renderHook(() => useAssignmentContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.assignments).toEqual([]);
    });

    it('starts with error as null', async () => {
      const { result } = renderHook(() => useAssignmentContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeNull();
    });
  });

  // ============================================================================
  // CRUD Operations Tests
  // ============================================================================

  describe('createAssignment', () => {
    it('creates assignment with valid data when trip is selected', async () => {
      const tripId = await createTestTripData();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      // Wait for loading and select trip
      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId);
      });

      await waitForLiveQuery();

      // Now create assignment
      let createdAssignment: RoomAssignment | undefined;
      await act(async () => {
        createdAssignment = await result.current.assignment.createAssignment({
          roomId,
          personId,
          startDate: '2024-07-15' as ISODateString,
          endDate: '2024-07-20' as ISODateString,
        });
      });

      expect(createdAssignment).toBeDefined();
      expect(createdAssignment!.roomId).toBe(roomId);
      expect(createdAssignment!.personId).toBe(personId);
    });

    it('throws error when no trip selected', async () => {
      const { result } = renderHook(() => useAssignmentContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.createAssignment({
            roomId: 'room_123' as RoomId,
            personId: 'person_123' as PersonId,
            startDate: '2024-07-15' as ISODateString,
            endDate: '2024-07-20' as ISODateString,
          });
        })
      ).rejects.toThrow('no trip selected');
    });
  });

  describe('updateAssignment', () => {
    it('updates assignment dates', async () => {
      const tripId = await createTestTripData();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

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

      let assignment: RoomAssignment | undefined;
      await act(async () => {
        assignment = await result.current.assignment.createAssignment({
          roomId,
          personId,
          startDate: '2024-07-15' as ISODateString,
          endDate: '2024-07-20' as ISODateString,
        });
      });

      await act(async () => {
        await result.current.assignment.updateAssignment(assignment!.id, {
          endDate: '2024-07-25' as ISODateString,
        });
      });

      await waitForLiveQuery();

      await waitFor(() => {
        const updated = result.current.assignment.assignments.find(
          (a) => a.id === assignment!.id
        );
        expect(updated?.endDate).toBe('2024-07-25');
      });
    });

    it('throws error when no trip selected', async () => {
      const { result } = renderHook(() => useAssignmentContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.updateAssignment('assignment_123' as any, {
            endDate: '2024-07-25' as ISODateString,
          });
        })
      ).rejects.toThrow('no trip selected');
    });
  });

  describe('deleteAssignment', () => {
    it('deletes assignment', async () => {
      const tripId = await createTestTripData();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

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

      let assignment: RoomAssignment | undefined;
      await act(async () => {
        assignment = await result.current.assignment.createAssignment({
          roomId,
          personId,
          startDate: '2024-07-15' as ISODateString,
          endDate: '2024-07-20' as ISODateString,
        });
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.assignment.assignments).toHaveLength(1);
      });

      await act(async () => {
        await result.current.assignment.deleteAssignment(assignment!.id);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.assignment.assignments).toHaveLength(0);
      });
    });

    it('throws error when no trip selected', async () => {
      const { result } = renderHook(() => useAssignmentContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.deleteAssignment('assignment_123' as any);
        })
      ).rejects.toThrow('no trip selected');
    });
  });

  // ============================================================================
  // Filter Functions Tests
  // ============================================================================

  describe('getAssignmentsByRoom', () => {
    it('returns assignments for specific room', async () => {
      const tripId = await createTestTripData();
      const room1 = await createTestRoom(tripId, 'Room 1');
      const room2 = await createTestRoom(tripId, 'Room 2');
      const person1 = await createTestPerson(tripId, 'Person 1');
      const person2 = await createTestPerson(tripId, 'Person 2');

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

      // Create assignments for different rooms
      await act(async () => {
        await result.current.assignment.createAssignment({
          roomId: room1,
          personId: person1,
          startDate: '2024-07-15' as ISODateString,
          endDate: '2024-07-20' as ISODateString,
        });
        await result.current.assignment.createAssignment({
          roomId: room2,
          personId: person2,
          startDate: '2024-07-15' as ISODateString,
          endDate: '2024-07-20' as ISODateString,
        });
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.assignment.assignments).toHaveLength(2);
      });

      const room1Assignments = result.current.assignment.getAssignmentsByRoom(room1);
      expect(room1Assignments).toHaveLength(1);
      expect(room1Assignments[0]?.roomId).toBe(room1);
    });

    it('returns empty array for room with no assignments', async () => {
      const tripId = await createTestTripData();
      const roomId = await createTestRoom(tripId);

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

      const assignments = result.current.assignment.getAssignmentsByRoom(roomId);
      expect(assignments).toEqual([]);
    });
  });

  describe('getAssignmentsByPerson', () => {
    it('returns assignments for specific person', async () => {
      const tripId = await createTestTripData();
      const room1 = await createTestRoom(tripId, 'Room 1');
      const room2 = await createTestRoom(tripId, 'Room 2');
      const personId = await createTestPerson(tripId);

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

      // Create multiple assignments for same person (different date ranges)
      await act(async () => {
        await result.current.assignment.createAssignment({
          roomId: room1,
          personId,
          startDate: '2024-07-15' as ISODateString,
          endDate: '2024-07-17' as ISODateString,
        });
        await result.current.assignment.createAssignment({
          roomId: room2,
          personId,
          startDate: '2024-07-20' as ISODateString,
          endDate: '2024-07-25' as ISODateString,
        });
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.assignment.assignments).toHaveLength(2);
      });

      const personAssignments = result.current.assignment.getAssignmentsByPerson(personId);
      expect(personAssignments).toHaveLength(2);
      personAssignments.forEach((a) => {
        expect(a.personId).toBe(personId);
      });
    });

    it('returns empty array for person with no assignments', async () => {
      const tripId = await createTestTripData();
      const personId = await createTestPerson(tripId);

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

      const assignments = result.current.assignment.getAssignmentsByPerson(personId);
      expect(assignments).toEqual([]);
    });
  });

  // ============================================================================
  // Conflict Checking Tests
  // ============================================================================

  describe('checkConflict', () => {
    it('returns false when no conflict exists', async () => {
      const tripId = await createTestTripData();
      const personId = await createTestPerson(tripId);

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

      let hasConflict: boolean | undefined;
      await act(async () => {
        hasConflict = await result.current.assignment.checkConflict(
          personId,
          '2024-07-15' as ISODateString,
          '2024-07-20' as ISODateString
        );
      });

      expect(hasConflict).toBe(false);
    });

    it('returns true when dates overlap with existing assignment', async () => {
      const tripId = await createTestTripData();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

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

      // Create existing assignment
      await act(async () => {
        await result.current.assignment.createAssignment({
          roomId,
          personId,
          startDate: '2024-07-15' as ISODateString,
          endDate: '2024-07-20' as ISODateString,
        });
      });

      await waitForLiveQuery();

      // Check for overlapping dates
      let hasConflict: boolean | undefined;
      await act(async () => {
        hasConflict = await result.current.assignment.checkConflict(
          personId,
          '2024-07-18' as ISODateString, // Overlaps with existing
          '2024-07-25' as ISODateString
        );
      });

      expect(hasConflict).toBe(true);
    });

    it('throws error when no trip selected', async () => {
      const { result } = renderHook(() => useAssignmentContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.checkConflict(
            'person_123' as PersonId,
            '2024-07-15' as ISODateString,
            '2024-07-20' as ISODateString
          );
        })
      ).rejects.toThrow('no trip selected');
    });
  });

  // ============================================================================
  // Hook Error Tests
  // ============================================================================

  describe('useAssignmentContext Hook', () => {
    it('throws error when used outside provider', () => {
      // Only wrap with TripProvider (missing AssignmentProvider)
      const TripOnlyWrapper = ({ children }: { children: ReactNode }) => (
        <TripProvider>{children}</TripProvider>
      );

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useAssignmentContext(), { wrapper: TripOnlyWrapper });
      }).toThrow('useAssignmentContext must be used within an AssignmentProvider');

      consoleSpy.mockRestore();
    });
  });
});
