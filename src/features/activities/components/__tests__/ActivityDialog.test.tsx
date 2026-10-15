import { describe, expect, it, vi, beforeEach } from 'vitest';
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

const mockCreateActivity = vi.fn().mockResolvedValue(undefined);
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

vi.mock('@/features/activities/components/ActivityForm', () => ({
  ActivityForm: ({
    activity,
    defaultDate,
    onCancel,
    onSubmit,
    onDirtyChange,
  }: {
    activity?: Activity;
    defaultDate?: ISODateString;
    onCancel: () => void;
    onSubmit: (data: ActivityFormData) => Promise<void>;
    onDirtyChange?: (dirty: boolean) => void;
  }) => (
    <div data-testid="activity-form">
      {activity ? (
        <span data-testid="edit-mode">{activity.title}</span>
      ) : (
        <span data-testid="create-mode">New</span>
      )}
      <span data-testid="default-date">{defaultDate ?? 'none'}</span>
      <button data-testid="cancel-btn" onClick={onCancel}>
        Cancel
      </button>
      <button data-testid="submit-btn" onClick={() => void onSubmit(submittedData)}>
        Submit
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
    });
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
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
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
});
