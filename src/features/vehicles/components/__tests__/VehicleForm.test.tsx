/**
 * @fileoverview Tests for VehicleForm.
 *
 * The two things worth pinning down here are the ones that would silently
 * corrupt a car: an empty seat count must submit "not measured" rather than a
 * zero-seat car, and the child-seat tally must round-trip through the
 * one-entry-per-seat list the entity stores.
 *
 * @module features/vehicles/components/__tests__/VehicleForm.test
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { render, screen, userEvent, waitFor, within } from '@/test/utils';
import { VehicleForm } from '@/features/vehicles/components/VehicleForm';
import { hexColor } from '@/test/utils';
import type { Person, PersonId, TripId, Vehicle, VehicleId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;

const alice: Person = {
  id: 'person-alice' as PersonId,
  tripId: TRIP_ID,
  name: 'Alice',
  color: hexColor('#3b82f6'),
};

const bob: Person = {
  id: 'person-bob' as PersonId,
  tripId: TRIP_ID,
  name: 'Bob',
  color: hexColor('#ef4444'),
};

const espace: Vehicle = {
  id: 'vehicle-1' as VehicleId,
  tripId: TRIP_ID,
  name: 'Espace de location',
  ownerId: bob.id,
  isRental: true,
  seatCount: 7,
  childSeats: ['booster', 'booster', 'rearFacing'],
  luggageNotes: 'Big boot',
  notes: 'Automatic',
};

/**
 * Renders the form with a resolved submit handler and hands it back.
 */
function renderForm(vehicle?: Vehicle) {
  const onSubmit = vi.fn().mockResolvedValue(undefined),
    onCancel = vi.fn();

  render(
    <VehicleForm
      vehicle={vehicle}
      persons={[alice, bob]}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
    { withProviders: false },
  );

  return { onCancel, onSubmit };
}

/** The stepper group for one restraint kind. */
function seatGroup(kind: string): HTMLElement {
  return screen.getByRole('group', { name: `childSeats.${kind}` });
}

// ============================================================================
// Tests
// ============================================================================

describe('VehicleForm', () => {
  beforeAll(() => {
    // Radix Select reaches for pointer-capture and scroll APIs jsdom omits.
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it('starts blank in create mode', () => {
    renderForm();

    expect(screen.getByLabelText(/vehicles\.name/)).toHaveValue('');
    expect(screen.getByLabelText('vehicles.seatCount')).toHaveValue(null);
    expect(screen.getByRole('switch', { name: 'vehicles.rental' })).not.toBeChecked();
  });

  it('seeds every field from the car being edited', () => {
    renderForm(espace);

    expect(screen.getByLabelText(/vehicles\.name/)).toHaveValue('Espace de location');
    expect(screen.getByLabelText('vehicles.seatCount')).toHaveValue(7);
    expect(screen.getByRole('switch', { name: 'vehicles.rental' })).toBeChecked();
    expect(screen.getByLabelText('vehicles.luggageNotes')).toHaveValue('Big boot');
    expect(screen.getByLabelText('vehicles.notes')).toHaveValue('Automatic');

    // Stored one entry per seat, shown as a tally.
    expect(
      within(seatGroup('booster')).getByRole('status', {
        name: 'vehicles.childSeatCount',
      }),
    ).toHaveTextContent('2');
    expect(
      within(seatGroup('rearFacing')).getByRole('status', {
        name: 'vehicles.childSeatCount',
      }),
    ).toHaveTextContent('1');
  });

  it('refuses a car with no name', async () => {
    const user = userEvent.setup(),
      { onSubmit } = renderForm();

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(await screen.findByText('common.required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits an empty seat count as "not measured", never as zero', async () => {
    const user = userEvent.setup(),
      { onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/vehicles\.name/), 'La Clio');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'La Clio', seatCount: undefined }),
    );
  });

  it('rejects a seat count of zero rather than storing a car nobody fits in', async () => {
    const user = userEvent.setup(),
      { onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/vehicles\.name/), 'La Clio');
    await user.type(screen.getByLabelText('vehicles.seatCount'), '0');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(await screen.findByText(/vehicles\.seatCountInvalid/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('stores two boosters as two entries, so a second child is not lost', async () => {
    const user = userEvent.setup(),
      { onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/vehicles\.name/), 'La Clio');

    const boosters = within(seatGroup('booster'));
    await user.click(boosters.getByRole('button', { name: 'vehicles.addChildSeat' }));
    await user.click(boosters.getByRole('button', { name: 'vehicles.addChildSeat' }));
    await user.click(
      within(seatGroup('forwardFacing')).getByRole('button', {
        name: 'vehicles.addChildSeat',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        childSeats: ['forwardFacing', 'booster', 'booster'],
      }),
    );
  });

  it('cannot take a restraint away from a kind the car does not carry', () => {
    renderForm();

    expect(
      within(seatGroup('booster')).getByRole('button', {
        name: 'vehicles.removeChildSeat',
      }),
    ).toBeDisabled();
  });

  it('submits no child seats at all when every stepper is at zero', async () => {
    const user = userEvent.setup(),
      { onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/vehicles\.name/), 'La Clio');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ childSeats: undefined }),
    );
  });

  it('records the guest whose car it is', async () => {
    const user = userEvent.setup(),
      { onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/vehicles\.name/), 'La Clio');
    await user.click(screen.getByRole('combobox', { name: 'vehicles.owner' }));
    await user.click(await screen.findByRole('option', { name: /Alice/ }));
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: alice.id }),
    );
  });

  it('clears an owner back to nobody in particular', async () => {
    const user = userEvent.setup(),
      { onSubmit } = renderForm(espace);

    await user.click(screen.getByRole('combobox', { name: 'vehicles.owner' }));
    await user.click(await screen.findByRole('option', { name: 'vehicles.noOwner' }));
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    // Present and undefined rather than absent: the update repository only
    // clears a field it is actually handed.
    const [data] = onSubmit.mock.calls[0] as [Record<string, unknown>];
    expect(data).toHaveProperty('ownerId', undefined);
  });

  it('flags a hire car', async () => {
    const user = userEvent.setup(),
      { onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/vehicles\.name/), 'Espace');
    await user.click(screen.getByRole('switch', { name: 'vehicles.rental' }));
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ isRental: true }),
    );
  });

  it('says the owner is somebody this device does not have', () => {
    render(
      <VehicleForm
        vehicle={espace}
        persons={[alice]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );

    // The trigger must not read "Nobody in particular" over a car that names
    // an owner — that is the label under which the id used to be written back.
    expect(
      screen.getByRole('combobox', { name: 'vehicles.owner' }),
    ).toHaveTextContent('vehicles.unknownOwner');
    expect(screen.getByText('vehicles.unknownOwnerHint')).toBeInTheDocument();
  });

  it('keeps an owner it cannot resolve rather than dropping them on save', async () => {
    const user = userEvent.setup(),
      onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <VehicleForm
        vehicle={espace}
        persons={[alice]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    // A guest whose row has not been projected yet is not a guest who was
    // deleted: clearing the link here would destroy the answer to "whose car
    // is that?" for everybody, permanently.
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: bob.id }),
    );
  });

  it('reports the dirty state so the dialog can guard a close', async () => {
    const user = userEvent.setup(),
      onDirtyChange = vi.fn();

    render(
      <VehicleForm
        persons={[alice]}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
      { withProviders: false },
    );

    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    await user.type(screen.getByLabelText(/vehicles\.name/), 'La Clio');

    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });
  });

  it('cancels without submitting', async () => {
    const user = userEvent.setup(),
      { onCancel, onSubmit } = renderForm(espace);

    await user.click(screen.getByRole('button', { name: 'common.cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
