/**
 * @fileoverview Tests for ActivityForm.
 * @module features/activities/components/__tests__/ActivityForm.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isoDate, render, screen } from '@/test/utils';
import type { Activity, ActivityFormData, Person } from '@/types';

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
    id?: string;
    value: string;
    onChange: (loc: string) => void;
  }) => (
    <input
      id={id}
      data-testid="location-picker"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import { ActivityForm } from '../ActivityForm';

// ============================================================================
// Helpers
// ============================================================================

function renderForm(props: Partial<Parameters<typeof ActivityForm>[0]> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();

  const result = render(
    <ActivityForm
      persons={mockPersons}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...props}
    />,
    { withProviders: false },
  );

  return { ...result, onSubmit, onCancel };
}

/** Reads the single call's payload from a mocked onSubmit. */
function submittedData(onSubmit: ReturnType<typeof vi.fn>): ActivityFormData {
  return onSubmit.mock.calls[0]![0] as ActivityFormData;
}

// ============================================================================
// Tests
// ============================================================================

describe('ActivityForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the core fields', () => {
    renderForm();

    expect(screen.getByLabelText(/activities.title_field/)).toBeInTheDocument();
    expect(screen.getByLabelText(/activities.start/)).toBeInTheDocument();
    expect(screen.getByLabelText('activities.end')).toBeInTheDocument();
    expect(screen.getByLabelText('activities.allDay')).toBeInTheDocument();
    expect(screen.getByLabelText('activities.notes')).toBeInTheDocument();
  });

  it('blocks submission and flags the title when it is empty', async () => {
    const { user, onSubmit } = renderForm();

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('common.required');
  });

  it('submits a timed activity with an ISO start and end', async () => {
    const { user, onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/activities.title_field/), 'Plant fair');
    await user.type(screen.getByLabelText(/activities.start/), '2026-07-16T09:00');
    await user.type(screen.getByLabelText('activities.end'), '2026-07-16T12:00');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const data = submittedData(onSubmit);
    expect(data.title).toBe('Plant fair');
    expect(data.allDay).toBe(false);
    // The stored value is the *UTC instant* of the wall clock that was typed,
    // not the offset-less string. Activities are ordered as plain strings by
    // the `[tripId+startDatetime]` index, so a naive `2026-07-16T09:00:00`
    // stored next to a `…Z` value silently breaks the agenda's ordering — and
    // `getHours() === 9` holds for either of them.
    expect(data.startDatetime).toBe(new Date(2026, 6, 16, 9, 0).toISOString());
    expect(data.endDatetime).toBe(new Date(2026, 6, 16, 12, 0).toISOString());
    expect(data.startDatetime.endsWith('Z')).toBe(true);
  });

  it('rejects an end before the start', async () => {
    const { user, onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/activities.title_field/), 'Backwards');
    await user.type(screen.getByLabelText(/activities.start/), '2026-07-16T12:00');
    await user.type(screen.getByLabelText('activities.end'), '2026-07-16T09:00');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText('activities.errors.endBeforeStart'),
    ).toBeInTheDocument();
  });

  it('switches to whole-day inputs and stores the day boundaries', async () => {
    const { user, onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/activities.title_field/), 'Festival');
    await user.type(screen.getByLabelText(/activities.start/), '2026-07-16T09:00');
    await user.click(screen.getByLabelText('activities.allDay'));

    // The day carries over from the timed input, so nothing is retyped
    expect(screen.getByLabelText(/activities.start/)).toHaveValue('2026-07-16');

    await user.type(screen.getByLabelText('activities.end'), '2026-07-18');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    const data = submittedData(onSubmit);
    expect(data.allDay).toBe(true);

    // A whole-day activity is stored as a real instant range snapped to the
    // *local* day boundaries — down to the last millisecond, so that "is it
    // over?" is answered by an instant comparison and not a date-only path.
    // Reading back only the hour and the day number let the 23:59:59.999 end
    // drift to any minute of the last hour.
    expect(data.startDatetime).toBe(new Date(2026, 6, 16, 0, 0, 0, 0).toISOString());
    expect(data.endDatetime).toBe(new Date(2026, 6, 18, 23, 59, 59, 999).toISOString());
  });

  it('prefills the start day from defaultDate', () => {
    renderForm({ defaultDate: isoDate('2026-07-20') });

    expect(screen.getByLabelText(/activities.start/)).toHaveValue('2026-07-20T10:00');
  });

  it('toggles participants on and off', async () => {
    const { user, onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/activities.title_field/), 'Hike');
    await user.type(screen.getByLabelText(/activities.start/), '2026-07-16T09:00');

    const alice = screen.getByRole('button', { name: /Alice/ });
    await user.click(alice);
    expect(alice).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: /Bob/ }));
    await user.click(alice);
    expect(alice).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(submittedData(onSubmit).participantIds).toEqual(['p2']);
  });

  it('rejects a seat cap below the number of sign-ups', async () => {
    const { user, onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/activities.title_field/), 'Car trip');
    await user.type(screen.getByLabelText(/activities.start/), '2026-07-16T09:00');
    await user.click(screen.getByRole('button', { name: /Alice/ }));
    await user.click(screen.getByRole('button', { name: /Bob/ }));
    await user.type(screen.getByLabelText('activities.maxParticipants'), '1');

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText('activities.errors.capBelowParticipants'),
    ).toBeInTheDocument();
  });

  it('pre-fills every field when editing', () => {
    const activity: Activity = {
      id: 'a1' as Activity['id'],
      tripId: 't1' as Activity['tripId'],
      title: 'Existing fair',
      category: 'market',
      startDatetime: new Date(2026, 6, 16, 9, 0).toISOString(),
      endDatetime: new Date(2026, 6, 16, 12, 0).toISOString(),
      allDay: false,
      location: 'Old town',
      notes: 'Bring cash',
      participantIds: ['p1' as Person['id']],
      maxParticipants: 4,
    };

    renderForm({ activity });

    expect(screen.getByLabelText(/activities.title_field/)).toHaveValue('Existing fair');
    expect(screen.getByLabelText(/activities.start/)).toHaveValue('2026-07-16T09:00');
    expect(screen.getByLabelText('activities.end')).toHaveValue('2026-07-16T12:00');
    expect(screen.getByTestId('location-picker')).toHaveValue('Old town');
    expect(screen.getByLabelText('activities.notes')).toHaveValue('Bring cash');
    expect(screen.getByLabelText('activities.maxParticipants')).toHaveValue(4);
    expect(screen.getByRole('button', { name: /Alice/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('reports the dirty state to the parent', async () => {
    const onDirtyChange = vi.fn();
    const { user } = renderForm({ onDirtyChange });

    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    await user.type(screen.getByLabelText(/activities.title_field/), 'X');

    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('calls onCancel from the cancel button', async () => {
    const { user, onCancel } = renderForm();

    await user.click(screen.getByRole('button', { name: 'common.cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
