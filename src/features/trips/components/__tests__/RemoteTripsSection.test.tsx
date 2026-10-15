/**
 * @fileoverview Tests for the "trips you joined elsewhere" section.
 *
 * Everything it renders comes from the server's denormalised preview row, which
 * is the only thing this device knows about a trip it has never downloaded — and
 * which is written by whoever owns the trip. So the cases that matter are the
 * ones where that row says something unusable.
 *
 * @module features/trips/components/__tests__/RemoteTripsSection.test
 */

import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';
import type { RemoteOnlyTrip } from '../../hooks/useRemoteTrips';

const mockDownload = vi.fn(async () => null);
let remoteOnly: readonly RemoteOnlyTrip[] = [];

vi.mock('../../hooks/useRemoteTrips', () => ({
  useRemoteTrips: () => ({
    remoteOnly,
    download: mockDownload,
    isDownloading: null,
  }),
}));

import { RemoteTripsSection } from '../RemoteTripsSection';

describe('RemoteTripsSection', () => {
  it('renders nothing when every trip is already on this device', () => {
    remoteOnly = [];
    const { container } = render(<RemoteTripsSection localTripCount={2} />, {
      withProviders: false,
    });

    // Signed out, offline, or nothing to add: none of those is worth a heading.
    expect(container).toBeEmptyDOMElement();
  });

  it('lists a trip that is on the account but not on this device', () => {
    remoteOnly = [{ id: 'remote-1', name: 'Brittany' }];
    render(<RemoteTripsSection localTripCount={0} />, { withProviders: false });

    expect(screen.getByText('Brittany')).toBeInTheDocument();
  });

  it('falls back to a translated name when the preview has none', () => {
    remoteOnly = [{ id: 'remote-1', name: '' }];
    render(<RemoteTripsSection localTripCount={0} />, { withProviders: false });

    // The old fallback was a hardcoded 'Shared Trip', shown to French users as
    // if that were the trip's name.
    expect(screen.getByText('trips.untitled')).toBeInTheDocument();
  });
});
