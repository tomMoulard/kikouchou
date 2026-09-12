/**
 * @fileoverview The transport form's selects and the entries it refuses.
 *
 * The sibling file covers what the form renders and the ride pairing. This one
 * drives the three selects — who is travelling, how, and who is collecting them
 * — plus the starting place, and the two entries the form sends back: an
 * unreadable time, and a guest who is not on this trip.
 *
 * @module features/transports/components/__tests__/TransportForm.selects.test
 */

import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';

import { render, screen, userEvent, waitFor } from '@/test/utils';
import type { Person, Transport } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const mockPersons: Person[] = [
  {
    id: 'p1' as Person['id'],
    tripId: 't1' as Person['tripId'],
    name: 'Alice',
    color: '#3b82f6' as Person['color'],
  },
  {
    id: 'p2' as Person['id'],
    tripId: 't1' as Person['tripId'],
    name: 'Bob',
    color: '#ef4444' as Person['color'],
  },
];

// ============================================================================
// Mocks
// ============================================================================

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
    id: string;
    value: string;
    onChange: (next: string) => void;
  }) => (
    <input
      data-testid="location-picker"
      data-location-id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

import { TransportForm } from '../TransportForm';

// ============================================================================
// Helpers
// ============================================================================

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= (): boolean => false;
  Element.prototype.setPointerCapture ??= (): void => undefined;
  Element.prototype.releasePointerCapture ??= (): void => undefined;
  Element.prototype.scrollIntoView ??= (): void => undefined;
});

function renderForm(props: Record<string, unknown> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <TransportForm
      rides={[]}
      vehicles={[]}
      persons={mockPersons}
      tripStartDate="2026-07-15"
      tripEndDate="2026-07-22"
      onSubmit={onSubmit}
      onCancel={vi.fn()}
      {...props}
    />,
    { withProviders: false },
  );
  return { ...view, onSubmit };
}

/** Opens the collapsed extra fields. */
async function openDetails(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByText('transports.details'));
}

/** Opens a Radix select by its label and picks an option. */
async function chooseFrom(
  user: ReturnType<typeof userEvent.setup>,
  label: string | RegExp,
  optionName: RegExp,
): Promise<void> {
  await user.click(screen.getByLabelText(label));
  await user.click(await screen.findByRole('option', { name: optionName }));
}

/**
 * The fields every save needs.
 *
 * The day comes pre-filled from the trip's first day, and is chosen from a
 * calendar rather than typed, so only the time and the place are entered here.
 */
async function fillRequired(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const time = screen.getByLabelText('common.time');
  await user.clear(time);
  await user.type(time, '14:30');
  const pickers = screen.getAllByTestId('location-picker');
  const main = pickers.find(
    (picker) => picker.getAttribute('data-location-id') !== 'transport-start-location',
  );
  await user.type(main!, 'Gare de Vannes');
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('TransportForm — the selects', () => {
  it('records who is travelling', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await chooseFrom(user, /assignments.person/, /Bob/);
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: /common.save|common.add/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ personId: 'p2' });
  });

  it('records how they are travelling', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await chooseFrom(user, /assignments.person/, /Alice/);
    await fillRequired(user);
    await openDetails(user);
    await chooseFrom(user, 'transports.mode', /transports.modes.car/);
    await user.click(screen.getByRole('button', { name: /common.save|common.add/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ transportMode: 'car' });
  });

  it('records who is collecting them', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await chooseFrom(user, /assignments.person/, /Alice/);
    await fillRequired(user);
    await openDetails(user);
    await chooseFrom(user, 'transports.driver', /Bob/);
    await user.click(screen.getByRole('button', { name: /common.save|common.add/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ driverId: 'p2' });
  });

  it('records where the journey starts', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await chooseFrom(user, /assignments.person/, /Alice/);
    await fillRequired(user);
    await openDetails(user);
    const start = screen
      .getAllByTestId('location-picker')
      .find((picker) => picker.getAttribute('data-location-id') === 'transport-start-location');
    await user.type(start!, 'Paris Montparnasse');
    await user.click(screen.getByRole('button', { name: /common.save|common.add/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      startLocation: 'Paris Montparnasse',
    });
  });
});

describe('TransportForm — the entries it refuses', () => {
  it('refuses an entry with nowhere to be', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await chooseFrom(user, /assignments.person/, /Alice/);
    // A time but no place.
    const time = screen.getByLabelText('common.time');
    await user.clear(time);
    await user.type(time, '14:30');
    await user.click(screen.getByRole('button', { name: /common.save|common.add/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a guest who is not on this trip', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm({
      transport: {
        id: 't-ghost' as Transport['id'],
        tripId: 't1' as Transport['tripId'],
        personId: 'ghost' as Transport['personId'],
        type: 'arrival',
        datetime: '2026-07-15T14:30:00',
        location: 'Gare de Vannes',
        needsPickup: false,
      } as Transport,
    });

    await user.click(screen.getByRole('button', { name: /common.save|common.add/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('picks no day when the trip start is not a plain day', () => {
    renderForm({ tripStartDate: '15/07/2026', tripEndDate: '22/07/2026' });

    expect(screen.getByLabelText('common.time')).toHaveValue('');
  });
});
