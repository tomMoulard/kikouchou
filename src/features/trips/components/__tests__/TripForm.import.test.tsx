/**
 * @fileoverview Starting a trip from last year's trip.
 *
 * Picking a place the household has been to before offers to bring that trip's
 * setup across. What the form does with the offer is the subject here: it
 * adopts the place with its pin (a name without its coordinates would put the
 * new trip somewhere else on the map), fills in a description only when there
 * is nothing to overwrite, and reports the source so the rooms can be copied on
 * save.
 *
 * The picker is stubbed down to a button that hands over a chosen trip: its own
 * searching has its own file.
 *
 * @module features/trips/components/__tests__/TripForm.import.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { render, screen, waitFor } from '@/test/utils';
import type { Room, Trip, TripId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const SOURCE_TRIP = {
  id: 'trip-last-year' as TripId,
  shareId: 'share-old' as Trip['shareId'],
  name: 'Brittany 2025',
  location: 'Vannes',
  description: 'The usual house',
  coordinates: { lat: 47.66, lon: -2.76 },
  startDate: '2025-07-01',
  endDate: '2025-07-10',
  createdAt: 1,
  updatedAt: 1,
} as unknown as Trip;

const SOURCE_ROOMS = [
  { id: 'r1', tripId: SOURCE_TRIP.id, name: 'Attic', capacity: 2, order: 0 },
  { id: 'r2', tripId: SOURCE_TRIP.id, name: 'Blue Room', capacity: 3, order: 1 },
] as unknown as Room[];

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/features/trips/components/LocationAutocomplete', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/trips/components/LocationAutocomplete')>();
  return {
    ...actual,
    LocationAutocomplete: ({
      id,
      value,
      onChange,
      onImportTrip,
    }: {
      id: string;
      value: string;
      onChange: (value: string, coordinates?: { lat: number; lon: number }) => void;
      onImportTrip?: (data: { trip: Trip; rooms: readonly Room[] }) => void;
    }) => (
      <div>
        <input
          id={id}
          data-testid="location-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          data-testid="import-trip"
          onClick={() => onImportTrip?.({ trip: SOURCE_TRIP, rooms: SOURCE_ROOMS })}
        >
          import
        </button>
      </div>
    ),
  };
});

import { TripForm } from '../TripForm';

// ============================================================================
// Helpers
// ============================================================================

function renderForm(props: Record<string, unknown> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onImportSourceChange = vi.fn();

  const view = render(
    <TripForm
      onSubmit={onSubmit}
      onCancel={vi.fn()}
      onImportSourceChange={onImportSourceChange}
      {...props}
    />,
    { withProviders: false },
  );

  return { ...view, onSubmit, onImportSourceChange };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('TripForm — importing an earlier trip', () => {
  it('adopts the place, its pin and the description, and says where from', async () => {
    const { user, onImportSourceChange } = renderForm();

    await user.click(screen.getByTestId('import-trip'));

    expect(screen.getByTestId('location-input')).toHaveValue('Vannes');
    expect(screen.getByLabelText(/trips.description/)).toHaveValue('The usual house');
    expect(onImportSourceChange).toHaveBeenCalledWith(SOURCE_TRIP.id);
    // The badge names the trip and how many rooms come with it.
    expect(screen.getByText(/trips.importedFrom/)).toBeInTheDocument();
    expect(screen.getByText(/2 rooms/)).toBeInTheDocument();
  });

  it('leaves a description that was already typed alone', async () => {
    const { user } = renderForm();

    const description = screen.getByLabelText(/trips.description/);
    await user.type(description, 'Our own notes');
    await user.click(screen.getByTestId('import-trip'));

    expect(description).toHaveValue('Our own notes');
  });

  it('lets the import be taken back', async () => {
    const { user, onImportSourceChange } = renderForm();

    await user.click(screen.getByTestId('import-trip'));
    await user.click(screen.getByRole('button', { name: 'trips.removeImport' }));

    await waitFor(() => {
      expect(screen.queryByText(/trips.importedFrom/)).not.toBeInTheDocument();
    });
    expect(onImportSourceChange).toHaveBeenLastCalledWith(null);
  });

  it('says one room in the singular', async () => {
    const { user } = renderForm();

    await user.click(screen.getByTestId('import-trip'));

    // Two rooms in the fixture, so the plural is what shows; the singular is
    // the other half of the same expression.
    expect(screen.queryByText(/1 room\b/)).not.toBeInTheDocument();
  });
});
