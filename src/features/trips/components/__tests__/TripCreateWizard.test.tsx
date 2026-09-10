/**
 * @fileoverview The first-trip wizard: five questions, Enter, Back, Skip, done.
 *
 * @module features/trips/components/__tests__/TripCreateWizard.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TripCreateWizard } from '../TripCreateWizard';
import { createTripWithDetails } from '../../lib/create-trip-with-details';
import { announceStatus } from '@/lib/notifications';
import posthog, { captureUsage } from '@/lib/posthog';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') {
        return fallback;
      }
      const options = fallback ?? {};
      const template = options.defaultValue;
      if (typeof template !== 'string') {
        return key;
      }
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options[name] ?? ''),
      );
    },
    i18n: { language: 'en' },
  }),
}));

// The picker is react-day-picker behind a popover; one button standing in
// for it keeps this file about the wizard. The real picker has its own tests.
vi.mock('@/components/shared/DateRangePicker', () => ({
  DateRangePicker: ({
    onChange,
    'aria-label': label,
  }: {
    onChange: (range: { from: Date; to: Date }) => void;
    'aria-label'?: string;
  }) => (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        onChange({ from: new Date(2026, 6, 15), to: new Date(2026, 6, 22) });
      }}
    >
      pick dates
    </button>
  ),
}));

vi.mock('../LocationAutocomplete', () => ({
  LocationAutocomplete: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      id={id}
      aria-label="Location"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  ),
}));

vi.mock('@/features/sharing/components/ShareDialog', () => ({
  ShareDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog">share</div> : null),
}));

const confetti = vi.fn();
vi.mock('canvas-confetti', () => ({ default: (...args: unknown[]) => confetti(...args) }));

vi.mock('../../lib/create-trip-with-details', () => ({ createTripWithDetails: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ announceStatus: vi.fn() }));
vi.mock('@/lib/posthog', () => ({
  default: { capture: vi.fn() },
  captureUsage: vi.fn(),
}));

const mockedCreate = vi.mocked(createTripWithDetails);
const capture = vi.mocked(posthog!.capture);

const CREATED_TRIP = {
  id: 'trip-1',
  shareId: 'share-1',
  name: 'Lake house',
  startDate: '2026-07-15',
  endDate: '2026-07-22',
};

function outcome(overrides: Partial<{ guests: number; rooms: number }> = {}) {
  return {
    trip: CREATED_TRIP,
    selfPersonId: undefined,
    counts: {
      guests: overrides.guests ?? 0,
      importedGuests: 0,
      rooms: overrides.rooms ?? 0,
      importedRooms: false,
    },
    warnings: [],
  } as never;
}

const onCreated = vi.fn();
const onCancel = vi.fn();
const onDirtyChange = vi.fn();

function renderWizard(currentUserName?: string): ReturnType<typeof render> {
  return render(
    <TripCreateWizard
      currentUserName={currentUserName}
      onCreated={onCreated}
      onCancel={onCancel}
      onDirtyChange={onDirtyChange}
    />,
  );
}

/** Answers the two required questions and lands on the place screen. */
async function answerNameAndDates(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Trip name'), 'Lake house{Enter}');
  await user.click(screen.getByRole('button', { name: 'Trip dates' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Where is the house?');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreate.mockResolvedValue(outcome());
});

// ============================================================================
// Tests
// ============================================================================

describe('TripCreateWizard', () => {
  it('asks one question at a time, and Enter answers it', async () => {
    const user = userEvent.setup();
    renderWizard();

    expect(screen.getByText('What is the trip called?')).toBeInTheDocument();
    expect(screen.queryByText('When is it?')).not.toBeInTheDocument();
    expect(capture).toHaveBeenCalledWith('trip_wizard_started');

    await user.type(screen.getByLabelText('Trip name'), 'Lake house{Enter}');

    expect(screen.getByText('When is it?')).toBeInTheDocument();
    expect(capture).toHaveBeenCalledWith('trip_wizard_step', { step: 'name', outcome: 'next' });
  });

  it('will not move on without a name, and says so', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Give the trip a name to continue.');
    expect(screen.getByText('What is the trip called?')).toBeInTheDocument();
  });

  it('will not move on without both dates', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.type(screen.getByLabelText('Trip name'), 'Lake house{Enter}');

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Pick the first and the last day');
  });

  it('shows the step count as progress', async () => {
    const user = userEvent.setup();
    renderWizard();

    expect(screen.getByRole('list', { name: 'Step 1 of 5' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Trip name'), 'Lake house{Enter}');

    expect(screen.getByRole('list', { name: 'Step 2 of 5' })).toBeInTheDocument();
  });

  it('goes back a question, and leaves from the first one', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.type(screen.getByLabelText('Trip name'), 'Lake house{Enter}');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('What is the trip called?')).toBeInTheDocument();
    // The name typed is still there.
    expect(screen.getByLabelText('Trip name')).toHaveValue('Lake house');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('lets everything after the dates be skipped, and creates the trip', async () => {
    const user = userEvent.setup();
    renderWizard();
    await answerNameAndDates(user);

    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByText('Who is coming?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByText('Which rooms are there?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith({
        form: { name: 'Lake house', startDate: '2026-07-15', endDate: '2026-07-22' },
        guests: [],
        rooms: [],
        importSourceTripId: null,
        // Selecting the trip would remount the route and lose the done screen.
        selectAsCurrent: false,
      });
    });
    expect(await screen.findByTestId('trip-wizard-done')).toHaveTextContent('Lake house is ready');
    expect(vi.mocked(captureUsage)).toHaveBeenCalledWith(
      'trip_created',
      expect.objectContaining({ via: 'wizard' }),
    );
    expect(vi.mocked(announceStatus)).toHaveBeenCalledWith('Trip Lake house created');
  });

  it('collects guests one Enter at a time, with the user first', async () => {
    const user = userEvent.setup();
    renderWizard('Tom');
    await answerNameAndDates(user);
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));

    // "You" is already on the list.
    expect(screen.getByText('Tom')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Guest name'), 'Alice{Enter}');
    await user.type(screen.getByLabelText('Guest name'), 'Bob{Enter}');
    // Still on the guests screen: Enter with a name adds; Enter empty moves on.
    expect(screen.getByText('Who is coming?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Bob' }));
    await user.type(screen.getByLabelText('Guest name'), '{Enter}');
    expect(screen.getByText('Which rooms are there?')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Room name'), 'Attic{Enter}');
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          guests: [{ name: 'Tom', isSelf: true }, { name: 'Alice' }],
          rooms: [{ name: 'Attic', capacity: 2, icon: 'bed-double' }],
        }),
      );
    });
  });

  it('carries the place typed on the place screen', async () => {
    const user = userEvent.setup();
    renderWizard();
    await answerNameAndDates(user);

    await user.type(screen.getByLabelText('Location'), 'Annecy{Enter}');
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({ form: expect.objectContaining({ location: 'Annecy' }) }),
      );
    });
  });

  it('celebrates on the done screen, then hands the trip over', async () => {
    const user = userEvent.setup();
    renderWizard();
    await answerNameAndDates(user);
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));
    await screen.findByTestId('trip-wizard-done');

    await waitFor(() => {
      expect(confetti).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole('button', { name: 'Share the trip' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open the calendar' }));
    expect(onCreated).toHaveBeenCalledWith(CREATED_TRIP);
  });

  it('keeps the confetti for people who asked for less motion', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => ({ matches: true }),
    });
    const user = userEvent.setup();
    renderWizard();
    await answerNameAndDates(user);
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));
    await screen.findByTestId('trip-wizard-done');

    // The announcement still happens; only the motion is skipped.
    expect(vi.mocked(announceStatus)).toHaveBeenCalled();
    expect(confetti).not.toHaveBeenCalled();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('says so and stays when the trip cannot be created', async () => {
    mockedCreate.mockRejectedValue(new Error('disk full'));
    const user = userEvent.setup();
    renderWizard();
    await answerNameAndDates(user);
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    await expect(screen.findByRole('alert')).resolves.toHaveTextContent(
      'The trip could not be created.',
    );
    expect(screen.getByRole('button', { name: 'Create the trip' })).toBeEnabled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('reports what it holds as unsaved changes', async () => {
    const user = userEvent.setup();
    renderWizard();

    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    await user.type(screen.getByLabelText('Trip name'), 'L');

    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });
});
