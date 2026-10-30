/**
 * @fileoverview Tests for the page a device shows for a trip it does not hold.
 *
 * Both ways out are checked: back to the trip list, and the invite dialog,
 * which loads only on the first click.
 *
 * @module features/trips/components/__tests__/TripNotOnDeviceState.test
 */

import { describe, expect, it, vi } from 'vitest';

import { act, render, screen } from '@/test/utils';

import { TripNotOnDeviceState } from '../TripNotOnDeviceState';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

vi.mock('@/features/sharing/components/ImportTripQrDialog', () => ({
  ImportTripQrDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="invite">
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          close
        </button>
      </div>
    ) : null,
}));

describe('TripNotOnDeviceState', () => {
  it('says the trip is not on this device, and why', async () => {
    render(<TripNotOnDeviceState />, { withProviders: false });

    expect(screen.getByText('errors.tripNotOnDevice')).toBeInTheDocument();
    expect(screen.getByText('errors.tripNotOnDeviceDescription')).toBeInTheDocument();
    // The invite dialog waits for a click, not merely for its chunk.
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('goes back to the trip list', async () => {
    const { user } = render(<TripNotOnDeviceState />, { withProviders: false });

    await user.click(screen.getByRole('button', { name: 'errors.backToTrips' }));

    expect(mockNavigate).toHaveBeenCalledWith('/trips');
  });

  it('opens the invite dialog, and closes it again', async () => {
    const { user } = render(<TripNotOnDeviceState />, { withProviders: false });

    await user.click(screen.getByRole('button', { name: 'trips.joinWithInvite' }));
    expect(await screen.findByRole('dialog', { name: 'invite' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
