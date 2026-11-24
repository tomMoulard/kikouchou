import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
import type {
  Activity,
  ActivityFormData,
  ActivityId,
  ISODateString,
  ISODateTimeString,
  Person,
  PersonId,
  TripId,
} from '@/types';

const mockCreateActivity = vi.fn().mockResolvedValue({ id: 'new-0' });
const mockUpdateActivity = vi.fn().mockResolvedValue(undefined);
const mockSuccessToast = vi.fn();
const mockCaptureUsage = vi.fn();

const mockActivities: Activity[] = [
  {
    id: 'a1' as ActivityId,
    tripId: 't1' as TripId,
    title: 'Plant fair',
    category: 'horticulture',
    startDatetime: '2024-07-16T09:00:00.000Z' as ISODateTimeString,
    allDay: false,
    participantIds: ['p1' as PersonId],
  },
];

const mockPersons: Person[] = [];

vi.mock('@/contexts/ActivityContext', () => ({
  useActivityContext: () => ({
    activities: mockActivities,
    createActivity: mockCreateActivity,
    updateActivity: mockUpdateActivity,
  }),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({ persons: mockPersons }),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({
    notifySuccess: mockSuccessToast,
    errorToast: vi.fn(),
  }),
}));

const mockToggleParticipation = vi.fn().mockResolvedValue(true);
const mockActivityParticipation = vi.fn(() => ({
  myPersonId: undefined as PersonId | undefined,
  canToggle: false,
  toggleParticipation: mockToggleParticipation,
}));

// Answers how many guests it invited, as the real hook does.
const mockInvite = vi.fn(async (...args: unknown[]) => (args[1] as readonly string[]).length);
const invitations = { canInvite: false };

vi.mock('@/features/activities/hooks/useActivityInvitations', () => ({
  useActivityInvitations: () => ({
    myPersonId: undefined,
    canInvite: invitations.canInvite,
    invite: mockInvite,
    decline: vi.fn(async () => false),
  }),
}));

vi.mock('@/features/activities/hooks/useActivityParticipation', () => ({
  useActivityParticipation: () => mockActivityParticipation(),
}));

vi.mock('@/lib/posthog', () => ({
  captureUsage: (...args: unknown[]) => mockCaptureUsage(...args),
}));

/**
 * The real form owns a date picker, a category select and a participant list.
 * None of that is under test here — the dialog's own job is the mode split, the
 * unsaved-changes guard and what it does with a submitted payload — so the form
 * is replaced by three buttons that drive those three paths.
 */
const submittedData: ActivityFormData = {
  title: 'Plant fair',
  category: 'horticulture',
  startDatetime: '2024-07-16T09:00:00.000Z' as ISODateTimeString,
  allDay: false,
  participantIds: ['p1' as PersonId, 'p2' as PersonId],
};

const submittedWithInvites = {
  ...submittedData,
  invitedIds: ['p3' as PersonId, 'p4' as PersonId],
};

vi.mock('@/features/activities/components/ActivityForm', () => ({
  ActivityForm: ({
    activity,
    defaultDate,
    onCancel,
    onSubmit,
    onDirtyChange,
    allowInvitations,
  }: {
    activity?: Activity;
    defaultDate?: ISODateString;
    onCancel: () => void;
    onSubmit: (data: ActivityFormData & { invitedIds?: readonly PersonId[] }) => Promise<void>;
    onDirtyChange?: (dirty: boolean) => void;
    allowInvitations?: boolean;
  }) => (
    <div data-testid="activity-form">
      {activity ? (
        <span data-testid="edit-mode">{activity.title}</span>
      ) : (
        <span data-testid="create-mode">New</span>
      )}
      <span data-testid="default-date">{defaultDate ?? 'none'}</span>
      <span data-testid="allow-invitations">{String(allowInvitations ?? false)}</span>
      {/* Uncontrolled, so it only goes back to empty when the form remounts. */}
      <input data-testid="form-draft" defaultValue="" aria-label="draft" />
      <button data-testid="cancel-btn" onClick={onCancel}>
        Cancel
      </button>
      <button data-testid="submit-btn" onClick={() => void onSubmit(submittedData)}>
        Submit
      </button>
      <button data-testid="submit-invites-btn" onClick={() => void onSubmit(submittedWithInvites)}>
        Submit with invites
      </button>
      <button data-testid="dirty-btn" onClick={() => onDirtyChange?.(true)}>
        Mark Dirty
      </button>
    </div>
  ),
}));

import { ActivityDialog } from '../ActivityDialog';

describe('ActivityDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invitations.canInvite = false;
  });

  it('renders create mode when activityId is undefined', () => {
    render(<ActivityDialog open onOpenChange={vi.fn()} />, { withProviders: false });

    expect(screen.getByText('activities.new')).toBeInTheDocument();
    expect(screen.getByText('activities.newDescription')).toBeInTheDocument();
    expect(screen.getByTestId('create-mode')).toBeInTheDocument();
  });

  it('renders edit mode when activityId is provided', () => {
    render(<ActivityDialog activityId={'a1' as ActivityId} open onOpenChange={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.getByText('activities.edit')).toBeInTheDocument();
    expect(screen.getByText('activities.editDescription')).toBeInTheDocument();
    expect(screen.getByTestId('edit-mode')).toHaveTextContent('Plant fair');
  });

  it('shows the not-found message when the activity is gone in edit mode', () => {
    render(<ActivityDialog activityId={'gone' as ActivityId} open onOpenChange={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.getByText('activities.edit')).toBeInTheDocument();
    expect(screen.getByText('errors.activityNotFound')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-form')).not.toBeInTheDocument();
  });

  it('does not render when not open', () => {
    render(<ActivityDialog open={false} onOpenChange={vi.fn()} />, { withProviders: false });

    expect(screen.queryByText('activities.new')).not.toBeInTheDocument();
  });

  it('passes defaultDate to the form in create mode only', () => {
    const { unmount } = render(
      <ActivityDialog open onOpenChange={vi.fn()} defaultDate={'2024-07-16' as ISODateString} />,
      { withProviders: false },
    );
    expect(screen.getByTestId('default-date')).toHaveTextContent('2024-07-16');
    unmount();

    render(
      <ActivityDialog
        activityId={'a1' as ActivityId}
        open
        onOpenChange={vi.fn()}
        defaultDate={'2024-07-16' as ISODateString}
      />,
      { withProviders: false },
    );
    expect(screen.getByTestId('default-date')).toHaveTextContent('none');
  });

  it('creates the activity, reports it and closes on submit in create mode', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ActivityDialog open onOpenChange={onOpenChange} />, { withProviders: false });

    await user.click(screen.getByTestId('submit-btn'));

    await waitFor(() => {
      expect(mockCreateActivity).toHaveBeenCalledWith(submittedData);
    });
    expect(mockUpdateActivity).not.toHaveBeenCalled();
    expect(mockSuccessToast).toHaveBeenCalledWith('activities.createSuccess');
    expect(mockCaptureUsage).toHaveBeenCalledWith('activity_saved', {
      operation: 'created',
      category: 'horticulture',
      is_all_day: false,
      participant_count: 2,
      invited_count: 0,
    });
    expect(mockInvite).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('updates the activity, reports it and closes on submit in edit mode', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ActivityDialog activityId={'a1' as ActivityId} open onOpenChange={onOpenChange} />, {
      withProviders: false,
    });

    await user.click(screen.getByTestId('submit-btn'));

    await waitFor(() => {
      expect(mockUpdateActivity).toHaveBeenCalledWith('a1', submittedData);
    });
    expect(mockCreateActivity).not.toHaveBeenCalled();
    expect(mockSuccessToast).toHaveBeenCalledWith('activities.updateSuccess');
    expect(mockCaptureUsage).toHaveBeenCalledWith('activity_saved', {
      operation: 'updated',
      category: 'horticulture',
      is_all_day: false,
      participant_count: 2,
      invited_count: 0,
    });
    expect(mockInvite).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('offers invitations to the form in edit mode too', () => {
    invitations.canInvite = true;
    render(<ActivityDialog activityId={'a1' as ActivityId} open onOpenChange={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.getByTestId('allow-invitations')).toHaveTextContent('true');
  });

  it('saves the edit without the invited guests, then invites them, in one confirmation', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    invitations.canInvite = true;
    render(<ActivityDialog activityId={'a1' as ActivityId} open onOpenChange={onOpenChange} />, {
      withProviders: false,
    });

    await user.click(screen.getByTestId('submit-invites-btn'));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(mockUpdateActivity).toHaveBeenCalledWith('a1', submittedData);
    expect(mockInvite).toHaveBeenCalledWith('a1', ['p3', 'p4'], { quiet: true });
    expect(mockSuccessToast).toHaveBeenCalledTimes(1);
    expect(mockSuccessToast).toHaveBeenCalledWith('activities.updatedAndInvited');
  });

  it('offers invitations to the form in create mode, where this device may invite', () => {
    invitations.canInvite = true;
    render(<ActivityDialog open onOpenChange={vi.fn()} />, { withProviders: false });

    expect(screen.getByTestId('allow-invitations')).toHaveTextContent('true');
  });

  it('does not offer invitations where this device may not invite', () => {
    render(<ActivityDialog open onOpenChange={vi.fn()} />, { withProviders: false });

    expect(screen.getByTestId('allow-invitations')).toHaveTextContent('false');
  });

  it('creates the activity without the invited guests, then invites them to it', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    invitations.canInvite = true;
    mockCreateActivity.mockResolvedValueOnce({ ...submittedData, id: 'new-1', tripId: 't1' });
    render(<ActivityDialog open onOpenChange={onOpenChange} />, { withProviders: false });

    await user.click(screen.getByTestId('submit-invites-btn'));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    // The activity write never carries the invitations: `invite` writes them,
    // and tells the invited guests.
    expect(mockCreateActivity).toHaveBeenCalledWith(submittedData);
    expect(mockInvite).toHaveBeenCalledWith('new-1', ['p3', 'p4'], { quiet: true });
    // One confirmation for the save and the invitations together.
    expect(mockSuccessToast).toHaveBeenCalledTimes(1);
    expect(mockSuccessToast).toHaveBeenCalledWith('activities.createdAndInvited');
    expect(mockCreateActivity.mock.invocationCallOrder[0]).toBeLessThan(
      mockInvite.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mockCaptureUsage).toHaveBeenCalledWith('activity_saved', {
      operation: 'created',
      category: 'horticulture',
      is_all_day: false,
      participant_count: 2,
      invited_count: 2,
    });
  });

  it('confirms the save alone when no invitation went out', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    invitations.canInvite = true;
    // `invite` answers 0 when it failed (and reported it) or nobody was new.
    mockInvite.mockResolvedValueOnce(0);
    mockCreateActivity.mockResolvedValueOnce({ ...submittedData, id: 'new-2', tripId: 't1' });
    render(<ActivityDialog open onOpenChange={onOpenChange} />, { withProviders: false });

    await user.click(screen.getByTestId('submit-invites-btn'));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(mockSuccessToast).toHaveBeenCalledTimes(1);
    expect(mockSuccessToast).toHaveBeenCalledWith('activities.createSuccess');
  });

  it('closes straight away when cancel is clicked on a clean form', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ActivityDialog open onOpenChange={onOpenChange} />, { withProviders: false });

    await user.click(screen.getByTestId('cancel-btn'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText('unsaved.discardChanges')).not.toBeInTheDocument();
  });

  it('asks before throwing away an unsaved edit', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ActivityDialog open onOpenChange={onOpenChange} />, { withProviders: false });

    await user.click(screen.getByTestId('dirty-btn'));
    await user.click(screen.getByTestId('cancel-btn'));

    expect(screen.getByText('unsaved.discardChanges')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('closes the dialog once the discard is confirmed', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ActivityDialog open onOpenChange={onOpenChange} />, { withProviders: false });

    await user.click(screen.getByTestId('dirty-btn'));
    await user.click(screen.getByTestId('cancel-btn'));
    await user.click(screen.getByRole('button', { name: 'unsaved.discard' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the edit when the discard prompt is dismissed', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ActivityDialog open onOpenChange={onOpenChange} />, { withProviders: false });

    await user.click(screen.getByTestId('dirty-btn'));
    await user.click(screen.getByTestId('cancel-btn'));
    await user.click(screen.getByRole('button', { name: 'unsaved.keepEditing' }));

    await waitFor(() => {
      expect(screen.queryByText('unsaved.discardChanges')).not.toBeInTheDocument();
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('activity-form')).toBeInTheDocument();
  });

  it('clears the dirty flag when the dialog is reopened', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(<ActivityDialog open onOpenChange={onOpenChange} />, {
      withProviders: false,
    });

    await user.click(screen.getByTestId('dirty-btn'));
    rerender(<ActivityDialog open={false} onOpenChange={onOpenChange} />);
    rerender(<ActivityDialog open onOpenChange={onOpenChange} />);

    await user.click(screen.getByTestId('cancel-btn'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText('unsaved.discardChanges')).not.toBeInTheDocument();
  });

  describe('joining or leaving in one tap', () => {
    const renderEdit = () =>
      render(<ActivityDialog activityId={'a1' as ActivityId} open onOpenChange={vi.fn()} />, {
        withProviders: false,
      });

    const asGuest = (personId: string) => {
      mockActivityParticipation.mockReturnValue({
        myPersonId: personId as PersonId,
        canToggle: true,
        toggleParticipation: mockToggleParticipation,
      });
    };

    beforeEach(() => {
      mockToggleParticipation.mockResolvedValue(true);
    });

    afterEach(() => {
      mockActivityParticipation.mockReturnValue({
        myPersonId: undefined,
        canToggle: false,
        toggleParticipation: mockToggleParticipation,
      });
    });

    it('signs the guest up without saving the form, then reloads the form', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      asGuest('p2');
      renderEdit();

      await user.type(screen.getByTestId('form-draft'), 'stale');
      await user.click(screen.getByRole('button', { name: 'activities.join' }));

      expect(mockToggleParticipation).toHaveBeenCalledWith('a1', true);
      expect(mockUpdateActivity).not.toHaveBeenCalled();
      // Remounted: the form re-reads the activity and its new participant list.
      await waitFor(() => {
        expect(screen.getByTestId('form-draft')).toHaveValue('');
      });
    });

    it('offers to leave an activity the guest is already on', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      asGuest('p1');
      renderEdit();

      await user.click(screen.getByRole('button', { name: 'activities.leave' }));

      expect(mockToggleParticipation).toHaveBeenCalledWith('a1', false);
    });

    it('keeps the form as it was when the sign-up could not be saved', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      mockToggleParticipation.mockResolvedValue(false);
      asGuest('p2');
      renderEdit();

      await user.type(screen.getByTestId('form-draft'), 'kept');
      await user.click(screen.getByRole('button', { name: 'activities.join' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'activities.join' })).toBeEnabled();
      });
      expect(screen.getByTestId('form-draft')).toHaveValue('kept');
    });

    it('waits for unsaved edits to be saved or dropped first', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      asGuest('p2');
      renderEdit();

      await user.click(screen.getByTestId('dirty-btn'));

      expect(screen.getByRole('button', { name: 'activities.join' })).toBeDisabled();
    });

    it('is not offered when creating an activity or when the device is anonymous', () => {
      asGuest('p2');
      const { unmount } = render(<ActivityDialog open onOpenChange={vi.fn()} />, {
        withProviders: false,
      });
      expect(screen.queryByRole('button', { name: 'activities.join' })).not.toBeInTheDocument();
      unmount();

      mockActivityParticipation.mockReturnValue({
        myPersonId: undefined,
        canToggle: false,
        toggleParticipation: mockToggleParticipation,
      });
      renderEdit();
      expect(screen.queryByRole('button', { name: 'activities.join' })).not.toBeInTheDocument();
    });
  });
});
