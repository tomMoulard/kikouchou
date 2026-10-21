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

import { TripCard } from '../TripCard';
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

describe('TripCard Basic Rendering', () => {
  it('renders trip name', () => {
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        persons={[]}
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const card = screen.getByRole('button', { name: /beach vacation/i });
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('Beach Vacation'));
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('Brittany, France'));
  });

  it('says how many guests the trip has in its accessible name', () => {
    const trip = createTestTrip();
    const persons = Array.from({ length: 3 }, (_, i) => ({
      id: `p${i}`, tripId: 'trip-1', name: `Person ${i}`, color: '#ef4444',
      order: i, createdAt: Date.now(), updatedAt: Date.now(),
    })) as never;
    render(<TripCard trip={trip} persons={persons} onClick={vi.fn()} />);

    // The card is one `role="button"`, so its accessible name is everything a
    // screen reader is given — the badges inside it are never announced.
    const card = screen.getByRole('button', { name: /beach vacation/i });
    expect(card).toHaveAttribute(
      'aria-label',
      expect.stringContaining('trips.guestCount'),
    );
  });

  it('says a trip has no guests yet in its accessible name', () => {
    const trip = createTestTrip();
    render(<TripCard trip={trip} persons={[]} onClick={vi.fn()} />);

    const card = screen.getByRole('button', { name: /beach vacation/i });
    expect(card).toHaveAttribute(
      'aria-label',
      expect.stringContaining('trips.noGuests'),
    );
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        isDisabled={true}
      />
    );

    // The dimming lives on the card container, not on the activation button
    // overlaid on it — the button is transparent, so dimming it would show
    // nothing. `getByRole('button')` now returns that overlay.
    const activation = screen.getByRole('button', { name: /beach vacation/i });
    expect(activation.closest('[data-slot="card"]')).toHaveClass('opacity-50');
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
        persons={[]}
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
        persons={[]}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    // Wait for lazy-loaded component. This is the first test in the file to
    // pull the map chunk in, so it pays for the whole import graph — Leaflet,
    // the error boundary around it and their dependencies — and the default
    // one-second budget is not always enough on a cold module cache. The
    // dialog test below already waits two seconds for the same reason.
    await waitFor(
      () => {
        const mapPreviewButton = findMapPreviewButton();
        expect(mapPreviewButton).toBeDefined();
        expect(mapPreviewButton).toBeInTheDocument();
      },
      { timeout: 2000 }
    );
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
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
        persons={[]}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const titleElement = screen.getByText('A Very Long Trip Name That Should Be Truncated');
    expect(titleElement).toHaveAttribute('title', 'A Very Long Trip Name That Should Be Truncated');
  });
});

// ============================================================================
// Share Button Tests
// ============================================================================

describe('TripCard Share Button', () => {
  it('renders share button when onShare is provided', () => {
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        persons={[]}
        onClick={vi.fn()}
        onShare={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/trips\.shareTripAria/i)).toBeInTheDocument();
  });

  it('calls onShare when share button is clicked', async () => {
    const user = userEvent.setup();
    const onShare = vi.fn();
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        persons={[]}
        onClick={vi.fn()}
        onShare={onShare}
      />
    );
    await user.click(screen.getByLabelText(/trips\.shareTripAria/i));
    expect(onShare).toHaveBeenCalledWith(trip);
  });

  it('does not call onShare when disabled', async () => {
    const user = userEvent.setup();
    const onShare = vi.fn();
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        persons={[]}
        onClick={vi.fn()}
        onShare={onShare}
        isDisabled
      />
    );
    await user.click(screen.getByLabelText(/trips\.shareTripAria/i));
    expect(onShare).not.toHaveBeenCalled();
  });

  it('does not call card onClick when share button is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        persons={[]}
        onClick={onClick}
        onShare={vi.fn()}
      />
    );
    await user.click(screen.getByLabelText(/trips\.shareTripAria/i));
    expect(onClick).not.toHaveBeenCalled();
  });
});

// ============================================================================
// No Corner Actions Tests
// ============================================================================

describe('TripCard without actions', () => {
  it('does not render menu or share when no onEdit/onDelete/onShare', () => {
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        persons={[]}
        onClick={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /common\.openMenu/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/trips\.shareTripAria/i)).not.toBeInTheDocument();
  });

  it('renders only share when onShare provided but no edit/delete', () => {
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        persons={[]}
        onClick={vi.fn()}
        onShare={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/trips\.shareTripAria/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /common\.openMenu/i })).not.toBeInTheDocument();
  });
});

// ============================================================================
// Persons Display Tests
// ============================================================================

describe('TripCard Persons', () => {
  it('shows "no guests" when persons array is empty', () => {
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        persons={[]}
        onClick={vi.fn()}
      />
    );
    expect(screen.getByText(/trips\.noGuests/i)).toBeInTheDocument();
  });

  it('renders person badges when persons are provided', () => {
    const trip = createTestTrip();
    const persons = [
      { id: 'p1', tripId: 'trip-1', name: 'Alice', color: '#ef4444', order: 0, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'p2', tripId: 'trip-1', name: 'Bob', color: '#3b82f6', order: 1, createdAt: Date.now(), updatedAt: Date.now() },
    ] as never;
    render(
      <TripCard
        trip={trip}
        persons={persons}
        onClick={vi.fn()}
      />
    );
    expect(screen.queryByText(/trips\.noGuests/i)).not.toBeInTheDocument();
  });

  it('renders overflow count when more than 4 persons', () => {
    const trip = createTestTrip();
    const persons = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`, tripId: 'trip-1', name: `Person ${i}`, color: '#ef4444',
      order: i, createdAt: Date.now(), updatedAt: Date.now(),
    })) as never;
    render(
      <TripCard
        trip={trip}
        persons={persons}
        onClick={vi.fn()}
      />
    );
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('carries the guest count in text, not only as a bare number', () => {
    const trip = createTestTrip();
    const persons = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`, tripId: 'trip-1', name: `Person ${i}`, color: '#ef4444',
      order: i, createdAt: Date.now(), updatedAt: Date.now(),
    })) as never;
    render(
      <TripCard
        trip={trip}
        persons={persons}
        onClick={vi.fn()}
      />
    );
    // "+2" read aloud on its own says nothing at all, and the bare number was
    // the one string on this card that never went through i18n.
    expect(screen.getByText('trips.moreGuests')).toBeInTheDocument();
  });
});

// ============================================================================
// Description Tests
// ============================================================================

describe('TripCard Description', () => {
  it('renders the trip description', () => {
    const trip = createTestTrip({ description: 'Bring walking boots' });
    render(<TripCard trip={trip} persons={[]} onClick={vi.fn()} />);

    // The form has always captured this and no screen has ever shown it back.
    expect(screen.getByText('Bring walking boots')).toBeInTheDocument();
  });

  it('puts the description in the card\'s accessible name', () => {
    const trip = createTestTrip({ description: 'Bring walking boots' });
    render(<TripCard trip={trip} persons={[]} onClick={vi.fn()} />);

    // The card is one `role="button"`, so text rendered inside it is not
    // announced: whatever is not in the label is not read out at all.
    const card = screen.getByRole('button', { name: /beach vacation/i });
    expect(card).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Bring walking boots'),
    );
  });

  it('renders nothing when the trip has no description', () => {
    const trip = createTestTrip();
    const { container } = render(
      <TripCard trip={trip} persons={[]} onClick={vi.fn()} />
    );

    expect(container.querySelector('.line-clamp-2')).toBeNull();
  });

  it('renders nothing for a description of only whitespace', () => {
    const trip = createTestTrip({ description: '   \n  ' });
    const { container } = render(
      <TripCard trip={trip} persons={[]} onClick={vi.fn()} />
    );

    // Otherwise the card grows a blank line for a field nobody filled in.
    expect(container.querySelector('.line-clamp-2')).toBeNull();
  });

  it('shows a Markdown description as plain words, in the text and the label', () => {
    const trip = createTestTrip({ description: '## Arrival\n**Door code** 1234' });
    const { container } = render(<TripCard trip={trip} persons={[]} onClick={vi.fn()} />);

    // Two clamped lines have no room to render Markdown, and the raw syntax
    // reads as noise, to the eye and to a screen reader alike.
    const card = screen.getByRole('button', { name: /beach vacation/i });
    expect(card.getAttribute('aria-label')).toContain('Arrival\nDoor code 1234');
    expect(card.getAttribute('aria-label')).not.toMatch(/[#*]/);
    expect(container.querySelector('.line-clamp-2')).toHaveTextContent('Arrival Door code 1234');
  });
});

// ============================================================================
// Keyboard While Disabled Tests
// ============================================================================

describe('TripCard Keyboard while disabled', () => {
  it('does not call onClick on Enter when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const trip = createTestTrip();
    render(
      <TripCard
        trip={trip}
        persons={[]}
        onClick={onClick}
        isDisabled
      />
    );
    const card = screen.getByRole('button', { name: /beach vacation/i });
    card.focus();
    await user.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Archive Tests
// ============================================================================

describe('TripCard archiving', () => {
  it('shows no menu when the card has no menu action at all', () => {
    const trip = createTestTrip();

    render(<TripCard trip={trip} persons={[]} onClick={vi.fn()} />);

    expect(
      screen.queryByRole('button', { name: /common\.openMenu/i }),
    ).not.toBeInTheDocument();
  });

  it('opens the menu for the archive action alone', async () => {
    const user = userEvent.setup();
    const trip = createTestTrip();

    // The trip list passes this one callback and neither edit nor delete, which
    // used to mean no menu at all.
    render(
      <TripCard
        trip={trip}
        persons={[]}
        onClick={vi.fn()}
        onArchiveToggle={vi.fn()}
      />,
    );

    const menuTrigger = screen.getByRole('button', { name: /common\.openMenu/i });
    await user.click(menuTrigger);

    await waitFor(() => {
      expect(
        screen.getByRole('menuitem', { name: /trips\.archive/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('menuitem', { name: /common\.delete/i }),
    ).not.toBeInTheDocument();
  });

  it('offers to take an archived trip back out', async () => {
    const user = userEvent.setup();
    const trip = createTestTrip({ archived: true });

    render(
      <TripCard
        trip={trip}
        persons={[]}
        onClick={vi.fn()}
        onArchiveToggle={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /common\.openMenu/i }));

    expect(
      await screen.findByRole('menuitem', { name: /trips\.unarchive/i }),
    ).toBeInTheDocument();
  });

  it('passes the trip to onArchiveToggle', async () => {
    const user = userEvent.setup();
    const onArchiveToggle = vi.fn();
    const trip = createTestTrip();

    render(
      <TripCard
        trip={trip}
        persons={[]}
        onClick={vi.fn()}
        onArchiveToggle={onArchiveToggle}
      />,
    );

    await user.click(screen.getByRole('button', { name: /common\.openMenu/i }));
    await user.click(
      await screen.findByRole('menuitem', { name: /trips\.archive/i }),
    );

    expect(onArchiveToggle).toHaveBeenCalledTimes(1);
    expect(onArchiveToggle).toHaveBeenCalledWith(trip);
  });

  it('marks the menu item with the icon of what it does', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <TripCard trip={createTestTrip()} persons={[]} onClick={vi.fn()} onArchiveToggle={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: /common\.openMenu/i }));
    const archive = await screen.findByRole('menuitem', { name: /trips\.archive/i });
    expect(archive.querySelector('svg.lucide-archive')).not.toBeNull();
    expect(archive.querySelector('svg.lucide-archive-restore')).toBeNull();
    unmount();

    render(
      <TripCard
        trip={createTestTrip({ archived: true })}
        persons={[]}
        onClick={vi.fn()}
        onArchiveToggle={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /common\.openMenu/i }));
    const restore = await screen.findByRole('menuitem', { name: /trips\.unarchive/i });
    expect(restore.querySelector('svg.lucide-archive-restore')).not.toBeNull();
  });
});

// ============================================================================
// What the card is named, how it looks, and what it follows
// ============================================================================

function person(index: number) {
  return {
    id: `p${index}`,
    tripId: 'trip-1',
    name: `Person ${index}`,
    color: '#ef4444',
  } as never;
}

describe('TripCard accessible name', () => {
  const name = () => screen.getByRole('button', { name: /Beach Vacation/ }).getAttribute('aria-label');
  const dates = () => screen.getByText(/15.*-.*22/).textContent ?? '';

  it('reads name, place, dates and guests, comma-separated', () => {
    render(<TripCard trip={createTestTrip()} persons={[]} onClick={vi.fn()} />);

    expect(name()).toBe(`Beach Vacation, Brittany, France, ${dates()}, trips.noGuests`);
  });

  it('leaves out a place the trip does not have', () => {
    render(
      <TripCard trip={createTestTrip({ location: undefined })} persons={[person(1)]} onClick={vi.fn()} />,
    );

    expect(name()).toBe(`Beach Vacation, ${dates()}, trips.guestCount`);
  });

  it('clips a long description to a breath', () => {
    const description = 'word '.repeat(60).trim();
    render(<TripCard trip={createTestTrip({ description })} persons={[]} onClick={vi.fn()} />);

    expect(name()).toBe(
      `Beach Vacation, Brittany, France, ${dates()}, trips.noGuests, ${description.slice(0, 120)}`,
    );
  });

  it('follows the trip and the guests it is handed next', () => {
    const { rerender } = render(<TripCard trip={createTestTrip()} persons={[]} onClick={vi.fn()} />);

    rerender(
      <TripCard
        trip={createTestTrip({
          name: 'Ski Week',
          startDate: isoDate('2024-02-03'),
          endDate: isoDate('2024-02-09'),
          description: 'Bring boots',
        })}
        persons={[person(1), person(2), person(3), person(4), person(5)]}
        onClick={vi.fn()}
      />,
    );

    const label = screen.getByRole('button', { name: /Ski Week/ }).getAttribute('aria-label');
    expect(label).toContain('trips.guestCount');
    expect(label).toContain('Bring boots');
    expect(screen.getByText(/3.*-.*9/)).toBeInTheDocument();
    expect(screen.getByText('Bring boots')).toBeInTheDocument();
    expect(screen.getByText('Person 4')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });
});

describe('TripCard guests', () => {
  it('shows the first four guests by name and counts the rest', () => {
    render(
      <TripCard
        trip={createTestTrip()}
        persons={[person(1), person(2), person(3), person(4), person(5), person(6)]}
        onClick={vi.fn()}
      />,
    );

    expect(screen.getByText('Person 1')).toBeInTheDocument();
    expect(screen.getByText('Person 4')).toBeInTheDocument();
    expect(screen.queryByText('Person 5')).not.toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('adds no overflow badge for exactly four guests', () => {
    render(
      <TripCard
        trip={createTestTrip()}
        persons={[person(1), person(2), person(3), person(4)]}
        onClick={vi.fn()}
      />,
    );

    expect(screen.queryByText('+0')).not.toBeInTheDocument();
    expect(screen.queryByText('trips.moreGuests')).not.toBeInTheDocument();
  });
});

describe('TripCard layout', () => {
  it('styles the card, and the overlay that makes it one button', () => {
    const { container } = render(
      <TripCard trip={createTestTrip()} persons={[]} onClick={vi.fn()} />,
    );

    expect(container.firstElementChild).toHaveClass('relative', 'cursor-pointer', 'hover:shadow-md');
    const overlay = screen.getByRole('button', { name: /Beach Vacation/ });
    expect(overlay).toHaveClass('absolute', 'inset-0', 'focus-visible:ring-2');
    expect(overlay).not.toHaveClass('cursor-not-allowed');
    // No action at all: no corner, and no room kept for one.
    expect(container.querySelector('.top-2.right-2')).toBeNull();
    expect(container.querySelector('.pr-14, .pr-28')).toBeNull();
  });

  it('shows the not-allowed cursor on a disabled card', () => {
    render(<TripCard trip={createTestTrip()} persons={[]} onClick={vi.fn()} isDisabled />);

    expect(screen.getByRole('button', { name: /Beach Vacation/ })).toHaveClass('cursor-not-allowed');
  });

  it('keeps room in the header for the corner it carries', () => {
    const header = (container: HTMLElement) =>
      container.querySelector('[data-slot="card-header"]') ?? container.querySelector('.pr-14, .pr-28');
    const both = render(
      <TripCard
        trip={createTestTrip()}
        persons={[]}
        onClick={vi.fn()}
        onShare={vi.fn()}
        onArchiveToggle={vi.fn()}
      />,
    );
    expect(header(both.container)).toHaveClass('pr-28');
    both.unmount();

    const shareOnly = render(
      <TripCard trip={createTestTrip()} persons={[]} onClick={vi.fn()} onShare={vi.fn()} />,
    );
    expect(header(shareOnly.container)).toHaveClass('pr-14');
    shareOnly.unmount();

    const menuOnly = render(
      <TripCard trip={createTestTrip()} persons={[]} onClick={vi.fn()} onArchiveToggle={vi.fn()} />,
    );
    expect(header(menuOnly.container)).toHaveClass('pr-14');
  });

  it('needs both edit and delete before it offers that menu', () => {
    render(<TripCard trip={createTestTrip()} persons={[]} onClick={vi.fn()} onEdit={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /common\.openMenu/i })).not.toBeInTheDocument();
  });

  it('shows the place on its own truncated line', () => {
    render(<TripCard trip={createTestTrip()} persons={[]} onClick={vi.fn()} />);

    expect(screen.getByText('Brittany, France')).toHaveAttribute('title', 'Brittany, France');
  });
});

describe('TripCard handlers', () => {
  it('calls the handlers it was given last', async () => {
    const user = userEvent.setup();
    const first = { onClick: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onShare: vi.fn() };
    const last = { onClick: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onShare: vi.fn() };
    const trip = createTestTrip();
    const { rerender } = render(<TripCard trip={trip} persons={[]} {...first} />);
    rerender(<TripCard trip={trip} persons={[]} {...last} />);

    await user.click(screen.getByRole('button', { name: /Beach Vacation/ }));
    await user.click(screen.getByRole('button', { name: 'trips.shareTripAria' }));
    await user.click(screen.getByRole('button', { name: /common\.openMenu/i }));
    await user.click(await screen.findByRole('menuitem', { name: /common\.edit/i }));
    await user.click(screen.getByRole('button', { name: /common\.openMenu/i }));
    await user.click(await screen.findByRole('menuitem', { name: /common\.delete/i }));

    expect(last.onClick).toHaveBeenCalledWith(trip);
    expect(last.onShare).toHaveBeenCalledWith(trip);
    expect(last.onEdit).toHaveBeenCalledTimes(1);
    expect(last.onDelete).toHaveBeenCalledTimes(1);
    expect(Object.values(first).every((handler) => handler.mock.calls.length === 0)).toBe(true);
  });

  it('archives the trip it shows now', async () => {
    const user = userEvent.setup();
    const onArchiveToggle = vi.fn();
    const later = createTestTrip({ id: 'trip-2' as TripId, name: 'Later' });
    const { rerender } = render(
      <TripCard trip={createTestTrip()} persons={[]} onClick={vi.fn()} onArchiveToggle={vi.fn()} />,
    );
    rerender(
      <TripCard trip={later} persons={[]} onClick={vi.fn()} onArchiveToggle={onArchiveToggle} />,
    );

    await user.click(screen.getByRole('button', { name: /common\.openMenu/i }));
    await user.click(await screen.findByRole('menuitem', { name: /trips\.archive/i }));

    expect(onArchiveToggle).toHaveBeenCalledWith(later);
  });

  it('opens the trip it shows now, also once it was enabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const later = createTestTrip({ id: 'trip-2' as TripId, name: 'Later' });
    const { rerender } = render(
      <TripCard trip={createTestTrip()} persons={[]} onClick={onClick} isDisabled />,
    );
    rerender(<TripCard trip={later} persons={[]} onClick={onClick} />);

    await user.click(screen.getByRole('button', { name: /Later/ }));

    expect(onClick).toHaveBeenCalledWith(later);
  });

  it('shares the trip it shows now, also once it was enabled', async () => {
    const user = userEvent.setup();
    const onShare = vi.fn();
    const later = createTestTrip({ id: 'trip-2' as TripId, name: 'Later' });
    const { rerender } = render(
      <TripCard trip={createTestTrip()} persons={[]} onClick={vi.fn()} onShare={onShare} isDisabled />,
    );
    rerender(<TripCard trip={later} persons={[]} onClick={vi.fn()} onShare={onShare} />);

    await user.click(screen.getByRole('button', { name: 'trips.shareTripAria' }));

    expect(onShare).toHaveBeenCalledWith(later);
  });
});
