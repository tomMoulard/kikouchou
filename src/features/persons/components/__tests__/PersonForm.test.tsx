/**
 * @fileoverview Tests for PersonForm component.
 * Tests rendering, validation, and submission flows.
 *
 * @module features/persons/components/__tests__/PersonForm.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/utils';
import type { Person, Trip } from '@/types';

// ============================================================================
// Mocks
// ============================================================================

const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  location: 'Alps',
  startDate: '2026-06-01' as Trip['startDate'],
  endDate: '2026-06-10' as Trip['endDate'],
  description: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const existingPerson: Person = {
  id: 'person-1' as Person['id'],
  tripId: mockTrip.id,
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
  stayStartDate: '2026-06-02' as NonNullable<Person['stayStartDate']>,
  stayEndDate: '2026-06-08' as NonNullable<Person['stayEndDate']>,
};

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(() => ({
    currentTrip: mockTrip,
  })),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: vi.fn(() => ({
    persons: [existingPerson],
  })),
}));

vi.mock('@/hooks', () => ({
  useFormSubmission: <T,>(onSubmit: (data: T) => Promise<void>) => ({
    isSubmitting: false,
    submitError: null,
    handleSubmit: onSubmit,
  }),
}));

vi.mock('@/components/shared/ColorPicker', () => ({
  DEFAULT_COLORS: ['#3b82f6', '#ef4444', '#22c55e'],
  ColorPicker: ({ value, onChange }: { value: string; onChange: (c: string) => void }) => (
    <button
      type="button"
      data-testid="color-picker"
      data-value={value}
      onClick={() => onChange('#ef4444')}
    >
      Color: {value}
    </button>
  ),
}));

vi.mock('@/components/shared/DateRangePicker', () => ({
  DateRangePicker: () => <div data-testid="date-range-picker" />,
}));

import { PersonForm } from '../PersonForm';
import { useTripContext } from '@/contexts/TripContext';
import { usePersonContext } from '@/contexts/PersonContext';

// ============================================================================
// Tests
// ============================================================================

describe('PersonForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: mockTrip,
    } as unknown as ReturnType<typeof useTripContext>);
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [existingPerson],
    } as unknown as ReturnType<typeof usePersonContext>);
  });

  it('renders create mode with empty name field', () => {
    render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const nameInput = screen.getByLabelText(/persons\.name/);
    expect(nameInput).toHaveValue('');
  });

  it('renders edit mode with pre-filled name', () => {
    render(
      <PersonForm person={existingPerson} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const nameInput = screen.getByLabelText(/persons\.name/);
    expect(nameInput).toHaveValue('Alice');
  });

  it('renders color picker', () => {
    render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByTestId('color-picker')).toBeInTheDocument();
  });

  it('renders stay dates picker when trip context exists', () => {
    render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByTestId('date-range-picker')).toBeInTheDocument();
  });

  it('hides stay dates picker when no current trip', () => {
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: null,
    } as unknown as ReturnType<typeof useTripContext>);
    render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.queryByTestId('date-range-picker')).not.toBeInTheDocument();
  });

  it('renders cancel and save buttons', () => {
    render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('common.cancel')).toBeInTheDocument();
    expect(screen.getByText('common.save')).toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const onCancel = vi.fn();
    const { user } = render(
      <PersonForm onSubmit={vi.fn()} onCancel={onCancel} />,
      { withProviders: false },
    );
    await user.click(screen.getByText('common.cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows validation error when submitting empty name', async () => {
    const onSubmit = vi.fn();
    const { user } = render(
      <PersonForm onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    await user.click(screen.getByText('common.save'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('common.required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with form data when valid', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { user } = render(
      <PersonForm onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const nameInput = screen.getByLabelText(/persons\.name/);
    await user.type(nameInput, 'Bob');
    await user.click(screen.getByText('common.save'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Bob' }),
    );
  });

  it('calls onSubmit with correct data in edit mode', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { user } = render(
      <PersonForm person={existingPerson} onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    await user.click(screen.getByText('common.save'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Alice' }),
    );
  });

  it('shows name validation error on blur', async () => {
    const { user } = render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const nameInput = screen.getByLabelText(/persons\.name/);
    await user.click(nameInput);
    await user.tab(); // blur
    expect(screen.getByText('common.required')).toBeInTheDocument();
  });

  it('clears validation error when typing', async () => {
    const { user } = render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    // Trigger error first
    await user.click(screen.getByText('common.save'));
    expect(screen.getByText('common.required')).toBeInTheDocument();
    // Type to clear
    const nameInput = screen.getByLabelText(/persons\.name/);
    await user.type(nameInput, 'A');
    expect(screen.queryByText('common.required')).not.toBeInTheDocument();
  });

  it('reports dirty state changes via onDirtyChange', async () => {
    const onDirtyChange = vi.fn();
    const { user } = render(
      <PersonForm
        person={existingPerson}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
      { withProviders: false },
    );
    const nameInput = screen.getByLabelText(/persons\.name/);
    await user.type(nameInput, 'X');
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });
});
