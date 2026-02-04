/**
 * @fileoverview Tests for Layout component.
 * Tests conditional navigation based on trip selection.
 *
 * @module components/shared/__tests__/Layout.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
 * Gets the sidebar element (desktop navigation).
 */
function getSidebar() {
  return document.querySelector('aside[aria-label="nav.main"]');
}

/**
 * Gets the mobile navigation element.
 */
function getMobileNav() {
  return document.querySelector('nav[aria-label="nav.main"]');
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

    it('does NOT show trip navigation links (Calendar, Rooms, etc.) in sidebar', () => {
      renderLayout();

      const sidebar = getSidebar();
      // Trip nav items should not be in the sidebar when no trip is selected
      // They'll still be in mobile nav but disabled
      const sidebarContent = sidebar?.textContent || '';
      
      // The sidebar should NOT contain these trip-specific items
      expect(sidebarContent).not.toContain('nav.calendar');
      expect(sidebarContent).not.toContain('nav.rooms');
      expect(sidebarContent).not.toContain('nav.persons');
      expect(sidebarContent).not.toContain('nav.transports');
    });

    it('shows empty trip placeholder in header', () => {
      renderLayout();

      expect(screen.getByText('trips.empty')).toBeInTheDocument();
    });

    it('mobile nav shows all items but trip items are disabled', () => {
      renderLayout();

      const mobileNav = getMobileNav();
      expect(mobileNav).toBeInTheDocument();

      // Get all nav links in mobile nav
      const navLinks = within(mobileNav as HTMLElement).getAllByRole('link');
      
      // Should have 6 links: Calendar, Rooms, Persons, Transports, Trips, Settings
      expect(navLinks).toHaveLength(6);

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
      const calendarLink = within(mobileNav as HTMLElement).getByText('nav.calendar').closest('a');
      expect(calendarLink).toHaveAttribute('aria-disabled', 'false');
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

    it('shows trip indicator when collapsed and trip selected', async () => {
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

      // Trip info section should have a title attribute with trip details
      const sidebar = getSidebar();
      const tripIndicator = sidebar?.querySelector('[title*="Beach House Vacation"]');
      expect(tripIndicator).toBeInTheDocument();
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
      expect(mobileNav).toHaveAttribute('aria-label', 'nav.main');
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

      // Should have 4 disabled links (Calendar, Rooms, Persons, Transports)
      expect(disabledLinks).toHaveLength(4);
    });

    it('collapse button has appropriate aria-label', () => {
      renderLayout();

      const button = screen.getByRole('button', { name: /collapse|expand/i });
      expect(button).toHaveAttribute('aria-label');
    });
  });
});
