/**
 * @fileoverview The first-trip wizard: five questions, Enter, Back, Skip, done.
 *
 * @module features/trips/components/__tests__/TripCreateWizard.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { format } from 'date-fns';

import { TripCreateWizard } from '../TripCreateWizard';
import { createTripWithDetails } from '../../lib/create-trip-with-details';
import { pushDataLayerEvent } from '@/lib/google-tag';
import { announceStatus } from '@/lib/notifications';
import { captureEvent, captureUsage } from '@/lib/posthog';

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
  LocationAutocomplete: (props: {
    id?: string;
    value: string;
    coordinates?: { lat: number; lon: number };
    onChange: (value: string, coordinates?: { lat: number; lon: number }) => void;
    onImportTrip: (data: {
      trip: { id: string; location?: string; coordinates?: { lat: number; lon: number } };
      rooms: never[];
    }) => void;
  }) => (
    <div>
      <input
        id={props.id}
        aria-label="Location"
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
      {/* What the wizard handed down, so a test can read the pin back. */}
      <output data-testid="location-pin">
        {'coordinates' in props
          ? `${props.coordinates?.lat ?? 'none'},${props.coordinates?.lon ?? 'none'}`
          : 'no pin'}
      </output>
      <button
        type="button"
        onClick={() => {
          props.onChange('Annecy', { lat: 45.9, lon: 6.1 });
        }}
      >
        pick Annecy
      </button>
      <button
        type="button"
        onClick={() => {
          props.onImportTrip({
            trip: { id: 'old-trip', location: 'Biarritz', coordinates: { lat: 43.5, lon: -1.6 } },
            rooms: [],
          });
        }}
      >
        import Biarritz
      </button>
      <button
        type="button"
        onClick={() => {
          props.onImportTrip({ trip: { id: 'placeless-trip' }, rooms: [] });
        }}
      >
        import placeless
      </button>
    </div>
  ),
}));

vi.mock('@/features/sharing/components/ShareDialog', () => ({
  ShareDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog">share</div> : null),
}));

const confetti = vi.fn();
vi.mock('canvas-confetti', () => ({ default: (...args: unknown[]) => confetti(...args) }));

vi.mock('../../lib/create-trip-with-details', () => ({ createTripWithDetails: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ announceStatus: vi.fn() }));
vi.mock('@/lib/google-tag', () => ({ pushDataLayerEvent: vi.fn() }));
// One spy behind both shapes — see `TripLinkPage.test.tsx`.
vi.mock('@/lib/posthog', () => {
  const capture = vi.fn();
  return {
    default: { capture },
    captureEvent: capture,
    captureUsage: vi.fn(),
  // Named export used by every catch block that reports; a mock
  // without it makes the reporter itself the error under test.
  reportError: vi.fn(),
  };
});

const mockedCreate = vi.mocked(createTripWithDetails);
const capture = vi.mocked(captureEvent);

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

/** What a trip template hands the wizard. */
const PREFILL = {
  name: 'Chalet Marmotte',
  description: 'Check-in after 3pm.',
  location: 'Chamonix',
  coordinates: { lat: 45.9237, lon: 6.8694 },
  currency: 'EUR',
  rooms: [{ name: 'Attic', capacity: 4, icon: 'bunk-bed' as const }],
};

function renderTemplateWizard(): ReturnType<typeof render> {
  return render(
    <TripCreateWizard prefill={PREFILL} onCreated={onCreated} onCancel={onCancel} />,
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
    expect(vi.mocked(pushDataLayerEvent)).toHaveBeenCalledWith(
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
  // --------------------------------------------------------------------------
  // Behind a trip template link
  // --------------------------------------------------------------------------

  describe('with a template', () => {
    it("starts on the template's name and today, so Next alone reaches the guests", async () => {
      const user = userEvent.setup();
      renderTemplateWizard();

      expect(screen.getByLabelText('Trip name')).toHaveValue('Chalet Marmotte');
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByText('When is it?');
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByText('Who is coming?');
      await user.click(screen.getByRole('button', { name: 'Create the trip' }));

      const today = format(new Date(), 'yyyy-MM-dd');
      await waitFor(() => {
        expect(mockedCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            form: expect.objectContaining({
              name: 'Chalet Marmotte',
              startDate: today,
              endDate: today,
            }),
          }),
        );
      });
    });

    it('lets the customer type over the name the template gave', async () => {
      const user = userEvent.setup();
      renderTemplateWizard();

      await user.clear(screen.getByLabelText('Trip name'));
      await user.click(screen.getByRole('button', { name: 'Next' }));

      expect(screen.getByRole('alert')).toHaveTextContent('Give the trip a name to continue.');
    });

    it('asks three questions instead of five', async () => {
      const user = userEvent.setup();
      renderTemplateWizard();

      expect(screen.getByLabelText('Step 1 of 3')).toBeInTheDocument();

      await user.clear(screen.getByLabelText('Trip name'));
      await user.type(screen.getByLabelText('Trip name'), 'Ski week{Enter}');
      await user.click(screen.getByRole('button', { name: 'Trip dates' }));
      await user.click(screen.getByRole('button', { name: 'Next' }));

      // Straight to the guests: the place and the rooms came with the template.
      expect(await screen.findByText('Who is coming?')).toBeInTheDocument();
      expect(screen.queryByText('Where is the house?')).not.toBeInTheDocument();
    });

    it('creates the trip with the template values and the answers', async () => {
      const user = userEvent.setup();
      renderTemplateWizard();

      await user.clear(screen.getByLabelText('Trip name'));
      await user.type(screen.getByLabelText('Trip name'), 'Ski week{Enter}');
      await user.click(screen.getByRole('button', { name: 'Trip dates' }));
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByText('Who is coming?');
      await user.type(screen.getByLabelText('Guest name'), 'Alice{Enter}');
      await user.click(screen.getByRole('button', { name: 'Create the trip' }));

      await waitFor(() => {
        expect(mockedCreate).toHaveBeenCalledWith({
          form: {
            name: 'Ski week',
            startDate: '2026-07-15',
            endDate: '2026-07-22',
            location: 'Chamonix',
            coordinates: { lat: 45.9237, lon: 6.8694 },
            description: 'Check-in after 3pm.',
            currency: 'EUR',
          },
          guests: [{ name: 'Alice' }],
          rooms: [{ name: 'Attic', capacity: 4, icon: 'bunk-bed' }],
          importSourceTripId: null,
          selectAsCurrent: false,
        });
      });
    });

    it('is counted apart from the ordinary wizard', async () => {
      const user = userEvent.setup();
      renderTemplateWizard();

      await user.clear(screen.getByLabelText('Trip name'));
      await user.type(screen.getByLabelText('Trip name'), 'Ski week{Enter}');
      await user.click(screen.getByRole('button', { name: 'Trip dates' }));
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByText('Who is coming?');
      await user.click(screen.getByRole('button', { name: 'Create the trip' }));

      await waitFor(() => {
        expect(vi.mocked(captureUsage)).toHaveBeenCalledWith(
          'trip_created',
          expect.objectContaining({ via: 'template' }),
        );
        expect(vi.mocked(pushDataLayerEvent)).toHaveBeenCalledWith(
          'trip_created',
          expect.objectContaining({ via: 'template' }),
        );
      });
    });

    it('goes back through its own three questions', async () => {
      const user = userEvent.setup();
      renderTemplateWizard();

      await user.clear(screen.getByLabelText('Trip name'));
      await user.type(screen.getByLabelText('Trip name'), 'Ski week{Enter}');
      await user.click(screen.getByRole('button', { name: 'Back' }));

      expect(screen.getByLabelText('Step 1 of 3')).toBeInTheDocument();
    });
  });

});

// ============================================================================
// What each screen says and how it looks
// ============================================================================

/** Walks past the name, the dates and the place, onto the guests screen. */
async function goToGuests(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await answerNameAndDates(user);
  await user.click(screen.getByRole('button', { name: 'Skip for now' }));
  await screen.findByText('Who is coming?');
}

/** Walks on to the rooms screen, the last question. */
async function goToRooms(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await goToGuests(user);
  await user.click(screen.getByRole('button', { name: 'Skip for now' }));
  await screen.findByText('Which rooms are there?');
}

/** The single argument of the one `createTripWithDetails` call. */
function createdDraft(): unknown {
  expect(mockedCreate).toHaveBeenCalledTimes(1);
  return mockedCreate.mock.calls[0]?.[0];
}

/** A creation the test finishes by hand. */
function pendingCreation(): { finish: () => Promise<void> } {
  let settle: (value: never) => void = () => {};
  mockedCreate.mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  return {
    finish: async () => {
      await act(async () => {
        settle(outcome());
      });
    },
  };
}

describe('TripCreateWizard screens', () => {
  it('words the name screen and focuses its field', () => {
    renderWizard();

    expect(screen.getByRole('heading', { name: 'What is the trip called?' })).toHaveClass(
      'text-2xl',
    );
    expect(
      screen.getByText('The house, the town, the occasion, whatever the group calls it.'),
    ).toHaveClass('text-muted-foreground');
    const field = screen.getByLabelText('Trip name');
    expect(field).toHaveAttribute('placeholder', 'Summer at the lake house');
    expect(field).toHaveClass('h-12');
    expect(field).toHaveFocus();
    expect(screen.getByText('Trip name')).toHaveClass('sr-only');
    expect(screen.getByTestId('trip-wizard')).toHaveClass('space-y-6');
    // Nothing is wrong yet, and nothing can be skipped on the first screen.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument();
    expect(screen.queryByText('Who is coming?')).not.toBeInTheDocument();
    expect(screen.queryByText('Which rooms are there?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
  });

  it('marks the current step and fills the dots up to it', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.type(screen.getByLabelText('Trip name'), 'Lake house{Enter}');

    const dots = within(screen.getByRole('list', { name: 'Step 2 of 5' })).getAllByRole(
      'listitem',
    );
    expect(dots).toHaveLength(5);
    expect(dots.map((dot) => dot.getAttribute('aria-current'))).toEqual([
      null,
      'step',
      null,
      null,
      null,
    ]);
    expect(dots[0]).toHaveClass('bg-primary', 'size-2.5');
    expect(dots[1]).toHaveClass('bg-primary');
    expect(dots[2]).toHaveClass('bg-muted-foreground/30');
    expect(dots[2]).not.toHaveClass('bg-primary');
    expect(dots[1]).not.toHaveClass('bg-muted-foreground/30');
    expect(dots[1]).toHaveTextContent('dates');
  });

  it('words the dates screen, with no skip', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.type(screen.getByLabelText('Trip name'), 'Lake house{Enter}');

    expect(screen.getByRole('heading', { name: 'When is it?' })).toBeInTheDocument();
    expect(
      screen.getByText('First and last day. Guests can arrive and leave in between.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument();
  });

  it('words the place screen and hands it no pin until one is picked', async () => {
    const user = userEvent.setup();
    renderWizard();
    await answerNameAndDates(user);

    expect(screen.getByRole('heading', { name: 'Where is the house?' })).toBeInTheDocument();
    expect(
      screen.getByText('A town or an address. Pick a previous trip to reuse its rooms.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('location-pin')).toHaveTextContent('no pin');
    expect(screen.getByText('Location', { selector: 'label' })).toHaveClass('sr-only');

    await user.click(screen.getByRole('button', { name: 'pick Annecy' }));

    expect(screen.getByLabelText('Location')).toHaveValue('Annecy');
    expect(screen.getByTestId('location-pin')).toHaveTextContent('45.9,6.1');
  });

  it('words the guests screen, and lists nobody before a name is added', async () => {
    const user = userEvent.setup();
    renderWizard();
    await goToGuests(user);

    expect(screen.getByRole('heading', { name: 'Who is coming?' })).toBeInTheDocument();
    expect(
      screen.getByText('One name at a time, Enter after each. You can add more later.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Who is coming?' })).not.toBeInTheDocument();
    const field = screen.getByLabelText('Guest name');
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('placeholder', 'A first name');
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.queryByText('Which rooms are there?')).not.toBeInTheDocument();
  });

  it('shows each guest as a chip with a remove button, "you" marked', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const user = userEvent.setup();
    renderWizard('Tom');
    await goToGuests(user);
    await user.type(screen.getByLabelText('Guest name'), 'Alice{Enter}');
    await user.type(screen.getByLabelText('Guest name'), 'Alice{Enter}');

    const list = screen.getByRole('list', { name: 'Who is coming?' });
    const chips = within(list).getAllByRole('listitem');
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveClass('rounded-full', 'bg-card');
    expect(within(chips[0] as HTMLElement).getByText('You')).toHaveClass('bg-primary/10');
    expect(within(chips[1] as HTMLElement).queryByText('You')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Remove Alice' })[0]).toHaveClass('size-7');
    // Two guests may share a first name; each chip still has its own key.
    expect(
      consoleError.mock.calls.some((call) => String(call[0]).includes('same key')),
    ).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Remove Tom' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });

  it('adds a guest from the Add button and keeps the keyboard on the field', async () => {
    const user = userEvent.setup();
    renderWizard();
    await goToGuests(user);

    const add = screen.getByRole('button', { name: 'Add' });
    // Refusing the mousedown is what keeps a phone keyboard open.
    expect(fireEvent.mouseDown(add)).toBe(false);

    await user.type(screen.getByLabelText('Guest name'), 'Alice');
    await user.click(add);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByLabelText('Guest name')).toHaveValue('');
    expect(screen.getByLabelText('Guest name')).toHaveFocus();
  });

  it('trims a guest name and ignores one that is only spaces', async () => {
    const user = userEvent.setup();
    renderWizard();
    await goToGuests(user);

    await user.type(screen.getByLabelText('Guest name'), '  Alice  {Enter}');
    expect(screen.getByLabelText('Guest name')).toHaveValue('');
    // Spaces only: Enter moves on rather than adding a blank guest.
    await user.type(screen.getByLabelText('Guest name'), '   {Enter}');
    await screen.findByText('Which rooms are there?');
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({ guests: [{ name: 'Alice' }] }),
      );
    });
  });

  it('cuts a pasted guest name to the length a guest name may have', async () => {
    const user = userEvent.setup();
    renderWizard();
    await goToGuests(user);

    fireEvent.change(screen.getByLabelText('Guest name'), { target: { value: 'G'.repeat(150) } });
    await user.type(screen.getByLabelText('Guest name'), '{Enter}');
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({ guests: [{ name: 'G'.repeat(100) }] }),
      );
    });
  });

  it('words the rooms screen, and lists no room before one is added', async () => {
    const user = userEvent.setup();
    renderWizard();
    await goToRooms(user);

    expect(screen.getByRole('heading', { name: 'Which rooms are there?' })).toBeInTheDocument();
    expect(
      screen.getByText('Name and beds. Skip this and add rooms as you go.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Which rooms are there?' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Room name')).toHaveFocus();
    expect(screen.getByLabelText('Room name')).toHaveAttribute('placeholder', 'Master bedroom');
    expect(screen.getByLabelText('Beds')).toHaveValue(2);
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    // The last question creates the trip, so there is nothing left to skip.
    expect(screen.queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument();
    expect(screen.queryByText('Who is coming?')).not.toBeInTheDocument();
  });

  it('gives Enter a submit button on the rooms screen that nobody tabs to', async () => {
    const user = userEvent.setup();
    const { container } = renderWizard();
    await goToRooms(user);

    const hidden = container.querySelector('button[type="submit"][aria-hidden="true"]');
    expect(hidden).toHaveAttribute('tabindex', '-1');
    expect(hidden).toHaveClass('sr-only');
    expect(hidden).toHaveTextContent('Add');
  });

  it('adds rooms with their beds, resets the row, and removes one', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const user = userEvent.setup();
    renderWizard();
    await goToRooms(user);

    await user.type(screen.getByLabelText('Room name'), '  Attic  ');
    fireEvent.change(screen.getByLabelText('Beds'), { target: { value: '3' } });
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByLabelText('Room name')).toHaveValue('');
    expect(screen.getByLabelText('Beds')).toHaveValue(2);

    await user.type(screen.getByLabelText('Room name'), 'Attic{Enter}');

    const list = screen.getByRole('list', { name: 'Which rooms are there?' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Attic · 3 beds');
    expect(rows[0]).toHaveClass('rounded-lg', 'bg-card');
    expect(rows[1]).toHaveTextContent('Attic · 2 beds');
    expect(
      consoleError.mock.calls.some((call) => String(call[0]).includes('same key')),
    ).toBe(false);

    const removeButtons = screen.getAllByRole('button', { name: 'Remove Attic' });
    expect(removeButtons[0]).toHaveClass('size-8');
    await user.click(removeButtons[0] as HTMLElement);
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByRole('listitem')).toHaveTextContent('Attic · 2 beds');

    await user.click(screen.getByRole('button', { name: 'Create the trip' }));
    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({ rooms: [{ name: 'Attic', capacity: 2, icon: 'bed-double' }] }),
      );
    });
  });

  it('keeps a room to one bed at least, and cuts a pasted name', async () => {
    const user = userEvent.setup();
    renderWizard();
    await goToRooms(user);

    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'R'.repeat(150) } });
    fireEvent.change(screen.getByLabelText('Beds'), { target: { value: '0' } });
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          rooms: [{ name: 'R'.repeat(100), capacity: 1, icon: 'bed-double' }],
        }),
      );
    });
  });

  it('creates the trip on Enter in an empty room row', async () => {
    const user = userEvent.setup();
    renderWizard();
    await goToRooms(user);

    await user.type(screen.getByLabelText('Room name'), '   {Enter}');

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({ rooms: [] }));
    });
    expect(capture).toHaveBeenCalledWith('trip_wizard_step', { step: 'rooms', outcome: 'next' });
  });

  it('reports the create button as a next move', async () => {
    const user = userEvent.setup();
    renderWizard();
    await goToRooms(user);

    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    expect(capture).toHaveBeenCalledWith('trip_wizard_step', { step: 'rooms', outcome: 'next' });
  });

  it('does not add a half-typed guest from the rooms screen', async () => {
    const user = userEvent.setup();
    renderWizard();
    await goToGuests(user);
    // Typed but never added: Skip leaves it behind.
    await user.type(screen.getByLabelText('Guest name'), 'Zoe');
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await screen.findByText('Which rooms are there?');

    await user.type(screen.getByLabelText('Room name'), '{Enter}');

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({ guests: [] }));
    });
  });

  it('does not add a half-typed room from the guests screen', async () => {
    const user = userEvent.setup();
    renderWizard();
    await goToRooms(user);
    await user.type(screen.getByLabelText('Room name'), 'Barn');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByText('Who is coming?');

    await user.type(screen.getByLabelText('Guest name'), '{Enter}');

    // Enter on an empty guest row moves on; it does not add the room.
    expect(await screen.findByText('Which rooms are there?')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Which rooms are there?' })).not.toBeInTheDocument();
  });

  it('cancels the browser submit on every Enter', () => {
    renderWizard();

    expect(fireEvent.submit(screen.getByTestId('trip-wizard'))).toBe(false);
  });
});

describe('TripCreateWizard navigation', () => {
  it('reports every move with its outcome', async () => {
    const user = userEvent.setup();
    renderWizard();
    await answerNameAndDates(user);
    expect(capture).toHaveBeenCalledWith('trip_wizard_step', { step: 'dates', outcome: 'next' });

    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(capture).toHaveBeenCalledWith('trip_wizard_step', { step: 'place', outcome: 'skip' });

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(capture).toHaveBeenCalledWith('trip_wizard_step', { step: 'guests', outcome: 'back' });
  });

  it('goes back one question at a time, not to the start', async () => {
    const user = userEvent.setup();
    renderWizard();
    await answerNameAndDates(user);

    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByText('When is it?')).toBeInTheDocument();
  });

  it('clears a complaint once the question is answered', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('alert')).toHaveClass('text-destructive');

    await user.type(screen.getByLabelText('Trip name'), 'Lake house{Enter}');

    expect(screen.getByText('When is it?')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('will not take a name that is only spaces, and trims the one it takes', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.type(screen.getByLabelText('Trip name'), '   {Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Give the trip a name to continue.');

    await user.clear(screen.getByLabelText('Trip name'));
    await user.type(screen.getByLabelText('Trip name'), '  Lake house  {Enter}');
    await user.click(screen.getByRole('button', { name: 'Trip dates' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText('Location'), '   ');
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    // Exactly these keys: a blank place and no pin are left out, not sent empty.
    await waitFor(() => {
      expect(createdDraft()).toStrictEqual({
        form: { name: 'Lake house', startDate: '2026-07-15', endDate: '2026-07-22' },
        guests: [],
        rooms: [],
        importSourceTripId: null,
        selectAsCurrent: false,
      });
    });
  });

  it('trims the place, and drops the pin once the place is typed over', async () => {
    const user = userEvent.setup();
    renderWizard();
    await answerNameAndDates(user);
    await user.click(screen.getByRole('button', { name: 'pick Annecy' }));
    await user.type(screen.getByLabelText('Location'), '  ');
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    await waitFor(() => {
      expect(createdDraft()).toStrictEqual(
        expect.objectContaining({
          form: {
            name: 'Lake house',
            startDate: '2026-07-15',
            endDate: '2026-07-22',
            location: 'Annecy',
          },
        }),
      );
    });
  });

  it('sends the pin when the place is picked last', async () => {
    const user = userEvent.setup();
    renderWizard();
    await answerNameAndDates(user);
    await user.click(screen.getByRole('button', { name: 'pick Annecy' }));
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          form: expect.objectContaining({ location: 'Annecy', coordinates: { lat: 45.9, lon: 6.1 } }),
        }),
      );
    });
  });

  it('takes the place, the pin and the rooms source from a previous trip', async () => {
    const user = userEvent.setup();
    renderWizard();
    await answerNameAndDates(user);
    await user.click(screen.getByRole('button', { name: 'import Biarritz' }));
    expect(screen.getByLabelText('Location')).toHaveValue('Biarritz');
    expect(screen.getByTestId('location-pin')).toHaveTextContent('43.5,-1.6');
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          form: expect.objectContaining({
            location: 'Biarritz',
            coordinates: { lat: 43.5, lon: -1.6 },
          }),
          importSourceTripId: 'old-trip',
        }),
      );
    });
  });

  it('leaves the place empty when the previous trip had none', async () => {
    const user = userEvent.setup();
    renderWizard();
    await answerNameAndDates(user);
    await user.type(screen.getByLabelText('Location'), 'Somewhere');
    await user.click(screen.getByRole('button', { name: 'import placeless' }));

    expect(screen.getByLabelText('Location')).toHaveValue('');
  });

  it('asks the questions of the prefill it is given now', () => {
    const { rerender } = renderWizard();
    expect(screen.getByRole('list', { name: 'Step 1 of 5' })).toBeInTheDocument();

    rerender(<TripCreateWizard prefill={PREFILL} onCreated={onCreated} onCancel={onCancel} />);

    expect(screen.getByRole('list', { name: 'Step 1 of 3' })).toBeInTheDocument();
  });
});

describe('TripCreateWizard creating', () => {
  it('says it is creating and refuses a second Enter meanwhile', async () => {
    const creation = pendingCreation();
    const onCreating = vi.fn();
    const user = userEvent.setup();
    render(
      <TripCreateWizard onCreating={onCreating} onCreated={onCreated} onCancel={onCancel} />,
    );
    await goToRooms(user);

    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    expect(onCreating).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    await user.type(screen.getByLabelText('Room name'), '{Enter}');
    expect(mockedCreate).toHaveBeenCalledTimes(1);

    await creation.finish();
    expect(await screen.findByTestId('trip-wizard-done')).toBeInTheDocument();
  });

  it('clears the last failure as soon as it tries again', async () => {
    const user = userEvent.setup();
    mockedCreate.mockRejectedValueOnce(new Error('disk full'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderWizard();
    await goToRooms(user);
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));
    await screen.findByRole('alert');
    expect(consoleError).toHaveBeenCalledWith(
      'Wizard could not create the trip:',
      expect.any(Error),
    );

    pendingCreation();
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports the counts of what it created', async () => {
    mockedCreate.mockResolvedValue({
      ...(outcome() as object),
      counts: { guests: 3, importedGuests: 1, rooms: 2, importedRooms: true },
    } as never);
    const user = userEvent.setup();
    renderWizard();
    await goToRooms(user);
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));
    await screen.findByTestId('trip-wizard-done');

    expect(vi.mocked(captureUsage)).toHaveBeenCalledWith('trip_created', {
      via: 'wizard',
      imported_rooms: true,
      guest_count: 3,
      imported_guests: 1,
      room_count: 2,
    });
    expect(vi.mocked(pushDataLayerEvent)).toHaveBeenCalledWith('trip_created', {
      via: 'wizard',
      guest_count: 3,
      room_count: 2,
    });
  });

  it('says nothing and counts nothing when it has left the screen', async () => {
    const creation = pendingCreation();
    const user = userEvent.setup();
    const { unmount } = renderWizard();
    await goToRooms(user);
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    unmount();
    await creation.finish();

    expect(vi.mocked(captureUsage)).not.toHaveBeenCalled();
    expect(vi.mocked(announceStatus)).not.toHaveBeenCalled();
  });

  it('is no longer dirty once the trip exists', async () => {
    const user = userEvent.setup();
    renderWizard();
    await goToRooms(user);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole('button', { name: 'Create the trip' }));
    await screen.findByTestId('trip-wizard-done');

    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('counts template dates as unsaved even under an empty name', () => {
    render(
      <TripCreateWizard
        prefill={{ ...PREFILL, name: '' }}
        onCreated={onCreated}
        onCancel={onCancel}
        onDirtyChange={onDirtyChange}
      />,
    );

    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it("cuts a template's long name to the length a trip name may have", () => {
    render(
      <TripCreateWizard
        prefill={{ ...PREFILL, name: 'N'.repeat(150) }}
        onCreated={onCreated}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByLabelText('Trip name')).toHaveValue('N'.repeat(100));
  });
});

describe('TripCreateWizard done screen', () => {
  async function finish(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    await goToRooms(user);
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));
    return screen.findByTestId('trip-wizard-done');
  }

  it('words the done screen and opens the share dialog only on request', async () => {
    const user = userEvent.setup();
    renderWizard();
    const done = await finish(user);

    expect(done).toHaveClass('text-center');
    expect(screen.getByRole('heading', { name: 'Lake house is ready' })).toHaveClass('text-2xl');
    expect(
      screen.getByText(
        'Share the link and the others can see who sleeps where and who arrives when.',
      ),
    ).toHaveClass('text-muted-foreground');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('throws confetti once, with its shape', async () => {
    const user = userEvent.setup();
    renderWizard();
    await finish(user);

    await waitFor(() => {
      expect(confetti).toHaveBeenCalledWith({
        particleCount: 140,
        spread: 75,
        origin: { y: 0.65 },
      });
    });
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(confetti).toHaveBeenCalledTimes(1);
  });

  describe('and the motion preference', () => {
    let original: PropertyDescriptor | undefined;

    beforeEach(() => {
      original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    });

    afterEach(() => {
      if (original) {
        Object.defineProperty(window, 'matchMedia', original);
      } else {
        Reflect.deleteProperty(window, 'matchMedia');
      }
    });

    function setMatchMedia(value: unknown): void {
      Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value });
    }

    it('asks the browser about reduced motion, and only that', async () => {
      const asked: string[] = [];
      setMatchMedia((query: string) => {
        asked.push(query);
        return { matches: query === '(prefers-reduced-motion: reduce)' };
      });
      const user = userEvent.setup();
      renderWizard();
      await finish(user);
      // Every lazy import the effect may have started has landed by now.
      await act(async () => {
        await vi.dynamicImportSettled();
      });

      expect(asked).toEqual(['(prefers-reduced-motion: reduce)']);
      expect(confetti).not.toHaveBeenCalled();
    });

    it('celebrates where the browser cannot say', async () => {
      Reflect.deleteProperty(window, 'matchMedia');
      const user = userEvent.setup();
      renderWizard();
      await finish(user);

      await waitFor(() => {
        expect(confetti).toHaveBeenCalledTimes(1);
      });
    });

    it('celebrates where asking the browser fails', async () => {
      setMatchMedia(() => {
        throw new Error('blocked');
      });
      const user = userEvent.setup();
      renderWizard();
      await finish(user);

      await waitFor(() => {
        expect(confetti).toHaveBeenCalledTimes(1);
      });
    });
  });

  it('throws no confetti once the screen is gone', async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    vi.doMock('canvas-confetti', async () => {
      await gate;
      return { default: (...args: unknown[]) => confetti(...args) };
    });
    try {
      const user = userEvent.setup();
      const { unmount } = renderWizard();
      await finish(user);

      unmount();
      open();
      await act(async () => {
        await vi.dynamicImportSettled();
      });

      expect(confetti).not.toHaveBeenCalled();
    } finally {
      // A gate left in place would hang every later confetti test.
      open();
      vi.doUnmock('canvas-confetti');
    }
  });
});
