/**
 * The room form asks how many rooms to create, so six identical doubles are one
 * save rather than six.
 *
 * @module features/rooms/components/__tests__/RoomForm.bulk.test
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { render, screen } from '@/test/utils';
import type { Room } from '@/types';

vi.mock('@/hooks', () => ({
  useFormSubmission: <T,>(onSubmit: (data: T) => Promise<void>) => ({
    isSubmitting: false,
    submitError: null,
    handleSubmit: onSubmit,
  }),
}));

vi.mock('@/components/shared/RoomIconPicker', () => ({
  RoomIconPicker: ({ value, onChange }: { value?: string; onChange: (v: string) => void }) => (
    <button data-testid="icon-picker" onClick={() => onChange('tent')}>{value ?? 'none'}</button>
  ),
}));

import { RoomForm } from '../RoomForm';

const existingRoom: Room = {
  id: 'r1' as Room['id'],
  tripId: 't1' as Room['tripId'],
  name: 'Big Room',
  capacity: 3,
  order: 0,
};

describe('RoomForm — how many rooms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks how many rooms in create mode', () => {
    render(<RoomForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.getByLabelText('rooms.count')).toBeInTheDocument();
  });

  it('does not ask in edit mode', () => {
    render(
      <RoomForm room={existingRoom} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );

    expect(screen.queryByLabelText('rooms.count')).not.toBeInTheDocument();
  });

  it('submits one room by default', async () => {
    const { userEvent } = await import('@testing-library/user-event'),
     user = userEvent.setup(),
     onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<RoomForm onSubmit={onSubmit} onCancel={vi.fn()} />, {
      withProviders: false,
    });

    await user.type(
      screen.getByPlaceholderText('rooms.namePlaceholder'),
      'Attic',
    );
    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Attic', count: 1 }),
    );
  });

  it('submits the count the user stepped up to', async () => {
    const { userEvent } = await import('@testing-library/user-event'),
     user = userEvent.setup(),
     onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<RoomForm onSubmit={onSubmit} onCancel={vi.fn()} />, {
      withProviders: false,
    });

    await user.type(
      screen.getByPlaceholderText('rooms.namePlaceholder'),
      'Double bed',
    );
    const increment = screen.getByRole('button', {
      name: 'rooms.countIncrease',
    });
    await user.click(increment);
    await user.click(increment);
    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Double bed', count: 3 }),
    );
  });

  it('shows the names the save would create once the count is above one', async () => {
    const { userEvent } = await import('@testing-library/user-event'),
     user = userEvent.setup();

    render(<RoomForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
      withProviders: false,
    });

    await user.type(
      screen.getByPlaceholderText('rooms.namePlaceholder'),
      'Double bed',
    );
    expect(screen.queryByText('rooms.countPreview')).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'rooms.countIncrease' }),
    );

    expect(screen.getByText('rooms.countPreview')).toBeInTheDocument();
  });

  it('stops the count at one', () => {
    render(<RoomForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
      withProviders: false,
    });

    expect(
      screen.getByRole('button', { name: 'rooms.countDecrease' }),
    ).toBeDisabled();
  });

  it('reports a raised count as unsaved work', async () => {
    const { userEvent } = await import('@testing-library/user-event'),
     user = userEvent.setup(),
     onDirtyChange = vi.fn();

    render(
      <RoomForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
      { withProviders: false },
    );

    await user.click(
      screen.getByRole('button', { name: 'rooms.countIncrease' }),
    );

    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });
});
