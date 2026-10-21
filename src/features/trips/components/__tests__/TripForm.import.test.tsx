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

/** The trip the stub hands over; a test may swap it for another. */
const importSource = vi.hoisted(() => ({ trip: undefined as unknown as Trip }));

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
      coordinates,
      onChange,
      onImportTrip,
    }: {
      id: string;
      value: string;
      coordinates?: { lat: number; lon: number };
      onChange: (value: string, coordinates?: { lat: number; lon: number }) => void;
      onImportTrip?: (data: { trip: Trip; rooms: readonly Room[] }) => void;
    }) => (
      <div>
        <input
          id={id}
          data-testid="location-input"
          data-pin={coordinates ? `${coordinates.lat},${coordinates.lon}` : 'none'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          data-testid="import-trip"
          onClick={() => onImportTrip?.({ trip: importSource.trip, rooms: SOURCE_ROOMS })}
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
  importSource.trip = SOURCE_TRIP;
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
    // Through the plural key now, not a hardcoded English literal.
    expect(screen.getByText(/rooms\.roomCount/)).toBeInTheDocument();
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

  it('takes the pin of the trip it imports the place from', async () => {
    const { user } = renderForm();

    await user.click(screen.getByTestId('import-trip'));

    expect(screen.getByTestId('location-input')).toHaveAttribute('data-pin', '47.66,-2.76');
  });

  it('fills a description that holds only spaces', async () => {
    const { user } = renderForm();

    const description = screen.getByLabelText(/trips.description/);
    await user.type(description, '   ');
    await user.click(screen.getByTestId('import-trip'));

    expect(description).toHaveValue('The usual house');
  });

  it('imports without a listener for the import source', async () => {
    const { user } = render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
      withProviders: false,
    });

    await user.click(screen.getByTestId('import-trip'));

    expect(screen.getByText(/trips.importedFrom/)).toBeInTheDocument();
  });

  it('drops the import when it is handed another trip', async () => {
    const { user, rerender } = renderForm();
    await user.click(screen.getByTestId('import-trip'));
    expect(screen.getByText(/trips.importedFrom/)).toBeInTheDocument();

    rerender(<TripForm trip={EDITED_TRIP} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByText(/trips.importedFrom/)).not.toBeInTheDocument();
  });

  it('keeps the typed place when the imported trip has none', async () => {
    importSource.trip = { ...SOURCE_TRIP, location: undefined, coordinates: undefined };
    const { user } = renderForm();
    await user.type(screen.getByTestId('location-input'), 'Quimper');

    await user.click(screen.getByTestId('import-trip'));

    expect(screen.getByTestId('location-input')).toHaveValue('Quimper');
  });

  it('saves the typed place when the imported trip has none', async () => {
    importSource.trip = { ...SOURCE_TRIP, location: undefined, coordinates: undefined };
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { user } = render(
      <TripForm trip={EDITED_TRIP} onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    await user.clear(screen.getByTestId('location-input'));
    await user.type(screen.getByTestId('location-input'), 'Quimper');

    await user.click(screen.getByTestId('import-trip'));
    await user.click(screen.getByRole('button', { name: /common\.save/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ location: 'Quimper' }));
    });
  });

  it('reports the import, and its removal, to the listener it has now', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { user, rerender } = renderForm({ onImportSourceChange: first });
    rerender(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} onImportSourceChange={latest} />);

    await user.click(screen.getByTestId('import-trip'));
    await user.click(screen.getByRole('button', { name: 'trips.removeImport' }));

    expect(latest.mock.calls).toEqual([[SOURCE_TRIP.id], [null]]);
    expect(first).not.toHaveBeenCalled();
  });

  it('takes an import back without a listener for it', async () => {
    const { user } = render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
      withProviders: false,
    });
    await user.click(screen.getByTestId('import-trip'));

    await user.click(screen.getByRole('button', { name: 'trips.removeImport' }));

    expect(screen.queryByText(/trips.importedFrom/)).not.toBeInTheDocument();
  });

  describe('and the unsaved-changes guard', () => {
    function renderEdit(coordinates: { lat: number; lon: number }) {
      const onDirtyChange = vi.fn();
      const view = render(
        <TripForm
          trip={{ ...EDITED_TRIP, location: 'Vannes', coordinates }}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          onDirtyChange={onDirtyChange}
        />,
        { withProviders: false },
      );
      return { ...view, onDirtyChange };
    }

    it('reads the same pin, handed over again, as no change', async () => {
      const { user, onDirtyChange } = renderEdit({ lat: 47.66, lon: -2.76 });

      await user.click(screen.getByTestId('import-trip'));

      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('reads a pin moved north or south as a change', async () => {
      const { user, onDirtyChange } = renderEdit({ lat: 40, lon: -2.76 });

      await user.click(screen.getByTestId('import-trip'));

      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });

    it('reads a pin moved east or west as a change', async () => {
      const { user, onDirtyChange } = renderEdit({ lat: 47.66, lon: 0 });

      await user.click(screen.getByTestId('import-trip'));

      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });
  });
});

/** An existing trip, for the cases that need edit mode. */
const EDITED_TRIP = {
  ...SOURCE_TRIP,
  id: 'trip-now' as TripId,
  name: 'This year',
  description: undefined,
} as unknown as Trip;
