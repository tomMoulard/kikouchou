/**
 * The beds part of the room form, read through the real English bundle so a
 * test can see the "Sleeps 3" a person reads.
 *
 * @module features/rooms/components/__tests__/RoomForm.beds.test
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.unmock('i18next');
vi.unmock('react-i18next');

vi.mock('@/hooks', () => ({
  useFormSubmission: <T,>(onSubmit: (data: T) => Promise<void>) => ({
    isSubmitting: false,
    submitError: null,
    handleSubmit: onSubmit,
  }),
}));

import { renderWithRealI18n, screen, userEvent, within } from '@/test/utils';
import type { Room, RoomFormData } from '@/types';

import { RoomForm } from '../RoomForm';

// ============================================================================
// Fixtures
// ============================================================================

const TWIN_ROOM: Room = {
  id: 'r1' as Room['id'],
  tripId: 't1' as Room['tripId'],
  name: 'Attic',
  capacity: 2,
  order: 0,
  bedLayouts: [
    { name: 'Twin', beds: [{ kind: 'single', count: 2, widthCm: 80, lengthCm: 200 }] },
    { name: 'Together', beds: [{ kind: 'queen', count: 1 }] },
  ],
};

async function renderForm(room?: Room) {
  const onSubmit = vi.fn<(data: RoomFormData) => Promise<void>>().mockResolvedValue(undefined);
  const onDirtyChange = vi.fn();
  await renderWithRealI18n(
    <RoomForm
      {...(room === undefined ? {} : { room })}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
      onDirtyChange={onDirtyChange}
    />,
    { withProviders: false },
  );
  return { onSubmit, onDirtyChange, user: userEvent.setup() };
}

function submittedData(onSubmit: ReturnType<typeof vi.fn>): RoomFormData {
  return onSubmit.mock.calls[0]?.[0] as RoomFormData;
}

// ============================================================================
// Tests
// ============================================================================

// Radix's Select drives itself with pointer capture and scrolls the highlighted
// option into view, neither of which jsdom implements.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= (): boolean => false;
  Element.prototype.setPointerCapture ??= (): void => undefined;
  Element.prototype.releasePointerCapture ??= (): void => undefined;
  Element.prototype.scrollIntoView ??= (): void => undefined;
});

describe('RoomForm beds', () => {
  it('asks how many people a room sleeps, not how many beds it has', async () => {
    await renderForm();

    expect(screen.getByLabelText(/How many people it sleeps/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Describe the beds' })).toBeInTheDocument();
  });

  it('starts the beds from the number the room had: two people is one double', async () => {
    const { onSubmit, user } = await renderForm();
    await user.type(screen.getByLabelText(/Room name/), 'Blue room');
    await user.click(screen.getByRole('button', { name: 'One person more' }));

    await user.click(screen.getByRole('button', { name: 'Describe the beds' }));

    expect(screen.getByRole('combobox', { name: 'Kind of bed' })).toHaveTextContent('Double');
    expect(screen.getByText('Sleeps 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(submittedData(onSubmit)).toMatchObject({
      name: 'Blue room',
      capacity: 2,
      bedLayouts: [{ beds: [{ kind: 'double', count: 1 }] }],
      extraSpots: undefined,
    });
  });

  it('saves two layouts of one room with their names and sizes, sleeping the largest', async () => {
    const { onSubmit, user } = await renderForm();
    await user.type(screen.getByLabelText(/Room name/), 'Attic');
    await user.click(screen.getByRole('button', { name: 'Describe the beds' }));

    // One single by default; make it two 80 × 200 singles.
    const first = screen.getByRole('group', { name: 'Layout 1' });
    await user.click(within(first).getByRole('button', { name: 'One bed more' }));
    await user.type(within(first).getByLabelText('Width (cm)'), '80');
    await user.type(within(first).getByLabelText('Length (cm)'), '200');

    await user.click(screen.getByRole('button', { name: 'Add another way to set up the beds' }));
    const second = screen.getByRole('group', { name: 'Layout 2' });
    await user.type(within(first).getByLabelText('Name of this layout'), 'Twin');
    await user.type(within(second).getByLabelText('Name of this layout'), 'Together');

    expect(within(second).getByRole('combobox', { name: 'Kind of bed' })).toHaveTextContent('Queen');
    expect(screen.getByText('Sleeps 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(submittedData(onSubmit)).toMatchObject({
      capacity: 2,
      bedLayouts: [
        { name: 'Twin', beds: [{ kind: 'single', count: 2, widthCm: 80, lengthCm: 200 }] },
        { name: 'Together', beds: [{ kind: 'queen', count: 1 }] },
      ],
    });
  });

  it('adds the extra spots to what the room sleeps', async () => {
    const { onSubmit, user } = await renderForm(TWIN_ROOM);

    await user.click(screen.getByRole('button', { name: 'One spot more' }));

    expect(screen.getByText('Sleeps 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(submittedData(onSubmit)).toMatchObject({ capacity: 3, extraSpots: 1 });
  });

  it('changes the kind of a bed from the list', async () => {
    const { onSubmit, user } = await renderForm({
      ...TWIN_ROOM,
      bedLayouts: [{ beds: [{ kind: 'single', count: 1 }] }],
      capacity: 1,
    });

    await user.click(screen.getByRole('combobox', { name: 'Kind of bed' }));
    await user.click(screen.getByRole('option', { name: 'Bunk bed' }));

    expect(screen.getByText('Sleeps 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(submittedData(onSubmit)).toMatchObject({
      capacity: 2,
      bedLayouts: [{ beds: [{ kind: 'bunk', count: 1 }] }],
    });
  });

  it('refuses a size out of bounds and says which bounds', async () => {
    const { onSubmit, user } = await renderForm(TWIN_ROOM);
    const first = screen.getByRole('group', { name: 'Layout 1' });
    const width = within(first).getByLabelText('Width (cm)');

    await user.clear(width);
    await user.type(width, '2500');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(within(first).getByRole('alert')).toHaveTextContent(
      'Width from 40 to 250 cm, length from 80 to 250 cm.',
    );
    expect(width).toHaveAttribute('aria-invalid', 'true');
  });

  it('goes back to a typed number when the last layout is removed, and clears the beds', async () => {
    const { onSubmit, user } = await renderForm({
      ...TWIN_ROOM,
      capacity: 3,
      extraSpots: 1,
    });

    for (const button of screen.getAllByRole('button', { name: 'Remove this layout' })) {
      await user.click(button);
    }

    // The number starts from what the beds slept.
    expect(screen.getByLabelText(/How many people it sleeps/)).toHaveValue(3);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const data = submittedData(onSubmit);
    expect(data.capacity).toBe(3);
    // The keys are sent empty, which is how the repository clears them.
    expect(data).toHaveProperty('bedLayouts', undefined);
    expect(data).toHaveProperty('extraSpots', undefined);
  });

  it('removes a layout when its last bed is removed', async () => {
    const { user } = await renderForm(TWIN_ROOM);
    const second = screen.getByRole('group', { name: 'Layout 2' });

    await user.click(within(second).getByRole('button', { name: 'Remove this bed' }));

    expect(screen.queryByRole('group', { name: 'Layout 2' })).not.toBeInTheDocument();
    // One layout left: its name field is no longer asked for.
    expect(screen.queryByLabelText('Name of this layout')).not.toBeInTheDocument();
  });

  it('turns dirty on a change to the beds alone, and back when it is undone', async () => {
    const { onDirtyChange, user } = await renderForm(TWIN_ROOM);
    const first = screen.getByRole('group', { name: 'Layout 1' });

    await user.click(within(first).getByRole('button', { name: 'One bed more' }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await user.click(within(first).getByRole('button', { name: 'One bed fewer' }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('refuses beds that sleep more people than a room may hold', async () => {
    const { onSubmit, user } = await renderForm({
      ...TWIN_ROOM,
      capacity: 40,
      bedLayouts: [{ beds: [{ kind: 'bunk', count: 20 }] }],
    });

    for (let index = 0; index < 11; index++) {
      await user.click(screen.getByRole('button', { name: 'One spot more' }));
    }
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Maximum 50 beds')).toBeInTheDocument();
  });
});
