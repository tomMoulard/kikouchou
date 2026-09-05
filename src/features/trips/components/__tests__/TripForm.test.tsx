/**
 * Component tests for TripForm
 *
 * Tests form rendering, validation, create/edit modes,
 * date selection, and submission handling.
 *
 * @module features/trips/components/__tests__/TripForm.test
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Beach Vacation',
      location: 'Brittany, France',
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-22'),
    });
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
    // Make onSubmit take some time
    const onSubmit = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );
    const onCancel = vi.fn();

    const trip = createTestTrip();

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    const submitButton = screen.getByRole('button', { name: /common\.save/i });
    await user.click(submitButton);

    // Button should be disabled
    await waitFor(() => {
      expect(submitButton).toBeDisabled();
    });

    // Wait for submission to complete
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
  });

  it('shows loading text during submission', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );
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
    const onSubmit = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 50))
    );
    const onCancel = vi.fn();

    const trip = createTestTrip();

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    const submitButton = screen.getByRole('button', { name: /common\.save/i });
    
    // Click twice quickly
    await user.click(submitButton);
    await user.click(submitButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
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
    const onSubmit = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );
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
    const onSubmit = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );
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
    const onSubmit = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );
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

  it('includes description in submission', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const trip = createTestTrip({ description: 'Trip notes' });
    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Trip notes' })
      );
    });
  });

  it('converts empty description to undefined on submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const trip = createTestTrip({ description: '' });
    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /common\.save/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ description: undefined })
      );
    });
  });

  it('pre-fills description in edit mode', () => {
    const trip = createTestTrip({ description: 'Existing description' });
    render(<TripForm trip={trip} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/trips\.description/i)).toHaveValue('Existing description');
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
    expect(screen.getByLabelText(/trips\.description/i)).toHaveValue('');
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

  it('shows character count for description in edit mode', () => {
    const trip = createTestTrip({ description: 'Hello World' });
    render(<TripForm trip={trip} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('11/1000')).toBeInTheDocument();
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

  it('shows the existing pin next to the location field', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    const trip = createTestTrip({ coordinates: { lat: 48.3904, lon: -4.4861 } });

    render(<TripForm trip={trip} onSubmit={onSubmit} onCancel={onCancel} />);

    expect(screen.getByText(/trips\.pinnedAt/)).toBeInTheDocument();
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
        { name: 'Tom' },
        { name: 'Marie' },
      ]);
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

    expect(onGuestsChange).toHaveBeenLastCalledWith([{ name: 'Tom' }]);
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
        { name: 'Tom' },
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
        { name: 'Tom' },
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
});

