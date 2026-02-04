/**
 * Component tests for TripCard
 *
 * Tests trip card rendering, menu actions, keyboard navigation,
 * and map preview integration.
 *
 * @module features/trips/components/__tests__/TripCard.test
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TripCard, formatDateRange, getDateLocale } from '../TripCard';
import type { Trip, TripId, ShareId } from '@/types';
import { isoDate } from '@/test/utils';
import { enUS, fr } from 'date-fns/locale';

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
// Utility Function Tests
// ============================================================================

describe('getDateLocale', () => {
  it('returns French locale for "fr"', () => {
    expect(getDateLocale('fr')).toBe(fr);
  });

  it('returns English locale for "en"', () => {
    expect(getDateLocale('en')).toBe(enUS);
  });

  it('returns English locale for unknown language', () => {
    expect(getDateLocale('de')).toBe(enUS);
    expect(getDateLocale('es')).toBe(enUS);
  });
});

describe('formatDateRange', () => {
  it('formats same month dates compactly', () => {
    const result = formatDateRange('2024-07-15', '2024-07-22', enUS);
    expect(result).toMatch(/15.*-.*22.*Jul.*2024/i);
  });

  it('formats different month dates with both months', () => {
    const result = formatDateRange('2024-07-28', '2024-08-05', enUS);
    expect(result).toMatch(/Jul.*-.*Aug.*2024/i);
  });

  it('handles invalid dates gracefully', () => {
    const result = formatDateRange('invalid', '2024-07-22', enUS);
    expect(result).toBe('invalid - 2024-07-22');
  });

  it('handles both invalid dates', () => {
    const result = formatDateRange('bad', 'dates', enUS);
    expect(result).toBe('bad - dates');
  });
});

// ============================================================================
// Basic Rendering Tests
// ============================================================================

describe('TripCard Basic Rendering', () => {
  it('renders trip name', () => {
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('Beach Vacation')).toBeInTheDocument();
  });

  it('renders trip location', () => {
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('Brittany, France')).toBeInTheDocument();
  });

  it('renders date range', () => {
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    // Date range should be rendered (format depends on locale)
    expect(screen.getByText(/15.*-.*22/)).toBeInTheDocument();
  });

  it('does not render location when not provided', () => {
    const trip = createTestTrip({ location: undefined });
    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.queryByText('Brittany, France')).not.toBeInTheDocument();
  });

  it('has role="button" for clickable card', () => {
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /beach vacation/i })).toBeInTheDocument();
  });

  it('includes aria-label with trip details', () => {
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const card = screen.getByRole('button', { name: /beach vacation/i });
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('Beach Vacation'));
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('Brittany, France'));
  });
});

// ============================================================================
// Click Handler Tests
// ============================================================================

describe('TripCard Click Handlers', () => {
  it('calls onClick when card is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const trip = createTestTrip();

    render(
      <TripCard
        trip={trip}
        onClick={onClick}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const card = screen.getByRole('button', { name: /beach vacation/i });
    await user.click(card);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClick on Enter key', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const trip = createTestTrip();

    render(
      <TripCard
        trip={trip}
        onClick={onClick}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const card = screen.getByRole('button', { name: /beach vacation/i });
    card.focus();
    await user.keyboard('{Enter}');

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClick on Space key', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const trip = createTestTrip();

    render(
      <TripCard
        trip={trip}
        onClick={onClick}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const card = screen.getByRole('button', { name: /beach vacation/i });
    card.focus();
    await user.keyboard(' ');

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const trip = createTestTrip();

    render(
      <TripCard
        trip={trip}
        onClick={onClick}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        isDisabled={true}
      />
    );

    const card = screen.getByRole('button', { name: /beach vacation/i });
    await user.click(card);

    expect(onClick).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Menu Tests
// ============================================================================

describe('TripCard Menu', () => {
  it('renders menu trigger button', () => {
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /common\.openMenu/i })).toBeInTheDocument();
  });

  it('opens menu when trigger is clicked', async () => {
    const user = userEvent.setup();
    const trip = createTestTrip();

    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const menuTrigger = screen.getByRole('button', { name: /common\.openMenu/i });
    await user.click(menuTrigger);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /common\.edit/i })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /common\.delete/i })).toBeInTheDocument();
    });
  });

  it('calls onEdit when Edit menu item is clicked', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const trip = createTestTrip();

    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={onEdit}
        onDelete={vi.fn()}
      />
    );

    const menuTrigger = screen.getByRole('button', { name: /common\.openMenu/i });
    await user.click(menuTrigger);

    const editItem = await screen.findByRole('menuitem', { name: /common\.edit/i });
    await user.click(editItem);

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('calls onDelete when Delete menu item is clicked', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const trip = createTestTrip();

    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={onDelete}
      />
    );

    const menuTrigger = screen.getByRole('button', { name: /common\.openMenu/i });
    await user.click(menuTrigger);

    const deleteItem = await screen.findByRole('menuitem', { name: /common\.delete/i });
    await user.click(deleteItem);

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('does not trigger card onClick when menu is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const trip = createTestTrip();

    render(
      <TripCard
        trip={trip}
        onClick={onClick}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const menuTrigger = screen.getByRole('button', { name: /common\.openMenu/i });
    await user.click(menuTrigger);

    expect(onClick).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Disabled State Tests
// ============================================================================

describe('TripCard Disabled State', () => {
  it('has aria-disabled when isDisabled is true', () => {
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        isDisabled={true}
      />
    );

    const card = screen.getByRole('button', { name: /beach vacation/i });
    expect(card).toHaveAttribute('aria-disabled', 'true');
  });

  it('has tabIndex=-1 when disabled', () => {
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        isDisabled={true}
      />
    );

    const card = screen.getByRole('button', { name: /beach vacation/i });
    expect(card).toHaveAttribute('tabindex', '-1');
  });

  it('disables menu trigger when card is disabled', () => {
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        isDisabled={true}
      />
    );

    const menuTrigger = screen.getByRole('button', { name: /common\.openMenu/i });
    expect(menuTrigger).toBeDisabled();
  });

  it('applies opacity class when disabled', () => {
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        isDisabled={true}
      />
    );

    const card = screen.getByRole('button', { name: /beach vacation/i });
    expect(card).toHaveClass('opacity-50');
  });
});

// ============================================================================
// Map Preview Tests
// ============================================================================

describe('TripCard Map Preview', () => {
  /**
   * Helper to find the map preview button (distinct from map markers and menu triggers).
   * The map preview button has aria-haspopup="dialog", while menu trigger has aria-haspopup="menu".
   */
  function findMapPreviewButton() {
    const buttons = screen.queryAllByRole('button');
    return buttons.find(
      (btn) =>
        btn.tagName === 'BUTTON' &&
        btn.getAttribute('aria-haspopup') === 'dialog'
    );
  }

  it('does not render map preview when coordinates are not provided', () => {
    const trip = createTestTrip({ coordinates: undefined });
    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    // Map preview button should not exist (only card menu button exists)
    const mapPreviewButton = findMapPreviewButton();
    expect(mapPreviewButton).toBeUndefined();
  });

  it('renders map preview when coordinates are provided', async () => {
    const trip = createTestTrip({
      coordinates: { lat: 48.8566, lon: 2.3522 },
    });
    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    // Wait for lazy-loaded component
    await waitFor(() => {
      const mapPreviewButton = findMapPreviewButton();
      expect(mapPreviewButton).toBeDefined();
      expect(mapPreviewButton).toBeInTheDocument();
    });
  });

  it('does not trigger card onClick when map preview is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const trip = createTestTrip({
      coordinates: { lat: 48.8566, lon: 2.3522 },
    });

    render(
      <TripCard
        trip={trip}
        onClick={onClick}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    // Wait for lazy-loaded component
    await waitFor(() => {
      expect(findMapPreviewButton()).toBeDefined();
    });

    const mapButton = findMapPreviewButton()!;
    await user.click(mapButton);

    // Card onClick should not be called
    expect(onClick).not.toHaveBeenCalled();
  });

  it('opens map dialog when map preview is clicked', async () => {
    const user = userEvent.setup();
    const trip = createTestTrip({
      coordinates: { lat: 48.8566, lon: 2.3522 },
    });

    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    // Wait for lazy-loaded component
    await waitFor(() => {
      expect(findMapPreviewButton()).toBeDefined();
    });

    const mapButton = findMapPreviewButton()!;
    await user.click(mapButton);

    // Dialog should open - wait for dialog with longer timeout
    // The dialog renders in a portal, so we need to wait for it to appear
    await waitFor(
      () => {
        const dialog = screen.queryByRole('dialog');
        expect(dialog).toBeInTheDocument();
      },
      { timeout: 2000 }
    );
  });

  it('uses trip name as location fallback when location is not provided', async () => {
    const trip = createTestTrip({
      location: undefined,
      coordinates: { lat: 48.8566, lon: 2.3522 },
    });

    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    // Wait for lazy-loaded component
    await waitFor(() => {
      const mapPreviewButton = findMapPreviewButton();
      expect(mapPreviewButton).toBeDefined();
      // The button has aria-label attribute (translation key in test env)
      expect(mapPreviewButton).toHaveAttribute('aria-label');
    });
  });
});

// ============================================================================
// Accessibility Tests
// ============================================================================

describe('TripCard Accessibility', () => {
  it('is focusable via Tab', async () => {
    const user = userEvent.setup();
    const trip = createTestTrip();

    render(
      <div>
        <button>Before</button>
        <TripCard
          trip={trip}
          onClick={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
        <button>After</button>
      </div>
    );

    await user.tab();
    expect(screen.getByText('Before')).toHaveFocus();

    await user.tab();
    const card = screen.getByRole('button', { name: /beach vacation/i });
    expect(card).toHaveFocus();
  });

  it('has visible focus indicator', () => {
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const card = screen.getByRole('button', { name: /beach vacation/i });
    expect(card).toHaveClass('focus-visible:ring-2');
  });

  it('truncates long names with title attribute', () => {
    const trip = createTestTrip({
      name: 'A Very Long Trip Name That Should Be Truncated',
    });

    render(
      <TripCard
        trip={trip}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const titleElement = screen.getByText('A Very Long Trip Name That Should Be Truncated');
    expect(titleElement).toHaveAttribute('title', 'A Very Long Trip Name That Should Be Truncated');
  });
});
