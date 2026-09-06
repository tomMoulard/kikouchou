/**
 * @fileoverview Tests for the "which guest am I?" settings card.
 *
 * The assertions go through `localStorage` rather than a mocked helper: the
 * key's shape is the contract every other reader of the guest identity depends
 * on — the share wizard writes it, the agenda reads it — so a card that stored
 * the right thing under the wrong key would pass a mock-level test and still
 * leave the app believing this browser is nobody.
 *
 * @module features/settings/components/__tests__/GuestIdentitySelector.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, userEvent } from '@/test/utils';
import type { Person, Trip } from '@/types';

// ============================================================================
// localStorage double
// ============================================================================

const entries = new Map<string, string>();

/** Set to make the next write throw, as a full quota or a locked store does. */
let storageThrows = false;

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    get length(): number {
      return entries.size;
    },
    clear: (): void => entries.clear(),
    getItem: (key: string): string | null => entries.get(key) ?? null,
    key: (index: number): string | null => [...entries.keys()][index] ?? null,
    removeItem: (key: string): void => {
      if (storageThrows) throw new DOMException('QuotaExceededError');
      entries.delete(key);
    },
    setItem: (key: string, value: string): void => {
      if (storageThrows) throw new DOMException('QuotaExceededError');
      entries.set(key, value);
    },
  } satisfies Storage,
});

/**
 * Radix's Select trigger calls `hasPointerCapture` on pointerdown and scrolls
 * the chosen item into view; jsdom implements neither, and the resulting
 * `TypeError` escapes as an uncaught exception rather than a failed assertion.
 * Without these the dropdown cannot be opened in a test at all.
 */
function installPointerCaptureShims(): () => void {
  const element = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  const shims: Record<string, () => unknown> = {
    hasPointerCapture: () => false,
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    scrollIntoView: () => undefined,
  };

  const absent = Object.keys(shims).filter((name) => !(name in element));
  const originals = Object.fromEntries(
    Object.keys(shims)
      .filter((name) => name in element)
      .map((name) => [name, element[name]]),
  );

  Object.assign(element, shims);

  return () => {
    Object.assign(element, originals);
    for (const name of absent) {
      Reflect.deleteProperty(element, name);
    }
  };
}

// ============================================================================
// Fixtures & mocks
// ============================================================================

const SHARE_KEY = 'kikouchou_guest_share-1';

const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  location: 'Paris',
  startDate: '2026-07-01' as Trip['startDate'],
  endDate: '2026-07-10' as Trip['endDate'],
  description: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const marie: Person = {
  id: 'person-marie' as Person['id'],
  tripId: mockTrip.id,
  name: 'Marie',
  color: '#ef4444' as Person['color'],
};

const paul: Person = {
  ...marie,
  id: 'person-paul' as Person['id'],
  name: 'Paul',
  color: '#3b82f6' as Person['color'],
};

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: vi.fn(),
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

// The card deliberately uses the raw sonner toast rather than the offline-aware
// one — the identity never leaves this device — so the raw one is what is
// observed here.
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

import { useTripContext } from '@/contexts/TripContext';
import { usePersonContext } from '@/contexts/PersonContext';

import { GuestIdentitySelector } from '../GuestIdentitySelector';

/**
 * Points the two mocked contexts at a trip and a guest list.
 */
function setContexts(
  options: {
    readonly trip?: Trip | null;
    readonly persons?: readonly Person[];
    readonly isLoading?: boolean;
  } = {},
): void {
  const { trip = mockTrip, persons = [marie, paul], isLoading = false } = options;

  vi.mocked(useTripContext).mockReturnValue({
    currentTrip: trip,
  } as ReturnType<typeof useTripContext>);

  vi.mocked(usePersonContext).mockReturnValue({
    persons,
    isLoading,
  } as ReturnType<typeof usePersonContext>);
}

/**
 * Opens the picker and chooses the option with the given accessible name.
 */
async function choose(optionName: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'settings.guestIdentity' }));
  await user.click(await screen.findByRole('option', { name: optionName }));
}

// ============================================================================
// Tests
// ============================================================================

describe('GuestIdentitySelector', () => {
  let restoreShims: () => void;

  beforeAll(() => {
    restoreShims = installPointerCaptureShims();
  });

  afterAll(() => {
    restoreShims();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    entries.clear();
    storageThrows = false;
    setContexts();
  });

  it('shows the guest this browser already is', () => {
    entries.set(SHARE_KEY, JSON.stringify({ personId: marie.id, tripId: mockTrip.id }));

    render(<GuestIdentitySelector />, { withProviders: false });

    expect(screen.getByText('settings.guestIdentityCurrent')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'settings.guestIdentity' })).toHaveTextContent(
      'Marie',
    );
  });

  it('offers "nobody in particular" when this browser has no identity yet', () => {
    render(<GuestIdentitySelector />, { withProviders: false });

    expect(screen.getByRole('combobox', { name: 'settings.guestIdentity' })).toHaveTextContent(
      'settings.guestIdentityNone',
    );
    expect(screen.queryByText('settings.guestIdentityCurrent')).not.toBeInTheDocument();
  });

  it('stores the chosen guest under the trip share key', async () => {
    render(<GuestIdentitySelector />, { withProviders: false });

    await choose('Paul');

    expect(JSON.parse(entries.get(SHARE_KEY) ?? '{}')).toEqual({
      personId: paul.id,
      tripId: mockTrip.id,
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('settings.guestIdentityChanged');
    expect(screen.getByText('settings.guestIdentityCurrent')).toBeInTheDocument();
  });

  it('removes the key when the user is nobody in particular', async () => {
    entries.set(SHARE_KEY, JSON.stringify({ personId: marie.id, tripId: mockTrip.id }));

    render(<GuestIdentitySelector />, { withProviders: false });

    await choose('settings.guestIdentityNone');

    // Absent, not blanked: a stored identity with an empty personId still
    // parses, so every other reader would go on believing this browser is
    // somebody.
    expect(entries.has(SHARE_KEY)).toBe(false);
    expect(mockToastSuccess).toHaveBeenCalledWith('settings.guestIdentityCleared');
    expect(screen.queryByText('settings.guestIdentityCurrent')).not.toBeInTheDocument();
  });

  it('warns instead of saving when storage refuses the write', async () => {
    render(<GuestIdentitySelector />, { withProviders: false });
    storageThrows = true;

    await choose('Paul');

    expect(entries.has(SHARE_KEY)).toBe(false);
    expect(mockToastError).toHaveBeenCalledWith('sharing.identityStorageFailed');
    expect(mockToastSuccess).not.toHaveBeenCalled();
    // The picker must not claim a choice that was never persisted.
    expect(screen.queryByText('settings.guestIdentityCurrent')).not.toBeInTheDocument();
  });

  it('says so when the stored guest is no longer on the trip', () => {
    entries.set(
      SHARE_KEY,
      JSON.stringify({ personId: 'person-removed', tripId: mockTrip.id }),
    );

    render(<GuestIdentitySelector />, { withProviders: false });

    expect(screen.getByText('settings.guestIdentityMissing')).toBeInTheDocument();
    expect(screen.queryByText('settings.guestIdentityCurrent')).not.toBeInTheDocument();
  });

  it('ignores an identity stored for another trip', () => {
    entries.set(SHARE_KEY, JSON.stringify({ personId: marie.id, tripId: 'trip-other' }));

    render(<GuestIdentitySelector />, { withProviders: false });

    expect(screen.getByRole('combobox', { name: 'settings.guestIdentity' })).toHaveTextContent(
      'settings.guestIdentityNone',
    );
    expect(screen.queryByText('settings.guestIdentityMissing')).not.toBeInTheDocument();
  });

  it('asks for a trip before asking who you are', () => {
    setContexts({ trip: null });

    render(<GuestIdentitySelector />, { withProviders: false });

    expect(screen.getByText('settings.guestIdentityNoTrip')).toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'settings.guestIdentity' }),
    ).not.toBeInTheDocument();
  });

  it('waits for the guest list rather than offering an empty menu', () => {
    setContexts({ persons: [], isLoading: true });

    render(<GuestIdentitySelector />, { withProviders: false });

    expect(
      screen.queryByRole('combobox', { name: 'settings.guestIdentity' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('settings.guestIdentityNoGuests')).not.toBeInTheDocument();
  });

  it('sends the user to the guest list when the trip has no guests', async () => {
    setContexts({ persons: [] });

    render(<GuestIdentitySelector />, { withProviders: false });

    expect(screen.getByText('settings.guestIdentityNoGuests')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'settings.guestIdentityOpenGuests' }));

    expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-1/persons');
  });
});
