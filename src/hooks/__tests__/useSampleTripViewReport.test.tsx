/**
 * @fileoverview `useSampleTripViewReport`: one event per page of the sample.
 *
 * @module hooks/__tests__/useSampleTripViewReport.test
 */

import { type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';

import {
  OPENED_FROM_LIST,
  OPENED_FROM_NAV,
  OPENED_ON_ENTRY,
  useSampleTripViewReport,
} from '@/hooks/useSampleTripViewReport';
import { useTripContext } from '@/contexts/TripContext';
import { captureEvent } from '@/lib/posthog';

vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));
vi.mock('@/lib/posthog', () => ({ captureEvent: vi.fn() }));

const mockedUseTripContext = vi.mocked(useTripContext);
const mockedCaptureEvent = vi.mocked(captureEvent);

const SAMPLE_ID = 'sample-trip';

function Probe(): ReactElement {
  useSampleTripViewReport();
  return <div />;
}

function renderAt(path: string, state?: unknown): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter([{ path: '*', element: <Probe /> }], {
    initialEntries: [{ pathname: path, state }],
  });
  render(<RouterProvider router={router} />);
  return router;
}

function withSample(sampleTripId: string | undefined): void {
  mockedUseTripContext.mockReturnValue({ sampleTripId } as never);
}

function sampleViews(): unknown[] {
  return mockedCaptureEvent.mock.calls
    .filter(([event]) => event === 'sample_trip_viewed')
    .map(([, properties]) => properties);
}

describe('useSampleTripViewReport', () => {
  beforeEach(() => {
    mockedCaptureEvent.mockClear();
    withSample(SAMPLE_ID);
  });

  it('reports a sample page opened from the trip list', () => {
    renderAt(`/trips/${SAMPLE_ID}/calendar`, OPENED_FROM_LIST);

    expect(sampleViews()).toEqual([{ page: 'calendar', via: 'list' }]);
  });

  it('reports each page, with the navigation as the way in', async () => {
    const router = renderAt(`/trips/${SAMPLE_ID}/calendar`, OPENED_FROM_LIST);

    await act(async () => {
      await router.navigate(`/trips/${SAMPLE_ID}/rooms`, { state: OPENED_FROM_NAV });
    });

    expect(sampleViews()).toEqual([
      { page: 'calendar', via: 'list' },
      { page: 'rooms', via: 'nav' },
    ]);
  });

  it('reports the calendar the app opened on by itself as the entry', () => {
    renderAt(`/trips/${SAMPLE_ID}/calendar`, OPENED_ON_ENTRY);

    expect(sampleViews()).toEqual([{ page: 'calendar', via: 'entry' }]);
  });

  it('says other when no link said where it was', () => {
    renderAt(`/trips/${SAMPLE_ID}/money`, { via: 'somewhere' });

    expect(sampleViews()).toEqual([{ page: 'money', via: 'other' }]);
  });

  it('ignores the user\'s own trips', () => {
    renderAt('/trips/own-trip/calendar', OPENED_FROM_LIST);

    expect(sampleViews()).toEqual([]);
  });

  it('ignores the bare trip path that redirects to the calendar', () => {
    renderAt(`/trips/${SAMPLE_ID}`, OPENED_FROM_LIST);

    expect(sampleViews()).toEqual([]);
  });

  it('ignores the trip list itself', () => {
    renderAt('/trips', OPENED_FROM_NAV);

    expect(sampleViews()).toEqual([]);
  });

  it('waits for the sample id, then reports once', () => {
    withSample(undefined);
    const tree = (): ReactElement => (
      <MemoryRouter initialEntries={[`/trips/${SAMPLE_ID}/persons`]}>
        <Probe />
      </MemoryRouter>
    );
    const { rerender } = render(tree());
    expect(sampleViews()).toEqual([]);

    withSample(SAMPLE_ID);
    rerender(tree());
    rerender(tree());

    expect(sampleViews()).toEqual([{ page: 'persons', via: 'other' }]);
  });
});
