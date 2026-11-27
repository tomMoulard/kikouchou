/**
 * Component tests for TripForm
 *
 * Tests form rendering, validation, date selection, and submission handling
 * for the trip edit form.
 *
 * @module features/trips/components/__tests__/TripForm.test
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TripForm } from '@/features/trips/components/TripForm';
import type { Trip, TripId, ShareId } from '@/types';
import { isoDate } from '@/test/utils';

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Creates a test trip object with optional overrides.
 */
function createTestTrip(overrides?: Partial<Trip>): Trip {
  return {
    id: 'trip-1' as TripId,
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
 * A trip without dates, opened in the edit form: where the date fields live
 * now that a new trip is created without them.
 */
function createUndatedTrip(): Trip {
  return createTestTrip({ startDate: undefined, endDate: undefined });
}

/**
 * A trip with nothing set but its id: the state a fresh form used to start
 * in, so the validation tests can begin from an empty name and no dates.
 */
function blankTrip(): Trip {
  return createTestTrip({
    name: '',
    location: undefined,
    startDate: undefined,
    endDate: undefined,
  });
}

/**
 * An onSubmit whose save stays pending until the test settles it.
 *
 * A save that resolves on a wall-clock timer races the assertions: on a loaded
 * machine the timer can fire before the next click or the next waitFor poll,
 * and the form is then idle again, so it accepts a second save or shows no
 * pending state. The test decides here when the save ends.
 */
/** Saves a test left pending; settled once the test is over. */
const pendingSaves: (() => void)[] = [];

afterEach(() => {
  pendingSaves.splice(0).forEach((settle) => {
    settle();
  });
});

function deferredSubmit() {
  let settle: () => void = () => {};
  const onSubmit = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
        pendingSaves.push(resolve);
      }),
  );
  return {
    onSubmit,
    resolve: async () => {
      await act(async () => {
        settle();
      });
    },
  };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  // Typing in the location field triggers a place lookup; keep it off the wire.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================================
// Basic Rendering Tests
// ============================================================================

describe('TripForm Basic Rendering', () => {
  it('renders empty fields for a trip with nothing set', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm trip={blankTrip()} onSubmit={onSubmit} onCancel={onCancel} />);

    const nameInput = screen.getByLabelText(/trips\.name/i);
    const locationInput = screen.getByLabelText(/trips\.location/i);

    expect(nameInput).toHaveValue('');
    expect(locationInput).toHaveValue('');
  });

  it('renders form in edit mode with pre-filled data', () => {
    const trip = createTestTrip();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    const nameInput = screen.getByLabelText(/trips\.name/i);
    const locationInput = screen.getByLabelText(/trips\.location/i);

    expect(nameInput).toHaveValue('Beach Vacation');
    expect(locationInput).toHaveValue('Brittany, France');
  });

  it('puts the cursor in the name by default', () => {
    render(<TripForm trip={createUndatedTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/trips\.name/i)).toHaveFocus();
  });

  // The calendar checklist's "Set the dates" landed here with the cursor in
  // the name and the dates further down the page.
  it('puts the cursor in the start date when asked for the dates', () => {
    render(
      <TripForm
        trip={createUndatedTrip()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        focusField="dates"
      />,
    );

    expect(screen.getByLabelText(/trips\.startDate/i)).toHaveFocus();
    expect(screen.getByLabelText(/trips\.name/i)).not.toHaveFocus();
  });

  it('marks only the name as required', () => {
    render(<TripForm trip={createUndatedTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    // The dates are optional, even where they are asked.
    expect(screen.getAllByText('*')).toHaveLength(1);
  });
});

// ============================================================================
// Validation Tests
// ============================================================================

describe('TripForm Validation', () => {
  it('shows error when name is empty on blur', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm trip={blankTrip()} onSubmit={onSubmit} onCancel={onCancel} />);

    const nameInput = screen.getByLabelText(/trips\.name/i);
    await user.click(nameInput);
    await user.tab(); // Blur

    expect(await screen.findByRole('alert')).toHaveTextContent('common.required');
  });

  it('clears name error when user types', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm trip={blankTrip()} onSubmit={onSubmit} onCancel={onCancel} />);

    const nameInput = screen.getByLabelText(/trips\.name/i);
    await user.click(nameInput);
    await user.tab(); // Trigger error

    expect(await screen.findByRole('alert')).toBeInTheDocument();

    // Start typing to clear error
    await user.type(nameInput, 'Test Trip');

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('shows error when submitting without required fields', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm trip={blankTrip()} onSubmit={onSubmit} onCancel={onCancel} />);

    const submitButton = screen.getByRole('button', { name: /common\.save/i });
    await user.click(submitButton);

    // Should show validation errors
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('validates end date is not before start date', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    // Create trip with end date before start date
    const invalidTrip = createTestTrip({
      startDate: isoDate('2024-07-22'),
      endDate: isoDate('2024-07-15'), // Before start
    });

    render(<TripForm trip={invalidTrip} onSubmit={onSubmit} onCancel={onCancel} />);

    const submitButton = screen.getByRole('button', { name: /common\.save/i });
    await user.click(submitButton);

    // Should show end date error
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Submission Tests
// ============================================================================

describe('TripForm Submission', () => {
  it('calls onSubmit with form data when valid', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    const trip = createTestTrip();

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    const submitButton = screen.getByRole('button', { name: /common\.save/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    // The currency rides along on every save: a trip that never picked one
    // still carries the default, so the money page has something to label its
    // figures with.
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Beach Vacation',
      location: 'Brittany, France',
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-22'),
      currency: 'EUR',
    });
  });

  it('keeps the currency a trip already had', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <TripForm
        trip={createTestTrip({ currency: 'CHF' })}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /common\.save/iu }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ currency: 'CHF' });
  });

  it('trims whitespace from name and location', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    const trip = createTestTrip({
      name: '  Trip Name  ',
      location: '  Location  ',
    });

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    const submitButton = screen.getByRole('button', { name: /common\.save/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Trip Name',
          location: 'Location',
        })
      );
    });
  });

  it('converts empty location to undefined', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    const trip = createTestTrip({ location: '' });

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    const submitButton = screen.getByRole('button', { name: /common\.save/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          location: undefined,
        })
      );
    });
  });

  it('disables form during submission', async () => {
    const user = userEvent.setup();
    // Keep the save pending until the test ends it
    const { onSubmit, resolve } = deferredSubmit();
    const onCancel = vi.fn();

    const trip = createTestTrip();

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    const submitButton = screen.getByRole('button', { name: /common\.save/i });
    await user.click(submitButton);

    // Button should be disabled
    await waitFor(() => {
      expect(submitButton).toBeDisabled();
    });

    // End the save: the form is usable again
    await resolve();
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
  });

  it('shows loading text during submission', async () => {
    const user = userEvent.setup();
    const { onSubmit } = deferredSubmit();
    const onCancel = vi.fn();

    const trip = createTestTrip();

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    const submitButton = screen.getByRole('button', { name: /common\.save/i });
    await user.click(submitButton);

    // Should show loading text
    await waitFor(() => {
      expect(screen.getByText('common.loading')).toBeInTheDocument();
    });
  });

  it('shows error on submission failure', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('Network error'));
    const onCancel = vi.fn();

    const trip = createTestTrip();

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    const submitButton = screen.getByRole('button', { name: /common\.save/i });
    await user.click(submitButton);

    // Should show error message
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('errors.saveFailed');
    });
  });

  it('prevents double submission', async () => {
    const user = userEvent.setup();
    // The first save stays pending for the whole test, so the second click
    // always lands while it runs, however slow the machine is.
    const { onSubmit, resolve } = deferredSubmit();
    const onCancel = vi.fn();

    const trip = createTestTrip();

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    const submitButton = screen.getByRole('button', { name: /common\.save/i });

    await user.click(submitButton);
    await user.click(submitButton);

    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Once the first save is done, the form accepts the next one.
    await resolve();
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
    await user.click(submitButton);
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// Cancel Action Tests
// ============================================================================

describe('TripForm Cancel Action', () => {
  it('calls onCancel when cancel button clicked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm trip={blankTrip()} onSubmit={onSubmit} onCancel={onCancel} />);

    const cancelButton = screen.getByRole('button', { name: /common\.cancel/i });
    await user.click(cancelButton);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables cancel button during submission', async () => {
    const user = userEvent.setup();
    const { onSubmit } = deferredSubmit();
    const onCancel = vi.fn();

    const trip = createTestTrip();

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    const submitButton = screen.getByRole('button', { name: /common\.save/i });
    const cancelButton = screen.getByRole('button', { name: /common\.cancel/i });

    await user.click(submitButton);

    await waitFor(() => {
      expect(cancelButton).toBeDisabled();
    });
  });
});

// ============================================================================
// Edit Mode Tests
// ============================================================================

describe('TripForm Edit Mode', () => {
  it('pre-fills form with trip data', () => {
    const trip = createTestTrip({
      name: 'Summer Trip',
      location: 'Paris',
    });
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    expect(screen.getByLabelText(/trips\.name/i)).toHaveValue('Summer Trip');
    expect(screen.getByLabelText(/trips\.location/i)).toHaveValue('Paris');
  });

  it('updates form when trip prop changes', () => {
    const trip1 = createTestTrip({ name: 'Trip 1', id: 'trip-1' as TripId });
    const trip2 = createTestTrip({ name: 'Trip 2', id: 'trip-2' as TripId });
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    const { rerender } = render(
      <TripForm trip={trip1} onSubmit={onSubmit} onCancel={onCancel} />
    );

    expect(screen.getByLabelText(/trips\.name/i)).toHaveValue('Trip 1');

    rerender(<TripForm trip={trip2} onSubmit={onSubmit} onCancel={onCancel} />);

    expect(screen.getByLabelText(/trips\.name/i)).toHaveValue('Trip 2');
  });

  it('handles trip without location', () => {
    const trip = createTestTrip({ location: undefined });
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    expect(screen.getByLabelText(/trips\.location/i)).toHaveValue('');
  });
});

// ============================================================================
// Accessibility Tests
// ============================================================================

describe('TripForm Accessibility', () => {
  it('has accessible form structure', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    const { container } = render(<TripForm trip={blankTrip()} onSubmit={onSubmit} onCancel={onCancel} />);

    // Form element exists (HTML forms don't get role="form" without accessible name)
    expect(container.querySelector('form')).toBeInTheDocument();
  });

  it('name input has aria-invalid when error', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm trip={blankTrip()} onSubmit={onSubmit} onCancel={onCancel} />);

    const nameInput = screen.getByLabelText(/trips\.name/i);
    await user.click(nameInput);
    await user.tab();

    await waitFor(() => {
      expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    });
  });

  it('error messages have role="alert"', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm trip={blankTrip()} onSubmit={onSubmit} onCancel={onCancel} />);

    const submitButton = screen.getByRole('button', { name: /common\.save/i });
    await user.click(submitButton);

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('submit button has aria-busy during submission', async () => {
    const user = userEvent.setup();
    const { onSubmit } = deferredSubmit();
    const onCancel = vi.fn();

    const trip = createTestTrip();

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    const submitButton = screen.getByRole('button', { name: /common\.save/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(submitButton).toHaveAttribute('aria-busy', 'true');
    });
  });
});

// ============================================================================
// Input Handling Tests
// ============================================================================

describe('TripForm Input Handling', () => {
  it('allows typing in name field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm trip={blankTrip()} onSubmit={onSubmit} onCancel={onCancel} />);

    const nameInput = screen.getByLabelText(/trips\.name/i);
    await user.type(nameInput, 'My Trip');

    expect(nameInput).toHaveValue('My Trip');
  });

  it('allows typing in location field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm trip={blankTrip()} onSubmit={onSubmit} onCancel={onCancel} />);

    const locationInput = screen.getByLabelText(/trips\.location/i);
    await user.type(locationInput, 'Paris');

    expect(locationInput).toHaveValue('Paris');
  });

  it('disables inputs during submission', async () => {
    const user = userEvent.setup();
    const { onSubmit } = deferredSubmit();
    const onCancel = vi.fn();

    const trip = createTestTrip();

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    const submitButton = screen.getByRole('button', { name: /common\.save/i });
    const nameInput = screen.getByLabelText(/trips\.name/i);

    await user.click(submitButton);

    await waitFor(() => {
      expect(nameInput).toBeDisabled();
    });
  });
});

// ============================================================================
// Import Integration Tests
// ============================================================================

describe('TripForm Import Integration', () => {
  it('renders location field as combobox (autocomplete)', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm trip={blankTrip()} onSubmit={onSubmit} onCancel={onCancel} />);

    const locationInput = screen.getByLabelText(/trips\.location/i);
    expect(locationInput).toHaveAttribute('role', 'combobox');
    expect(locationInput).toHaveAttribute('aria-autocomplete', 'list');
  });

  it('includes coordinates in submission when set', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    const trip = createTestTrip({
      coordinates: { lat: 48.8566, lon: 2.3522 },
    });

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    const submitButton = screen.getByRole('button', { name: /common\.save/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          coordinates: { lat: 48.8566, lon: 2.3522 },
        })
      );
    });
  });
});

// ============================================================================
// Description Tests
// ============================================================================

describe('TripForm Description', () => {
  it('has no description field in edit mode, where its own card edits it', () => {
    const trip = createTestTrip({ description: 'Existing description' });
    render(<TripForm trip={trip} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText(/trips\.description/i)).toBeNull();
  });

  it('leaves the description out of an edit-mode submission', async () => {
    // The card saves the description on its own. Sending the value this form
    // loaded would overwrite whatever the card saved since.
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const trip = createTestTrip({ description: 'Trip notes' });
    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('description');
  });

  it('does not read as dirty when the trip description changes under it', () => {
    const onDirtyChange = vi.fn();
    const trip = createTestTrip({ description: 'Before' });
    const { rerender } = render(
      <TripForm trip={trip} onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />,
    );
    rerender(
      <TripForm
        trip={{ ...trip, description: 'After' }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  });

  it('reports dirty state via onDirtyChange callback', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    render(<TripForm trip={blankTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />);
    const nameInput = screen.getByLabelText(/trips\.name/i);
    await user.type(nameInput, 'X');
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it('start date shows aria-invalid when error', async () => {
    const user = userEvent.setup();
    render(<TripForm trip={createUndatedTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // An end alone: the dates go together.
    pickDate('end', '2024-07-15');
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    await waitFor(() => {
      const startBtn = screen.getByLabelText(/trips\.startDate/i);
      expect(startBtn).toHaveAttribute('aria-invalid', 'true');
    });
  });
});

// ============================================================================
// Edge case and branch coverage tests
// ============================================================================

describe('TripForm Edge Cases', () => {
  it('handles submit error gracefully', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('Save failed'));
    const trip = createTestTrip();

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  it('renders with undefined description', () => {
    const trip = createTestTrip({ description: undefined });
    render(<TripForm trip={trip} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/trips\.name/i)).toHaveValue('Beach Vacation');
  });

  it('renders with undefined location', () => {
    const trip = createTestTrip({ location: undefined });
    render(<TripForm trip={trip} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/trips\.location/i)).toHaveValue('');
  });

  it('validates name with only whitespace', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<TripForm trip={blankTrip()} onSubmit={onSubmit} onCancel={vi.fn()} />);

    const nameInput = screen.getByLabelText(/trips\.name/i);
    await user.type(nameInput, '   ');
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    // Should not submit with whitespace-only name
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders end date aria-invalid when end date before start date on submit', async () => {
    const user = userEvent.setup();
    const invalidTrip = createTestTrip({
      startDate: isoDate('2024-07-22'),
      endDate: isoDate('2024-07-15'),
    });

    render(<TripForm trip={invalidTrip} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    await waitFor(() => {
      const endBtn = screen.getByLabelText(/trips\.endDate/i);
      expect(endBtn).toHaveAttribute('aria-invalid', 'true');
    });
  });

  it('updates name in edit mode', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const trip = createTestTrip();

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={vi.fn()} />);

    const nameInput = screen.getByLabelText(/trips\.name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Name');
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Updated Name' })
      );
    });
  });

  it('shows no description character count in edit mode', () => {
    const trip = createTestTrip({ description: 'Hello World' });
    render(<TripForm trip={trip} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText('11/1000')).toBeNull();
  });
});

// ============================================================================
// Date picker branch coverage tests
// ============================================================================

describe('TripForm Date Selection Branches', () => {
  it('clears the start date error once a start date is picked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<TripForm trip={createUndatedTrip()} onSubmit={onSubmit} onCancel={vi.fn()} />);

    // An end alone triggers the start date error.
    pickDate('end', '2024-07-15');
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/trips\.startDate/i)).toHaveAttribute('aria-invalid', 'true');
    });

    pickDate('start', '2024-07-10');

    expect(screen.getByLabelText(/trips\.startDate/i)).toHaveAttribute('aria-invalid', 'false');
  });

  it('flags an end date that a new start date has not overtaken as valid', () => {
    const trip = createTestTrip({
      startDate: isoDate('2024-07-10'),
      endDate: isoDate('2024-07-20'),
    });

    render(<TripForm trip={trip} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    pickDate('start', '2024-07-12');

    expect(screen.getByLabelText(/trips\.endDate/i)).toHaveValue('2024-07-20');
    expect(screen.getByLabelText(/trips\.endDate/i)).toHaveAttribute('aria-invalid', 'false');
  });

  it('validates end date before start date on submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    // Edit trip with end date before start date
    const trip = createTestTrip({
      startDate: isoDate('2024-07-22'),
      endDate: isoDate('2024-07-15'),
    });

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={vi.fn()} />);

    // Submit the form — should show validation error
    const submitBtn = screen.getByRole('button', { name: /common\.save/i });
    await user.click(submitBtn);

    // Should not call onSubmit due to validation error
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows error when submitting without name', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<TripForm trip={blankTrip()} onSubmit={onSubmit} onCancel={vi.fn()} />);

    // Submit immediately without filling in name
    const submitBtn = screen.getByRole('button', { name: /common\.save/i });
    await user.click(submitBtn);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('saves a trip with a name and no dates', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<TripForm trip={blankTrip()} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/trips\.name/i), 'My Trip');
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('startDate');
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('endDate');
  });
});

// ============================================================================
// Map Pin Tests
// ============================================================================

describe('TripForm Map Pin', () => {
  it('carries the pinned coordinates through to submission', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    const trip = createTestTrip({ coordinates: { lat: 48.3904, lon: -4.4861 } });

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          location: 'Brittany, France',
          coordinates: { lat: 48.3904, lon: -4.4861 },
        }),
      );
    });
  });

  it('shows the existing pin on a map, not as coordinates', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    const trip = createTestTrip({ coordinates: { lat: 48.3904, lon: -4.4861 } });

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    expect(screen.getByTestId('location-map-picker')).toBeInTheDocument();
    expect(screen.queryByText(/48\.390400/)).not.toBeInTheDocument();
  });

  it('drops the pin when the location text is edited', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    const trip = createTestTrip({ coordinates: { lat: 48.3904, lon: -4.4861 } });

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    // Retyping the place name invalidates coordinates resolved from the old one.
    await user.type(screen.getByLabelText(/trips\.location/i), ' extra');
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          location: 'Brittany, France extra',
          coordinates: undefined,
        }),
      );
    });
  });

  it('keeps the pin when a different field is edited', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    const trip = createTestTrip({ coordinates: { lat: 48.3904, lon: -4.4861 } });

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    await user.type(screen.getByLabelText(/trips\.name/i), '!');
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          coordinates: { lat: 48.3904, lon: -4.4861 },
        }),
      );
    });
  });

  it('marks the form dirty when the pin is removed but the name kept', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const onDirtyChange = vi.fn();

    const trip = createTestTrip({ coordinates: { lat: 48.3904, lon: -4.4861 } });

    render(
      <TripForm
        trip={trip}
        onSubmit={onSubmit}
        onCancel={onCancel}
        onDirtyChange={onDirtyChange}
      />,
    );

    onDirtyChange.mockClear();
    // The location text is untouched, so only the coordinate comparison can
    // catch this — otherwise the unsaved-changes guard waves it through.
    await user.click(screen.getByRole('button', { name: /trips\.removePin/ }));

    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenCalledWith(true);
    });
  });
});

// ============================================================================
// The date inputs, and what a new start date does to the end date
// ============================================================================

/**
 * Sets a trip date input the way a browser does when its native picker
 * closes: one `change` carrying the whole `YYYY-MM-DD` value, or `''` when the
 * date is cleared.
 */
function pickDate(field: 'start' | 'end', value: string): void {
  const label = field === 'start' ? /trips\.startDate/i : /trips\.endDate/i;
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('TripForm Date Inputs', () => {
  it('uses native date inputs holding the trip dates', () => {
    const trip = createTestTrip({
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-22'),
    });

    render(<TripForm trip={trip} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/trips\.startDate/i)).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText(/trips\.startDate/i)).toHaveValue('2024-07-15');
    expect(screen.getByLabelText(/trips\.endDate/i)).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText(/trips\.endDate/i)).toHaveValue('2024-07-22');
  });

  it('keeps the end date from going before the start', () => {
    render(<TripForm trip={createUndatedTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/trips\.endDate/i)).not.toHaveAttribute('min');

    pickDate('start', '2024-10-15');

    expect(screen.getByLabelText(/trips\.endDate/i)).toHaveAttribute('min', '2024-10-15');
  });

  it('drops an end date that the newly chosen start date has overtaken', () => {
    const trip = createTestTrip({
      startDate: isoDate('2024-07-10'),
      endDate: isoDate('2024-07-12'),
    });

    render(<TripForm trip={trip} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    pickDate('start', '2024-08-15');

    // The end date the form is holding is now before the start — a range the
    // end input itself refuses to produce, since its `min` is the start.
    // Keeping it only to report an error leaves the form in a state no
    // sequence of picks could reach; dropping it puts the user one pick from
    // a valid range instead.
    expect(screen.getByLabelText(/trips\.endDate/i)).toHaveValue('');
    expect(screen.queryByText('validation.endDateBeforeStart')).toBeNull();
  });
});

// ============================================================================
// Switching trips, required fields and date picking
// ============================================================================

describe('TripForm switching trips', () => {
  const tripA = createTestTrip({
    id: 'trip-a' as TripId,
    name: 'Alps',
    location: 'Chamonix',
    startDate: isoDate('2024-07-10'),
    endDate: isoDate('2024-07-20'),
    coordinates: { lat: 45.9, lon: 6.8 },
  });
  const tripB = createTestTrip({
    id: 'trip-b' as TripId,
    name: 'Coast',
    location: 'Biarritz',
    startDate: isoDate('2025-03-01'),
    endDate: isoDate('2025-03-05'),
    currency: 'USD',
    coordinates: { lat: 43.5, lon: -1.6 },
  });

  it('loads every field of the next trip it is given', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<TripForm trip={tripA} onSubmit={onSubmit} onCancel={vi.fn()} />);

    rerender(<TripForm trip={tripB} onSubmit={onSubmit} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/trips\.name/i)).toHaveValue('Coast');
    expect(screen.getByLabelText(/trips\.location/i)).toHaveValue('Biarritz');
    expect(screen.getByLabelText(/trips\.startDate/i)).toHaveValue('2025-03-01');
    expect(screen.getByLabelText(/trips\.endDate/i)).toHaveValue('2025-03-05');

    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Coast',
        location: 'Biarritz',
        startDate: '2025-03-01',
        endDate: '2025-03-05',
        coordinates: { lat: 43.5, lon: -1.6 },
        currency: 'USD',
      });
    });
  });

  it('drops the errors of the trip it was showing', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TripForm trip={tripA} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.clear(screen.getByLabelText(/trips\.name/i));
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('common.required');

    rerender(<TripForm trip={tripB} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

});

describe('TripForm required fields', () => {
  it('refuses a nameless trip even with both dates chosen', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TripForm trip={createUndatedTrip()} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.clear(screen.getByLabelText(/trips\.name/i));
    pickDate('start', '2024-07-10');
    pickDate('end', '2024-07-15');
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/trips\.name/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('common.required');
  });

  it('asks for the end date when only the start is chosen', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { container } = render(
      <TripForm trip={createUndatedTrip()} onSubmit={onSubmit} onCancel={vi.fn()} />,
    );

    pickDate('start', '2024-07-10');
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/trips\.endDate/i)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(container.querySelector('#trip-end-date-error')).toHaveTextContent(
      'trips.datesTogether',
    );
  });

  it('saves a trip without dates when both are left empty', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TripForm trip={createUndatedTrip()} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('startDate');
  });

  it('cancels the browser submit', () => {
    const { container } = render(<TripForm trip={blankTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(fireEvent.submit(container.querySelector('form')!)).toBe(false);
  });
});

describe('TripForm picking dates', () => {
  const startInput = () => screen.getByLabelText(/trips\.startDate/i);
  const endInput = () => screen.getByLabelText(/trips\.endDate/i);

  /** Picks the given day of July 2024 as the start. */
  function pickStart(day: number) {
    pickDate('start', `2024-07-${String(day).padStart(2, '0')}`);
  }

  /** Picks the given day of July 2024 as the end. */
  function pickEnd(day: number) {
    pickDate('end', `2024-07-${String(day).padStart(2, '0')}`);
  }

  /** The edit form of a trip without dates, where the dates are picked. */
  function renderUndated(onSubmit = vi.fn()) {
    return render(<TripForm trip={createUndatedTrip()} onSubmit={onSubmit} onCancel={vi.fn()} />);
  }

  it('keeps an end date the new start date has not overtaken', () => {
    renderUndated();
    pickStart(10);
    pickEnd(15);

    pickStart(12);

    expect(endInput()).toHaveValue('2024-07-15');
  });

  it('drops an end date overtaken, and then asks for one', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderUndated(onSubmit);
    pickStart(10);
    pickEnd(15);

    pickStart(21);

    expect(endInput()).toHaveValue('');
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(endInput()).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps the name error when only the start date is chosen', async () => {
    const user = userEvent.setup();
    renderUndated();
    await user.clear(screen.getByLabelText(/trips\.name/i));
    await user.tab();
    expect(screen.getByLabelText(/trips\.name/i)).toHaveAttribute('aria-invalid', 'true');

    pickStart(10);

    expect(screen.getByLabelText(/trips\.name/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps asking for the end date after the start is chosen', async () => {
    const user = userEvent.setup();
    renderUndated();
    pickStart(10);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    expect(endInput()).toHaveAttribute('aria-invalid', 'true');

    pickStart(11);

    expect(startInput()).toHaveAttribute('aria-invalid', 'false');
    expect(endInput()).toHaveAttribute('aria-invalid', 'true');
  });

  describe('on a trip that arrived with its dates the wrong way round', () => {
    const inverted = createTestTrip({
      startDate: isoDate('2024-07-22'),
      endDate: isoDate('2024-07-15'),
    });

    async function submitInverted(user: ReturnType<typeof userEvent.setup>) {
      render(<TripForm trip={inverted} onSubmit={vi.fn()} onCancel={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /common\.save/i }));
      expect(screen.getByText('validation.endDateBeforeStart')).toBeInTheDocument();
    }

    it('clears the complaint when the new start comes before the end', async () => {
      const user = userEvent.setup();
      await submitInverted(user);

      pickStart(10);

      expect(screen.queryByText('validation.endDateBeforeStart')).not.toBeInTheDocument();
      expect(endInput()).toHaveAttribute('aria-invalid', 'false');
    });

    it('clears the complaint along with the end date a new start overtakes', async () => {
      const user = userEvent.setup();
      await submitInverted(user);

      pickStart(26);

      expect(endInput()).toHaveValue('');
      expect(screen.queryByText('validation.endDateBeforeStart')).not.toBeInTheDocument();
    });
  });

  it('lets a chosen start date be cleared again, back to a trip without dates', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderUndated(onSubmit);
    pickStart(10);
    expect(startInput()).toHaveValue('2024-07-10');

    pickDate('start', '');

    expect(startInput()).toHaveValue('');
    // Both empty again: the trip saves without dates.
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('startDate');
  });

  it('lets a chosen end date be cleared again', async () => {
    const user = userEvent.setup();
    renderUndated();
    pickStart(10);
    pickEnd(12);

    pickDate('end', '');

    expect(endInput()).toHaveValue('');
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    expect(endInput()).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the end date complaint once an end is chosen, and only that one', async () => {
    const user = userEvent.setup();
    renderUndated();
    await user.clear(screen.getByLabelText(/trips\.name/i));
    pickStart(10);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    expect(endInput()).toHaveAttribute('aria-invalid', 'true');

    pickEnd(15);

    expect(endInput()).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByLabelText(/trips\.name/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('asks for the start when only the end is chosen, and not for the end', async () => {
    const user = userEvent.setup();
    renderUndated();
    pickEnd(15);

    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    expect(endInput()).toHaveAttribute('aria-invalid', 'false');
    expect(startInput()).toHaveAttribute('aria-invalid', 'true');
  });

  it('marks a missing date in error and ties the message to it', async () => {
    const user = userEvent.setup();
    const { container } = renderUndated();
    expect(startInput()).toHaveAttribute('aria-invalid', 'false');
    expect(endInput()).toHaveAttribute('aria-invalid', 'false');
    expect(container.querySelector('#trip-start-date-error')).toBeNull();
    expect(container.querySelector('#trip-end-date-error')).toBeNull();

    pickEnd(15);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    expect(startInput()).toHaveAttribute('aria-invalid', 'true');
    expect(startInput()).toHaveAttribute('aria-describedby', 'trip-start-date-error');
    expect(container.querySelector('#trip-start-date-error')).toHaveTextContent(
      'trips.datesTogether',
    );

    pickStart(10);
    expect(startInput()).toHaveAttribute('aria-invalid', 'false');
  });

  it('keeps the end input from going before the start', () => {
    renderUndated();
    pickStart(10);

    expect(endInput()).toHaveAttribute('min', '2024-07-10');
  });

  it('clears both dates with one button, and saves a trip without dates', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TripForm trip={createTestTrip()} onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(startInput()).toHaveValue('2024-07-15');

    await user.click(screen.getByRole('button', { name: 'trips.clearDates' }));

    expect(startInput()).toHaveValue('');
    expect(endInput()).toHaveValue('');
    // Nothing left to clear.
    expect(screen.queryByRole('button', { name: 'trips.clearDates' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('startDate');
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('endDate');
  });

  it('offers no clear button while both dates are empty', () => {
    renderUndated();

    expect(screen.queryByRole('button', { name: 'trips.clearDates' })).not.toBeInTheDocument();
  });
});

describe('TripForm labels and hints', () => {
  it('names the fields and their hints', () => {
    render(<TripForm trip={blankTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/trips\.name/i)).toHaveAttribute('placeholder', 'trips.namePlaceholder');
    expect(screen.getByLabelText(/trips\.location/i)).toHaveAttribute(
      'placeholder',
      'trips.locationPlaceholder',
    );
    expect(screen.getByRole('combobox', { name: 'trips.currency' })).toBeInTheDocument();
    expect(screen.getByText('trips.currencyHint')).toBeInTheDocument();
    // The two dates are the optional fields.
    expect(screen.getAllByText('(common.optional)')).toHaveLength(2);
  });

  it('ties the name error to the field', async () => {
    const user = userEvent.setup();
    const { container } = render(<TripForm trip={blankTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/trips\.name/i)).not.toHaveAttribute('aria-describedby');

    await user.click(screen.getByLabelText(/trips\.name/i));
    await user.tab();

    expect(screen.getByLabelText(/trips\.name/i)).toHaveAttribute('aria-describedby', 'trip-name-error');
    expect(container.querySelector('#trip-name-error')).toHaveTextContent('common.required');
  });

  it('offers every supported currency by name', async () => {
    const user = userEvent.setup();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TripForm trip={createTestTrip()} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('combobox', { name: 'trips.currency' }));
    expect(await screen.findByRole('option', { name: 'trips.currencies.GBP' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'trips.currencies.USD' }));
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ currency: 'USD' }));
    });
  });
});

describe('TripForm name checks', () => {
  it('flags a name of only spaces as soon as the field is left', async () => {
    const user = userEvent.setup();
    render(<TripForm trip={blankTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/trips\.name/i), '   ');
    await user.tab();

    expect(screen.getByLabelText(/trips\.name/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('judges the name as typed, not as first rendered', async () => {
    const user = userEvent.setup();
    render(<TripForm trip={blankTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/trips\.name/i), 'Lake');
    await user.tab();

    expect(screen.getByLabelText(/trips\.name/i)).toHaveAttribute('aria-invalid', 'false');
  });

  it('clears only the name error while the name is typed', async () => {
    const user = userEvent.setup();
    render(<TripForm trip={createUndatedTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.clear(screen.getByLabelText(/trips\.name/i));
    // An end alone, so the start carries an error of its own.
    pickDate('end', '2024-07-15');
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    await user.type(screen.getByLabelText(/trips\.name/i), 'L');

    expect(screen.getByLabelText(/trips\.name/i)).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByLabelText(/trips\.startDate/i)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });
});

describe('TripForm unsaved changes', () => {
  const last = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)?.[0];

  it('starts pristine', () => {
    const onDirtyChange = vi.fn();
    render(<TripForm trip={blankTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />);

    expect(last(onDirtyChange)).toBe(false);
  });

  it('is dirty once the location alone changes', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    render(<TripForm trip={blankTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />);

    await user.type(screen.getByLabelText(/trips\.location/i), 'B');

    expect(last(onDirtyChange)).toBe(true);
  });

  it('is dirty once the start date alone changes', () => {
    const onDirtyChange = vi.fn();
    render(
      <TripForm
        trip={createUndatedTrip()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );

    pickDate('start', '2024-07-10');

    expect(last(onDirtyChange)).toBe(true);
  });

  it('is dirty once the end date alone changes', () => {
    const onDirtyChange = vi.fn();
    render(
      <TripForm
        trip={createUndatedTrip()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );

    pickDate('end', '2024-07-10');

    expect(last(onDirtyChange)).toBe(true);
  });

  it('is dirty once the currency alone changes', async () => {
    const user = userEvent.setup();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
    const onDirtyChange = vi.fn();
    render(
      <TripForm trip={createTestTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />,
    );
    expect(last(onDirtyChange)).toBe(false);

    await user.click(screen.getByRole('combobox', { name: 'trips.currency' }));
    await user.click(await screen.findByRole('option', { name: 'trips.currencies.USD' }));

    expect(last(onDirtyChange)).toBe(true);
  });

  it('is pristine again on the next trip it is given', () => {
    const onDirtyChange = vi.fn();
    const { rerender } = render(
      <TripForm trip={createTestTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />,
    );

    rerender(
      <TripForm
        trip={createTestTrip({ id: 'trip-2' as TripId, name: 'Other', location: 'Elsewhere' })}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );

    expect(last(onDirtyChange)).toBe(false);
  });

});

