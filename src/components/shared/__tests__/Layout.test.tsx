/**
 * @fileoverview Tests for Layout component.
 * Tests conditional navigation based on trip selection.
 *
 * @module components/shared/__tests__/Layout.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import { Layout } from '../Layout';
import type { Trip } from '@/types';
import { isoDate } from '@/test/utils';

// ============================================================================
// Mock Data
// ============================================================================

const mockTrip: Trip = {
  id: 'trip-123' as Trip['id'],
  name: 'Beach House Vacation',
  location: 'Brittany, France',
  startDate: isoDate('2024-07-15'),
  endDate: isoDate('2024-07-22'),
  shareId: 'abc123' as Trip['shareId'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const mockTripNoLocation: Trip = {
  id: 'trip-456' as Trip['id'],
  name: 'Mountain Retreat',
  startDate: isoDate('2024-08-01'),
  endDate: isoDate('2024-08-10'),
  shareId: 'def456' as Trip['shareId'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// ============================================================================
// Mocks
// ============================================================================

// Mock TripContext
const mockUseTripContext = vi.fn();

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => mockUseTripContext(),
}));

// Mock PersonContext
vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({
    persons: [],
    isLoading: false,
    error: null,
    createPerson: vi.fn(),
    updatePerson: vi.fn(),
    deletePerson: vi.fn(),
  }),
}));

// Mock TransportContext
vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => ({
    transports: [],
    arrivals: [],
    departures: [],
    upcomingPickups: [],
    isLoading: false,
    error: null,
    createTransport: vi.fn(),
    updateTransport: vi.fn(),
    deleteTransport: vi.fn(),
  }),
}));

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Renders Layout with router context.
 */
function renderLayout(
  children: ReactNode = <div>Page Content</div>,
  initialPath = '/',
) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Layout>{children}</Layout>
    </MemoryRouter>,
  );
}

/**
 * Reports the router's current path, so a "did not navigate" assertion reads
 * the router rather than `window.location`, which `MemoryRouter` never touches.
 */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-probe">{location.pathname}</span>;
}

/**
 * Gets the sidebar element (desktop navigation).
 */
function getSidebar() {
  return document.querySelector('aside[aria-label="nav.main"]');
}

/**
 * Gets the mobile navigation element.
 */
function getMobileNav() {
  return document.querySelector('nav[aria-label="nav.mobileMain"]');
}

// ============================================================================
// Test Setup
// ============================================================================

describe('Layout', () => {
  beforeEach(() => {
    mockUseTripContext.mockReset();
    // Default: no trip selected
    mockUseTripContext.mockReturnValue({
      currentTrip: null,
      trips: [],
      isLoading: false,
      error: null,
      setCurrentTrip: vi.fn(),
      checkConnection: vi.fn(),
    });
  });

  // ============================================================================
  // Basic Rendering Tests
  // ============================================================================

  describe('Basic Rendering', () => {
    it('renders children content', () => {
      renderLayout(<div data-testid="test-content">Test Content</div>);

      expect(screen.getByTestId('test-content')).toBeInTheDocument();
      expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    it('renders header with app name', () => {
      renderLayout();

      expect(screen.getByText('app.name')).toBeInTheDocument();
    });

    it('renders skip to main content link', () => {
      renderLayout();

      const skipLink = screen.getByText('nav.skipToMain');
      expect(skipLink).toBeInTheDocument();
      expect(skipLink).toHaveAttribute('href', '#main-content');
    });

    it('renders main content area with correct id', () => {
      renderLayout();

      const main = document.getElementById('main-content');
      expect(main).toBeInTheDocument();
    });
  });

  // ============================================================================
  // No Trip Selected Tests
  // ============================================================================

  describe('No Trip Selected', () => {
    beforeEach(() => {
      mockUseTripContext.mockReturnValue({
        currentTrip: null,
        trips: [],
        isLoading: false,
        error: null,
        setCurrentTrip: vi.fn(),
        checkConnection: vi.fn(),
      });
    });

    it('shows "My Trips" link in sidebar', () => {
      renderLayout();

      const sidebar = getSidebar();
      expect(sidebar).toBeInTheDocument();

      // Should show My Trips link
      const myTripsLink = within(sidebar as HTMLElement).getByText('trips.title');
      expect(myTripsLink).toBeInTheDocument();
    });

    it('shows "Settings" link in sidebar', () => {
      renderLayout();

      const sidebar = getSidebar();
      const settingsLink = within(sidebar as HTMLElement).getByText('nav.settings');
      expect(settingsLink).toBeInTheDocument();
    });

    it('does NOT show trip info section', () => {
      renderLayout();

      expect(screen.queryByTestId('trip-info-section')).not.toBeInTheDocument();
    });

    it('shows trip navigation links in the sidebar, disabled rather than absent', () => {
      renderLayout();

      const sidebar = getSidebar() as HTMLElement;

      // These used to be behind `{trip && …}`, so with no trip selected they
      // were not in the DOM at all — the sidebar silently changed shape and a
      // screen-reader user never learned the sections existed.
      for (const labelKey of [
        'nav.calendar',
        'nav.rooms',
        'nav.persons',
        'nav.transports',
        'nav.activities',
        'nav.tripAnalytics',
      ]) {
        const link = within(sidebar).getByText(labelKey).closest('a');
        expect(link, `${labelKey} is missing from the sidebar`).toBeInTheDocument();
        expect(link).toHaveAttribute('aria-disabled', 'true');
        expect(link).not.toHaveAttribute('tabindex');
      }
    });

    it('does not let a disabled link claim to be the current page', () => {
      // On '/trips' specifically. `buildNavPath` collapses every trip-gated
      // path to '/trips' while no trip is selected, and `NavLink` has no `end`,
      // so this is the route where the router marked all of them current at
      // once — the app's own landing page.
      renderLayout(<div>Page Content</div>, '/trips');

      const currentInSidebar = within(getSidebar() as HTMLElement)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
        .filter((link) => link.getAttribute('aria-disabled') === 'true');

      const currentInBar = within(getMobileNav() as HTMLElement)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
        .filter((link) => link.getAttribute('aria-disabled') === 'true');

      expect(currentInSidebar).toHaveLength(0);
      expect(currentInBar).toHaveLength(0);

      // And the guard itself has to be reachable: something *is* current here,
      // otherwise the two assertions above would hold for the wrong reason.
      const anyCurrent = within(getSidebar() as HTMLElement)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page');
      expect(anyCurrent.length).toBeGreaterThan(0);
    });

    it('shows empty trip placeholder in header', () => {
      renderLayout();

      expect(screen.getByText('trips.empty')).toBeInTheDocument();
    });

    it('mobile nav shows primary items and More button, trip items are disabled', () => {
      renderLayout();

      const mobileNav = getMobileNav();
      expect(mobileNav).toBeInTheDocument();

      // Get all nav links in mobile nav (3 primary items: Calendar, Rooms, Transports)
      const navLinks = within(mobileNav as HTMLElement).getAllByRole('link');
      expect(navLinks).toHaveLength(3);

      // "More" button should be present
      const moreButton = within(mobileNav as HTMLElement).getByText('nav.more');
      expect(moreButton).toBeInTheDocument();

      // Trip-specific links should be disabled (aria-disabled)
      const calendarLink = within(mobileNav as HTMLElement).getByText('nav.calendar').closest('a');
      expect(calendarLink).toHaveAttribute('aria-disabled', 'true');
    });
  });

  // ============================================================================
  // Trip Selected Tests
  // ============================================================================

  describe('Trip Selected', () => {
    beforeEach(() => {
      mockUseTripContext.mockReturnValue({
        currentTrip: mockTrip,
        trips: [mockTrip],
        isLoading: false,
        error: null,
        setCurrentTrip: vi.fn(),
        checkConnection: vi.fn(),
      });
    });

    it('shows trip info section with trip name', () => {
      renderLayout();

      const tripInfo = screen.getByTestId('trip-info-section');
      expect(tripInfo).toBeInTheDocument();
      expect(within(tripInfo).getByText('Beach House Vacation')).toBeInTheDocument();
    });

    it('shows trip dates in info section', () => {
      renderLayout();

      const tripInfo = screen.getByTestId('trip-info-section');
      // Date format: "Jul 15 - Jul 22" (depending on locale)
      expect(tripInfo).toHaveTextContent(/Jul\s+15/);
      expect(tripInfo).toHaveTextContent(/Jul\s+22/);
    });

    it('shows trip location when available', () => {
      renderLayout();

      const tripInfo = screen.getByTestId('trip-info-section');
      expect(within(tripInfo).getByText('Brittany, France')).toBeInTheDocument();
    });

    it('does NOT show location when trip has no location', () => {
      mockUseTripContext.mockReturnValue({
        currentTrip: mockTripNoLocation,
        trips: [mockTripNoLocation],
        isLoading: false,
        error: null,
        setCurrentTrip: vi.fn(),
        checkConnection: vi.fn(),
      });

      renderLayout();

      const tripInfo = screen.getByTestId('trip-info-section');
      expect(tripInfo).not.toHaveTextContent('Brittany');
    });

    it('shows "My Trips" link in sidebar', () => {
      renderLayout();

      const sidebar = getSidebar();
      expect(within(sidebar as HTMLElement).getByText('trips.title')).toBeInTheDocument();
    });

    it('shows trip navigation links in sidebar', () => {
      renderLayout();

      const sidebar = getSidebar();

      expect(within(sidebar as HTMLElement).getByText('nav.calendar')).toBeInTheDocument();
      expect(within(sidebar as HTMLElement).getByText('nav.rooms')).toBeInTheDocument();
      expect(within(sidebar as HTMLElement).getByText('nav.persons')).toBeInTheDocument();
      expect(within(sidebar as HTMLElement).getByText('nav.transports')).toBeInTheDocument();
      expect(within(sidebar as HTMLElement).getByText('nav.tripAnalytics')).toBeInTheDocument();
    });

    it('shows "Settings" link in sidebar', () => {
      renderLayout();

      const sidebar = getSidebar();
      expect(within(sidebar as HTMLElement).getByText('nav.settings')).toBeInTheDocument();
    });

    it('shows trip name in header', () => {
      renderLayout();

      // Trip name appears in both header and sidebar - verify at least in header
      const header = document.querySelector('header');
      expect(within(header as HTMLElement).getByText('Beach House Vacation')).toBeInTheDocument();
    });

    it('trip navigation links have correct hrefs', () => {
      renderLayout();

      const sidebar = getSidebar();

      const calendarLink = within(sidebar as HTMLElement).getByText('nav.calendar').closest('a');
      const roomsLink = within(sidebar as HTMLElement).getByText('nav.rooms').closest('a');
      const personsLink = within(sidebar as HTMLElement).getByText('nav.persons').closest('a');
      const transportsLink = within(sidebar as HTMLElement).getByText('nav.transports').closest('a');

      expect(calendarLink).toHaveAttribute('href', '/trips/trip-123/calendar');
      expect(roomsLink).toHaveAttribute('href', '/trips/trip-123/rooms');
      expect(personsLink).toHaveAttribute('href', '/trips/trip-123/persons');
      expect(transportsLink).toHaveAttribute('href', '/trips/trip-123/transports');

      const analyticsLink = within(sidebar as HTMLElement).getByText('nav.tripAnalytics').closest('a');
      expect(analyticsLink).toHaveAttribute('href', '/trips/trip-123/analytics');
    });

    it('My Trips link has correct href', () => {
      renderLayout();

      const sidebar = getSidebar();
      const tripsLink = within(sidebar as HTMLElement).getByText('trips.title').closest('a');
      expect(tripsLink).toHaveAttribute('href', '/trips');
    });

    it('Settings link has correct href', () => {
      renderLayout();

      const sidebar = getSidebar();
      const settingsLink = within(sidebar as HTMLElement).getByText('nav.settings').closest('a');
      expect(settingsLink).toHaveAttribute('href', '/settings');
    });

    it('mobile nav trip items are enabled when trip selected', () => {
      renderLayout();

      const mobileNav = getMobileNav();
      // Calendar is a primary mobile nav item
      const calendarLink = within(mobileNav as HTMLElement).getByText('nav.calendar').closest('a');
      expect(calendarLink).not.toHaveAttribute('aria-disabled');
    });
  });

  // ============================================================================
  // Sidebar Collapse Tests
  // ============================================================================

  describe('Sidebar Collapse', () => {
    it('renders collapse button', () => {
      renderLayout();

      const collapseButton = screen.getByRole('button', { name: 'nav.collapse' });
      expect(collapseButton).toBeInTheDocument();
    });

    it('toggles sidebar collapse state', async () => {
      const user = userEvent.setup();
      renderLayout();

      const sidebar = getSidebar();
      
      // Initially expanded (w-60)
      expect(sidebar).toHaveClass('w-60');

      // Click collapse
      const collapseButton = screen.getByRole('button', { name: 'nav.collapse' });
      await user.click(collapseButton);

      // Should be collapsed (w-16)
      expect(sidebar).toHaveClass('w-16');

      // Click expand
      const expandButton = screen.getByRole('button', { name: 'nav.expand' });
      await user.click(expandButton);

      // Back to expanded
      expect(sidebar).toHaveClass('w-60');
    });

    it('hides trip info section when collapsed and trip selected', async () => {
      const user = userEvent.setup();
      mockUseTripContext.mockReturnValue({
        currentTrip: mockTrip,
        trips: [mockTrip],
        isLoading: false,
        error: null,
        setCurrentTrip: vi.fn(),
        checkConnection: vi.fn(),
      });

      renderLayout();

      // Collapse sidebar
      const collapseButton = screen.getByRole('button', { name: 'nav.collapse' });
      await user.click(collapseButton);

      // Icon rail has no duplicate trip chip; details stay in expanded sidebar / header.
      expect(screen.queryByTestId('trip-info-section')).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Accessibility Tests
  // ============================================================================

  describe('Accessibility', () => {
    it('sidebar has navigation aria-label', () => {
      renderLayout();

      const sidebar = getSidebar();
      expect(sidebar).toHaveAttribute('aria-label', 'nav.main');
    });

    it('mobile nav has navigation aria-label', () => {
      renderLayout();

      const mobileNav = getMobileNav();
      expect(mobileNav).toHaveAttribute('aria-label', 'nav.mobileMain');
    });

    it('disabled links have aria-disabled attribute', () => {
      // No trip selected
      mockUseTripContext.mockReturnValue({
        currentTrip: null,
        trips: [],
        isLoading: false,
        error: null,
        setCurrentTrip: vi.fn(),
        checkConnection: vi.fn(),
      });

      renderLayout();

      const mobileNav = getMobileNav();
      const disabledLinks = within(mobileNav as HTMLElement)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-disabled') === 'true');

      // Should have 3 disabled links (Calendar, Rooms, Transports) — primary mobile items
      expect(disabledLinks).toHaveLength(3);
    });

    it('collapse button has appropriate aria-label', () => {
      renderLayout();

      const button = screen.getByRole('button', { name: /collapse|expand/i });
      expect(button).toHaveAttribute('aria-label');
    });
  });

  // ============================================================================
  // Disabled Nav Affordances
  // ============================================================================

  describe('Disabled nav affordances', () => {
    beforeEach(() => {
      mockUseTripContext.mockReturnValue({
        currentTrip: null,
        trips: [],
        isLoading: false,
        error: null,
        setCurrentTrip: vi.fn(),
        checkConnection: vi.fn(),
      });
    });

    it('keeps trip-gated links in the tab order instead of hiding them', () => {
      renderLayout();

      const calendarLink = within(getMobileNav() as HTMLElement)
        .getByText('nav.calendar')
        .closest('a');

      expect(calendarLink).toHaveAttribute('aria-disabled', 'true');
      // `tabIndex={-1}` was the bug: a link nobody can reach is a link nobody
      // knows exists, so the nav silently changed shape without a trip.
      expect(calendarLink).not.toHaveAttribute('tabindex');
      expect(calendarLink?.className).not.toContain('pointer-events-none');
    });

    it('describes why a trip-gated link cannot be used', () => {
      renderLayout();

      const calendarLink = within(getMobileNav() as HTMLElement)
        .getByText('nav.calendar')
        .closest('a');

      const hintId = calendarLink?.getAttribute('aria-describedby');
      expect(hintId).toBeTruthy();
      expect(document.getElementById(hintId as string)).toHaveTextContent(
        'nav.requiresTrip',
      );
    });

    it('does not navigate when a disabled link is activated', async () => {
      const user = userEvent.setup();
      renderLayout(<LocationProbe />);

      const calendarLink = within(getMobileNav() as HTMLElement)
        .getByText('nav.calendar')
        .closest('a') as HTMLAnchorElement;

      // Focusable is the point of the fix; activating it must still do nothing.
      act(() => calendarLink.focus());
      expect(document.activeElement).toBe(calendarLink);
      // Exact, not `toHaveTextContent('/')`: that is a substring match, and it
      // also passes for the '/trips' this test exists to rule out.
      expect(screen.getByTestId('location-probe').textContent).toBe('/');

      await user.click(calendarLink);

      // Without the guard this link resolves to '/trips'.
      expect(screen.getByTestId('location-probe').textContent).toBe('/');
    });

    it('leaves "More" sheet items reachable while announcing them as disabled', async () => {
      const user = userEvent.setup();
      renderLayout();

      await user.click(
        within(getMobileNav() as HTMLElement).getByRole('button', { name: 'nav.more' }),
      );

      const personsItem = await screen.findByRole('button', { name: /nav\.persons/ });
      expect(personsItem).toHaveAttribute('aria-disabled', 'true');
      // A natively `disabled` button leaves the tab order entirely.
      expect(personsItem).not.toBeDisabled();

      const hintId = personsItem.getAttribute('aria-describedby');
      expect(hintId).toBeTruthy();
      expect(document.getElementById(hintId as string)).toHaveTextContent(
        'nav.requiresTrip',
      );
    });

    it('does not park the "More" sheet\'s opening focus on a disabled item', async () => {
      const user = userEvent.setup();
      renderLayout();

      await user.click(
        within(getMobileNav() as HTMLElement).getByRole('button', { name: 'nav.more' }),
      );
      await screen.findByRole('button', { name: /nav\.persons/ });

      // Radix's focus scope skips natively `disabled` nodes but not
      // `aria-disabled` ones, so swapping the attribute moved the sheet's
      // opening focus onto the first item — which, with no trip, is disabled.
      const focused = document.activeElement as HTMLElement | null;
      expect(focused).not.toBeNull();
      // Inside the sheet, or the focus trap has nothing to trap. `document.body`
      // would satisfy a bare "not disabled" check, so assert both halves.
      const sheet = screen.getByRole('dialog');
      expect(sheet.contains(focused)).toBe(true);
      expect(focused?.getAttribute('aria-disabled')).not.toBe('true');
    });

    it('drops the trip-gated hint entirely once a trip is selected', () => {
      mockUseTripContext.mockReturnValue({
        currentTrip: mockTrip,
        trips: [mockTrip],
        isLoading: false,
        error: null,
        setCurrentTrip: vi.fn(),
        checkConnection: vi.fn(),
      });

      renderLayout();

      // An sr-only span is still in the accessibility tree. Rendered
      // unconditionally it would be read out on every screen of the app,
      // explaining a restriction that no longer applies to anything.
      expect(screen.queryByText('nav.requiresTrip')).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Collapsed Sidebar Tooltip
  // ============================================================================

  describe('Collapsed sidebar tooltip', () => {
    beforeEach(() => {
      mockUseTripContext.mockReturnValue({
        currentTrip: mockTrip,
        trips: [mockTrip],
        isLoading: false,
        error: null,
        setCurrentTrip: vi.fn(),
        checkConnection: vi.fn(),
      });
    });

    /** Collapses the sidebar and returns the icon-only Calendar link. */
    async function collapseAndGetCalendarLink(
      user: ReturnType<typeof userEvent.setup>,
    ): Promise<HTMLAnchorElement> {
      await user.click(screen.getByRole('button', { name: 'nav.collapse' }));

      const link = within(getSidebar() as HTMLElement).getByRole('link', {
        name: 'nav.calendar',
      });
      return link as HTMLAnchorElement;
    }

    it('links the tooltip to the link it describes', async () => {
      const user = userEvent.setup();
      renderLayout();

      const link = await collapseAndGetCalendarLink(user);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

      // `focus()` is what opens the tooltip, so the state update it triggers
      // has to be inside `act`.
      act(() => link.focus());

      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toHaveTextContent('nav.calendar');
      // Without this the tooltip is an orphan in a body portal that no screen
      // reader ever visits.
      expect(link.getAttribute('aria-describedby')).toBe(tooltip.id);
    });

    it('dismisses the tooltip on Escape', async () => {
      const user = userEvent.setup();
      renderLayout();

      const link = await collapseAndGetCalendarLink(user);
      act(() => link.focus());
      await screen.findByRole('tooltip');

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      expect(link).not.toHaveAttribute('aria-describedby');
    });
  });
});
