import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/utils';
import type { Person } from '@/types';

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

vi.mock('@/hooks', () => ({
  useFormSubmission: <T,>(onSubmit: (data: T) => Promise<void>) => ({
    isSubmitting: false,
    submitError: null,
    handleSubmit: onSubmit,
  }),
}));

vi.mock('@/components/shared/LocationPicker', () => ({
  LocationPicker: ({ value, onChange }: { value: string; onChange: (loc: string) => void }) => (
    <input data-testid="location-picker" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { TransportForm } from '../TransportForm';

describe('TransportForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders create mode with type radio buttons', () => {
    render(
      <TransportForm persons={mockPersons} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByLabelText('transports.arrival')).toBeInTheDocument();
    expect(screen.getByLabelText('transports.departure')).toBeInTheDocument();
  });

  it('renders person select with persons', () => {
    render(
      <TransportForm persons={mockPersons} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('assignments.person')).toBeInTheDocument();
  });

  it('renders datetime, location, and mode fields', () => {
    render(
      <TransportForm persons={mockPersons} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByLabelText(/transports.datetime/)).toBeInTheDocument();
    expect(screen.getByTestId('location-picker')).toBeInTheDocument();
    expect(screen.getByText('transports.mode')).toBeInTheDocument();
  });

  it('renders needs pickup switch', () => {
    render(
      <TransportForm persons={mockPersons} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('transports.needsPickup')).toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <TransportForm persons={mockPersons} onSubmit={vi.fn()} onCancel={onCancel} />,
      { withProviders: false },
    );
    await user.click(screen.getByText('common.cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables submit when no persons available', () => {
    render(
      <TransportForm persons={[]} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const submitBtn = screen.getByText('common.save');
    expect(submitBtn).toBeDisabled();
  });

  it('reports dirty state changes', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    render(
      <TransportForm persons={mockPersons} onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />,
      { withProviders: false },
    );
    const locationInput = screen.getByTestId('location-picker');
    await user.type(locationInput, 'Paris');
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it('renders empty persons message when no persons', () => {
    render(
      <TransportForm persons={[]} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('persons.empty')).toBeInTheDocument();
  });
});
