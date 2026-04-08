import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/utils';
import type { Person, PersonId } from '@/types';

const mockPersons: Person[] = [
  {
    id: 'p1' as PersonId,
    tripId: 't1' as Person['tripId'],
    name: 'Alice',
    color: '#3b82f6' as Person['color'],
  },
];

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({
    persons: mockPersons,
    createPerson: vi.fn().mockResolvedValue(undefined),
    updatePerson: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({
    successToast: vi.fn(),
    errorToast: vi.fn(),
  }),
}));

vi.mock('@/features/persons/components/PersonForm', () => ({
  PersonForm: ({ person, onCancel }: { person?: Person; onCancel: () => void }) => (
    <div data-testid="person-form">
      {person ? <span data-testid="edit-mode">{person.name}</span> : <span data-testid="create-mode">New</span>}
      <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

import { PersonDialog } from '../PersonDialog';

describe('PersonDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders create mode when personId is undefined', () => {
    render(
      <PersonDialog open onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('persons.new')).toBeInTheDocument();
    expect(screen.getByTestId('create-mode')).toBeInTheDocument();
  });

  it('renders edit mode when personId is provided', () => {
    render(
      <PersonDialog personId={'p1' as PersonId} open onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('persons.edit')).toBeInTheDocument();
    expect(screen.getByTestId('edit-mode')).toBeInTheDocument();
  });

  it('shows error state when person is not found in edit mode', () => {
    render(
      <PersonDialog personId={'nonexistent' as PersonId} open onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('persons.edit')).toBeInTheDocument();
    expect(screen.getByText('errors.personNotFound')).toBeInTheDocument();
  });

  it('calls onOpenChange when cancel is clicked (not dirty)', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <PersonDialog open onOpenChange={onOpenChange} />,
      { withProviders: false },
    );
    await user.click(screen.getByTestId('cancel-btn'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not render when not open', () => {
    render(
      <PersonDialog open={false} onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.queryByText('persons.new')).not.toBeInTheDocument();
  });
});
