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

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/test/utils';
import type { RemoteOnlyTrip } from '../../hooks/useRemoteTrips';

let mockDownload = vi.fn<(id: string) => Promise<string | null>>(async () => null);
let remoteOnly: readonly RemoteOnlyTrip[] = [];
let isDownloading: string | null = null;

vi.mock('../../hooks/useRemoteTrips', () => ({
  useRemoteTrips: () => ({
    remoteOnly,
    download: mockDownload,
    isDownloading,
  }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

import { RemoteTripsSection } from '../RemoteTripsSection';

beforeEach(() => {
  remoteOnly = [];
  isDownloading = null;
  mockDownload = vi.fn<(id: string) => Promise<string | null>>(async () => null);
});

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
    expect(screen.getByRole('heading', { name: 'trips.remote.title' })).toBeInTheDocument();
    expect(screen.getByText('trips.remote.description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Brittany/ })).toHaveTextContent(
      'trips.remote.download',
    );
  });

  it('falls back to a translated name when the preview has none', () => {
    remoteOnly = [{ id: 'remote-1', name: '' }];
    render(<RemoteTripsSection localTripCount={0} />, { withProviders: false });

    // The old fallback was a hardcoded 'Shared Trip', shown to French users as
    // if that were the trip's name.
    expect(screen.getByText('trips.untitled')).toBeInTheDocument();
  });

  it('opens a downloaded trip on its calendar', async () => {
    remoteOnly = [{ id: 'remote-1', name: 'Brittany' }];
    mockDownload = vi.fn<(id: string) => Promise<string | null>>(async () => 'local-1');
    const { user } = render(<RemoteTripsSection localTripCount={0} />, { withProviders: false });

    await user.click(screen.getByRole('button', { name: /Brittany/ }));

    expect(mockDownload).toHaveBeenCalledWith('remote-1');
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/trips/local-1/calendar');
    });
  });

  it('stays put when the download brought nothing', async () => {
    remoteOnly = [{ id: 'remote-1', name: 'Brittany' }];
    const { user } = render(<RemoteTripsSection localTripCount={0} />, { withProviders: false });

    await user.click(screen.getByRole('button', { name: /Brittany/ }));

    await waitFor(() => {
      expect(mockDownload).toHaveBeenCalled();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('downloads through the download the hook hands it now', async () => {
    remoteOnly = [{ id: 'remote-1', name: 'Brittany' }];
    const first = mockDownload;
    const { user, rerender } = render(<RemoteTripsSection localTripCount={0} />, {
      withProviders: false,
    });

    mockDownload = vi.fn<(id: string) => Promise<string | null>>(async () => null);
    rerender(<RemoteTripsSection localTripCount={1} />);
    await user.click(screen.getByRole('button', { name: /Brittany/ }));

    expect(mockDownload).toHaveBeenCalledWith('remote-1');
    expect(first).not.toHaveBeenCalled();
  });

  it('spins on the trip being downloaded and holds every button meanwhile', () => {
    remoteOnly = [
      { id: 'remote-1', name: 'Brittany' },
      { id: 'remote-2', name: 'Alps' },
    ];
    isDownloading = 'remote-1';
    render(<RemoteTripsSection localTripCount={0} />, { withProviders: false });

    const brittany = screen.getByRole('button', { name: /Brittany/ });
    const alps = screen.getByRole('button', { name: /Alps/ });
    expect(brittany).toBeDisabled();
    expect(alps).toBeDisabled();
    expect(brittany.querySelector('.animate-spin')).not.toBeNull();
    expect(alps.querySelector('.animate-spin')).toBeNull();
  });

  it('offers every trip while nothing downloads', () => {
    remoteOnly = [{ id: 'remote-1', name: 'Brittany' }];
    render(<RemoteTripsSection localTripCount={0} />, { withProviders: false });

    const button = screen.getByRole('button', { name: /Brittany/ });
    expect(button).toBeEnabled();
    expect(button.querySelector('.animate-spin')).toBeNull();
  });
});
