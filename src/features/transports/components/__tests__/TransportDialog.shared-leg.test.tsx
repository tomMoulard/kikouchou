/**
 * TransportDialog: turning a save of a shared train into context calls.
 *
 * The form says what changed about the train; the dialog decides which writes
 * that takes and in which order.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, userEvent } from '@/test/utils';
import type { SharedLegChange } from '@/features/transports/components/TransportForm';
import type { Person, Transport, TransportFormData, TransportId } from '@/types';

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  createSharedTransports: vi.fn(),
  setTransportSharedLeg: vi.fn(),
  updateTransport: vi.fn(),
  calls: [] as string[],
  submission: {
    data: undefined as unknown,
    sharedLeg: undefined as unknown,
  },
}));

const aliceLeg: Transport = {
  id: 't-alice' as TransportId,
  tripId: 'trip1' as Transport['tripId'],
  personId: 'p1' as Transport['personId'],
  type: 'arrival',
  datetime: '2026-07-15T10:00:00Z' as Transport['datetime'],
  location: 'Gare de Lyon',
  needsPickup: false,
};

const persons: Person[] = [
  {
    id: 'p1' as Person['id'],
    tripId: 'trip1' as Person['tripId'],
    name: 'Alice',
    color: '#3b82f6' as Person['color'],
  },
];

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => ({
    transports: [aliceLeg],
    createTransport: mocks.createTransport,
    createSharedTransports: mocks.createSharedTransports,
    setTransportSharedLeg: mocks.setTransportSharedLeg,
    updateTransport: mocks.updateTransport,
  }),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({ persons }),
}));

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({ currentTrip: { id: 'trip1', name: 'Summer' } }),
}));

vi.mock('@/contexts/RideContext', () => ({
  useRideContext: () => ({ rides: [], vehicles: [] }),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({ notifySuccess: vi.fn(), errorToast: vi.fn() }),
}));

vi.mock('@/features/transports/components/TransportForm', () => ({
  TransportForm: ({
    onSubmit,
  }: {
    onSubmit: (data: unknown, sharedLeg?: unknown) => Promise<void>;
  }) => (
    <button
      type="button"
      onClick={() => {
        const { data, sharedLeg } = mocks.submission;
        void (sharedLeg === undefined ? onSubmit(data) : onSubmit(data, sharedLeg));
      }}
    >
      submit
    </button>
  ),
}));

import { TransportDialog } from '../TransportDialog';

const LEG: TransportFormData = {
  personId: 'p1' as TransportFormData['personId'],
  type: 'arrival',
  datetime: '2026-07-15T10:00:00Z' as TransportFormData['datetime'],
  location: 'Gare de Lyon',
  needsPickup: false,
};

function submitWith(data: TransportFormData, sharedLeg?: SharedLegChange): void {
  mocks.submission.data = data;
  mocks.submission.sharedLeg = sharedLeg;
}

beforeEach(() => {
  mocks.calls.length = 0;
  for (const name of [
    'createTransport',
    'createSharedTransports',
    'setTransportSharedLeg',
    'updateTransport',
  ] as const) {
    mocks[name].mockReset();
    mocks[name].mockImplementation((...args: unknown[]) => {
      mocks.calls.push(name);
      return Promise.resolve(name === 'setTransportSharedLeg' ? (args[1] ?? 'own-key') : undefined);
    });
  }
});

describe('TransportDialog on a shared train', () => {
  it('creates one leg per guest when companions are ticked', async () => {
    const user = userEvent.setup();
    submitWith(LEG, { addPersonIds: ['p2' as Person['id']], removeTransportIds: [] });
    render(<TransportDialog open onOpenChange={vi.fn()} />, { withProviders: false });

    await user.click(screen.getByText('submit'));

    expect(mocks.createSharedTransports).toHaveBeenCalledWith(
      {
        type: LEG.type,
        datetime: LEG.datetime,
        location: LEG.location,
        needsPickup: LEG.needsPickup,
        sharedLegId: undefined,
      },
      ['p1', 'p2'],
    );
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });

  it("creates the guest's leg on the train they picked", async () => {
    const user = userEvent.setup();
    submitWith(LEG, {
      join: 't-bob' as SharedLegChange['join'],
      addPersonIds: [],
      removeTransportIds: [],
    });
    render(<TransportDialog open onOpenChange={vi.fn()} />, { withProviders: false });

    await user.click(screen.getByText('submit'));

    expect(mocks.createSharedTransports).toHaveBeenCalledWith(
      expect.objectContaining({ sharedLegId: 't-bob' }),
      ['p1'],
    );
  });

  it('creates a plain leg when nobody else is on the train', async () => {
    const user = userEvent.setup();
    submitWith(LEG);
    render(<TransportDialog open onOpenChange={vi.fn()} />, { withProviders: false });

    await user.click(screen.getByText('submit'));

    expect(mocks.createTransport).toHaveBeenCalledWith(LEG);
    expect(mocks.createSharedTransports).not.toHaveBeenCalled();
  });

  it('moves the leg, saves it, then updates who else is on board', async () => {
    const user = userEvent.setup();
    submitWith(LEG, {
      join: 't-bob' as SharedLegChange['join'],
      addPersonIds: ['p3' as Person['id']],
      removeTransportIds: ['t-carol' as TransportId],
    });
    render(<TransportDialog transportId={aliceLeg.id} open onOpenChange={vi.fn()} />, {
      withProviders: false,
    });

    await user.click(screen.getByText('submit'));

    // The move goes first, so the save reaches the new train's guests.
    expect(mocks.calls).toEqual([
      'setTransportSharedLeg',
      'updateTransport',
      'setTransportSharedLeg',
      'createSharedTransports',
    ]);
    expect(mocks.setTransportSharedLeg).toHaveBeenNthCalledWith(1, 't-alice', 't-bob');
    expect(mocks.setTransportSharedLeg).toHaveBeenNthCalledWith(2, 't-carol', null);
    expect(mocks.createSharedTransports).toHaveBeenCalledWith(
      expect.objectContaining({ sharedLegId: 't-bob' }),
      ['p3'],
    );
  });

  it("adds companions to the leg's own train when it stays on it", async () => {
    const user = userEvent.setup();
    submitWith(LEG, { addPersonIds: ['p2' as Person['id']], removeTransportIds: [] });
    render(<TransportDialog transportId={aliceLeg.id} open onOpenChange={vi.fn()} />, {
      withProviders: false,
    });

    await user.click(screen.getByText('submit'));

    expect(mocks.setTransportSharedLeg).not.toHaveBeenCalled();
    expect(mocks.createSharedTransports).toHaveBeenCalledWith(
      expect.objectContaining({ sharedLegId: 't-alice' }),
      ['p2'],
    );
  });
});
