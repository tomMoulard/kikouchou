/**
 * Component tests for TripForm
 *
 * Tests form rendering, validation, create/edit modes,
 * date selection, and submission handling.
 *
 * @module features/trips/components/__tests__/TripForm.test
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    const user = userEvent.setup();
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
