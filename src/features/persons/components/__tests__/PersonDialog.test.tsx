import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
import type { Person, PersonId } from '@/types';

const mockCreatePerson = vi.fn().mockResolvedValue(undefined);
const mockUpdatePerson = vi.fn().mockResolvedValue(undefined);
const mockGetAssignmentsByPerson = vi.fn().mockReturnValue([]);
const mockUpdateAssignment = vi.fn().mockResolvedValue(undefined);
const mockSuccessToast = vi.fn();

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
    createPerson: mockCreatePerson,
    updatePerson: mockUpdatePerson,
  }),
}));

vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: () => ({
    getAssignmentsByPerson: mockGetAssignmentsByPerson,
    updateAssignment: mockUpdateAssignment,
  }),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({
    successToast: mockSuccessToast,
    errorToast: vi.fn(),
  }),
}));

vi.mock('@/features/persons/components/PersonForm', () => ({
  PersonForm: ({ person, onCancel, onSubmit, onDirtyChange }: {
    person?: Person;
    onCancel: () => void;
    onSubmit: (data: unknown) => Promise<void>;
    onDirtyChange?: (dirty: boolean) => void;
  }) => (
    <div data-testid="person-form">
      {person ? <span data-testid="edit-mode">{person.name}</span> : <span data-testid="create-mode">New</span>}
      <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
      <button
        data-testid="submit-btn"
        onClick={() =>
          onSubmit({
            name: 'Test',
            color: '#000000',
            stayStartDate: '2026-04-22',
            stayEndDate: '2026-04-25',
          })
        }
      >
        Submit
      </button>
      <button data-testid="dirty-btn" onClick={() => onDirtyChange?.(true)}>Mark Dirty</button>
    </div>
  ),
}));

import { PersonDialog } from '../PersonDialog';

describe('PersonDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAssignmentsByPerson.mockReturnValue([]);
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

  // ===========================================================================
  // New tests for improved coverage
  // ===========================================================================

  it('calls createPerson and closes dialog on submit in create mode', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <PersonDialog open onOpenChange={onOpenChange} />,
      { withProviders: false },
    );
    await user.click(screen.getByTestId('submit-btn'));
    await waitFor(() => {
      expect(mockCreatePerson).toHaveBeenCalled();
    });
    expect(mockSuccessToast).toHaveBeenCalledWith('persons.createSuccess');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls updatePerson and closes dialog on submit in edit mode', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <PersonDialog personId={'p1' as PersonId} open onOpenChange={onOpenChange} />,
      { withProviders: false },
    );
    await user.click(screen.getByTestId('submit-btn'));
    await waitFor(() => {
      expect(mockUpdatePerson).toHaveBeenCalledWith('p1', expect.anything());
    });
    expect(mockSuccessToast).toHaveBeenCalledWith('persons.updateSuccess');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('syncs single existing assignment dates when stay dates are edited', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    mockGetAssignmentsByPerson.mockReturnValue([
      {
        id: 'a1',
        tripId: 't1',
        roomId: 'r1',
        personId: 'p1',
        startDate: '2026-04-20',
        endDate: '2026-04-24',
      },
    ]);

    render(
      <PersonDialog personId={'p1' as PersonId} open onOpenChange={vi.fn()} />,
      { withProviders: false },
    );

    await user.click(screen.getByTestId('submit-btn'));

    await waitFor(() => {
      expect(mockUpdateAssignment).toHaveBeenCalledWith('a1', {
        startDate: '2026-04-22',
        endDate: '2026-04-25',
      });
    });
  });

  it('shows discard confirm when cancel is clicked on dirty form', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <PersonDialog open onOpenChange={onOpenChange} />,
      { withProviders: false },
    );
    // Mark form as dirty
    await user.click(screen.getByTestId('dirty-btn'));
    // Cancel — should show discard confirmation
    await user.click(screen.getByTestId('cancel-btn'));
    expect(screen.getByText('unsaved.discardChanges')).toBeInTheDocument();
    // onOpenChange should NOT have been called yet
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('confirms discard and closes dialog', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <PersonDialog open onOpenChange={onOpenChange} />,
      { withProviders: false },
    );
    // Mark dirty
    await user.click(screen.getByTestId('dirty-btn'));
    // Cancel — opens discard dialog
    await user.click(screen.getByTestId('cancel-btn'));
    // Click discard button
    await user.click(screen.getByRole('button', { name: 'unsaved.discard' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders accessibility description in create mode', () => {
    render(
      <PersonDialog open onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('persons.newDescription')).toBeInTheDocument();
  });

  it('renders accessibility description in edit mode', () => {
    render(
      <PersonDialog personId={'p1' as PersonId} open onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('persons.editDescription')).toBeInTheDocument();
  });
});
