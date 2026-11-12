/**
 * TransportForm: several guests on one train.
 *
 * The form saves the leg of the guest it names, and beside it, only when the
 * save changes who shares the train, what changes: guests to add, guests to
 * take off, or another train to join.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { render, screen, userEvent } from '@/test/utils';
import type { Person, SharedLegId, Transport } from '@/types';

vi.mock('@/hooks', () => ({
  useFormSubmission: <T,>(onSubmit: (data: T) => Promise<void>) => ({
    isSubmitting: false,
    submitError: null,
    handleSubmit: onSubmit,
  }),
}));

vi.mock('@/components/shared/LocationPicker', () => ({
  LocationPicker: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value: string;
    onChange: (loc: string) => void;
  }) => (
    <input id={id} data-testid="location-picker" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { TransportForm, type TransportFormProps } from '../TransportForm';

// ============================================================================
// Fixtures
// ============================================================================

function person(id: string, name: string): Person {
  return {
    id: id as Person['id'],
    tripId: 't1' as Person['tripId'],
    name,
    color: '#3b82f6' as Person['color'],
  };
}

const alice = person('p1', 'Alice');
const bob = person('p2', 'Bob');
const carol = person('p3', 'Carol');
const persons = [alice, bob, carol];

function leg(id: string, personId: string, fields: Partial<Transport> = {}): Transport {
  return {
    id: id as Transport['id'],
    tripId: 't1' as Transport['tripId'],
    personId: personId as Transport['personId'],
    type: 'arrival',
    datetime: '2027-07-15T14:00:00.000Z' as Transport['datetime'],
    location: 'Gare de Lyon',
    transportMode: 'train',
    transportNumber: 'TGV 6105',
    needsPickup: false,
    ...fields,
  };
}

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= (): boolean => false;
  Element.prototype.setPointerCapture ??= (): void => undefined;
  Element.prototype.releasePointerCapture ??= (): void => undefined;
  Element.prototype.scrollIntoView ??= (): void => undefined;
});

function renderForm(props: {
  readonly transport?: Transport;
  readonly transports?: readonly Transport[];
  readonly onSubmit: TransportFormProps['onSubmit'];
}): void {
  render(
    <TransportForm
      rides={[]}
      vehicles={[]}
      persons={persons}
      transport={props.transport}
      transports={props.transports ?? []}
      tripStartDate="2027-07-15"
      tripEndDate="2027-07-22"
      onSubmit={props.onSubmit}
      onCancel={vi.fn()}
    />,
    { withProviders: false },
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('TransportForm on a shared train', () => {
  it('puts every guest ticked in "Travelling with" on the new train', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<TransportFormProps['onSubmit']>().mockResolvedValue(undefined);
    renderForm({ onSubmit });

    await user.click(screen.getByLabelText(/assignments\.person/));
    await user.click(await screen.findByRole('option', { name: /Alice/ }));
    await user.type(screen.getAllByTestId('location-picker')[1]!, 'Gare de Lyon');
    await user.click(screen.getByLabelText(/Bob/));
    await user.click(screen.getByLabelText(/Carol/));
    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 'p1', location: 'Gare de Lyon' }),
      { addPersonIds: ['p2', 'p3'], removeTransportIds: [] },
    );
  });

  it('does not offer the guest the leg belongs to as their own companion', async () => {
    const onSubmit = vi.fn<TransportFormProps['onSubmit']>();
    renderForm({ transport: leg('t-alice', 'p1'), transports: [leg('t-alice', 'p1')], onSubmit });

    expect(screen.queryByRole('checkbox', { name: /Alice/ })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Bob/ })).not.toBeChecked();
  });

  it('shows who is already on the train, and takes an unticked guest off it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<TransportFormProps['onSubmit']>().mockResolvedValue(undefined);
    const aliceLeg = leg('t-alice', 'p1');
    const bobLeg = leg('t-bob', 'p2', { sharedLegId: 't-alice' as SharedLegId });
    renderForm({ transport: aliceLeg, transports: [aliceLeg, bobLeg], onSubmit });

    const bobBox = screen.getByRole('checkbox', { name: /Bob/ });
    expect(bobBox).toBeChecked();

    await user.click(bobBox);
    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ personId: 'p1' }), {
      addPersonIds: [],
      removeTransportIds: ['t-bob'],
    });
  });

  it('sends the leg alone when the save changes nobody on the train', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<TransportFormProps['onSubmit']>().mockResolvedValue(undefined);
    const aliceLeg = leg('t-alice', 'p1');
    const bobLeg = leg('t-bob', 'p2', { sharedLegId: 't-alice' as SharedLegId });
    renderForm({ transport: aliceLeg, transports: [aliceLeg, bobLeg], onSubmit });

    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]).toHaveLength(1);
  });

  it("joins another guest's train and copies it into the form", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<TransportFormProps['onSubmit']>().mockResolvedValue(undefined);
    const bobLeg = leg('t-bob', 'p2', {
      datetime: '2027-07-15T16:45:00.000Z' as Transport['datetime'],
      location: 'Lyon Part-Dieu',
      transportNumber: 'TGV 6111',
      notes: 'Coach 12',
      needsPickup: true,
    });
    renderForm({ transports: [bobLeg], onSubmit });

    await user.click(screen.getByLabelText(/assignments\.person/));
    await user.click(await screen.findByRole('option', { name: /Alice/ }));
    await user.click(screen.getByLabelText('transports.sharedLeg'));
    await user.click(await screen.findByRole('option', { name: /Lyon Part-Dieu/ }));

    expect(screen.getAllByTestId('location-picker')[1]).toHaveValue('Lyon Part-Dieu');
    // Bob is named as already on board, not offered as a box to tick again.
    expect(screen.getByText('transports.alreadyOnBoard')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Bob/ })).not.toBeInTheDocument();

    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: 'p1',
        location: 'Lyon Part-Dieu',
        transportNumber: 'TGV 6111',
        notes: 'Coach 12',
        datetime: '2027-07-15T16:45:00.000Z',
        // Fetched with Bob, off the same train.
        needsPickup: true,
      }),
      { join: 't-bob', addPersonIds: [], removeTransportIds: [] },
    );
  });

  it('does not offer a train the chosen guest is already on', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<TransportFormProps['onSubmit']>();
    renderForm({ transports: [leg('t-alice', 'p1')], onSubmit });

    await user.click(screen.getByLabelText(/assignments\.person/));
    await user.click(await screen.findByRole('option', { name: /Alice/ }));

    expect(screen.queryByLabelText('transports.sharedLeg')).not.toBeInTheDocument();
  });

  it('takes the leg off its train when "Its own transport" is picked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<TransportFormProps['onSubmit']>().mockResolvedValue(undefined);
    const aliceLeg = leg('t-alice', 'p1');
    const bobLeg = leg('t-bob', 'p2', { sharedLegId: 't-alice' as SharedLegId });
    renderForm({ transport: bobLeg, transports: [aliceLeg, bobLeg], onSubmit });

    await user.click(screen.getByLabelText('transports.sharedLeg'));
    await user.click(await screen.findByRole('option', { name: 'transports.sharedLegNone' }));
    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ personId: 'p2' }), {
      join: null,
      addPersonIds: [],
      removeTransportIds: [],
    });
  });

  it('does not offer a guest on the train as the driver', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<TransportFormProps['onSubmit']>();
    renderForm({ onSubmit });

    await user.click(screen.getByLabelText(/Bob/));
    await user.click(screen.getByText('transports.details'));
    await user.click(screen.getByLabelText('transports.driver'));

    expect(screen.queryByRole('option', { name: /Bob/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Carol/ })).toBeInTheDocument();
  });
});
