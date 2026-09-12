/**
 * Unit tests for IdentityStepPage (identity selection step).
 *
 * Tests:
 * 3.1 Participants load and render as selectable cards (mock getPersonsByTripId)
 * 3.2 Selecting a participant updates visual selection state
 * 3.3 Tapping "I'm not on the list" reveals inline form
 * 3.4 Submitting "Add myself" form calls createPersonWithAutoColor and selects person
 * 3.5 Tapping "Next" writes localStorage key and navigates to /share/:shareId/room
 * 3.6 Empty participant list shows "Add myself" prompt prominently (not behind a button)
 * 3.7 i18n — text nodes use translation keys (keys returned as-is by mock)
 *
 * Note: i18next is mocked in test/setup.ts — t('key', options) returns the key string.
 *
 * @module features/sharing/pages/__tests__/IdentityStepPage.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render as rtlRender } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { IdentityStepPage } from '../IdentityStepPage';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/lib/db', () => ({
  getTripByShareId: vi.fn(),
  getPersonsByTripId: vi.fn(),
  createPersonWithAutoColor: vi.fn(),
}));

// Mock sonner so we can assert toast.error calls
const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: vi.fn(),
  },
}));

// i18next is auto-mocked in test/setup.ts: t('key') → 'key', t('key', {x}) → 'key'

// localStorage mock — controlled per test
const localStorageMock: Record<string, string> = {};

Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => localStorageMock[key] ?? null,
    setItem: (key: string, value: string) => { localStorageMock[key] = value; },
    removeItem: (key: string) => { delete localStorageMock[key]; },
    clear: () => { Object.keys(localStorageMock).forEach(k => { delete localStorageMock[k]; }); },
    get length() { return Object.keys(localStorageMock).length; },
    key: (i: number) => Object.keys(localStorageMock)[i] ?? null,
  },
  writable: true,
});

// ============================================================================
// Imports after mocks
// ============================================================================

import type { Person, PersonId, Trip, TripId, ShareId, HexColor } from '@/types';
import { isoDate } from '@/test/utils';
import {
  getTripByShareId,
  getPersonsByTripId,
  createPersonWithAutoColor,
} from '@/lib/db';

const mockGetTripByShareId = vi.mocked(getTripByShareId);
const mockGetPersonsByTripId = vi.mocked(getPersonsByTripId);
const mockCreatePersonWithAutoColor = vi.mocked(createPersonWithAutoColor);

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a minimal fixture Trip for testing.
 */
function makeTrip(overrides?: Partial<Trip>): Trip {
  return {
    id: 'trip-abc' as TripId,
    name: 'Beach Vacation',
    location: 'Brittany, France',
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-22'),
    shareId: 'share-123' as ShareId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/**
 * Creates a minimal fixture Person for testing.
 */
function makePerson(overrides?: Partial<Person>): Person {
  return {
    id: 'person-1' as PersonId,
    tripId: 'trip-abc' as TripId,
    name: 'Alice',
    color: '#ef4444' as HexColor,
    ...overrides,
  };
}

/**
 * Renders IdentityStepPage inside a MemoryRouter with shareId in the URL.
 * No AppProviders — this page is outside AppProviders (AR-10).
 */
function renderIdentityStepPage(shareId = 'abc123'): ReturnType<typeof rtlRender> & { user: ReturnType<typeof userEvent.setup> } {
  const user = userEvent.setup();
  const result = rtlRender(
    <MemoryRouter initialEntries={[`/share/${shareId}/identity`]}>
      <Routes>
        <Route path="/share/:shareId/identity" element={<IdentityStepPage />} />
        <Route
          path="/share/:shareId/room"
          element={<div data-testid="room-page">Room step</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
  return { ...result, user };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

// ============================================================================
// 3.1 — Participants load and render as selectable cards
// ============================================================================

describe('IdentityStepPage — 3.1: participants load and render as selectable cards', () => {
  it('renders all participants as buttons after loading', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([
      makePerson({ id: 'p1' as PersonId, name: 'Alice' }),
      makePerson({ id: 'p2' as PersonId, name: 'Bob' }),
    ]);

    renderIdentityStepPage();

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  it('shows title key (i18n)', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([makePerson()]);

    renderIdentityStepPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.identityTitle')).toBeInTheDocument();
    });
  });

  it('shows loading state while fetching', () => {
    // Return a promise that never resolves to keep loading state
    mockGetTripByShareId.mockReturnValue(new Promise(() => { /* never */ }));

    renderIdentityStepPage();

    // LoadingState renders role="status" — assert it is present
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows not-found state when trip does not exist', async () => {
    mockGetTripByShareId.mockResolvedValue(undefined);

    renderIdentityStepPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.notFoundWizard')).toBeInTheDocument();
    });
  });

  it('calls getPersonsByTripId with the correct tripId', async () => {
    const trip = makeTrip({ id: 'trip-xyz' as TripId });
    mockGetTripByShareId.mockResolvedValue(trip);
    mockGetPersonsByTripId.mockResolvedValue([]);

    renderIdentityStepPage();

    await waitFor(() => {
      expect(mockGetPersonsByTripId).toHaveBeenCalledWith('trip-xyz');
    });
  });
});

// ============================================================================
// 3.2 — Selecting a participant updates visual selection state
// ============================================================================

describe('IdentityStepPage — 3.2: selecting a participant updates visual selection state', () => {
  it('marks the selected participant button as aria-pressed=true', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([
      makePerson({ id: 'p1' as PersonId, name: 'Alice' }),
    ]);

    const { user } = renderIdentityStepPage();

    const aliceButton = await screen.findByRole('button', { name: 'Alice' });
    expect(aliceButton).toHaveAttribute('aria-pressed', 'false');

    await user.click(aliceButton);

    await waitFor(() => {
      expect(aliceButton).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('enables the Next button once a participant is selected', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([
      makePerson({ id: 'p1' as PersonId, name: 'Alice' }),
    ]);

    const { user } = renderIdentityStepPage();

    // Next button should be disabled initially
    const nextButton = await screen.findByRole('button', { name: 'sharing.identityNext' });
    expect(nextButton).toBeDisabled();

    // Select Alice
    const aliceButton = screen.getByRole('button', { name: 'Alice' });
    await user.click(aliceButton);

    // Next button should be enabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'sharing.identityNext' })).not.toBeDisabled();
    });
  });
});

// ============================================================================
// 3.3 — Tapping "I'm not on the list" reveals inline form
// ============================================================================

describe('IdentityStepPage — 3.3: "I\'m not on the list" reveals inline form', () => {
  it('shows "I\'m not on the list" button when participants exist', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([makePerson()]);

    renderIdentityStepPage();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'sharing.identityNotOnList' }),
      ).toBeInTheDocument();
    });
  });

  it('reveals the inline name input after clicking "I\'m not on the list"', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([makePerson()]);

    const { user } = renderIdentityStepPage();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'sharing.identityNotOnList' }),
      ).toBeInTheDocument();
    });

    // Name input should not be visible yet
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'sharing.identityNotOnList' }));

    // Name input should now be visible
    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    // "Add myself" submit button should appear
    expect(
      screen.getByRole('button', { name: 'sharing.identityAddMyself' }),
    ).toBeInTheDocument();
  });
});

// ============================================================================
// 3.4 — Submitting "Add myself" calls createPersonWithAutoColor and selects person
// ============================================================================

describe('IdentityStepPage — 3.4: "Add myself" form calls createPersonWithAutoColor', () => {
  it('calls createPersonWithAutoColor with trimmed name and tripId on submit', async () => {
    const trip = makeTrip({ id: 'trip-abc' as TripId });
    mockGetTripByShareId.mockResolvedValue(trip);
    mockGetPersonsByTripId.mockResolvedValue([makePerson()]);

    const newPerson = makePerson({ id: 'p-new' as PersonId, name: 'Charlie' });
    mockCreatePersonWithAutoColor.mockResolvedValue(newPerson);

    const { user } = renderIdentityStepPage();

    // Open the form
    await user.click(
      await screen.findByRole('button', { name: 'sharing.identityNotOnList' }),
    );

    // Type a name with surrounding whitespace to verify trimming
    const nameInput = screen.getByRole('textbox');
    await user.type(nameInput, '  Charlie  ');

    // Submit
    await user.click(screen.getByRole('button', { name: 'sharing.identityAddMyself' }));

    await waitFor(() => {
      expect(mockCreatePersonWithAutoColor).toHaveBeenCalledWith('trip-abc', 'Charlie');
    });
  });

  it('adds the new person to the list and selects them after successful add', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([makePerson()]);

    const newPerson = makePerson({ id: 'p-new' as PersonId, name: 'Charlie' });
    mockCreatePersonWithAutoColor.mockResolvedValue(newPerson);

    const { user } = renderIdentityStepPage();

    await user.click(
      await screen.findByRole('button', { name: 'sharing.identityNotOnList' }),
    );

    const nameInput = screen.getByRole('textbox');
    await user.type(nameInput, 'Charlie');
    await user.click(screen.getByRole('button', { name: 'sharing.identityAddMyself' }));

    // New person should appear in the list
    await waitFor(() => {
      expect(screen.getByText('Charlie')).toBeInTheDocument();
    });

    // New person should be auto-selected — Next button should be enabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'sharing.identityNext' })).not.toBeDisabled();
    });
  });

  it('shows name error when submitting empty name', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([makePerson()]);

    const { user } = renderIdentityStepPage();

    await user.click(
      await screen.findByRole('button', { name: 'sharing.identityNotOnList' }),
    );

    // Submit without typing a name
    await user.click(screen.getByRole('button', { name: 'sharing.identityAddMyself' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('sharing.identityNameRequired')).toBeInTheDocument();
    });

    expect(mockCreatePersonWithAutoColor).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 3.5 — Tapping "Next" writes localStorage and navigates
// ============================================================================

describe('IdentityStepPage — 3.5: "Next" writes localStorage and navigates', () => {
  it('writes localStorage key with personId and tripId on "Next"', async () => {
    const trip = makeTrip({ id: 'trip-abc' as TripId });
    mockGetTripByShareId.mockResolvedValue(trip);
    mockGetPersonsByTripId.mockResolvedValue([
      makePerson({ id: 'p1' as PersonId, name: 'Alice' }),
    ]);

    const { user } = renderIdentityStepPage('abc123');

    const aliceButton = await screen.findByRole('button', { name: 'Alice' });
    await user.click(aliceButton);

    const nextButton = screen.getByRole('button', { name: 'sharing.identityNext' });
    await user.click(nextButton);

    await waitFor(() => {
      const stored = window.localStorage.getItem('kikouchou_guest_abc123');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed).toEqual({ personId: 'p1', tripId: 'trip-abc' });
    });
  });

  it('navigates to /share/:shareId/room after "Next"', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([
      makePerson({ id: 'p1' as PersonId, name: 'Alice' }),
    ]);

    const { user } = renderIdentityStepPage('abc123');

    const aliceButton = await screen.findByRole('button', { name: 'Alice' });
    await user.click(aliceButton);

    const nextButton = screen.getByRole('button', { name: 'sharing.identityNext' });
    await user.click(nextButton);

    await waitFor(() => {
      expect(screen.getByTestId('room-page')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 3.6 — Empty participant list: "Add myself" prompt shown prominently
// ============================================================================

describe('IdentityStepPage — 3.6: empty participant list shows add-myself form prominently', () => {
  it('shows the empty list message when there are no participants', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([]);

    renderIdentityStepPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.identityEmptyList')).toBeInTheDocument();
    });
  });

  it('shows the name input immediately (not behind a button) when list is empty', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([]);

    renderIdentityStepPage();

    await waitFor(() => {
      // Name input should be immediately visible — not hidden behind "I'm not on the list"
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    // The "I'm not on the list" button should NOT be shown when list is empty
    expect(
      screen.queryByRole('button', { name: 'sharing.identityNotOnList' }),
    ).not.toBeInTheDocument();
  });
});

// ============================================================================
// 3.7 — i18n: text nodes use translation keys
// ============================================================================

describe('IdentityStepPage — 3.7: i18n text nodes use translation keys', () => {
  it('renders all key UI strings via i18n translation keys', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([makePerson()]);

    renderIdentityStepPage();

    await waitFor(() => {
      // Title and subtitle
      expect(screen.getByText('sharing.identityTitle')).toBeInTheDocument();
      expect(screen.getByText('sharing.identitySubtitle')).toBeInTheDocument();
      // Action buttons
      expect(
        screen.getByRole('button', { name: 'sharing.identityNext' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'sharing.identityNotOnList' }),
      ).toBeInTheDocument();
    });
  });
});

// ============================================================================
// Additional branch coverage
// ============================================================================

describe('IdentityStepPage — additional branch coverage', () => {
  it('shows toast.error when createPersonWithAutoColor fails', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([makePerson()]);
    mockCreatePersonWithAutoColor.mockRejectedValue(new Error('DB failure'));

    const { user } = renderIdentityStepPage();

    await user.click(
      await screen.findByRole('button', { name: 'sharing.identityNotOnList' }),
    );
    const nameInput = screen.getByRole('textbox');
    await user.type(nameInput, 'Failing User');
    await user.click(screen.getByRole('button', { name: 'sharing.identityAddMyself' }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledTimes(1);
    });
  });

  it('clears name error when typing in the name input', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([makePerson()]);

    const { user } = renderIdentityStepPage();

    await user.click(
      await screen.findByRole('button', { name: 'sharing.identityNotOnList' }),
    );

    // Submit without typing -> error should appear
    await user.click(screen.getByRole('button', { name: 'sharing.identityAddMyself' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Type something -> error should clear
    const nameInput = screen.getByRole('textbox');
    await user.type(nameInput, 'A');
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('submits add form via Enter key on input', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([makePerson()]);

    const newPerson = makePerson({ id: 'p-enter' as PersonId, name: 'EnterUser' });
    mockCreatePersonWithAutoColor.mockResolvedValue(newPerson);

    const { user } = renderIdentityStepPage();

    await user.click(
      await screen.findByRole('button', { name: 'sharing.identityNotOnList' }),
    );
    const nameInput = screen.getByRole('textbox');
    await user.type(nameInput, 'EnterUser');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockCreatePersonWithAutoColor).toHaveBeenCalledWith('trip-abc', 'EnterUser');
    });
  });

  it('shows not-found state when getTripByShareId throws an error', async () => {
    mockGetTripByShareId.mockRejectedValue(new Error('Network error'));

    renderIdentityStepPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.notFoundWizard')).toBeInTheDocument();
    });
  });

  it('does not show "I\'m not on the list" when add form is open', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([makePerson()]);

    const { user } = renderIdentityStepPage();

    await user.click(
      await screen.findByRole('button', { name: 'sharing.identityNotOnList' }),
    );

    // Now that the form is open, the toggle button should be gone
    expect(
      screen.queryByRole('button', { name: 'sharing.identityNotOnList' }),
    ).not.toBeInTheDocument();
  });
});

// ============================================================================
// F16 — localStorage failure path (warn-and-continue with toast)
// ============================================================================

describe('IdentityStepPage — F16: localStorage failure shows toast and still navigates', () => {
  it('shows toast.error and still navigates to room step when localStorage.setItem throws', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([
      makePerson({ id: 'p1' as PersonId, name: 'Alice' }),
    ]);

    // Make localStorage.setItem throw (simulates quota exceeded / private mode)
    const originalSetItem = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };

    const { user } = renderIdentityStepPage('abc123');

    const aliceButton = await screen.findByRole('button', { name: 'Alice' });
    await user.click(aliceButton);

    const nextButton = screen.getByRole('button', { name: 'sharing.identityNext' });
    await user.click(nextButton);

    // Should still navigate despite the storage failure
    await waitFor(() => {
      expect(screen.getByTestId('room-page')).toBeInTheDocument();
    });

    // Should have shown an error toast to inform the user
    expect(mockToastError).toHaveBeenCalledTimes(1);

    // Restore
    window.localStorage.setItem = originalSetItem;
  });
});
