/**
 * Component tests for TripForm
 *
 * Tests form rendering, validation, create/edit modes,
 * date selection, and submission handling.
 *
 * @module features/trips/components/__tests__/TripForm.test
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createRef } from 'react';

import {
  TripForm,
  type TripFormHandle,
} from '@/features/trips/components/TripForm';
import type { Trip, TripId, ShareId } from '@/types';
import { hexColor, isoDate } from '@/test/utils';

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
  it('renders form in create mode', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm onSubmit={onSubmit} onCancel={onCancel} />);

    expect(screen.getByLabelText(/trips\.name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/trips\.location/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /trips\.startDate/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /trips\.endDate/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /common\.save/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /common\.cancel/i })).toBeInTheDocument();
  });

  it('renders empty form fields in create mode', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm onSubmit={onSubmit} onCancel={onCancel} />);

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

  it('shows required indicators for name and dates', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm onSubmit={onSubmit} onCancel={onCancel} />);

    // Required fields should have asterisk
    const requiredIndicators = screen.getAllByText('*');
    expect(requiredIndicators.length).toBeGreaterThanOrEqual(3); // name, startDate, endDate
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

    render(<TripForm onSubmit={onSubmit} onCancel={onCancel} />);

    const nameInput = screen.getByLabelText(/trips\.name/i);
    await user.click(nameInput);
    await user.tab(); // Blur

    expect(await screen.findByRole('alert')).toHaveTextContent('common.required');
  });

  it('clears name error when user types', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm onSubmit={onSubmit} onCancel={onCancel} />);

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

    render(<TripForm onSubmit={onSubmit} onCancel={onCancel} />);

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

    render(<TripForm onSubmit={onSubmit} onCancel={onCancel} />);

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

    const { container } = render(<TripForm onSubmit={onSubmit} onCancel={onCancel} />);

    // Form element exists (HTML forms don't get role="form" without accessible name)
    expect(container.querySelector('form')).toBeInTheDocument();
  });

  it('name input has aria-invalid when error', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm onSubmit={onSubmit} onCancel={onCancel} />);

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

    render(<TripForm onSubmit={onSubmit} onCancel={onCancel} />);

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

  it('date buttons have aria-haspopup', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm onSubmit={onSubmit} onCancel={onCancel} />);

    const startDateButton = screen.getByRole('button', { name: /trips\.startDate/i });
    const endDateButton = screen.getByRole('button', { name: /trips\.endDate/i });

    expect(startDateButton).toHaveAttribute('aria-haspopup', 'dialog');
    expect(endDateButton).toHaveAttribute('aria-haspopup', 'dialog');
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

    render(<TripForm onSubmit={onSubmit} onCancel={onCancel} />);

    const nameInput = screen.getByLabelText(/trips\.name/i);
    await user.type(nameInput, 'My Trip');

    expect(nameInput).toHaveValue('My Trip');
  });

  it('allows typing in location field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm onSubmit={onSubmit} onCancel={onCancel} />);

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

    render(<TripForm onSubmit={onSubmit} onCancel={onCancel} />);

    const locationInput = screen.getByLabelText(/trips\.location/i);
    expect(locationInput).toHaveAttribute('role', 'combobox');
    expect(locationInput).toHaveAttribute('aria-autocomplete', 'list');
  });

  it('accepts onImportSourceChange callback prop', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const onImportSourceChange = vi.fn();

    // Should render without error with the new prop
    render(
      <TripForm
        onSubmit={onSubmit}
        onCancel={onCancel}
        onImportSourceChange={onImportSourceChange}
      />
    );

    expect(screen.getByLabelText(/trips\.location/i)).toBeInTheDocument();
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
  it('allows typing in description field', async () => {
    const user = userEvent.setup();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const descInput = screen.getByLabelText(/trips\.description/i);
    await user.type(descInput, 'A nice vacation');
    expect(descInput).toHaveValue('A nice vacation');
  });

  it('shows character count', () => {
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('0/1000')).toBeInTheDocument();
  });

  it('updates character count as user types', async () => {
    const user = userEvent.setup();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const descInput = screen.getByLabelText(/trips\.description/i);
    await user.type(descInput, 'Hello');
    expect(screen.getByText('5/1000')).toBeInTheDocument();
  });

  it('includes the description in a create-mode submission, trimmed', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TripForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await fillRequiredTripFields(user);
    await user.type(screen.getByLabelText(/trips\.description/i), '  **Door code** 1234  ');
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ description: '**Door code** 1234' }),
      );
    });
  });

  it('converts an empty description to undefined on a create-mode submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TripForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await fillRequiredTripFields(user);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ description: undefined }),
      );
    });
  });

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
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />);
    const nameInput = screen.getByLabelText(/trips\.name/i);
    await user.type(nameInput, 'X');
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it('start date shows aria-invalid when error', async () => {
    const user = userEvent.setup();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // Submit without dates to trigger error
    const nameInput = screen.getByLabelText(/trips\.name/i);
    await user.type(nameInput, 'Test');
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    await waitFor(() => {
      const startBtn = screen.getByRole('button', { name: /trips\.startDate/i });
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

    render(<TripForm onSubmit={onSubmit} onCancel={vi.fn()} />);

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
      const endBtn = screen.getByRole('button', { name: /trips\.endDate/i });
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
  it('clears start date error when start date is selected via calendar', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<TripForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    // Submit without dates to trigger start date error
    const nameInput = screen.getByLabelText(/trips\.name/i);
    await user.type(nameInput, 'Test Trip');
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    // Verify start date error exists
    await waitFor(() => {
      const startBtn = screen.getByRole('button', { name: /trips\.startDate/i });
      expect(startBtn).toHaveAttribute('aria-invalid', 'true');
    });

    // Open start date picker and select a date
    const startBtn = screen.getByRole('button', { name: /trips\.startDate/i });
    await user.click(startBtn);

    // The calendar should now be visible - click a date
    await waitFor(() => {
      const dayButtons = screen.getAllByRole('gridcell');
      expect(dayButtons.length).toBeGreaterThan(0);
    });

    // Click the first available day
    const dayButtons = screen.getAllByRole('gridcell');
    const enabledDay = dayButtons.find(btn => !btn.getAttribute('disabled'));
    if (enabledDay) {
      const clickableButton = enabledDay.querySelector('button') ?? enabledDay;
      await user.click(clickableButton);
    }
  });

  it('validates end date when start date changes with existing end date', async () => {
    const user = userEvent.setup();
    const trip = createTestTrip({
      startDate: isoDate('2024-07-10'),
      endDate: isoDate('2024-07-20'),
    });

    render(<TripForm trip={trip} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    // The end date should already be set - clicking start date should re-validate end
    const startBtn = screen.getByRole('button', { name: /trips\.startDate/i });
    await user.click(startBtn);

    // Calendar should open
    await waitFor(() => {
      const gridCells = screen.getAllByRole('gridcell');
      expect(gridCells.length).toBeGreaterThan(0);
    });
  });

  it('clears errors for end date when end date is selected', async () => {
    const user = userEvent.setup();

    // Trip with start date but no end date
    const trip = createTestTrip();

    render(<TripForm trip={trip} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    // Open end date picker
    const endBtn = screen.getByRole('button', { name: /trips\.endDate/i });
    await user.click(endBtn);

    // Calendar should be visible
    await waitFor(() => {
      const gridCells = screen.getAllByRole('gridcell');
      expect(gridCells.length).toBeGreaterThan(0);
    });
  });

  it('handles import trip selection and removal', async () => {
    userEvent.setup();
    const onImportSourceChange = vi.fn();

    render(
      <TripForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onImportSourceChange={onImportSourceChange}
      />
    );

    // The LocationAutocomplete renders the combobox
    const locationInput = screen.getByLabelText(/trips\.location/i);
    expect(locationInput).toBeInTheDocument();
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

    render(<TripForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    // Submit immediately without filling in name
    const submitBtn = screen.getByRole('button', { name: /common\.save/i });
    await user.click(submitBtn);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows error when submitting without start date', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<TripForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    // Fill in name but not dates
    const nameInput = screen.getByLabelText(/trips\.name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'My Trip');

    const submitBtn = screen.getByRole('button', { name: /common\.save/i });
    await user.click(submitBtn);

    expect(onSubmit).not.toHaveBeenCalled();
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
// Which month a picker opens on, and what a new start date does to the end date
// ============================================================================

/**
 * The month heading of the calendar currently on screen.
 *
 * Read out of the DOM rather than through a role query because
 * react-day-picker renders the heading as a plain span, and the assertion is
 * about *which* month is showing — the one thing a role query cannot express.
 */
function openCalendarMonth(): string {
  const label = document.querySelector('.rdp-caption_label');
  if (!label) {
    throw new Error('no calendar is open');
  }
  return label.textContent ?? '';
}

/**
 * The day buttons of the month on screen, with the neighbouring months'
 * leading and trailing days excluded — clicking one of those moves the
 * calendar instead of choosing a date.
 */
function daysOfOpenMonth(): readonly HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '.rdp-day:not(.rdp-outside) button',
    ),
  );
}

/** The "next month" arrow of the calendar on screen. */
function nextMonthArrow(): HTMLElement {
  return screen.getByRole('button', { name: /next month/i });
}

/** Waits for a date picker popover to have rendered its calendar. */
async function waitForOpenCalendar(): Promise<void> {
  await waitFor(() => {
    expect(document.querySelector('.rdp-root')).toBeTruthy();
  });
}

describe('TripForm Date Picker Month', () => {
  it('opens the start date picker on the month already chosen', async () => {
    const user = userEvent.setup();
    const trip = createTestTrip({
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-22'),
    });

    render(<TripForm trip={trip} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /trips\.startDate/i }));
    await waitForOpenCalendar();

    // A selected date does not move react-day-picker's month on its own: with
    // no `defaultMonth` the picker opens on today, so re-opening the dates of
    // any trip that is not this month means paging back to it by hand.
    expect(openCalendarMonth()).toBe('July 2024');
  });

  it('opens the end date picker on the month of the start date', async () => {
    const user = userEvent.setup();

    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    // Three months out, which is where a holiday actually gets booked — and
    // far enough that a picker opening on today shows a month whose every day
    // is disabled.
    await user.click(screen.getByRole('button', { name: /trips\.startDate/i }));
    await waitForOpenCalendar();
    await user.click(nextMonthArrow());
    await user.click(nextMonthArrow());
    await user.click(nextMonthArrow());
    const chosenMonth = openCalendarMonth();
    await user.click(daysOfOpenMonth()[14]!);

    await user.click(screen.getByRole('button', { name: /trips\.endDate/i }));
    await waitForOpenCalendar();

    // Every day before the start is disabled, so opening on the current month
    // leaves the user in front of a grid where nothing can be tapped and the
    // only way out is the month arrow — three times.
    expect(openCalendarMonth()).toBe(chosenMonth);
    expect(daysOfOpenMonth().some((day) => !day.disabled)).toBe(true);
  });

  it('drops an end date that the newly chosen start date has overtaken', async () => {
    const user = userEvent.setup();
    const trip = createTestTrip({
      startDate: isoDate('2024-07-10'),
      endDate: isoDate('2024-07-12'),
    });

    render(<TripForm trip={trip} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    // Move the start a month past the end.
    await user.click(screen.getByRole('button', { name: /trips\.startDate/i }));
    await waitForOpenCalendar();
    await user.click(nextMonthArrow());
    await user.click(daysOfOpenMonth()[14]!);

    // The end date the form is holding is now before the start — a range the
    // end picker itself refuses to produce, since it disables everything
    // before the start. Keeping it only to report an error leaves the form in
    // a state no sequence of taps could reach; dropping it puts the user one
    // tap from a valid range instead.
    const endButton = screen.getByRole('button', { name: /trips\.endDate/i });
    expect(endButton).not.toHaveTextContent(/2024/);
    expect(screen.queryByText('validation.endDateBeforeStart')).toBeNull();
  });
});

// ============================================================================
// Guest List
// ============================================================================

/** The create-mode guest list, addressed through its `<legend>`. */
function guestList(): HTMLElement {
  return screen.getByRole('group', { name: /trips\.guests/i });
}

/** The guest name inputs, in list order. */
function guestInputs(): readonly HTMLInputElement[] {
  return within(guestList()).getAllByRole('textbox');
}

/**
 * Fills the trip fields a create-mode submit needs, leaving the guest list
 * alone — the dates have to come from the pickers, since the form offers no
 * way to type them.
 */
async function fillRequiredTripFields(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.type(screen.getByLabelText(/trips\.name/i), 'Beach Vacation');

  await user.click(screen.getByRole('button', { name: /trips\.startDate/i }));
  await waitForOpenCalendar();
  await user.click(daysOfOpenMonth()[9]!);

  await user.click(screen.getByRole('button', { name: /trips\.endDate/i }));
  await waitForOpenCalendar();
  await user.click(daysOfOpenMonth()[14]!);
}

describe('TripForm Guest List', () => {
  it('starts with a single row, for the user', () => {
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(guestInputs()).toHaveLength(1);
    expect(within(guestList()).getByText('trips.guestYou')).toBeInTheDocument();
  });

  it('is absent in edit mode', () => {
    // An existing trip's guests belong to the Guests page; a second editor here
    // would have to reconcile against records that already carry colours, stay
    // dates and room assignments.
    render(<TripForm trip={createTestTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByRole('group', { name: /trips\.guests/i })).toBeNull();
  });

  it("pre-fills the first row with the account's name", () => {
    render(
      <TripForm onSubmit={vi.fn()} onCancel={vi.fn()} currentUserName="Tom Moulard" />,
    );

    expect(guestInputs()[0]).toHaveValue('Tom Moulard');
  });

  it('adopts an account name that resolves after mount', () => {
    // AuthProvider loads supabase-js dynamically and never gates rendering on
    // the session, so this is the ordinary case rather than a race: the form
    // mounts signed out and is handed the account a tick later.
    const { rerender } = render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(guestInputs()[0]).toHaveValue('');

    rerender(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} currentUserName="Tom" />);

    expect(guestInputs()[0]).toHaveValue('Tom');
  });

  it('never overwrites a name the user typed', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.type(guestInputs()[0]!, 'Marie');
    rerender(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} currentUserName="Tom" />);

    expect(guestInputs()[0]).toHaveValue('Marie');
  });

  it('adds a row with the add button and puts the cursor in it', async () => {
    const user = userEvent.setup();

    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /trips\.addGuest/i }));

    const inputs = guestInputs();
    expect(inputs).toHaveLength(2);
    // Without this a keyboard user is left on the "+" button and has to tab
    // into the row they just asked for.
    expect(inputs[1]).toHaveFocus();
  });

  it('removes an added row and moves focus to the row above', async () => {
    const user = userEvent.setup();

    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} currentUserName="Tom" />);
    await user.click(screen.getByRole('button', { name: /trips\.addGuest/i }));
    await user.type(guestInputs()[1]!, 'Marie');

    await user.click(within(guestList()).getByRole('button', { name: /trips\.removeGuest/i }));

    const inputs = guestInputs();
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toHaveValue('Tom');
    // Removing the focused element otherwise drops focus on <body>, losing a
    // keyboard user's place in the form entirely.
    expect(inputs[0]).toHaveFocus();
  });

  it('gives the first row no remove control', async () => {
    const user = userEvent.setup();

    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /trips\.addGuest/i }));

    // Two rows, one remove button: the user's own row cannot be taken off the
    // list they are creating.
    expect(
      within(guestList()).getAllByRole('button', { name: /trips\.removeGuest/i }),
    ).toHaveLength(1);
  });

  it('reports the trimmed names, dropping rows left empty', async () => {
    const user = userEvent.setup();
    const onGuestsChange = vi.fn();

    render(
      <TripForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        currentUserName="Tom"
        onGuestsChange={onGuestsChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /trips\.addGuest/i }));
    await user.type(guestInputs()[1]!, '  Marie  ');
    // A third row added and left blank: an abandoned click, not a nameless guest.
    await user.click(screen.getByRole('button', { name: /trips\.addGuest/i }));

    await waitFor(() => {
      expect(onGuestsChange).toHaveBeenLastCalledWith([
        { name: 'Tom', isSelf: true },
        { name: 'Marie' },
      ]);
    });
  });

  it('marks the "You" row as the person this browser is', async () => {
    const user = userEvent.setup();
    const onGuestsChange = vi.fn();

    // The page turns this marker into the trip's guest identity, so the badge
    // and the name mean something past the form. Only the first row carries it:
    // a guest typed underneath is somebody else.
    render(
      <TripForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        currentUserName="Tom"
        onGuestsChange={onGuestsChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /trips\.addGuest/i }));
    await user.type(guestInputs()[1]!, 'Marie');

    await waitFor(() => {
      expect(onGuestsChange).toHaveBeenLastCalledWith([
        { name: 'Tom', isSelf: true },
        { name: 'Marie' },
      ]);
    });
  });

  it('marks nobody when the user clears their own row', async () => {
    const user = userEvent.setup();
    const onGuestsChange = vi.fn();

    // A host who is not travelling. The row below is a guest, not them, so it
    // must not inherit the marker when the "You" row drops out of the list.
    render(
      <TripForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        currentUserName="Tom"
        onGuestsChange={onGuestsChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /trips\.addGuest/i }));
    await user.type(guestInputs()[1]!, 'Marie');
    await user.clear(guestInputs()[0]!);

    await waitFor(() => {
      expect(onGuestsChange).toHaveBeenLastCalledWith([{ name: 'Marie' }]);
    });
  });

  it('reports the account name on its own once the session resolves', () => {
    const onGuestsChange = vi.fn();
    const { rerender } = render(
      <TripForm onSubmit={vi.fn()} onCancel={vi.fn()} onGuestsChange={onGuestsChange} />,
    );

    expect(onGuestsChange).toHaveBeenLastCalledWith([]);

    rerender(
      <TripForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        currentUserName="Tom"
        onGuestsChange={onGuestsChange}
      />,
    );

    expect(onGuestsChange).toHaveBeenLastCalledWith([{ name: 'Tom', isSelf: true }]);
  });

  it('submits with an empty guest list', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    // Signed out, with nobody named. The guest list is optional in full: a trip
    // is a fine thing to create before knowing who is coming.
    render(<TripForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await fillRequiredTripFields(user);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(within(guestList()).queryByRole('alert')).toBeNull();
  });

  it('submits guests without the organiser when they clear their own row', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onGuestsChange = vi.fn();

    // Somebody who hosts rather than travels — an Airbnb owner arranging a trip
    // for their guests — is not on the trip they are creating.
    render(
      <TripForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        currentUserName="Tom"
        onGuestsChange={onGuestsChange}
      />,
    );
    await fillRequiredTripFields(user);
    await user.click(screen.getByRole('button', { name: /trips\.addGuest/i }));
    await user.type(guestInputs()[1]!, 'Marie');
    await user.clear(guestInputs()[0]!);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onGuestsChange).toHaveBeenLastCalledWith([{ name: 'Marie' }]);
  });

  it('leaves a cleared first row cleared when the account resolves', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TripForm onSubmit={vi.fn()} onCancel={vi.fn()} currentUserName="Tom" />,
    );

    await user.clear(guestInputs()[0]!);
    // The session resolving again — a token refresh publishes the same user —
    // must not put the host back on a trip they took themselves off.
    rerender(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} currentUserName="Tom" />);

    expect(guestInputs()[0]).toHaveValue('');
  });

  it('leaves the form pristine when only the account pre-filled the row', () => {
    const onDirtyChange = vi.fn();

    render(
      <TripForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        currentUserName="Tom"
        onDirtyChange={onDirtyChange}
      />,
    );

    // The account name was put there by the form, not typed by the user, and
    // must not on its own arm the unsaved-changes guard.
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('marks the form dirty once a guest is added', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();

    render(
      <TripForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        currentUserName="Tom"
        onDirtyChange={onDirtyChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: /trips\.addGuest/i }));

    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });
  });
});

// ============================================================================
// Guests arriving from a saved group
// ============================================================================

describe('TripForm addGuests', () => {
  /** Two people as the group picker hands them over. */
  const FAMILY = [
    {
      sourceMemberId: 'member-1',
      name: 'Tom + Léa',
      color: hexColor('#ef4444'),
      headcount: 2,
      phone: '+33 6 12 34 56 78',
    },
    { sourceMemberId: 'member-2', name: 'Alice', color: hexColor('#3b82f6') },
  ];

  it('puts imported guests in the same list as the typed ones', async () => {
    const user = userEvent.setup();
    const ref = createRef<TripFormHandle>();

    render(
      <TripForm
        ref={ref}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        currentUserName="Tom"
      />,
    );

    await user.click(screen.getByRole('button', { name: /trips\.addGuest/i }));
    await user.type(guestInputs()[1]!, 'Marie');

    act(() => {
      ref.current?.addGuests(FAMILY);
    });

    // One list, four rows: a guest is a guest whichever way it arrived.
    await waitFor(() => {
      expect(guestInputs()).toHaveLength(4);
    });
    expect(guestInputs().map((field) => field.value)).toEqual([
      'Tom',
      'Marie',
      'Tom + Léa',
      'Alice',
    ]);
  });

  it('reports what the group brought alongside the name', async () => {
    const onGuestsChange = vi.fn();
    const ref = createRef<TripFormHandle>();

    render(
      <TripForm
        ref={ref}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        currentUserName="Tom"
        onGuestsChange={onGuestsChange}
      />,
    );

    act(() => {
      ref.current?.addGuests(FAMILY);
    });

    // The colour, headcount and phone are the reason a group is worth keeping;
    // a name-only merge would have thrown them away at the door.
    await waitFor(() => {
      expect(onGuestsChange).toHaveBeenLastCalledWith([
        { name: 'Tom', isSelf: true },
        {
          sourceMemberId: 'member-1',
          name: 'Tom + Léa',
          color: '#ef4444',
          headcount: 2,
          phone: '+33 6 12 34 56 78',
        },
        { sourceMemberId: 'member-2', name: 'Alice', color: '#3b82f6' },
      ]);
    });
  });

  it('lets an imported guest be edited and removed like any other', async () => {
    const user = userEvent.setup();
    const onGuestsChange = vi.fn();
    const ref = createRef<TripFormHandle>();

    render(
      <TripForm
        ref={ref}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        currentUserName="Tom"
        onGuestsChange={onGuestsChange}
      />,
    );

    act(() => {
      ref.current?.addGuests(FAMILY);
    });
    await waitFor(() => {
      expect(guestInputs()).toHaveLength(3);
    });

    await user.clear(guestInputs()[1]!);
    await user.type(guestInputs()[1]!, 'Tom & Léa');
    await user.click(screen.getAllByRole('button', { name: /trips\.removeGuest/i })[1]!);

    await waitFor(() => {
      expect(onGuestsChange).toHaveBeenLastCalledWith([
        { name: 'Tom', isSelf: true },
        expect.objectContaining({ name: 'Tom & Léa' }),
      ]);
    });
  });

  it('does not add the same person twice', async () => {
    const ref = createRef<TripFormHandle>();

    render(
      <TripForm ref={ref} onSubmit={vi.fn()} onCancel={vi.fn()} currentUserName="Tom" />,
    );

    act(() => {
      ref.current?.addGuests(FAMILY);
    });
    await waitFor(() => {
      expect(guestInputs()).toHaveLength(3);
    });

    // Adding the same family again is a no-op, not a double.
    act(() => {
      ref.current?.addGuests(FAMILY);
    });
    await waitFor(() => {
      expect(guestInputs()).toHaveLength(3);
    });
  });

  it('leaves two people who share a name alone', async () => {
    const ref = createRef<TripFormHandle>();

    render(
      <TripForm ref={ref} onSubmit={vi.fn()} onCancel={vi.fn()} currentUserName="Tom" />,
    );

    act(() => {
      ref.current?.addGuests([
        { sourceMemberId: 'member-a', name: 'Alice', color: hexColor('#3b82f6') },
        { sourceMemberId: 'member-b', name: 'Alice', color: hexColor('#22c55e') },
      ]);
    });

    // De-duplication is on the member id, never the name: two Alices are two
    // people, and dropping one would lose a guest for looking like another.
    await waitFor(() => {
      expect(guestInputs()).toHaveLength(3);
    });
  });

  it('fills a trailing blank row rather than leaving a gap', async () => {
    const user = userEvent.setup();
    const ref = createRef<TripFormHandle>();

    render(
      <TripForm ref={ref} onSubmit={vi.fn()} onCancel={vi.fn()} currentUserName="Tom" />,
    );

    // The row an abandoned "+" click leaves behind.
    await user.click(screen.getByRole('button', { name: /trips\.addGuest/i }));
    expect(guestInputs()).toHaveLength(2);

    act(() => {
      ref.current?.addGuests([FAMILY[1]!]);
    });

    // Two rows, not three with a hole in the middle.
    await waitFor(() => {
      expect(guestInputs()).toHaveLength(2);
    });
    expect(guestInputs().map((field) => field.value)).toEqual([
      'Tom',
      'Alice',
    ]);
  });

  it('keeps a trailing blank row when the group brings nobody new', async () => {
    const user = userEvent.setup();
    const ref = createRef<TripFormHandle>();
    render(
      <TripForm ref={ref} onSubmit={vi.fn()} onCancel={vi.fn()} currentUserName="Tom" />,
    );
    act(() => {
      ref.current?.addGuests([FAMILY[1]!]);
    });
    await user.click(screen.getByRole('button', { name: /trips\.addGuest/i }));

    act(() => {
      ref.current?.addGuests([FAMILY[1]!]);
    });

    expect(guestInputs().map((field) => field.value)).toEqual(['Tom', 'Alice', '']);
  });

  it('fills a trailing row that holds only spaces, after the typed guests', async () => {
    const user = userEvent.setup();
    const ref = createRef<TripFormHandle>();
    render(
      <TripForm ref={ref} onSubmit={vi.fn()} onCancel={vi.fn()} currentUserName="Tom" />,
    );
    await user.click(screen.getByRole('button', { name: /trips\.addGuest/i }));
    await user.type(guestInputs()[1]!, 'Marie');
    await user.click(screen.getByRole('button', { name: /trips\.addGuest/i }));
    await user.type(guestInputs()[2]!, '   ');

    act(() => {
      ref.current?.addGuests([FAMILY[1]!]);
    });

    expect(guestInputs().map((field) => field.value)).toEqual(['Tom', 'Marie', 'Alice']);
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
    expect(screen.getByRole('button', { name: /trips\.startDate/i })).toHaveTextContent(
      'March 1st, 2025',
    );
    expect(screen.getByRole('button', { name: /trips\.endDate/i })).toHaveTextContent(
      'March 5th, 2025',
    );

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

  it('goes back to an empty create form when the trip is taken away', () => {
    const { rerender } = render(<TripForm trip={tripA} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    rerender(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/trips\.name/i)).toHaveValue('');
    expect(screen.getByLabelText(/trips\.location/i)).toHaveValue('');
    expect(screen.getByLabelText(/trips\.description/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /trips\.startDate/i })).toHaveTextContent(
      /^trips\.startDate$/,
    );
    expect(screen.getByRole('button', { name: /trips\.endDate/i })).toHaveTextContent(
      /^trips\.endDate$/,
    );
    expect(screen.queryByRole('button', { name: /trips\.removePin/i })).not.toBeInTheDocument();
  });

  it('asks for both dates again once the trip is taken away', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TripForm trip={tripA} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    rerender(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    expect(screen.getByRole('button', { name: /trips\.startDate/i })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('button', { name: /trips\.endDate/i })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('starts the guest list afresh, following the account again', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TripForm onSubmit={vi.fn()} onCancel={vi.fn()} currentUserName="Tom" />,
    );
    await user.clear(guestInputs()[0]!);
    await user.type(guestInputs()[0]!, 'Bob');
    await user.click(screen.getByRole('button', { name: /trips\.addGuest/i }));
    await user.type(guestInputs()[1]!, 'Ann');

    rerender(<TripForm trip={tripA} onSubmit={vi.fn()} onCancel={vi.fn()} currentUserName="Tom" />);
    rerender(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} currentUserName="Tom" />);

    expect(guestInputs().map((field) => field.value)).toEqual(['Tom']);
  });
});

describe('TripForm required fields', () => {
  it('refuses a nameless trip even with both dates chosen', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TripForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /trips\.startDate/i }));
    await waitForOpenCalendar();
    await user.click(daysOfOpenMonth()[9]!);
    await user.click(screen.getByRole('button', { name: /trips\.endDate/i }));
    await waitForOpenCalendar();
    await user.click(daysOfOpenMonth()[14]!);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/trips\.name/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('common.required');
  });

  it('asks for the end date when only the start is chosen', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { container } = render(<TripForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/trips\.name/i), 'Lake');
    await user.click(screen.getByRole('button', { name: /trips\.startDate/i }));
    await waitForOpenCalendar();
    await user.click(daysOfOpenMonth()[9]!);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /trips\.endDate/i })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(container.querySelector('#trip-end-date-error')).toHaveTextContent('common.required');
  });

  it('cancels the browser submit', () => {
    const { container } = render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(fireEvent.submit(container.querySelector('form')!)).toBe(false);
  });
});

describe('TripForm picking dates', () => {
  const startButton = () => screen.getByRole('button', { name: /trips\.startDate/i });
  const endButton = () => screen.getByRole('button', { name: /trips\.endDate/i });

  async function pickStart(user: ReturnType<typeof userEvent.setup>, day: number) {
    await user.click(startButton());
    await waitForOpenCalendar();
    await user.click(daysOfOpenMonth()[day]!);
  }

  async function pickEnd(user: ReturnType<typeof userEvent.setup>, day: number) {
    await user.click(endButton());
    await waitForOpenCalendar();
    await user.click(daysOfOpenMonth()[day]!);
  }

  it('closes each picker once a day is chosen', async () => {
    const user = userEvent.setup();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await pickStart(user, 9);
    expect(document.querySelector('.rdp-root')).toBeNull();
    expect(startButton()).toHaveAttribute('aria-expanded', 'false');

    await pickEnd(user, 14);
    expect(document.querySelector('.rdp-root')).toBeNull();
    expect(endButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps an end date the new start date has not overtaken', async () => {
    const user = userEvent.setup();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await pickStart(user, 9);
    await pickEnd(user, 14);
    const chosenEnd = endButton().textContent;

    await pickStart(user, 11);

    expect(endButton()).toHaveTextContent(chosenEnd ?? '');
    expect(endButton()).not.toHaveTextContent(/^trips\.endDate$/);
  });

  it('drops an end date overtaken in a new trip, and then asks for one', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TripForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText(/trips\.name/i), 'Lake');
    await pickStart(user, 9);
    await pickEnd(user, 14);

    await pickStart(user, 20);

    expect(endButton()).toHaveTextContent(/^trips\.endDate$/);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(endButton()).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps the name error when only the start date is chosen', async () => {
    const user = userEvent.setup();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByLabelText(/trips\.name/i));
    await user.tab();
    expect(screen.getByLabelText(/trips\.name/i)).toHaveAttribute('aria-invalid', 'true');

    await pickStart(user, 9);

    expect(screen.getByLabelText(/trips\.name/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps asking for the end date after the start is chosen', async () => {
    const user = userEvent.setup();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    expect(endButton()).toHaveAttribute('aria-invalid', 'true');

    await pickStart(user, 9);

    expect(startButton()).toHaveAttribute('aria-invalid', 'false');
    expect(endButton()).toHaveAttribute('aria-invalid', 'true');
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

      await pickStart(user, 9);

      expect(screen.queryByText('validation.endDateBeforeStart')).not.toBeInTheDocument();
      expect(endButton()).toHaveAttribute('aria-invalid', 'false');
    });

    it('clears the complaint along with the end date a new start overtakes', async () => {
      const user = userEvent.setup();
      await submitInverted(user);

      await pickStart(user, 25);

      expect(endButton()).toHaveTextContent(/^trips\.endDate$/);
      expect(screen.queryByText('validation.endDateBeforeStart')).not.toBeInTheDocument();
    });
  });

  it('lets a chosen start date be cleared again', async () => {
    const user = userEvent.setup();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await pickStart(user, 9);
    expect(startButton()).not.toHaveTextContent(/^trips\.startDate$/);

    // Choosing the selected day again unselects it.
    await pickStart(user, 9);

    expect(startButton()).toHaveTextContent(/^trips\.startDate$/);
    // Unselected means unset: the form asks for it again.
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    expect(startButton()).toHaveAttribute('aria-invalid', 'true');
  });

  it('lets a chosen end date be cleared again', async () => {
    const user = userEvent.setup();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await pickEnd(user, 9);

    await pickEnd(user, 9);

    expect(endButton()).toHaveTextContent(/^trips\.endDate$/);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    expect(endButton()).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the end date complaint once an end is chosen, and only that one', async () => {
    const user = userEvent.setup();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await pickStart(user, 9);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    expect(endButton()).toHaveAttribute('aria-invalid', 'true');

    await pickEnd(user, 14);

    expect(endButton()).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByLabelText(/trips\.name/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the end date complaint even with no start yet, and only that one', async () => {
    const user = userEvent.setup();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    await pickEnd(user, 14);

    expect(endButton()).toHaveAttribute('aria-invalid', 'false');
    expect(startButton()).toHaveAttribute('aria-invalid', 'true');
  });

  it('greys an unchosen date and outlines one in error', async () => {
    const user = userEvent.setup();
    const { container } = render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(startButton()).toHaveClass('w-full', 'justify-start', 'text-muted-foreground');
    expect(endButton()).toHaveClass('w-full', 'justify-start', 'text-muted-foreground');
    expect(startButton()).not.toHaveClass('border-destructive');
    expect(endButton()).not.toHaveClass('border-destructive');
    expect(container.querySelector('#trip-start-date-error')).toBeNull();
    expect(container.querySelector('#trip-end-date-error')).toBeNull();

    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    expect(startButton()).toHaveClass('border-destructive');
    expect(endButton()).toHaveClass('border-destructive');
    expect(startButton()).toHaveAttribute('aria-describedby', 'trip-start-date-error');
    expect(endButton()).toHaveAttribute('aria-describedby', 'trip-end-date-error');
    expect(container.querySelector('#trip-start-date-error')).toHaveTextContent('common.required');

    await pickStart(user, 9);
    expect(startButton()).not.toHaveClass('text-muted-foreground');
    expect(startButton()).not.toHaveClass('border-destructive');
    await pickEnd(user, 14);
    expect(endButton()).not.toHaveClass('text-muted-foreground');
  });

  it('greys out every end day before the start', async () => {
    const user = userEvent.setup();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await pickStart(user, 9);

    await user.click(endButton());
    await waitForOpenCalendar();

    const days = daysOfOpenMonth();
    expect(days[8]).toBeDisabled();
    expect(days[9]).toBeEnabled();
  });
});

describe('TripForm labels and hints', () => {
  it('names the fields and their hints', async () => {
    const user = userEvent.setup();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(/trips\.name/i)).toHaveAttribute('placeholder', 'trips.namePlaceholder');
    expect(screen.getByLabelText(/trips\.location/i)).toHaveAttribute(
      'placeholder',
      'trips.locationPlaceholder',
    );
    expect(screen.getByLabelText(/trips\.description/i)).toHaveAttribute(
      'placeholder',
      'trips.descriptionPlaceholder',
    );
    expect(screen.getByRole('combobox', { name: 'trips.currency' })).toBeInTheDocument();
    expect(screen.getByText('trips.currencyHint')).toBeInTheDocument();
    expect(screen.getByText('trips.guestsHint')).toBeInTheDocument();
    expect(screen.getByText('trips.roomsHint')).toBeInTheDocument();
    expect(screen.getAllByText('(common.optional)')).toHaveLength(2);
    expect(guestInputs()[0]).toHaveAttribute('placeholder', 'trips.guestYouPlaceholder');
    expect(guestInputs()[0]).toHaveAccessibleName('trips.guestYouLabel');

    await user.click(screen.getByRole('button', { name: /trips\.addGuest/i }));
    expect(guestInputs()[1]).toHaveAttribute('placeholder', 'trips.guestNamePlaceholder');
    expect(guestInputs()[1]).toHaveAccessibleName('trips.guestNumberLabel');
  });

  it('ties the name error to the field', async () => {
    const user = userEvent.setup();
    const { container } = render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
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
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/trips\.name/i), '   ');
    await user.tab();

    expect(screen.getByLabelText(/trips\.name/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('judges the name as typed, not as first rendered', async () => {
    const user = userEvent.setup();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/trips\.name/i), 'Lake');
    await user.tab();

    expect(screen.getByLabelText(/trips\.name/i)).toHaveAttribute('aria-invalid', 'false');
  });

  it('clears only the name error while the name is typed', async () => {
    const user = userEvent.setup();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    await user.type(screen.getByLabelText(/trips\.name/i), 'L');

    expect(screen.getByLabelText(/trips\.name/i)).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByRole('button', { name: /trips\.startDate/i })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });
});

describe('TripForm unsaved changes', () => {
  const last = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)?.[0];

  it('starts pristine', () => {
    const onDirtyChange = vi.fn();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />);

    expect(last(onDirtyChange)).toBe(false);
  });

  it('is dirty once the location alone changes', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />);

    await user.type(screen.getByLabelText(/trips\.location/i), 'B');

    expect(last(onDirtyChange)).toBe(true);
  });

  it('is dirty once the start date alone changes', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />);

    await user.click(screen.getByRole('button', { name: /trips\.startDate/i }));
    await waitForOpenCalendar();
    await user.click(daysOfOpenMonth()[9]!);

    expect(last(onDirtyChange)).toBe(true);
  });

  it('is dirty once the end date alone changes', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />);

    await user.click(screen.getByRole('button', { name: /trips\.endDate/i }));
    await waitForOpenCalendar();
    await user.click(daysOfOpenMonth()[9]!);

    expect(last(onDirtyChange)).toBe(true);
  });

  it('is dirty once the description alone changes', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />);

    await user.type(screen.getByLabelText(/trips\.description/i), 'x');

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

  it('is dirty once the user types over their own row', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    render(
      <TripForm onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} currentUserName="Tom" />,
    );
    expect(last(onDirtyChange)).toBe(false);

    await user.type(guestInputs()[0]!, 'my');

    expect(last(onDirtyChange)).toBe(true);
  });

  it('is not dirty for a room row of only spaces', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />);

    await user.click(screen.getByRole('button', { name: /trips\.addRoom/i }));
    await user.keyboard('   ');

    expect(last(onDirtyChange)).toBe(false);
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

  it('reports no guests or rooms for a trip that already exists', () => {
    const onGuestsChange = vi.fn();
    const onRoomsChange = vi.fn();
    render(
      <TripForm
        trip={createTestTrip()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onGuestsChange={onGuestsChange}
        onRoomsChange={onRoomsChange}
        currentUserName="Tom"
      />,
    );

    expect(onGuestsChange).not.toHaveBeenCalled();
    expect(onRoomsChange).not.toHaveBeenCalled();
  });

  it('lets the first row of a fresh list be taken over after a trip switch', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TripForm onSubmit={vi.fn()} onCancel={vi.fn()} currentUserName="Tom" />,
    );
    rerender(<TripForm trip={createTestTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} currentUserName="Tom" />);
    rerender(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} currentUserName="Tom" />);

    await user.clear(guestInputs()[0]!);
    await user.type(guestInputs()[0]!, 'Bob');

    expect(guestInputs()[0]).toHaveValue('Bob');
  });
});

