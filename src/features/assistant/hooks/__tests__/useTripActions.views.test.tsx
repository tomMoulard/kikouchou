/**
 * useTripActions — the `showView` block.
 *
 * A view writes nothing. The executor must leave it out of what it runs and
 * counts, including on a read-only trip, and `listViewRequests` must read it
 * back out of an answer for the bubble to draw.
 *
 * @module features/assistant/hooks/__tests__/useTripActions.views.test
 */

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { AppProviders } from '@/contexts/AppProviders';
import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { notify } from '@/lib/notifications';
import { hexColor, isoDate } from '@/test/utils';
import type { TripId } from '@/types';

import { buildShowViewBlock } from '../../views';
import {
  listViewRequests,
  useTripActions,
  type ActionExecutionResult,
} from '../useTripActions';

// ============================================================================
// Test Helpers
// ============================================================================

function Wrapper({ children }: { children: ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}

function useCombined() {
  return { trip: useTripContext(), actions: useTripActions() };
}

/** Wraps an action payload in the fenced block the LLM is asked to emit. */
function actionBlock(payload: unknown): string {
  return `\`\`\`action\n${JSON.stringify(payload)}\n\`\`\``;
}

async function seedTrip(): Promise<TripId> {
  const trip = await createTrip({
    name: 'Test Trip',
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-30'),
  });
  await createPerson(trip.id, { name: 'Alice', color: hexColor('#ef4444') });
  return trip.id;
}

async function renderWithTrip(tripId: TripId) {
  const { result } = renderHook(() => useCombined(), { wrapper: Wrapper });
  await waitFor(() => {
    expect(result.current.trip.isLoading).toBe(false);
  });
  await act(async () => {
    await result.current.trip.setCurrentTrip(tripId);
  });
  await waitFor(() => {
    expect(result.current.trip.currentTrip?.id).toBe(tripId);
  });
  return result;
}

async function run(
  executeActions: (response: string) => Promise<ActionExecutionResult>,
  response: string,
): Promise<ActionExecutionResult> {
  let outcome: ActionExecutionResult = { count: 0, summaries: [] };
  await act(async () => {
    outcome = await executeActions(response);
  });
  return outcome;
}

// ============================================================================
// Tests
// ============================================================================

describe('listViewRequests', () => {
  it('reads the views an answer asks for, in order', () => {
    const answer = [
      'Here is the week.',
      buildShowViewBlock('planning'),
      buildShowViewBlock('money'),
    ].join('\n\n');

    expect(listViewRequests(answer)).toEqual(['planning', 'money']);
  });

  it('draws a view once, however often the answer repeats it', () => {
    const answer = [
      buildShowViewBlock('rooms'),
      actionBlock({ action: 'showView', data: { view: 'rooms' } }),
    ].join('\n');

    expect(listViewRequests(answer)).toEqual(['rooms']);
  });

  it('ignores a view it cannot draw and every action that is not a view', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const answer = [
      actionBlock({ action: 'showView', data: { view: 'weather' } }),
      actionBlock({ action: 'addRoom', data: { name: 'Attic', capacity: 2 } }),
    ].join('\n');

    expect(listViewRequests(answer)).toEqual([]);
    warn.mockRestore();
  });

  it('finds nothing in plain words', () => {
    expect(listViewRequests('Alice arrives on Friday.')).toEqual([]);
  });
});

describe('useTripActions — showView', () => {
  let notifyError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    notifyError = vi.spyOn(notify, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    notifyError.mockRestore();
  });

  it('runs nothing and counts nothing for a view', async () => {
    const tripId = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      buildShowViewBlock('planning'),
    );

    expect(outcome).toEqual({ count: 0, summaries: [] });
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('still runs the change an answer makes beside a view', async () => {
    const tripId = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      [
        actionBlock({ action: 'addRoom', data: { name: 'Attic', capacity: 2 } }),
        buildShowViewBlock('rooms'),
      ].join('\n'),
    );

    expect(outcome.count).toBe(1);
    await expect(db.rooms.where('tripId').equals(tripId).count()).resolves.toBe(1);
  });

  it('shows a read-only trip without calling it a refused write', async () => {
    const tripId = await seedTrip();
    // A viewer copy refuses every write, but looking at it is the point.
    await db.trips.update(tripId, { viewerToken: 'viewer-token' });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      buildShowViewBlock('planning'),
    );

    expect(outcome).toEqual({ count: 0, summaries: [] });
    expect(notifyError).not.toHaveBeenCalled();
  });
});
