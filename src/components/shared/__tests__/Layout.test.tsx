/**
 * @fileoverview Tests for Layout component.
 * Tests conditional navigation based on trip selection.
 *
 * @module components/shared/__tests__/Layout.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addDays, subDays } from 'date-fns';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { getDirectionsUrl } from '@/features/transports/components/DirectionsButton';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import { useHideNavigation } from '@/contexts/NavigationVisibilityContext';
import { db } from '@/lib/db';
import { DEFAULT_SETTINGS } from '@/types';
import { toLocalISODateString } from '@/lib/db/utils';
import type { HexColor, ISODateString, Person, RoomAssignment, Trip } from '@/types';
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

/** Which of the sidebar's three data sources is still loading, per test. */
const { contextLoading } = vi.hoisted(() => ({
  contextLoading: { persons: false, transports: false, assignments: false },
}));

// Mock useToday so "tonight" is a fixed calendar day rather than whichever day
// the suite happens to run on (and never straddles local midnight mid-run).
const { fixedToday, clock } = vi.hoisted(() => {
  // Local noon, so the local calendar day is unambiguous at any UTC offset.
  const fixedToday = new Date(2026, 3, 15, 12, 0, 0);
  // What the hook answers. A test that lets midnight pass swaps it and puts
  // `fixedToday` back when it is done.
  return { fixedToday, clock: { today: fixedToday } };
});

vi.mock('@/hooks/useToday', () => ({
  useToday: () => ({ today: clock.today }),
}));

// Mock TripContext
const mockUseTripContext = vi.fn();

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => mockUseTripContext(),
}));

// Mock PersonContext
const mockPersons = vi.fn<() => readonly Person[]>(() => []);

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({
    persons: mockPersons(),
    isLoading: contextLoading.persons,
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
    nowMs: fixedToday.getTime(),
    isLoading: contextLoading.transports,
    error: null,
    createTransport: vi.fn(),
    updateTransport: vi.fn(),
    deleteTransport: vi.fn(),
  }),
}));

// Mock AssignmentContext — the sidebar's guest list reads room assignments, so
// a guest with a bed and no stay dates still shows up there.
const mockAssignments = vi.fn<() => readonly RoomAssignment[]>(() => []);

vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: () => ({
    assignments: mockAssignments(),
    isLoading: contextLoading.assignments,
    error: null,
    createAssignment: vi.fn(),
    updateAssignment: vi.fn(),
    deleteAssignment: vi.fn(),
    getAssignmentsByRoom: vi.fn(() => []),
    getAssignmentsByPerson: vi.fn(() => []),
    hasConflict: vi.fn(() => false),
  }),
}));

// Mock RoomContext — read by the glance panel beside the trip pages, and by
// nothing else in the layout.
vi.mock('@/contexts/RoomContext', () => ({
  useRoomContext: () => ({
    rooms: [],
    isLoading: false,
    error: null,
    createRoom: vi.fn(),
    updateRoom: vi.fn(),
    deleteRoom: vi.fn(),
    reorderRooms: vi.fn(),
  }),
}));

// The three cards above the page content are stood in for: each has its own
// tests, and this file only decides which of them the layout shows where.
const { pushSupported } = vi.hoisted(() => ({ pushSupported: { value: false } }));

vi.mock('@/lib/notifications/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notifications/push')>()),
  isPushSupported: () => pushSupported.value,
}));

vi.mock('../ViewerUnlockCard', () => ({
  ViewerUnlockCard: ({ className }: { readonly className?: string }) => (
    <div data-testid="stub-viewer-card" className={className} />
  ),
}));

vi.mock('../ReminderCard', () => ({
  ReminderCard: ({ trip, className }: { readonly trip: Trip; readonly className?: string }) => (
    <div data-testid="stub-reminder-card" data-trip={trip.id} className={className} />
  ),
}));

vi.mock('@/components/pwa/InstallNudgeCard', () => ({
  InstallNudgeCard: ({ trip, className }: { readonly trip: Trip; readonly className?: string }) => (
    <div data-testid="stub-install-nudge" data-trip={trip.id} className={className} />
  ),
}));

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Renders Layout with router context.
 */
function renderLayout(children: ReactNode = <div>Page Content</div>) {
  return render(
    <MemoryRouter>
      <Layout>{children}</Layout>
    </MemoryRouter>,
  );
}

/**
 * Renders Layout at one path, for the tests that depend on the route.
 */
function renderLayoutAt(path: string, children: ReactNode = <div>Page Content</div>) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Layout>{children}</Layout>
    </MemoryRouter>,
  );
}

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

/**
 * Loaded inside the first test rather than at the top of the file: the nav
 * items and the route lists are load-time tables, and Stryker can only test a
 * mutant in load-time code against the test that was running when the module
 * loaded.
 */
let Layout: typeof import('../Layout').Layout;

beforeEach(async () => {
  ({ Layout } = await import('../Layout'));
});

describe('Layout load-time tables', () => {
  /** Answers the width and short-landscape queries the way the test asks. */
  function setViewport(isWide: boolean, isShortLandscape: boolean): void {
    vi.mocked(window.matchMedia).mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('min-width: 1280px')
            ? isWide
            : query.includes('orientation: landscape')
              ? isShortLandscape
              : false,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    );
  }

  function withTrip(trip: Trip | null): void {
    mockUseTripContext.mockReturnValue({
      currentTrip: trip,
      trips: trip ? [trip] : [],
      isLoading: false,
      error: null,
      setCurrentTrip: vi.fn(),
      checkConnection: vi.fn(),
    });
  }

  it('links the app-wide pages, gives the trip pages their column, and clears the shell for the new-trip form', () => {
    mockPersons.mockReturnValue([]);
    mockAssignments.mockReturnValue([]);

    // The app-wide links need no trip, and go to the same place either way.
    for (const trip of [null, mockTrip]) {
      withTrip(trip);
      const { unmount } = renderLayout();
      const sidebar = getSidebar() as HTMLElement;
      for (const [name, href] of [
        ['trips.title', '/trips'],
        ['guestGroups.title', '/groups'],
        ['nav.assistant', '/assistant'],
        ['nav.settings', '/settings'],
      ] as const) {
        const link = within(sidebar).getByRole('link', { name });
        expect(link, name).toHaveAttribute('href', href);
        expect(link, name).not.toHaveAttribute('aria-disabled', 'true');
      }
      unmount();
    }

    withTrip(mockTrip);
    setViewport(true, false);
    for (const suffix of ['calendar', 'rooms', 'persons', 'activities', 'money', 'edit', 'edit/']) {
      const { unmount } = renderLayoutAt(`/trips/${mockTrip.id}/${suffix}`);
      expect(document.querySelector('aside[aria-label="glance.title"]'), suffix).toBeInTheDocument();
      unmount();
    }
    // Only a trailing slash is trimmed: a slash inside the suffix is another
    // route, even one that would spell a glance page without it.
    for (const path of [
      `/trips/${mockTrip.id}/transports`,
      `/trips/${mockTrip.id}/analytics`,
      `/trips/${mockTrip.id}/cal/endar`,
      '/settings',
    ]) {
      const { unmount } = renderLayoutAt(path);
      expect(document.querySelector('aside[aria-label="glance.title"]'), path).not.toBeInTheDocument();
      unmount();
    }

    setViewport(false, true);
    const { unmount } = renderLayoutAt('/trips/new');
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    unmount();

    // Back to the suite's own answer, which matches nothing.
    setViewport(false, false);
  });
});

describe('Layout', () => {
  beforeEach(() => {
    mockUseTripContext.mockReset();
    mockPersons.mockReturnValue([]);
    mockAssignments.mockReturnValue([]);
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

    it('dresses the logo and decorates the page for a seasonal palette', () => {
      document.documentElement.setAttribute('data-palette', 'halloween');

      try {
        renderLayout();

        const header = screen.getByRole('banner');

        expect(header.querySelector('[data-dress="halloween"]')).not.toBeNull();
        expect(
          header.contains(screen.getByTestId('seasonal-header-decor')),
        ).toBe(true);
        expect(screen.getByTestId('seasonal-backdrop')).toBeInTheDocument();
      } finally {
        document.documentElement.removeAttribute('data-palette');
      }
    });

    it('draws no decoration for the default palette', () => {
      renderLayout();

      expect(screen.queryByTestId('seasonal-header-decor')).toBeNull();
      expect(screen.queryByTestId('seasonal-backdrop')).toBeNull();
    });

    it('renders skip to main content link', () => {
      renderLayout();

      const skipLink = screen.getByText('nav.skipToMain');
      expect(skipLink).toBeInTheDocument();
      expect(skipLink).toHaveAttribute('href', '#main-content');
    });

    it('points the skip link at a focusable <main>', () => {
      renderLayout(<div>Page Content</div>);

      // "An element with that id exists" was the whole assertion, and it holds
      // for a stray <div id="main-content"> anywhere on the page. The skip
      // link only works if its target is the landmark *and* is focusable —
      // a plain <main> is not a tab stop, hence tabIndex={-1}.
      const main = screen.getByRole('main');
      expect(main).toHaveAttribute('id', 'main-content');
      expect(main).toHaveAttribute('tabindex', '-1');
      expect(main).toHaveTextContent('Page Content');

      const skipHref = screen.getByText('nav.skipToMain').getAttribute('href');
      expect(document.querySelector(skipHref as string)).toBe(main);
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

    it('shows trip navigation links in the sidebar as disabled, not absent', () => {
      renderLayout();

      const sidebar = getSidebar();
      expect(sidebar).not.toBeNull();

      // These used to be omitted from the DOM entirely with no trip selected,
      // which meant a keyboard or screen-reader user never learned the app had
      // a calendar at all — and it made the sidebar disagree with the mobile
      // bar, which always rendered them disabled. They are rendered now, marked
      // unavailable, with the reason announced.
      for (const key of [
        'nav.calendar',
        'nav.rooms',
        'nav.persons',
        'nav.transports',
        'nav.tripAnalytics',
        'nav.tripSettings',
      ]) {
        const link = within(sidebar as HTMLElement).getByText(key).closest('a');
        expect(link).toHaveAttribute('aria-disabled', 'true');
        // Still reachable: removing it from the tab order is what hid it.
        expect(link).not.toHaveAttribute('tabindex', '-1');
      }

      // The reason is announced rather than conveyed by dimming alone.
      expect(within(sidebar as HTMLElement).getAllByText('nav.requiresTrip').length).toBeGreaterThan(
        0,
      );
    });

    it('does not offer the trip\'s cars', () => {
      renderLayout();

      // Deliberately absent from both bars. A car exists to be picked on a
      // ride, so its page hangs off the transport list that uses it and is
      // reached by the Cars button there. Asserting it here rather than
      // trusting the array: dropping the nav entry and leaving the mobile
      // "More" sheet listing it would put a dead link one tap away.
      expect(screen.queryByText('nav.vehicles')).not.toBeInTheDocument();
      expect(screen.queryByText('vehicles.title')).not.toBeInTheDocument();
    });

    it('shows empty trip placeholder in header', () => {
      renderLayout();

      expect(screen.getByText('trips.empty')).toBeInTheDocument();
    });

    it('mobile nav shows primary items and More button, trip items are disabled', () => {
      renderLayout();

      const mobileNav = getMobileNav();
      expect(mobileNav).toBeInTheDocument();

      // Get all nav links in mobile nav
      // (4 primary items: Calendar, Rooms, Guests, Transports)
      const navLinks = within(mobileNav as HTMLElement).getAllByRole('link');
      expect(navLinks).toHaveLength(4);

      // "More" button should be present
      const moreButton = within(mobileNav as HTMLElement).getByText('nav.more');
      expect(moreButton).toBeInTheDocument();

      // Trip-specific links should be disabled (aria-disabled)
      const calendarLink = within(mobileNav as HTMLElement).getByText('nav.calendar').closest('a');
      expect(calendarLink).toHaveAttribute('aria-disabled', 'true');
    });

    // Guests sat behind "More" and took two taps, which is a lot for one of the
    // pages people open most. It has a slot in the bar now.
    it('puts Guests in the mobile bar rather than the "More" sheet', () => {
      renderLayout();

      const mobileNav = getMobileNav();
      expect(
        within(mobileNav as HTMLElement).getByText('nav.persons'),
      ).toBeInTheDocument();
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
      // Canonical range format: "15 - 22 Jul 2024" (month name follows locale)
      expect(tripInfo).toHaveTextContent(/15\s+-\s+22\s+Jul\s+2024/);
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

    it('offers directions to the trip when it has a pin', () => {
      const pinned = { ...mockTrip, coordinates: { lat: 48.2, lon: -3.1 } };
      mockUseTripContext.mockReturnValue({
        currentTrip: pinned,
        trips: [pinned],
        isLoading: false,
        error: null,
        setCurrentTrip: vi.fn(),
        checkConnection: vi.fn(),
      });

      renderLayout();

      const tripInfo = screen.getByTestId('trip-info-section');
      expect(
        within(tripInfo).getByRole('button', { name: /map\.getDirections/ }),
      ).toBeInTheDocument();
    });

    it('offers no directions for a location with no pin', () => {
      renderLayout();

      const tripInfo = screen.getByTestId('trip-info-section');
      expect(
        within(tripInfo).queryByRole('button', { name: /map\.getDirections/ }),
      ).not.toBeInTheDocument();
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

      // The trip's own settings, and the app's, side by side: two entries for
      // two different things. The trip's name, its dates and deleting it used
      // to be reachable only through `/settings`, which is the confusion this
      // entry exists to end.
      const tripSettingsLink = within(sidebar as HTMLElement)
        .getByText('nav.tripSettings')
        .closest('a');
      expect(tripSettingsLink).toHaveAttribute('href', '/trips/trip-123/edit');
      expect(within(sidebar as HTMLElement).getByText('nav.settings').closest('a')).toHaveAttribute(
        'href',
        '/settings',
      );
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
  // Current Tab Tests
  // ============================================================================

  describe('Mobile nav current tab', () => {
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

    /**
     * lucide stamps every icon it renders with a `lucide` class. The solid
     * twins in `nav-icons` are plain SVGs and carry none, which is what these
     * assertions read: colour alone used to be the only difference between the
     * current tab and the other three, and on a phone that was not enough to
     * tell people which page they were on.
     */
    function iconOf(label: string): SVGSVGElement | null {
      const mobileNav = getMobileNav(),
       link = within(mobileNav as HTMLElement).getByText(label).closest('a');
      return link?.querySelector('svg') ?? null;
    }

    it('draws the current tab filled rather than as an outline', () => {
      renderLayoutAt(`/trips/${mockTrip.id}/rooms`);

      expect(iconOf('nav.rooms')?.getAttribute('class') ?? '').not.toContain('lucide');
    });

    it('leaves every other tab as an outline', () => {
      renderLayoutAt(`/trips/${mockTrip.id}/rooms`);

      for (const label of ['nav.calendar', 'nav.persons', 'nav.money']) {
        expect(iconOf(label)?.getAttribute('class') ?? '').toContain('lucide');
      }
    });

    it('follows the route to another tab', () => {
      renderLayoutAt(`/trips/${mockTrip.id}/money`);

      expect(iconOf('nav.money')?.getAttribute('class') ?? '').not.toContain('lucide');
      expect(iconOf('nav.rooms')?.getAttribute('class') ?? '').toContain('lucide');
    });

    it('still marks the current tab for a screen reader', () => {
      renderLayoutAt(`/trips/${mockTrip.id}/rooms`);

      const mobileNav = getMobileNav(),
       roomsLink = within(mobileNav as HTMLElement).getByText('nav.rooms').closest('a');
      expect(roomsLink).toHaveAttribute('aria-current', 'page');
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

      // Should have 4 disabled links (Calendar, Rooms, Guests, Transports) —
      // the primary mobile items, all of which need a trip.
      expect(disabledLinks).toHaveLength(4);
    });

    it('collapse button carries the same name in its tooltip and its label', async () => {
      const user = userEvent.setup();
      renderLayout();

      // `toHaveAttribute('aria-label')` with no value was circular: the query
      // above had already matched *by* that attribute. What is worth pinning
      // is that the visual tooltip and the accessible name agree, and that
      // both flip with the state — a mouse user and a screen-reader user must
      // not be told different things about the same button.
      const collapse = screen.getByRole('button', { name: 'nav.collapse' });
      expect(collapse).toHaveAttribute('title', 'nav.collapse');
      // The name could also come from the title or the visible "Collapse", so
      // the label itself is pinned too: it is the one a screen reader reads.
      expect(collapse).toHaveAttribute('aria-label', 'nav.collapse');

      await user.click(collapse);

      const expand = screen.getByRole('button', { name: 'nav.expand' });
      expect(expand).toHaveAttribute('title', 'nav.expand');
      expect(expand).toHaveAttribute('aria-label', 'nav.expand');
      expect(screen.queryByRole('button', { name: 'nav.collapse' })).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Guests tonight
  // ============================================================================

  describe('Guests tonight', () => {
    // Derived from the mocked "today" with the same converter the sidebar uses,
    // so the assertion never encodes the machine's timezone offset.
    const todayKey = toLocalISODateString(fixedToday);
    const yesterdayKey = toLocalISODateString(subDays(fixedToday, 1));
    const tomorrowKey = toLocalISODateString(addDays(fixedToday, 1));

    const ongoingTrip: Trip = {
      ...mockTrip,
      startDate: yesterdayKey,
      endDate: tomorrowKey,
    };

    function guest(id: string, stay?: { start: ISODateString; end: ISODateString }): Person {
      return {
        id: id as Person['id'],
        tripId: ongoingTrip.id,
        name: id,
        color: '#3b82f6' as HexColor,
        ...(stay ? { stayStartDate: stay.start, stayEndDate: stay.end } : {}),
      };
    }

    beforeEach(() => {
      mockUseTripContext.mockReturnValue({
        currentTrip: ongoingTrip,
        trips: [ongoingTrip],
        isLoading: false,
        error: null,
        setCurrentTrip: vi.fn(),
        checkConnection: vi.fn(),
      });
    });

    // Regression: this list used a stay-window-only definition of presence
    // while the calendar counted rooms too, so a guest with a bed and no stay
    // dates was counted on the calendar and missing from the list beside it.
    it('lists a guest whose only trace tonight is a room assignment', () => {
      mockPersons.mockReturnValue([
        guest('Dated', { start: todayKey, end: tomorrowKey }),
        // Their stated stay ended this morning; the bed is what keeps them here.
        guest('RoomOnly', { start: yesterdayKey, end: todayKey }),
      ]);
      mockAssignments.mockReturnValue([
        {
          id: 'ra-1' as RoomAssignment['id'],
          tripId: ongoingTrip.id,
          roomId: 'room-1' as RoomAssignment['roomId'],
          personId: 'RoomOnly' as RoomAssignment['personId'],
          startDate: todayKey,
          endDate: tomorrowKey,
        },
      ]);

      renderLayout();

      const list = screen.getByRole('list', { name: 'nav.guestsOfTheDay' });
      expect(within(list).getByText('Dated')).toBeInTheDocument();
      expect(within(list).getByText('RoomOnly')).toBeInTheDocument();
    });

    it('follows the day when midnight passes, and the guests when they change', () => {
      mockPersons.mockReturnValue([guest('Blank')]);
      mockAssignments.mockReturnValue([]);
      const { rerender } = renderLayout();
      expect(within(screen.getByRole('list', { name: 'nav.guestsOfTheDay' })).getByText('Blank')).toBeInTheDocument();

      // Another guest arrives. The live queries hand down fresh objects, which
      // is what makes the memoised section render again.
      mockPersons.mockReturnValue([guest('Blank'), guest('Late')]);
      mockUseTripContext.mockReturnValue({
        currentTrip: { ...ongoingTrip },
        trips: [ongoingTrip],
        isLoading: false,
        error: null,
        setCurrentTrip: vi.fn(),
        checkConnection: vi.fn(),
      });
      rerender(
        <MemoryRouter>
          <Layout>
            <div>Page Content</div>
          </Layout>
        </MemoryRouter>,
      );
      expect(within(screen.getByRole('list', { name: 'nav.guestsOfTheDay' })).getByText('Late')).toBeInTheDocument();

      // Two days on, the trip is over.
      clock.today = addDays(fixedToday, 2);
      try {
        mockUseTripContext.mockReturnValue({
          currentTrip: { ...ongoingTrip },
          trips: [ongoingTrip],
          isLoading: false,
          error: null,
          setCurrentTrip: vi.fn(),
          checkConnection: vi.fn(),
        });
        rerender(
          <MemoryRouter>
            <Layout>
              <div>Page Content</div>
            </Layout>
          </MemoryRouter>,
        );

        expect(screen.getByText('nav.guestsOfTheDayOutsideTrip')).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'nav.guestsOfTheDay' })).not.toBeInTheDocument();
      } finally {
        clock.today = fixedToday;
      }
    });

    // A guest the host added and left blank is here for the trip: leaving them
    // out made this list disagree with the guest list the host had just filled
    // in, and with the rooms page beside it.
    it('lists a guest with no stay dates, transports or room', () => {
      mockPersons.mockReturnValue([guest('Blank')]);
      mockAssignments.mockReturnValue([]);

      renderLayout();

      const list = screen.getByRole('list', { name: 'nav.guestsOfTheDay' });
      expect(within(list).getByText('Blank')).toBeInTheDocument();
    });

    it('leaves out a guest whose stay and room both ended before tonight', () => {
      // Dated: a guest who filled nothing in is taken to be here for the whole
      // trip, so only stated dates can put them in the past.
      mockPersons.mockReturnValue([guest('CheckedOut', { start: yesterdayKey, end: todayKey })]);
      mockAssignments.mockReturnValue([
        {
          id: 'ra-2' as RoomAssignment['id'],
          tripId: ongoingTrip.id,
          roomId: 'room-1' as RoomAssignment['roomId'],
          personId: 'CheckedOut' as RoomAssignment['personId'],
          startDate: yesterdayKey,
          endDate: todayKey,
        },
      ]);

      renderLayout();

      const tripInfo = screen.getByTestId('trip-info-section');
      expect(screen.queryByRole('list', { name: 'nav.guestsOfTheDay' })).not.toBeInTheDocument();
      expect(within(tripInfo).getByText('nav.guestsOfTheDayEmpty')).toBeInTheDocument();
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

      const activitiesItem = await screen.findByRole('button', { name: /nav\.activities/ });
      expect(activitiesItem).toHaveAttribute('aria-disabled', 'true');
      // A natively `disabled` button leaves the tab order entirely.
      expect(activitiesItem).not.toBeDisabled();

      const hintId = activitiesItem.getAttribute('aria-describedby');
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
      await screen.findByRole('button', { name: /nav\.activities/ });

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

  // ============================================================================
  // The organiser's column
  // ============================================================================

  describe('Glance panel', () => {
    /**
     * The panel is mounted only where it is shown, so its absence from a
     * narrow screen is a missing element rather than a class. These tests pin
     * both halves: the width, and which routes get it at that width.
     */
    function getGlancePanel() {
      return document.querySelector('aside[aria-label="glance.title"]');
    }

    /**
     * Answers the layout's width question, and nothing else.
     *
     * The suite's own `matchMedia` matches nothing, which is the narrow arm:
     * a test that wants the column has to say so.
     *
     * @param isWide - Whether the viewport is at least `xl`
     */
    function setViewportWidth(isWide: boolean): void {
      vi.mocked(window.matchMedia).mockImplementation(
        (query: string) =>
          ({
            matches: query.includes('min-width: 1280px') ? isWide : false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
          }) as unknown as MediaQueryList,
      );
    }

    beforeEach(() => {
      setViewportWidth(true);
      mockUseTripContext.mockReturnValue({
        currentTrip: mockTrip,
        trips: [mockTrip],
        isLoading: false,
        error: null,
        setCurrentTrip: vi.fn(),
        checkConnection: vi.fn(),
      });
    });

    it('sits beside the trip pages that leave the width spare', () => {
      renderLayoutAt(`/trips/${mockTrip.id}/rooms`);

      expect(getGlancePanel()).toBeInTheDocument();
    });

    it('stays away from the pages that spend the width themselves', () => {
      renderLayoutAt(`/trips/${mockTrip.id}/transports/map`);

      expect(getGlancePanel()).not.toBeInTheDocument();
    });

    it('stays away from the pages that belong to no single trip', () => {
      renderLayoutAt('/trips');

      expect(getGlancePanel()).not.toBeInTheDocument();
    });

    it('is not mounted at all on a screen too narrow to show it', () => {
      // A class alone used to hide it here, which still ran its live query and
      // put a second copy of every guest and room name in the document.
      setViewportWidth(false);

      renderLayoutAt(`/trips/${mockTrip.id}/rooms`);

      expect(getGlancePanel()).not.toBeInTheDocument();
    });

    it('renders the page content beside it, not instead of it', () => {
      renderLayoutAt(
        `/trips/${mockTrip.id}/calendar`,
        <div data-testid="test-content">Test Content</div>,
      );

      expect(screen.getByTestId('test-content')).toBeInTheDocument();
      expect(getGlancePanel()).toBeInTheDocument();
    });
  });
  // ============================================================================
  // The Shell On A Phone Held Sideways
  // ============================================================================

  describe('Focused form on a short landscape viewport', () => {
    /**
     * Answers only the short-landscape query, the way a sideways phone does.
     */
    function setShortLandscape(isShort: boolean): void {
      vi.mocked(window.matchMedia).mockImplementation(
        (query: string) =>
          ({
            matches: query.includes('orientation: landscape') ? isShort : false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
          }) as unknown as MediaQueryList,
      );
    }

    it('drops the header, the sidebar and the bottom bar on /trips/new', () => {
      setShortLandscape(true);

      renderLayoutAt('/trips/new');

      expect(screen.queryByRole('banner')).not.toBeInTheDocument();
      expect(getSidebar()).not.toBeInTheDocument();
      expect(getMobileNav()).not.toBeInTheDocument();
    });

    it('still renders the page itself', () => {
      setShortLandscape(true);

      renderLayoutAt('/trips/new', <div data-testid="test-content">Test Content</div>);

      expect(screen.getByTestId('test-content')).toBeInTheDocument();
    });

    it('keeps the shell on the same route once the phone is upright', () => {
      setShortLandscape(false);

      renderLayoutAt('/trips/new');

      expect(screen.queryByRole('banner')).toBeInTheDocument();
      expect(getMobileNav()).toBeInTheDocument();
    });

    it('keeps the shell on every other route, sideways or not', () => {
      setShortLandscape(true);

      renderLayoutAt('/trips');

      // The trip list is a list: the navigation is how you leave it, and
      // hiding it would strand a short viewport on whichever page it landed
      // on. Sideways, the `auto` mode trades the bar for the header's menu
      // button, so that button is the way out here.
      expect(screen.queryByRole('banner')).toBeInTheDocument();
      expect(getMobileNav()).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'common.menu' })).toBeInTheDocument();
    });

    it('treats a trailing slash as the same route', () => {
      setShortLandscape(true);

      renderLayoutAt('/trips/new/');

      expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    });
  });

  describe('Navigation hidden by the page', () => {
    // An upright viewport, so the focused form above cannot be what hid it.
    beforeEach(() => {
      vi.mocked(window.matchMedia).mockImplementation(
        (query: string) =>
          ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
          }) as unknown as MediaQueryList,
      );
    });

    function HidingPage({ hidden }: { readonly hidden: boolean }) {
      useHideNavigation(hidden);
      return <div data-testid="hiding-page">Page</div>;
    }

    it('drops the sidebar and the bottom bar but keeps the header', () => {
      renderLayoutAt('/trips/new', <HidingPage hidden />);

      expect(getSidebar()).not.toBeInTheDocument();
      expect(getMobileNav()).not.toBeInTheDocument();
      expect(screen.getByRole('banner')).toBeInTheDocument();
      expect(screen.getByTestId('hiding-page')).toBeInTheDocument();
    });

    it('drops the header menu button too when the bar is set to a menu', async () => {
      await db.settings.put({ ...DEFAULT_SETTINGS, mobileNavMode: 'menu' });

      renderLayoutAt('/trips/new', <HidingPage hidden />);

      await vi.waitFor(async () => {
        expect((await db.settings.get('settings'))?.mobileNavMode).toBe('menu');
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(screen.queryByRole('button', { name: 'common.menu' })).not.toBeInTheDocument();
      expect(getMobileNav()).not.toBeInTheDocument();
    });

    it('keeps the navigation when the page does not ask', () => {
      renderLayoutAt('/trips/new', <HidingPage hidden={false} />);

      expect(getSidebar()).toBeInTheDocument();
      expect(getMobileNav()).toBeInTheDocument();
    });

    it('puts the navigation back when the page unmounts', () => {
      const { rerender } = renderLayoutAt('/trips/new', <HidingPage hidden />);
      expect(getMobileNav()).not.toBeInTheDocument();

      rerender(
        <MemoryRouter initialEntries={['/trips/new']}>
          <Layout>
            <div>Next page</div>
          </Layout>
        </MemoryRouter>,
      );

      expect(getMobileNav()).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Phone Navigation Preferences
  // ============================================================================

  describe('Phone navigation preferences', () => {
    /**
     * Answers only the narrow-width half of the compact query.
     */
    function setNarrow(isNarrow: boolean): void {
      vi.mocked(window.matchMedia).mockImplementation(
        (query: string) =>
          ({
            matches: query.includes('max-width: 359px') ? isNarrow : false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
          }) as unknown as MediaQueryList,
      );
    }

    beforeEach(() => {
      setNarrow(false);
      mockUseTripContext.mockReturnValue({
        currentTrip: mockTrip,
        trips: [mockTrip],
        isLoading: false,
        error: null,
        setCurrentTrip: vi.fn(),
        checkConnection: vi.fn(),
      });
    });

    it('fills the bar with the first four pages of the stored order', async () => {
      await db.settings.put({
        ...DEFAULT_SETTINGS,
        mobileNavOrder: ['transports', 'calendar', 'rooms', 'persons', 'money', 'activities', 'analytics', 'edit'],
      });

      renderLayoutAt(`/trips/${mockTrip.id}/calendar`);

      const mobileNav = getMobileNav() as HTMLElement;
      await within(mobileNav).findByText('nav.transports');
      const labels = within(mobileNav)
        .getAllByRole('link')
        .map((link) => link.textContent);
      expect(labels).toEqual(['nav.transports', 'nav.calendar', 'nav.rooms', 'nav.persons']);
    });

    it('moves the page the bar gave up into the "More" sheet', async () => {
      const user = userEvent.setup();
      await db.settings.put({
        ...DEFAULT_SETTINGS,
        mobileNavOrder: ['transports', 'calendar', 'rooms', 'persons', 'money', 'activities', 'analytics', 'edit'],
      });

      renderLayoutAt(`/trips/${mockTrip.id}/calendar`);
      const mobileNav = getMobileNav() as HTMLElement;
      await within(mobileNav).findByText('nav.transports');
      await user.click(within(mobileNav).getByRole('button', { name: 'nav.more' }));

      const sheet = await screen.findByRole('navigation', { name: 'nav.moreNavigation' });
      expect(within(sheet).getByText('nav.money')).toBeInTheDocument();
      expect(within(sheet).queryByText('nav.transports')).not.toBeInTheDocument();
    });

    it('keeps the default bar for a device that never chose', () => {
      renderLayoutAt(`/trips/${mockTrip.id}/calendar`);

      const labels = within(getMobileNav() as HTMLElement)
        .getAllByRole('link')
        .map((link) => link.textContent);
      expect(labels).toEqual(['nav.calendar', 'nav.rooms', 'nav.persons', 'nav.money']);
      expect(screen.queryByRole('button', { name: 'common.menu' })).not.toBeInTheDocument();
      expect(document.documentElement.dataset.navBar).toBeUndefined();
    });

    it('swaps the bar for a header menu that lists every page in menu mode', async () => {
      const user = userEvent.setup();
      await db.settings.put({ ...DEFAULT_SETTINGS, mobileNavMode: 'menu' });

      renderLayoutAt(`/trips/${mockTrip.id}/calendar`);

      const menuButton = await screen.findByRole('button', { name: 'common.menu' });
      expect(getMobileNav()).not.toBeInTheDocument();
      expect(document.documentElement.dataset.navBar).toBe('hidden');

      await user.click(menuButton);

      const sheet = await screen.findByRole('navigation', { name: 'nav.moreNavigation' });
      for (const label of [
        'nav.calendar',
        'nav.rooms',
        'nav.persons',
        'nav.money',
        'nav.activities',
        'nav.transports',
        'nav.tripAnalytics',
        'nav.tripSettings',
        'nav.settings',
      ]) {
        expect(within(sheet).getByText(label)).toBeInTheDocument();
      }
      expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    });

    it('navigates from the header menu and closes it', async () => {
      const user = userEvent.setup();
      await db.settings.put({ ...DEFAULT_SETTINGS, mobileNavMode: 'menu' });

      render(
        <MemoryRouter initialEntries={[`/trips/${mockTrip.id}/calendar`]}>
          <Layout>
            <LocationProbe />
          </Layout>
        </MemoryRouter>,
      );

      await user.click(await screen.findByRole('button', { name: 'common.menu' }));
      const sheet = await screen.findByRole('navigation', { name: 'nav.moreNavigation' });
      await user.click(within(sheet).getByText('nav.transports'));

      await vi.waitFor(() => {
        expect(screen.getByTestId('location-probe')).toHaveTextContent(
          `/trips/${mockTrip.id}/transports`,
        );
      });
    });

    it('uses the header menu on a very narrow screen in auto mode', () => {
      setNarrow(true);

      renderLayoutAt(`/trips/${mockTrip.id}/calendar`);

      expect(getMobileNav()).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'common.menu' })).toBeInTheDocument();
    });

    it('keeps the bar on a very narrow screen when the user asked for it', async () => {
      setNarrow(true);
      await db.settings.put({ ...DEFAULT_SETTINGS, mobileNavMode: 'bar' });

      renderLayoutAt(`/trips/${mockTrip.id}/calendar`);

      await vi.waitFor(() => {
        expect(getMobileNav()).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: 'common.menu' })).not.toBeInTheDocument();
    });

    it('takes the root marker away when the layout unmounts', async () => {
      await db.settings.put({ ...DEFAULT_SETTINGS, mobileNavMode: 'menu' });

      const { unmount } = renderLayoutAt(`/trips/${mockTrip.id}/calendar`);
      await screen.findByRole('button', { name: 'common.menu' });
      unmount();

      expect(document.documentElement.dataset.navBar).toBeUndefined();
    });
  });
});

// ============================================================================
// The cards above the page content, and the collapsed rail's tooltip timing
// ============================================================================

describe('Layout cards and tooltip timing', () => {
  const viewerTrip: Trip = { ...mockTrip, viewerToken: 'tokentokentoken1' } as Trip;

  /** Answers the wide-viewport query only, or nothing at all. */
  function setWide(isWide: boolean): void {
    vi.mocked(window.matchMedia).mockImplementation(
      (query: string) =>
        ({
          matches: isWide && query.includes('min-width: 1280px'),
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    );
  }

  function withTrip(trip: Trip | null): void {
    mockUseTripContext.mockReturnValue({
      currentTrip: trip,
      trips: trip ? [trip] : [],
      isLoading: false,
      error: null,
      setCurrentTrip: vi.fn(),
      checkConnection: vi.fn(),
    });
  }

  beforeEach(() => {
    mockPersons.mockReturnValue([]);
    mockAssignments.mockReturnValue([]);
    pushSupported.value = false;
  });

  it('explains a read-only trip on its own pages only', () => {
    withTrip(viewerTrip);

    const onTrip = renderLayoutAt(`/trips/${viewerTrip.id}/rooms`);
    expect(screen.getByTestId('stub-viewer-card')).toHaveClass('mb-4');
    onTrip.unmount();

    const elsewhere = renderLayoutAt('/settings');
    expect(screen.queryByTestId('stub-viewer-card')).not.toBeInTheDocument();
    elsewhere.unmount();

    withTrip(mockTrip);
    renderLayoutAt(`/trips/${mockTrip.id}/rooms`);
    expect(screen.queryByTestId('stub-viewer-card')).not.toBeInTheDocument();
  });

  it('offers reminders on the calendar where a push can arrive, and the install nudge where it cannot', () => {
    withTrip(mockTrip);

    pushSupported.value = true;
    const push = renderLayoutAt(`/trips/${mockTrip.id}/calendar`);
    expect(screen.getByTestId('stub-reminder-card')).toHaveAttribute('data-trip', mockTrip.id);
    expect(screen.getByTestId('stub-reminder-card')).toHaveClass('mb-4');
    expect(screen.queryByTestId('stub-install-nudge')).not.toBeInTheDocument();
    push.unmount();

    pushSupported.value = false;
    const noPush = renderLayoutAt(`/trips/${mockTrip.id}/calendar`);
    expect(screen.getByTestId('stub-install-nudge')).toHaveAttribute('data-trip', mockTrip.id);
    expect(screen.getByTestId('stub-install-nudge')).toHaveClass('mb-4');
    expect(screen.queryByTestId('stub-reminder-card')).not.toBeInTheDocument();
    noPush.unmount();

    renderLayoutAt(`/trips/${mockTrip.id}/rooms`);
    expect(screen.queryByTestId('stub-reminder-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stub-install-nudge')).not.toBeInTheDocument();
  });

  it('offers no reminder without a trip', () => {
    withTrip(null);

    renderLayoutAt('/trips/trip-123/calendar');

    expect(screen.queryByTestId('stub-reminder-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stub-install-nudge')).not.toBeInTheDocument();
  });

  it('keeps the organiser column off a trip path when no trip is open', () => {
    withTrip(null);
    setWide(true);

    renderLayoutAt('/trips/trip-123/rooms');

    expect(document.querySelector('aside[aria-label="glance.title"]')).not.toBeInTheDocument();
    setWide(false);
  });

  it('keeps a trip-gated link from going anywhere, and lets an enabled one go', () => {
    withTrip(null);
    const gated = renderLayout();
    const disabled = within(getSidebar() as HTMLElement).getByRole('link', { name: 'nav.calendar' });
    // A middle click: react-router's Link prevents a plain left click itself,
    // so only this one shows whether the layout stops the link.
    expect(fireEvent.click(disabled, { button: 1 })).toBe(false);
    gated.unmount();

    withTrip(mockTrip);
    renderLayout();
    const enabled = within(getSidebar() as HTMLElement).getByRole('link', { name: 'nav.calendar' });
    expect(fireEvent.click(enabled, { button: 1 })).toBe(true);
  });

  it('places the collapsed tooltip beside the link, and keeps it up while the pointer comes back within the delay', async () => {
    withTrip(mockTrip);
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole('button', { name: 'nav.collapse' }));
    const link = within(getSidebar() as HTMLElement).getByRole('link', { name: 'nav.calendar' });

    vi.spyOn(link, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      height: 20,
      right: 60,
      left: 20,
      bottom: 120,
      width: 40,
      x: 20,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.mouseEnter(link);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.style.top).toBe('110px');
    expect(tooltip.style.left).toBe('68px');
    expect(tooltip).toHaveClass('pointer-events-auto', 'fixed', 'z-[100]', '-translate-y-1/2', 'bg-popover', 'shadow-md');

    fireEvent.mouseLeave(link);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    // Onto the tooltip itself: the pending close is called off.
    fireEvent.mouseEnter(screen.getByRole('tooltip'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByRole('tooltip'));
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  it('forgets an open tooltip when the rail is expanded', async () => {
    withTrip(mockTrip);
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole('button', { name: 'nav.collapse' }));
    const link = within(getSidebar() as HTMLElement).getByRole('link', { name: 'nav.calendar' });
    fireEvent.mouseEnter(link);
    await screen.findByRole('tooltip');

    await user.click(screen.getByRole('button', { name: 'nav.expand' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'nav.collapse' }));

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

// ============================================================================
// How each part of the shell is drawn
// ============================================================================

describe('Layout drawing', () => {
  function withTrip(trip: Trip | null): void {
    mockUseTripContext.mockReturnValue({
      currentTrip: trip,
      trips: trip ? [trip] : [],
      isLoading: false,
      error: null,
      setCurrentTrip: vi.fn(),
      checkConnection: vi.fn(),
    });
  }

  beforeEach(() => {
    mockPersons.mockReturnValue([]);
    mockAssignments.mockReturnValue([]);
  });

  it('draws the bottom bar with trip-gated tabs dimmed, explained and going nowhere', () => {
    withTrip(null);
    renderLayoutAt('/trips');

    const bar = getMobileNav() as HTMLElement;
    expect(bar).toHaveClass('fixed', 'bottom-0', 'left-0', 'right-0', 'z-50', 'border-t', 'bg-background', 'pb-safe', 'md:hidden', 'print:hidden');
    expect(bar.querySelector('ul')).toHaveClass('flex', 'h-16', 'items-center', 'justify-around');

    const calendar = within(bar).getByRole('link', { name: 'nav.calendar' });
    expect(calendar.closest('li')).toHaveClass('flex-1');
    expect(calendar).toHaveClass('flex', 'flex-col', 'items-center', 'justify-center', 'gap-1', 'py-2', 'text-xs', 'text-muted-foreground', 'cursor-not-allowed', 'opacity-50');
    expect(calendar).toHaveAttribute('aria-disabled', 'true');
    expect(calendar).not.toHaveAttribute('aria-current');
    expect(calendar).toHaveAttribute('href', '/trips');
    const hintId = calendar.getAttribute('aria-describedby') as string;
    expect(document.getElementById(hintId)).toHaveTextContent('nav.requiresTrip');
    expect(document.getElementById(hintId)).toHaveClass('sr-only');
    expect(fireEvent.click(calendar, { button: 1 })).toBe(false);
  });

  it('draws the current tab of the bar in the primary colour, and the others muted', () => {
    withTrip(mockTrip);
    renderLayoutAt(`/trips/${mockTrip.id}/calendar`);

    const bar = getMobileNav() as HTMLElement;
    const calendar = within(bar).getByRole('link', { name: 'nav.calendar' });
    expect(calendar).toHaveClass('text-primary', 'font-medium');
    expect(calendar).not.toHaveAttribute('aria-disabled');
    expect(calendar).not.toHaveAttribute('aria-describedby');
    expect(calendar.querySelector('svg')).toHaveClass('h-5', 'w-5', 'text-primary');
    const rooms = within(bar).getByRole('link', { name: 'nav.rooms' });
    expect(rooms).toHaveClass('text-muted-foreground');
    expect(rooms).not.toHaveClass('text-primary');
    expect(rooms.querySelector('svg')).not.toHaveClass('text-primary');
    expect(bar.querySelector('.sr-only')).toBeNull();
  });

  it('opens the "More" sheet from the bar and draws its rows', async () => {
    withTrip(mockTrip);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/trips/${mockTrip.id}/calendar`]}>
        <Layout>
          <LocationProbe />
        </Layout>
      </MemoryRouter>,
    );

    const more = within(getMobileNav() as HTMLElement).getByRole('button', { name: 'nav.more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    // Pinned as well as matched: the visible "More" alone would give the same name.
    expect(more).toHaveAttribute('aria-label', 'nav.more');
    expect(more).toHaveClass('flex', 'flex-col', 'items-center', 'justify-center', 'gap-1', 'py-2', 'text-xs', 'w-full');

    await user.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');

    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('nav.more')).toBeInTheDocument();
    expect(within(sheet).getByText('nav.main')).toHaveClass('sr-only');
    const sheetNav = within(sheet).getByRole('navigation', { name: 'nav.moreNavigation' });
    expect(sheetNav.querySelector('ul')).toHaveClass('space-y-1');
    const settings = within(sheetNav).getByRole('button', { name: 'nav.settings' });
    expect(settings).toHaveClass('flex', 'items-center', 'gap-3', 'w-full', 'rounded-lg', 'px-3', 'py-3', 'text-sm', 'min-h-[44px]', 'text-foreground');
    expect(settings.querySelector('svg')).toHaveClass('h-5', 'w-5', 'shrink-0');
    expect(settings).not.toHaveAttribute('aria-disabled');

    await user.click(settings);
    await waitFor(() => {
      expect(screen.getByTestId('location-probe')).toHaveTextContent('/settings');
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('moves the "More" highlight with the page, not only on the first render', async () => {
    withTrip(mockTrip);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/trips/${mockTrip.id}/calendar`]}>
        <Layout>
          <LocationProbe />
        </Layout>
      </MemoryRouter>,
    );
    const more = within(getMobileNav() as HTMLElement).getByRole('button', { name: 'nav.more' });
    expect(more).not.toHaveClass('text-primary');

    await user.click(more);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'nav.settings' }));
    await waitFor(() => {
      expect(screen.getByTestId('location-probe')).toHaveTextContent('/settings');
    });

    expect(within(getMobileNav() as HTMLElement).getByRole('button', { name: 'nav.more' })).toHaveClass(
      'text-primary',
    );
  });

  it('marks "More" and its row as current on a page that lives in the sheet', async () => {
    withTrip(mockTrip);
    const user = userEvent.setup();
    renderLayoutAt('/settings');

    const more = within(getMobileNav() as HTMLElement).getByRole('button', { name: 'nav.more' });
    expect(more).toHaveClass('text-primary', 'font-medium');
    expect(more.querySelector('svg')).toHaveClass('text-primary');

    await user.click(more);
    const settings = within(await screen.findByRole('dialog')).getByRole('button', { name: 'nav.settings' });
    expect(settings).toHaveClass('bg-accent', 'text-accent-foreground', 'font-medium');
    expect(settings.querySelector('svg')).toHaveClass('text-primary');
  });

  it('keeps a trip-gated row in the sheet dimmed, explained and going nowhere', async () => {
    withTrip(null);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/trips']}>
        <Layout>
          <LocationProbe />
        </Layout>
      </MemoryRouter>,
    );

    await user.click(within(getMobileNav() as HTMLElement).getByRole('button', { name: 'nav.more' }));
    const sheet = await screen.findByRole('dialog');
    const analytics = within(sheet).getByRole('button', { name: 'nav.tripAnalytics' });
    expect(analytics).toHaveAttribute('aria-disabled', 'true');
    expect(analytics).toHaveClass('opacity-50', 'cursor-not-allowed');
    const hint = document.getElementById(analytics.getAttribute('aria-describedby') as string);
    expect(hint).toHaveTextContent('nav.requiresTrip');
    expect(hint).toHaveClass('sr-only');

    await user.click(analytics);
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/trips');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('draws the desktop rail open and closed', async () => {
    withTrip(mockTrip);
    const user = userEvent.setup();
    renderLayout();

    const sidebar = getSidebar() as HTMLElement;
    expect(sidebar).toHaveClass('fixed', 'left-0', 'top-14', 'z-30', 'hidden', 'h-[calc(100dvh-3.5rem)]', 'flex-col', 'border-r', 'bg-background', 'md:flex', 'print:hidden', 'w-60');
    expect(within(sidebar).getByRole('navigation', { name: 'nav.tripsNavigation' })).toHaveClass('py-2');
    expect(within(sidebar).getByRole('navigation', { name: 'nav.tripSections' })).toHaveClass('flex-1', 'overflow-y-auto', 'py-2');
    expect(within(sidebar).getByRole('navigation', { name: 'nav.settingsNavigation' })).toHaveClass('border-t', 'py-2');
    const calendar = within(sidebar).getByRole('link', { name: 'nav.calendar' });
    expect(calendar).toHaveClass('flex', 'items-center', 'rounded-lg', 'min-h-9', 'gap-3', 'px-3', 'py-2');
    expect(within(calendar).getByText('nav.calendar')).toHaveClass('truncate');
    expect(calendar.querySelector('svg')).toHaveClass('h-5', 'w-5', 'shrink-0');
    const collapse = screen.getByRole('button', { name: 'nav.collapse' });
    expect(collapse).toHaveClass('w-full');
    expect(collapse).toHaveAttribute('title', 'nav.collapse');
    expect(collapse.parentElement).toHaveClass('border-t', 'p-2');
    expect(collapse.parentElement).not.toHaveClass('justify-center');

    await user.click(collapse);

    expect(sidebar).toHaveClass('w-16');
    const expand = screen.getByRole('button', { name: 'nav.expand' });
    expect(expand).toHaveAttribute('title', 'nav.expand');
    expect(expand).not.toHaveClass('w-full');
    expect(expand.parentElement).toHaveClass('flex', 'justify-center');
    const narrow = within(sidebar).getByRole('link', { name: 'nav.calendar' });
    expect(narrow).toHaveClass('size-9', 'shrink-0', 'justify-center');
    expect(narrow.closest('li')).toHaveClass('flex', 'justify-center');
    expect(within(narrow).queryByText('nav.calendar')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveClass('md:ml-16');
  });

  it('pads the page for the shell, and for the sidebar it sits beside', () => {
    withTrip(mockTrip);
    renderLayout();

    expect(screen.getByRole('main')).toHaveClass('pb-bottom-stack', 'pt-4', 'transition-all', 'duration-300', 'md:ml-60', 'px-4', 'md:px-6', 'focus:outline-none');
  });

  it('shows the trip in the header and its card in the rail', () => {
    withTrip(mockTrip);
    renderLayout();

    expect(screen.getByRole('banner')).toHaveClass('sticky', 'top-0', 'z-40', 'flex', 'h-14', 'items-center', 'gap-4', 'border-b', 'bg-background', 'px-4', 'md:px-6', 'print:hidden');
    const home = screen.getByRole('link', { name: /app\.name/ });
    expect(home).toHaveAttribute('href', '/trips');
    expect(home).toHaveClass('inline-flex', 'items-center', 'gap-2', 'text-lg', 'font-semibold');

    const info = screen.getByTestId('trip-info-section');
    expect(info).toHaveClass('px-3', 'py-3', 'border-b');
    const title = within(info).getByRole('heading', { level: 2 });
    expect(title).toHaveClass('font-semibold', 'text-sm', 'truncate');
    expect(title).toHaveAttribute('title', mockTrip.name);
    const place = within(info).getByTitle('Brittany, France');
    expect(place).toHaveClass('truncate');
    expect(place.parentElement).toHaveClass('text-xs', 'text-muted-foreground', 'flex', 'items-center', 'gap-1');
    expect(place.parentElement?.querySelector('svg')).toHaveClass('h-3', 'w-3', 'shrink-0');
  });

  it('says the trip is not on tonight when today is outside it', () => {
    withTrip(mockTrip);
    renderLayout();

    const info = screen.getByTestId('trip-info-section');
    expect(within(info).getByText('nav.guestsOfTheDay')).toHaveClass('text-xs', 'font-medium', 'text-muted-foreground', 'uppercase', 'tracking-wide');
    expect(within(info).getByText('nav.guestsOfTheDayHint')).toHaveClass('sr-only');
    expect(within(info).getByText('nav.guestsOfTheDayOutsideTrip')).toHaveClass('text-xs', 'text-muted-foreground', 'mt-1.5');
  });

  it('says nobody is staying tonight on a trip that is on but empty', () => {
    const tonight = toLocalISODateString(fixedToday);
    withTrip({ ...mockTrip, startDate: isoDate(tonight), endDate: isoDate(tonight) });
    renderLayout();

    expect(within(screen.getByTestId('trip-info-section')).getByText('nav.guestsOfTheDayEmpty')).toHaveClass('mt-1.5');
  });
});

// ============================================================================
// Which page is current
// ============================================================================

describe('Layout current page', () => {
  beforeEach(() => {
    mockPersons.mockReturnValue([]);
    mockAssignments.mockReturnValue([]);
    mockUseTripContext.mockReturnValue({
      currentTrip: mockTrip,
      trips: [mockTrip],
      isLoading: false,
      error: null,
      setCurrentTrip: vi.fn(),
      checkConnection: vi.fn(),
    });
  });

  /*
    The trip list lives at `/trips` and every trip's pages under
    `/trips/:tripId/…`, so a prefix match on the list's path claimed every trip
    page as "My trips". On the calendar the bar then drew two current tabs,
    Calendar and "More", and the sheet and the rail both marked "My trips" as
    the page the reader was on.
  */
  it('does not count a trip page as the trip list', async () => {
    const user = userEvent.setup();
    renderLayoutAt(`/trips/${mockTrip.id}/calendar`);

    const more = within(getMobileNav() as HTMLElement).getByRole('button', { name: 'nav.more' });
    expect(more).toHaveClass('text-muted-foreground');
    expect(more).not.toHaveClass('text-primary');

    const railTrips = within(getSidebar() as HTMLElement).getByRole('link', { name: 'trips.title' });
    expect(railTrips).not.toHaveClass('bg-primary/14');
    expect(railTrips).not.toHaveAttribute('aria-current', 'page');

    await user.click(more);
    const sheetTrips = within(await screen.findByRole('dialog')).getByRole('button', { name: 'trips.title' });
    expect(sheetTrips).not.toHaveClass('bg-accent');
  });

  it('marks nothing current on a trip page before the trip has loaded', () => {
    mockUseTripContext.mockReturnValue({
      currentTrip: null,
      trips: [],
      isLoading: true,
      error: null,
      setCurrentTrip: vi.fn(),
      checkConnection: vi.fn(),
    });
    renderLayoutAt('/trips/trip-123/calendar');

    // Every trip-gated entry falls back to '/trips' with no trip, and a prefix
    // match on that lit "More" on a page none of its rows leads to.
    expect(within(getMobileNav() as HTMLElement).getByRole('button', { name: 'nav.more' })).toHaveClass(
      'text-muted-foreground',
    );
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
  });

  it('matches the current page the way the router does: any case, with or without a trailing slash', () => {
    for (const path of ['/Settings', '/settings/']) {
      const { unmount } = renderLayoutAt(path);
      const settings = within(getSidebar() as HTMLElement).getByRole('link', { name: 'nav.settings' });
      expect(settings, path).toHaveAttribute('aria-current', 'page');
      expect(settings, path).toHaveClass('bg-primary/14');
      unmount();
    }

    const { unmount } = renderLayoutAt(`/Trips/${mockTrip.id}/Calendar`);
    const bar = getMobileNav() as HTMLElement;
    expect(within(bar).getByRole('link', { name: 'nav.calendar' })).toHaveAttribute('aria-current', 'page');
    expect(within(getSidebar() as HTMLElement).getByRole('link', { name: 'nav.calendar' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    unmount();
  });

  it('gives a trip-gated rail link no aria-current at all, current or not', () => {
    mockUseTripContext.mockReturnValue({
      currentTrip: null,
      trips: [],
      isLoading: false,
      error: null,
      setCurrentTrip: vi.fn(),
      checkConnection: vi.fn(),
    });
    renderLayoutAt('/trips');

    // Not 'false' either: an absent attribute and 'false' mean the same, and
    // the bar and the rail now say it the same way.
    const calendar = within(getSidebar() as HTMLElement).getByRole('link', { name: 'nav.calendar' });
    expect(calendar).toHaveAttribute('aria-disabled', 'true');
    expect(calendar).not.toHaveAttribute('aria-current');
  });

  it('counts a page below an entry as that entry', () => {
    renderLayoutAt(`/trips/${mockTrip.id}/transports/vehicles`);

    expect(within(getSidebar() as HTMLElement).getByRole('link', { name: 'nav.transports' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('still counts the trip list and the new-trip form as the trip list', () => {
    for (const path of ['/trips', '/trips/new']) {
      const { unmount } = renderLayoutAt(path);
      const railTrips = within(getSidebar() as HTMLElement).getByRole('link', { name: 'trips.title' });
      expect(railTrips, path).toHaveClass('bg-primary/14');
      expect(within(getMobileNav() as HTMLElement).getByRole('button', { name: 'nav.more' }), path).toHaveClass(
        'text-primary',
      );
      unmount();
    }
  });
});

// ============================================================================
// What the last mutation run left
// ============================================================================

describe('Layout, more of it', () => {
  function withTrip(trip: Trip | null): void {
    mockUseTripContext.mockReturnValue({
      currentTrip: trip,
      trips: trip ? [trip] : [],
      isLoading: false,
      error: null,
      setCurrentTrip: vi.fn(),
      checkConnection: vi.fn(),
    });
  }

  /** The suite's matchMedia answer, with the given queries matching. */
  function setMatching(...fragments: string[]): void {
    vi.mocked(window.matchMedia).mockImplementation(
      (query: string) =>
        ({
          matches: fragments.some((fragment) => query.includes(fragment)),
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    );
  }

  const tonight = toLocalISODateString(fixedToday);

  beforeEach(() => {
    mockPersons.mockReturnValue([]);
    mockAssignments.mockReturnValue([]);
    contextLoading.persons = false;
    contextLoading.transports = false;
    contextLoading.assignments = false;
  });

  afterEach(() => {
    setMatching();
    contextLoading.persons = false;
    contextLoading.transports = false;
    contextLoading.assignments = false;
  });

  it('gives another trip\'s pages no organiser column', () => {
    withTrip(mockTrip);
    setMatching('min-width: 1280px');

    renderLayoutAt('/trips/trip-456/calendar');

    expect(document.querySelector('aside[aria-label="glance.title"]')).not.toBeInTheDocument();
    // And the page is not wrapped in the two-column frame either.
    expect(screen.getByRole('main').firstElementChild).toHaveTextContent('Page Content');
    expect(screen.getByRole('main').querySelector('.xl\\:flex')).toBeNull();
  });

  it('lets an enabled link of the bar and of the rail through a middle click', () => {
    withTrip(mockTrip);
    renderLayout();

    expect(fireEvent.click(within(getMobileNav() as HTMLElement).getByRole('link', { name: 'nav.calendar' }), { button: 1 })).toBe(true);
    expect(fireEvent.click(within(getSidebar() as HTMLElement).getByRole('link', { name: 'nav.calendar' }), { button: 1 })).toBe(true);
  });

  it('draws the bar and its More button with their focus and hover classes, More muted while nothing in it is current', () => {
    withTrip(mockTrip);
    renderLayoutAt(`/trips/${mockTrip.id}/calendar`);
    const bar = getMobileNav() as HTMLElement;

    expect(within(bar).getByRole('link', { name: 'nav.rooms' })).toHaveClass(
      'hover:text-primary', 'focus-visible:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-ring',
    );
    const more = within(bar).getByRole('button', { name: 'nav.more' });
    expect(more).toHaveClass('hover:text-primary', 'focus-visible:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-ring');
    expect(within(more).getByText('nav.more')).toBeInTheDocument();
    const icon = more.querySelector('svg');
    expect(icon).toHaveClass('h-5', 'w-5');
    expect(icon).not.toHaveClass('text-primary');
  });

  it('slides the sheet up from the bar, with no close button, and in from the left as the header menu', async () => {
    withTrip(mockTrip);
    const user = userEvent.setup();
    const bar = renderLayoutAt(`/trips/${mockTrip.id}/calendar`);

    await user.click(within(getMobileNav() as HTMLElement).getByRole('button', { name: 'nav.more' }));
    const sheet = await screen.findByRole('dialog');
    expect(sheet).toHaveClass('inset-x-0', 'bottom-0', 'border-t');
    expect(within(sheet).getByText('nav.more')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    const row = within(sheet).getByRole('button', { name: 'nav.settings' });
    expect(row).toHaveClass('hover:bg-accent', 'hover:text-accent-foreground', 'focus-visible:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-ring');
    bar.unmount();

    // A very narrow screen in auto mode gets the header menu instead of the bar.
    setMatching('max-width');
    renderLayoutAt(`/trips/${mockTrip.id}/calendar`);
    await user.click(screen.getByRole('button', { name: 'common.menu' }));
    const left = await screen.findByRole('dialog');
    expect(left).toHaveClass('inset-y-0', 'left-0', 'border-r');
    expect(within(left).getByText('common.menu', { selector: 'h2' })).toBeInTheDocument();
  });

  it('follows a newly opened trip in the header and the links', () => {
    withTrip(mockTrip);
    const { rerender } = renderLayout();
    withTrip(mockTripNoLocation);
    rerender(
      <MemoryRouter>
        <Layout>
          <div>Other content</div>
        </Layout>
      </MemoryRouter>,
    );

    expect(screen.getByRole('banner')).toHaveTextContent(mockTripNoLocation.name);
    expect(within(getSidebar() as HTMLElement).getByRole('link', { name: 'nav.calendar' })).toHaveAttribute(
      'href',
      `/trips/${mockTripNoLocation.id}/calendar`,
    );
  });

  it('follows a trip whose dates change', () => {
    withTrip(mockTrip);
    const { rerender } = renderLayout();
    const before = within(screen.getByTestId('trip-info-section')).getByText(/2024/).textContent;
    withTrip({ ...mockTrip, startDate: isoDate('2025-03-01'), endDate: isoDate('2025-03-09') });
    rerender(
      <MemoryRouter>
        <Layout>
          <div>Other content</div>
        </Layout>
      </MemoryRouter>,
    );

    const after = within(screen.getByTestId('trip-info-section')).getByText(/2025/).textContent;
    expect(after).not.toBe(before);
  });

  it('says a trip that has not started yet is not on tonight', () => {
    withTrip({ ...mockTrip, startDate: isoDate('2099-01-01'), endDate: isoDate('2099-01-05') });
    renderLayout();

    expect(within(screen.getByTestId('trip-info-section')).getByText('nav.guestsOfTheDayOutsideTrip')).toBeInTheDocument();
  });

  it.each(['persons', 'transports', 'assignments'] as const)(
    'waits for the %s before saying who is staying tonight',
    (source) => {
      contextLoading[source] = true;
      withTrip({ ...mockTrip, startDate: isoDate(tonight), endDate: isoDate(tonight) });
      renderLayout();

      const loading = within(screen.getByTestId('trip-info-section')).getByText('nav.guestsOfTheDayLoading');
      expect(loading).toHaveClass('text-xs', 'text-muted-foreground', 'mt-1.5');
    },
  );

  it('links each guest of tonight to the guest list, with their colour', () => {
    const tripTonight = { ...mockTrip, startDate: isoDate(tonight), endDate: isoDate(tonight) };
    withTrip(tripTonight);
    mockPersons.mockReturnValue([
      {
        id: 'p-1' as Person['id'],
        tripId: tripTonight.id,
        name: 'Ana',
        color: '#3b82f6' as HexColor,
      },
    ]);
    mockAssignments.mockReturnValue([
      {
        id: 'ra-1' as RoomAssignment['id'],
        tripId: tripTonight.id,
        roomId: 'room-1' as RoomAssignment['roomId'],
        personId: 'p-1' as RoomAssignment['personId'],
        startDate: isoDate(tonight),
        endDate: isoDate(toLocalISODateString(addDays(fixedToday, 1))),
      },
    ]);
    renderLayout();

    const link = within(screen.getByRole('list', { name: 'nav.guestsOfTheDay' })).getByRole('link', { name: 'Ana' });
    expect(link).toHaveAttribute('href', `/trips/${tripTonight.id}/persons`);
    expect(link).toHaveClass(
      'flex', 'items-center', 'gap-2', 'rounded-md', 'px-1', 'py-0.5', '-mx-1',
      'text-xs', 'text-foreground', 'hover:bg-accent/80', 'transition-colors',
      'focus-visible:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-ring',
    );
    const dot = link.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(dot).toHaveClass('size-2', 'rounded-full', 'shrink-0');
    expect(dot.style.backgroundColor).toBe('rgb(59, 130, 246)');
    expect(within(link).getByText('Ana')).toHaveClass('truncate');
  });

  it('routes the directions to the trip\'s place, or to its name when it has none', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const coordinates = { lat: 48.2, lon: -3.1 };

    withTrip({ ...mockTrip, coordinates });
    const named = renderLayout();
    fireEvent.click(within(screen.getByTestId('trip-info-section')).getByRole('button', { name: /map\.getDirections/ }));
    expect(open).toHaveBeenLastCalledWith(getDirectionsUrl(48.2, -3.1, 'Brittany, France'), '_blank', 'noopener,noreferrer');
    named.unmount();

    withTrip({ ...mockTripNoLocation, coordinates });
    renderLayout();
    fireEvent.click(within(screen.getByTestId('trip-info-section')).getByRole('button', { name: /map\.getDirections/ }));
    expect(open).toHaveBeenLastCalledWith(
      getDirectionsUrl(48.2, -3.1, mockTripNoLocation.name),
      '_blank',
      'noopener,noreferrer',
    );
    open.mockRestore();
  });

  it('draws the rail links current, plain and disabled each with their own hover', async () => {
    withTrip(mockTrip);
    const enabled = renderLayoutAt(`/trips/${mockTrip.id}/calendar`);
    const rail = getSidebar() as HTMLElement;
    const current = within(rail).getByRole('link', { name: 'nav.calendar' });
    expect(current).toHaveClass(
      'bg-primary/14', 'text-primary', 'font-medium', 'shadow-sm', 'ring-1', 'ring-primary/20',
      'hover:bg-primary/20', 'hover:text-primary',
      'focus-visible:ring-offset-2', 'focus-visible:ring-offset-background',
    );
    const plain = within(rail).getByRole('link', { name: 'nav.rooms' });
    expect(plain).toHaveClass('text-muted-foreground', 'hover:bg-accent/80', 'hover:text-accent-foreground');
    expect(plain).not.toHaveClass('hover:bg-primary/20');
    expect(plain).not.toHaveClass('cursor-not-allowed');
    enabled.unmount();

    withTrip(null);
    renderLayoutAt('/trips');
    const gated = within(getSidebar() as HTMLElement).getByRole('link', { name: 'nav.calendar' });
    expect(gated).toHaveClass('cursor-not-allowed', 'opacity-50', 'hover:bg-transparent', 'hover:text-muted-foreground');
  });

  it('sizes the collapse button for each state, and labels the open one in words', async () => {
    withTrip(mockTrip);
    const user = userEvent.setup();
    renderLayout();

    const collapse = screen.getByRole('button', { name: 'nav.collapse' });
    expect(collapse).toHaveAttribute('data-size', 'sm');
    expect(within(collapse).getByText('nav.collapse')).toBeInTheDocument();
    expect(collapse.querySelector('svg')).toHaveClass('h-4', 'w-4', 'mr-2');

    await user.click(collapse);

    const expand = screen.getByRole('button', { name: 'nav.expand' });
    expect(expand).toHaveAttribute('data-size', 'icon');
    expect(expand.querySelector('svg')).toHaveClass('h-5', 'w-5');
  });

  it('keeps the collapsed tooltip up across leave and re-enter, and drops it after the last leave', async () => {
    withTrip(mockTrip);
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole('button', { name: 'nav.collapse' }));
    const link = within(getSidebar() as HTMLElement).getByRole('link', { name: 'nav.calendar' });
    const wait = async (ms: number) => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    };

    fireEvent.mouseEnter(link);
    await screen.findByRole('tooltip');

    // Leave and come straight back: the first close is called off.
    fireEvent.mouseLeave(link);
    await wait(50);
    fireEvent.mouseEnter(link);
    await wait(150);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    // Two leaves in a row: only the second one's delay counts.
    fireEvent.mouseLeave(link);
    await wait(100);
    fireEvent.mouseLeave(link);
    await wait(80);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    // A blur closes at once and calls off a pending close, so a quick refocus stays.
    fireEvent.mouseEnter(link);
    await screen.findByRole('tooltip');
    fireEvent.mouseLeave(link);
    act(() => {
      link.blur();
      fireEvent.blur(link);
    });
    act(() => {
      link.focus();
    });
    await wait(200);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('closes the collapsed tooltip on Escape only', async () => {
    withTrip(mockTrip);
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole('button', { name: 'nav.collapse' }));
    const link = within(getSidebar() as HTMLElement).getByRole('link', { name: 'nav.calendar' });
    fireEvent.mouseEnter(link);
    await screen.findByRole('tooltip');

    fireEvent.keyDown(document, { key: 'a' });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('describes a disabled collapsed link by both its tooltip and its reason', async () => {
    withTrip(null);
    const user = userEvent.setup();
    renderLayoutAt('/trips');
    await user.click(screen.getByRole('button', { name: 'nav.collapse' }));
    const link = within(getSidebar() as HTMLElement).getByRole('link', { name: 'nav.calendar' });

    fireEvent.mouseEnter(link);
    const tooltip = await screen.findByRole('tooltip');

    const ids = (link.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(tooltip.id);
    expect(document.getElementById(ids[1] as string)).toHaveTextContent('nav.requiresTrip');
  });

  it('draws the skip link hidden until focused', () => {
    renderLayout();

    expect(screen.getByRole('link', { name: 'nav.skipToMain' })).toHaveClass(
      'sr-only', 'focus:not-sr-only',
      'focus:absolute', 'focus:top-2', 'focus:left-2', 'focus:z-[100]',
      'focus:px-4', 'focus:py-2', 'focus:rounded-md',
      'focus:bg-background', 'focus:text-foreground',
      'focus:ring-2', 'focus:ring-ring', 'focus:ring-offset-2',
      'focus:shadow-lg',
    );
  });

  it('pads the page for a form with no shell, and for a page that hid the navigation', () => {
    setMatching('orientation: landscape');
    const focused = renderLayoutAt('/trips/new');
    expect(screen.getByRole('main')).toHaveClass('pt-2', 'pb-4');
    expect(screen.getByRole('main')).not.toHaveClass('pb-bottom-stack');
    focused.unmount();
    setMatching();

    function HidesNavigation(): null {
      useHideNavigation(true);
      return null;
    }
    renderLayout(<HidesNavigation />);
    expect(screen.getByRole('main')).toHaveClass('pt-4', 'pb-6');
    expect(screen.getByRole('main')).not.toHaveClass('pb-bottom-stack');
    expect(screen.getByRole('main')).not.toHaveClass('md:ml-60');
    // With no rail there is no margin to leave for it, and nothing else either.
    expect(screen.getByRole('main').className.split(/\s+/).filter(Boolean).sort()).toEqual(
      ['pt-4', 'pb-6', 'transition-all', 'duration-300', 'px-4', 'md:px-6', 'focus:outline-none'].sort(),
    );
  });
});

describe('Layout list keys', () => {
  /*
    React logs a warning through console.error when two siblings share a key,
    and then may drop or reuse one of them. Every list in the shell is built
    from the nav items, so this renders each list once and listens.
  */
  it('gives every row of the sheet and of the rail a key of its own', async () => {
    mockPersons.mockReturnValue([]);
    mockAssignments.mockReturnValue([]);
    mockUseTripContext.mockReturnValue({
      currentTrip: mockTrip,
      trips: [mockTrip],
      isLoading: false,
      error: null,
      setCurrentTrip: vi.fn(),
      checkConnection: vi.fn(),
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    renderLayoutAt(`/trips/${mockTrip.id}/calendar`);

    await user.click(within(getMobileNav() as HTMLElement).getByRole('button', { name: 'nav.more' }));
    await screen.findByRole('dialog');

    const keyWarnings = consoleError.mock.calls.filter((args) =>
      args.some((arg) => typeof arg === 'string' && arg.includes('same key')),
    );
    expect(keyWarnings).toEqual([]);
    consoleError.mockRestore();
  });
});
