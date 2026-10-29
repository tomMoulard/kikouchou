/**
 * @fileoverview `EntryRedirect`: `/` goes to the list, the sample's plan, or the
 * first-trip wizard.
 *
 * @module features/trips/components/__tests__/EntryRedirect.test
 */

import { type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';

import {
  EntryRedirect,
  ONBOARDING_PLANNING_VIEW_FLAG,
} from '@/features/trips/components/EntryRedirect';
import { useFeatureFlagVariant } from '@/hooks/useFeatureFlag';
import { useTripContext } from '@/contexts/TripContext';

vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));
vi.mock('@/hooks/useFeatureFlag', () => ({ useFeatureFlagVariant: vi.fn() }));

const mockedUseTripContext = vi.mocked(useTripContext);
const mockedUseFeatureFlagVariant = vi.mocked(useFeatureFlagVariant);

const SAMPLE_ID = 'sample-trip';
const OWN_ID = 'own-trip';

// ============================================================================
// Helpers
// ============================================================================

function Where(): ReactElement {
  const { pathname, state } = useLocation();
  return <p data-testid="where">{`${pathname} ${JSON.stringify(state)}`}</p>;
}

function renderEntry(): void {
  const router = createMemoryRouter(
    [
      { path: '/', element: <EntryRedirect /> },
      { path: '*', element: <Where /> },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
}

function withTrips(ids: string[], sampleTripId: string | undefined, isLoading = false): void {
  mockedUseTripContext.mockReturnValue({
    trips: ids.map((id) => ({ id })),
    sampleTripId,
    isLoading,
  } as never);
}

function where(): string {
  return screen.getByTestId('where').textContent ?? '';
}

// ============================================================================
// Tests
// ============================================================================

describe('EntryRedirect', () => {
  beforeEach(() => {
    mockedUseFeatureFlagVariant.mockReset();
    mockedUseFeatureFlagVariant.mockReturnValue('control');
  });

  it('opens the sample calendar in the test arm, saying the app went there itself', () => {
    withTrips([SAMPLE_ID], SAMPLE_ID);
    mockedUseFeatureFlagVariant.mockReturnValue('test');

    renderEntry();

    expect(where()).toBe(`/trips/${SAMPLE_ID}/calendar {"via":"entry"}`);
    expect(mockedUseFeatureFlagVariant).toHaveBeenCalledWith(ONBOARDING_PLANNING_VIEW_FLAG);
  });

  it('opens the first-trip wizard in the wizard arm', () => {
    withTrips([SAMPLE_ID], SAMPLE_ID);
    mockedUseFeatureFlagVariant.mockReturnValue('wizard');

    renderEntry();

    expect(where()).toBe('/trips/new null');
  });

  it('opens the assistant in the assistant arm, saying the app went there itself', () => {
    withTrips([SAMPLE_ID], SAMPLE_ID);
    mockedUseFeatureFlagVariant.mockReturnValue('assistant');

    renderEntry();

    expect(where()).toBe('/assistant {"via":"entry"}');
  });

  it('keeps the trip list in the control arm', () => {
    withTrips([SAMPLE_ID], SAMPLE_ID);

    renderEntry();

    expect(where()).toBe('/trips null');
  });

  it('keeps the trip list for a person in no arm', () => {
    withTrips([SAMPLE_ID], SAMPLE_ID);
    mockedUseFeatureFlagVariant.mockReturnValue(false);

    renderEntry();

    expect(where()).toBe('/trips null');
  });

  it('waits on the flag rather than flash either arm', () => {
    withTrips([SAMPLE_ID], SAMPLE_ID);
    mockedUseFeatureFlagVariant.mockReturnValue(undefined);

    renderEntry();

    expect(screen.queryByTestId('where')).toBeNull();
  });

  it('waits on the trips before deciding who takes part', () => {
    withTrips([], undefined, true);

    renderEntry();

    expect(screen.queryByTestId('where')).toBeNull();
    expect(mockedUseFeatureFlagVariant).not.toHaveBeenCalled();
  });

  it.each([
    ['has a trip of its own', [SAMPLE_ID, OWN_ID], SAMPLE_ID],
    ['deleted the sample', [OWN_ID], SAMPLE_ID],
    ['deleted the sample and has no trip', [], SAMPLE_ID],
    ['never got the sample', [OWN_ID], undefined],
    ['has no trip and no sample', [], undefined],
  ])('sends a device that %s to the list, without reading the flag', (_, ids, sampleId) => {
    withTrips(ids, sampleId);

    renderEntry();

    expect(where()).toBe('/trips null');
    // Reading the flag is the exposure: nobody outside the experiment is counted.
    expect(mockedUseFeatureFlagVariant).not.toHaveBeenCalled();
  });
});
