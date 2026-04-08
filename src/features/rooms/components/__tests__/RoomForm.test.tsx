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

describe('RoomForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders create mode with default values', () => {
    render(
      <RoomForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByLabelText(/rooms.name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/rooms.capacity/)).toBeInTheDocument();
    expect(screen.getByLabelText(/rooms.description/)).toBeInTheDocument();
    expect(screen.getByTestId('icon-picker')).toBeInTheDocument();
  });

  it('renders edit mode with room data', () => {
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: 't1' as Room['tripId'],
      name: 'Big Room',
      capacity: 3,
      description: 'A big room',
      order: 0,
    };
    render(
      <RoomForm room={room} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByDisplayValue('Big Room')).toBeInTheDocument();
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A big room')).toBeInTheDocument();
  });

  it('shows validation error on blur with empty name', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(
      <RoomForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const nameInput = screen.getByPlaceholderText('rooms.namePlaceholder');
    await user.click(nameInput);
    await user.tab();
    expect(screen.getByText('common.required')).toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <RoomForm onSubmit={vi.fn()} onCancel={onCancel} />,
      { withProviders: false },
    );
    await user.click(screen.getByText('common.cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('submits form with valid data', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <RoomForm onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const nameInput = screen.getByPlaceholderText('rooms.namePlaceholder');
    await user.type(nameInput, 'Test Room');
    await user.click(screen.getByText('common.save'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Test Room', capacity: 1 }),
    );
  });

  it('reports dirty state changes', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    render(
      <RoomForm onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />,
      { withProviders: false },
    );
    const nameInput = screen.getByPlaceholderText('rooms.namePlaceholder');
    await user.type(nameInput, 'X');
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });
});
