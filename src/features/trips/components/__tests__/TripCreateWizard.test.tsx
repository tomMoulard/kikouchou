/**
 * @fileoverview The first-trip wizard: a name, the dates, then the invite link.
 *
 * @module features/trips/components/__tests__/TripCreateWizard.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { format } from 'date-fns';

import { TripCreateWizard } from '../TripCreateWizard';
import { createTripWithDetails } from '../../lib/create-trip-with-details';
import {
  forgetPendingInvite,
  rememberPendingInvite,
} from '@/features/sharing/utils/pending-invite';
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

// The panel has its own tests. Here it only has to say what it was given and
// let a test move it from one link state to the next.
vi.mock('@/features/sharing/components/ShareLinkPanel', () => ({
  ShareLinkPanel: (props: {
    trip: { id: string };
    active: boolean;
    signIn: string;
    withShareSheet: boolean;
    onStateChange: (kind: string) => void;
  }) => (
    <div data-testid="share-link-panel">
      <output>{`${props.trip.id} ${String(props.active)} ${props.signIn} ${String(props.withShareSheet)}`}</output>
      {['needs-account', 'invite', 'loading'].map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => {
            props.onStateChange(kind);
          }}
        >
          {`link ${kind}`}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@/features/sharing/utils/pending-invite', () => ({
  rememberPendingInvite: vi.fn(),
  forgetPendingInvite: vi.fn(),
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

function outcome() {
  return {
    trip: CREATED_TRIP,
    selfPersonId: undefined,
    counts: { guests: 0, importedGuests: 0, rooms: 0, importedRooms: false },
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
  location: '  Chamonix  ',
  coordinates: { lat: 45.9237, lon: 6.8694 },
  currency: 'EUR',
  rooms: [{ name: 'Attic', capacity: 4, icon: 'bunk-bed' as const }],
};

function renderTemplateWizard(): ReturnType<typeof render> {
  return render(
    <TripCreateWizard prefill={PREFILL} onCreated={onCreated} onCancel={onCancel} />,
  );
}

/** Answers the name and lands on the dates, the last question. */
async function answerName(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Trip name'), 'Lake house{Enter}');
  await screen.findByText('When is it?');
}

/** Answers both questions and creates the trip. */
async function createTrip(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await answerName(user);
  await user.click(screen.getByRole('button', { name: 'Trip dates' }));
  await user.click(screen.getByRole('button', { name: 'Create the trip' }));
}

/** Creates the trip and waits for the invite screen. */
async function reachInvite(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await createTrip(user);
  return screen.findByTestId('trip-wizard-invite');
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

  it('will not create the trip without both dates', async () => {
    const user = userEvent.setup();
    renderWizard();
    await answerName(user);

    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Pick the first and the last day');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('counts the link as a step of its own', async () => {
    const user = userEvent.setup();
    renderWizard();

    expect(screen.getByRole('list', { name: 'Step 1 of 3' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Trip name'), 'Lake house{Enter}');

    expect(screen.getByRole('list', { name: 'Step 2 of 3' })).toBeInTheDocument();
  });

  it('goes back a question, and leaves from the first one', async () => {
    const user = userEvent.setup();
    renderWizard();
    await answerName(user);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('What is the trip called?')).toBeInTheDocument();
    // The name typed is still there.
    expect(screen.getByLabelText('Trip name')).toHaveValue('Lake house');
    expect(capture).toHaveBeenCalledWith('trip_wizard_step', { step: 'dates', outcome: 'back' });

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('creates the trip from the dates, with no place, guest or room asked', async () => {
    const user = userEvent.setup();
    renderWizard();
    await createTrip(user);

    // Exactly these keys: nothing the wizard did not ask for is sent empty.
    await waitFor(() => {
      expect(createdDraft()).toStrictEqual({
        form: { name: 'Lake house', startDate: '2026-07-15', endDate: '2026-07-22' },
        guests: [],
        rooms: [],
        importSourceTripId: null,
        // Selecting the trip would remount the route and lose the invite screen.
        selectAsCurrent: false,
      });
    });
    expect(await screen.findByTestId('trip-wizard-invite')).toBeInTheDocument();
    expect(capture).toHaveBeenCalledWith('trip_wizard_step', { step: 'dates', outcome: 'next' });
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

  it('puts the account holder on the guest list, and nobody else', async () => {
    const user = userEvent.setup();
    renderWizard('Tom');
    await createTrip(user);

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({ guests: [{ name: 'Tom', isSelf: true }] }),
      );
    });
  });

  it('trims the name, and will not take one that is only spaces', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.type(screen.getByLabelText('Trip name'), '   {Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Give the trip a name to continue.');

    await user.clear(screen.getByLabelText('Trip name'));
    await user.type(screen.getByLabelText('Trip name'), '  Lake house  {Enter}');
    await user.click(screen.getByRole('button', { name: 'Trip dates' }));
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({ form: expect.objectContaining({ name: 'Lake house' }) }),
      );
    });
  });

  it('creates the trip on Enter from the dates', async () => {
    const user = userEvent.setup();
    renderWizard();
    await answerName(user);
    await user.click(screen.getByRole('button', { name: 'Trip dates' }));

    fireEvent.submit(screen.getByTestId('trip-wizard'));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledTimes(1);
    });
  });

  it('says so and stays when the trip cannot be created', async () => {
    mockedCreate.mockRejectedValue(new Error('disk full'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    renderWizard();
    await createTrip(user);

    await expect(screen.findByRole('alert')).resolves.toHaveTextContent(
      'The trip could not be created.',
    );
    expect(screen.getByRole('button', { name: 'Create the trip' })).toBeEnabled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      'Wizard could not create the trip:',
      expect.any(Error),
    );
    consoleError.mockRestore();
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
    it("starts on the template's name and today, so Next alone reaches the link", async () => {
      const user = userEvent.setup();
      renderTemplateWizard();

      expect(screen.getByLabelText('Trip name')).toHaveValue('Chalet Marmotte');
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByText('When is it?');
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
      expect(await screen.findByTestId('trip-wizard-invite')).toBeInTheDocument();
    });

    it('lets the customer type over the name the template gave', async () => {
      const user = userEvent.setup();
      renderTemplateWizard();

      await user.clear(screen.getByLabelText('Trip name'));
      await user.click(screen.getByRole('button', { name: 'Next' }));

      expect(screen.getByRole('alert')).toHaveTextContent('Give the trip a name to continue.');
    });

    it('asks the same two questions as the ordinary wizard', () => {
      renderTemplateWizard();

      expect(screen.getByRole('list', { name: 'Step 1 of 3' })).toBeInTheDocument();
    });

    it('creates the trip with the template values and the answers', async () => {
      const user = userEvent.setup();
      renderTemplateWizard();

      await user.clear(screen.getByLabelText('Trip name'));
      await user.type(screen.getByLabelText('Trip name'), 'Ski week{Enter}');
      await user.click(screen.getByRole('button', { name: 'Trip dates' }));
      await user.click(screen.getByRole('button', { name: 'Create the trip' }));

      await waitFor(() => {
        expect(createdDraft()).toStrictEqual({
          form: {
            name: 'Ski week',
            startDate: '2026-07-15',
            endDate: '2026-07-22',
            location: 'Chamonix',
            coordinates: { lat: 45.9237, lon: 6.8694 },
            description: 'Check-in after 3pm.',
            currency: 'EUR',
          },
          guests: [],
          rooms: [{ name: 'Attic', capacity: 4, icon: 'bunk-bed' }],
          importSourceTripId: null,
          selectAsCurrent: false,
        });
      });
    });

    it('leaves out the fields a template left blank', async () => {
      const user = userEvent.setup();
      render(
        <TripCreateWizard
          prefill={{
            ...PREFILL,
            location: '   ',
            coordinates: undefined,
            description: null,
            currency: null,
          }}
          onCreated={onCreated}
          onCancel={onCancel}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await user.click(screen.getByRole('button', { name: 'Create the trip' }));

      await waitFor(() => {
        expect(mockedCreate).toHaveBeenCalledTimes(1);
      });
      expect(mockedCreate.mock.calls[0]?.[0].form).toStrictEqual({
        name: 'Chalet Marmotte',
        startDate: format(new Date(), 'yyyy-MM-dd'),
        endDate: format(new Date(), 'yyyy-MM-dd'),
      });
    });

    it('is counted apart from the ordinary wizard', async () => {
      const user = userEvent.setup();
      renderTemplateWizard();

      await user.click(screen.getByRole('button', { name: 'Next' }));
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
  });
});

// ============================================================================
// What each screen says and how it looks
// ============================================================================

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
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create the trip' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
  });

  it('marks the current step and fills the dots up to it', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.type(screen.getByLabelText('Trip name'), 'Lake house{Enter}');

    const dots = within(screen.getByRole('list', { name: 'Step 2 of 3' })).getAllByRole(
      'listitem',
    );
    expect(dots).toHaveLength(3);
    expect(dots.map((dot) => dot.getAttribute('aria-current'))).toEqual([null, 'step', null]);
    expect(dots[0]).toHaveClass('bg-primary', 'size-2.5');
    expect(dots[1]).toHaveClass('bg-primary');
    expect(dots[2]).toHaveClass('bg-muted-foreground/30');
    expect(dots[2]).not.toHaveClass('bg-primary');
    expect(dots[1]).not.toHaveClass('bg-muted-foreground/30');
    expect(dots[1]).toHaveTextContent('dates');
    expect(dots[2]).toHaveTextContent('invite');
  });

  it('words the dates screen, which creates the trip', async () => {
    const user = userEvent.setup();
    renderWizard();
    await answerName(user);

    expect(screen.getByRole('heading', { name: 'When is it?' })).toBeInTheDocument();
    expect(
      screen.getByText('First and last day. Guests can arrive and leave in between.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create the trip' })).toBeInTheDocument();
  });

  it('cancels the browser submit on every Enter', () => {
    renderWizard();

    expect(fireEvent.submit(screen.getByTestId('trip-wizard'))).toBe(false);
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
    await createTrip(user);

    expect(onCreating).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    fireEvent.submit(screen.getByTestId('trip-wizard'));
    expect(mockedCreate).toHaveBeenCalledTimes(1);

    await creation.finish();
    expect(await screen.findByTestId('trip-wizard-invite')).toBeInTheDocument();
  });

  it('clears the last failure as soon as it tries again', async () => {
    const user = userEvent.setup();
    mockedCreate.mockRejectedValueOnce(new Error('disk full'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderWizard();
    await createTrip(user);
    await screen.findByRole('alert');

    pendingCreation();
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('reports the counts of what it created', async () => {
    mockedCreate.mockResolvedValue({
      ...(outcome() as object),
      counts: { guests: 3, importedGuests: 1, rooms: 2, importedRooms: true },
    } as never);
    const user = userEvent.setup();
    renderWizard();
    await reachInvite(user);

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
    await createTrip(user);

    unmount();
    await creation.finish();

    expect(vi.mocked(captureUsage)).not.toHaveBeenCalled();
    expect(vi.mocked(announceStatus)).not.toHaveBeenCalled();
  });

  it('says nothing when the creation fails after it has left the screen', async () => {
    let fail: (error: Error) => void = () => {};
    mockedCreate.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    const { unmount } = renderWizard();
    await createTrip(user);

    unmount();
    await act(async () => {
      fail(new Error('disk full'));
    });

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('is no longer dirty once the trip exists', async () => {
    const user = userEvent.setup();
    renderWizard();
    await answerName(user);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole('button', { name: 'Trip dates' }));
    await user.click(screen.getByRole('button', { name: 'Create the trip' }));
    await screen.findByTestId('trip-wizard-invite');

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

// ============================================================================
// The invite screen
// ============================================================================

describe('TripCreateWizard invite screen', () => {
  it('words the screen and asks the panel for a link straight away', async () => {
    const user = userEvent.setup();
    renderWizard();
    await reachInvite(user);

    expect(screen.getByRole('heading', { name: 'Lake house is ready: invite the group' })).toHaveClass(
      'text-2xl',
      'font-display',
    );
    expect(
      screen.getByText(
        'Send this link. Each person adds their name and when they arrive, and the rooms fill in from there.',
      ),
    ).toHaveClass('text-muted-foreground');
    // The trip, asked for now, sign-in in place, with the share sheet.
    expect(screen.getByTestId('share-link-panel')).toHaveTextContent('trip-1 true inline true');
    expect(screen.queryByTestId('trip-wizard')).not.toBeInTheDocument();
  });

  it('remembers the trip while an account is asked for, and forgets it once the link is there', async () => {
    const user = userEvent.setup();
    renderWizard();
    await reachInvite(user);

    await user.click(screen.getByRole('button', { name: 'link needs-account' }));
    expect(vi.mocked(rememberPendingInvite)).toHaveBeenCalledWith('trip-1');
    expect(vi.mocked(forgetPendingInvite)).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'link loading' }));
    expect(vi.mocked(forgetPendingInvite)).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'link invite' }));
    expect(vi.mocked(forgetPendingInvite)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rememberPendingInvite)).toHaveBeenCalledTimes(1);
  });

  it('offers "later" while signed out, and opens the trip from it', async () => {
    const user = userEvent.setup();
    renderWizard();
    await reachInvite(user);
    await user.click(screen.getByRole('button', { name: 'link needs-account' }));

    expect(screen.queryByRole('button', { name: 'Open the calendar' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Later, open the trip' }));

    expect(onCreated).toHaveBeenCalledWith(CREATED_TRIP);
    expect(vi.mocked(forgetPendingInvite)).toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith('trip_wizard_step', { step: 'invite', outcome: 'skip' });
  });

  it('opens the calendar once the link is on screen, and counts it as a link handed over', async () => {
    const user = userEvent.setup();
    renderWizard();
    await reachInvite(user);
    await user.click(screen.getByRole('button', { name: 'link invite' }));

    await user.click(screen.getByRole('button', { name: 'Open the calendar' }));

    expect(onCreated).toHaveBeenCalledWith(CREATED_TRIP);
    expect(capture).toHaveBeenCalledWith('trip_wizard_step', { step: 'invite', outcome: 'next' });
  });

  it('throws confetti once, with its shape', async () => {
    const user = userEvent.setup();
    renderWizard();
    await reachInvite(user);

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
      await reachInvite(user);
      // Every lazy import the effect may have started has landed by now.
      await act(async () => {
        await vi.dynamicImportSettled();
      });

      expect(asked).toEqual(['(prefers-reduced-motion: reduce)']);
      expect(confetti).not.toHaveBeenCalled();
      // The announcement still happens; only the motion is skipped.
      expect(vi.mocked(announceStatus)).toHaveBeenCalled();
    });

    it('celebrates where the browser cannot say', async () => {
      Reflect.deleteProperty(window, 'matchMedia');
      const user = userEvent.setup();
      renderWizard();
      await reachInvite(user);

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
      await reachInvite(user);

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
      await reachInvite(user);

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
