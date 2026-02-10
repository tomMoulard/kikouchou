/**
 * @fileoverview Main application layout with responsive navigation.
 * Provides a consistent shell with header and navigation for all pages.
 *
 * @module components/shared/Layout
 */

import { type ReactNode, memo, useCallback, useMemo, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  Car,
  ChevronLeft,
  ChevronRight,
  Home,
  type LucideIcon,
  Luggage,
  MapPin,
  Menu,
  MoreHorizontal,
  Settings,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useTripContext } from '@/contexts/TripContext';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { Trip } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Navigation item configuration.
 */
interface NavItem {
  /** Translation key for the label */
  readonly labelKey: string;
  /** Route path suffix (will be prefixed with tripId for trip-scoped routes) */
  readonly pathSuffix: string;
  /** Lucide icon component */
  readonly icon: LucideIcon;
  /** Whether this route requires a trip (trip-scoped) */
  readonly requiresTrip: boolean;
}

/**
 * Props for the navigation components.
 */
interface NavProps {
  /** Current trip ID for building trip-scoped paths */
  readonly tripId: string | null;
}

/**
 * Props for the Layout component.
 */
interface LayoutProps {
  /** Page content to render in the main area */
  readonly children: ReactNode;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Navigation items that require a trip to be selected.
 */
const TRIP_NAV_ITEMS: readonly NavItem[] = [
  { labelKey: 'nav.calendar', pathSuffix: 'calendar', icon: Calendar, requiresTrip: true },
  { labelKey: 'nav.rooms', pathSuffix: 'rooms', icon: Home, requiresTrip: true },
  { labelKey: 'nav.persons', pathSuffix: 'persons', icon: Users, requiresTrip: true },
  { labelKey: 'nav.transports', pathSuffix: 'transports', icon: Car, requiresTrip: true },
] as const;

/**
 * Navigation items that don't require a trip (always visible).
 */
const GLOBAL_NAV_ITEMS: readonly NavItem[] = [
  { labelKey: 'trips.title', pathSuffix: '', icon: Luggage, requiresTrip: false },
] as const;

/**
 * Settings navigation item (always at bottom).
 */
const SETTINGS_NAV_ITEM: NavItem = {
  labelKey: 'nav.settings',
  pathSuffix: 'settings',
  icon: Settings,
  requiresTrip: false,
};

/**
 * Primary mobile bottom nav items (max 4 for UX: 3 trip items + "More").
 * Calendar, Rooms, Transports are directly accessible.
 * Persons, Trips, Settings are inside the "More" sheet.
 */
const MOBILE_PRIMARY_NAV_ITEMS: readonly NavItem[] = [
  { labelKey: 'nav.calendar', pathSuffix: 'calendar', icon: Calendar, requiresTrip: true },
  { labelKey: 'nav.rooms', pathSuffix: 'rooms', icon: Home, requiresTrip: true },
  { labelKey: 'nav.transports', pathSuffix: 'transports', icon: Car, requiresTrip: true },
] as const;

/**
 * Items shown inside the "More" sheet on mobile.
 */
const MOBILE_MORE_NAV_ITEMS: readonly NavItem[] = [
  { labelKey: 'nav.persons', pathSuffix: 'persons', icon: Users, requiresTrip: true },
  { labelKey: 'trips.title', pathSuffix: '', icon: Luggage, requiresTrip: false },
  { labelKey: 'nav.settings', pathSuffix: 'settings', icon: Settings, requiresTrip: false },
] as const;

/**
 * Builds the navigation path for a nav item.
 *
 * @param item - The navigation item
 * @param tripId - Current trip ID or null
 * @returns The full path for the navigation item
 */
function buildNavPath(item: NavItem, tripId: string | null): string {
  if (item.requiresTrip) {
    // Trip-scoped routes require a tripId
    if (!tripId) {
      // If no trip is selected, link to trips list
      return '/trips';
    }
    return `/trips/${tripId}/${item.pathSuffix}`;
  }

  // Non-trip-scoped routes
  if (item.pathSuffix === '') {
    return '/trips';
  }
  return `/${item.pathSuffix}`;
}

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Header component displaying the app name and current trip.
 * Memoized to prevent unnecessary re-renders on route changes.
 */
const Header = memo(({
  tripName,
  onMenuClick,
}: {
  readonly tripName: string | null;
  readonly onMenuClick?: () => void;
}): React.ReactElement => {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b bg-background px-4 md:px-6">
      {/* Mobile menu button - only visible on mobile */}
      {onMenuClick && (
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onMenuClick}
          aria-label={t('common.menu', 'Menu')}
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}

      {/* App name - links to trips list */}
      <Link to="/trips" className="text-lg font-semibold hover:text-primary transition-colors">
        {t('app.name')}
      </Link>

      {/* Current trip name or placeholder - responsive max-width */}
      <span className="ml-auto text-sm text-muted-foreground truncate max-w-[120px] sm:max-w-[200px]">
        {tripName ?? t('trips.empty')}
      </span>
    </header>
  );
}),

/**
 * Mobile bottom navigation bar.
 * Fixed at the bottom of the screen, visible only on mobile.
 * Shows 3 primary items + a "More" button that opens a bottom sheet.
 * Memoized to prevent unnecessary re-renders on route changes.
 */
 MobileNav = memo(({ tripId }: NavProps): React.ReactElement => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const handleMoreItemClick = useCallback((path: string) => {
    setIsMoreOpen(false);
    navigate(path);
  }, [navigate]);

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background md:hidden"
        aria-label={t('nav.main', 'Main navigation')}
      >
        <ul className="flex h-16 items-center justify-around">
          {MOBILE_PRIMARY_NAV_ITEMS.map((item) => {
            const path = buildNavPath(item, tripId),
             isDisabled = item.requiresTrip && !tripId;

            return (
              <li key={item.pathSuffix} className="flex-1">
                <NavLink
                  to={path}
                  className={({ isActive }) =>
                    cn(
                      'flex flex-col items-center justify-center gap-1 py-2 text-xs transition-colors',
                      'hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive
                        ? 'text-primary font-medium'
                        : 'text-muted-foreground',
                      isDisabled && 'opacity-50 pointer-events-none',
                    )
                  }
                  aria-disabled={isDisabled}
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        className={cn('h-5 w-5', isActive && 'text-primary')}
                        aria-hidden="true"
                      />
                      <span>{t(item.labelKey)}</span>
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}

          {/* "More" button */}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setIsMoreOpen(true)}
              className={cn(
                'flex flex-col items-center justify-center gap-1 py-2 text-xs transition-colors w-full',
                'hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isMoreOpen ? 'text-primary font-medium' : 'text-muted-foreground',
              )}
              aria-label={t('nav.more', 'More')}
              aria-expanded={isMoreOpen}
            >
              <MoreHorizontal className={cn('h-5 w-5', isMoreOpen && 'text-primary')} aria-hidden="true" />
              <span>{t('nav.more', 'More')}</span>
            </button>
          </li>
        </ul>
      </nav>

      {/* "More" bottom sheet */}
      <Sheet open={isMoreOpen} onOpenChange={setIsMoreOpen}>
        <SheetContent side="bottom" showCloseButton={false} className="pb-20">
          <SheetHeader>
            <SheetTitle>{t('nav.more', 'More')}</SheetTitle>
            <SheetDescription className="sr-only">
              {t('nav.main', 'Main navigation')}
            </SheetDescription>
          </SheetHeader>
          <nav aria-label={t('nav.more', 'More')}>
            <ul className="space-y-1">
              {MOBILE_MORE_NAV_ITEMS.map((item) => {
                const path = buildNavPath(item, tripId);
                const isDisabled = item.requiresTrip && !tripId;

                return (
                  <li key={item.pathSuffix || 'trips'}>
                    <button
                      type="button"
                      onClick={() => handleMoreItemClick(path)}
                      disabled={isDisabled}
                      className={cn(
                        'flex items-center gap-3 w-full rounded-lg px-3 py-3 text-sm transition-colors',
                        'hover:bg-accent hover:text-accent-foreground',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        'text-foreground',
                        isDisabled && 'opacity-50 cursor-not-allowed',
                      )}
                    >
                      <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                      <span>{t(item.labelKey)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
});

/**
 * Formats date range for display.
 * @param startDate - Start date in ISO format
 * @param endDate - End date in ISO format
 * @returns Formatted date range string
 */
function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  
  return `${start.toLocaleDateString(undefined, options)} - ${end.toLocaleDateString(undefined, options)}`;
}

/**
 * Trip info section displayed in the sidebar when a trip is selected.
 */
const TripInfoSection = memo(({
  trip,
  isCollapsed,
}: {
  readonly trip: Trip;
  readonly isCollapsed: boolean;
}): React.ReactElement => {
  const dateRange = useMemo(
    () => formatDateRange(trip.startDate, trip.endDate),
    [trip.startDate, trip.endDate],
  );

  if (isCollapsed) {
    // When collapsed, show minimal trip indicator
    return (
      <div
        className="px-2 py-3 border-b"
        title={`${trip.name}\n${dateRange}${trip.location ? `\n${trip.location}` : ''}`}
      >
        <div className="flex justify-center">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Luggage className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-3 border-b" data-testid="trip-info-section">
      <div className="space-y-1">
        <h2 className="font-semibold text-sm truncate" title={trip.name}>
          {trip.name}
        </h2>
        <p className="text-xs text-muted-foreground">
          {dateRange}
        </p>
        {trip.location && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate" title={trip.location}>{trip.location}</span>
          </p>
        )}
      </div>
    </div>
  );
});

/**
 * Renders a navigation link item.
 */
const NavLinkItem = memo(({
  item,
  tripId,
  isCollapsed,
}: {
  readonly item: NavItem;
  readonly tripId: string | null;
  readonly isCollapsed: boolean;
}): React.ReactElement => {
  const { t } = useTranslation();
  const path = buildNavPath(item, tripId);
  const isDisabled = item.requiresTrip && !tripId;

  return (
    <li>
      <NavLink
        to={path}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isActive
              ? 'bg-accent text-accent-foreground font-medium'
              : 'text-muted-foreground',
            isCollapsed && 'justify-center px-2',
            isDisabled && 'opacity-50 pointer-events-none',
          )
        }
        title={isCollapsed ? t(item.labelKey) : undefined}
        aria-disabled={isDisabled}
      >
        <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        {!isCollapsed && (
          <span className="truncate">{t(item.labelKey)}</span>
        )}
      </NavLink>
    </li>
  );
});

/**
 * Desktop sidebar navigation.
 * Shows conditional content based on whether a trip is selected:
 * - No trip: Only "My Trips" and "Settings"
 * - Trip selected: Trip info + Calendar/Rooms/Guests/Transport + "My Trips" + "Settings"
 * 
 * Memoized to prevent unnecessary re-renders on route changes.
 */
const DesktopSidebar = memo(({
  isCollapsed,
  onToggle,
  tripId,
  trip,
}: {
  readonly isCollapsed: boolean;
  readonly onToggle: () => void;
  readonly tripId: string | null;
  readonly trip: Trip | null;
}): React.ReactElement => {
  const { t } = useTranslation();

  return (
    <aside
      className={cn(
        'fixed left-0 top-14 z-30 hidden h-[calc(100vh-3.5rem)] flex-col border-r bg-background transition-all duration-300 md:flex',
        isCollapsed ? 'w-16' : 'w-60',
      )}
      aria-label={t('nav.main', 'Main navigation')}
    >
      {/* My Trips link - always at top */}
      <nav className="py-2">
        <ul className="space-y-1 px-2">
          {GLOBAL_NAV_ITEMS.map((item) => (
            <NavLinkItem
              key={item.pathSuffix || 'trips'}
              item={item}
              tripId={tripId}
              isCollapsed={isCollapsed}
            />
          ))}
        </ul>
      </nav>

      {/* Trip info section - only shown when trip is selected */}
      {trip && (
        <TripInfoSection trip={trip} isCollapsed={isCollapsed} />
      )}

      {/* Trip navigation items - only shown when trip is selected */}
      {trip && (
        <nav className="flex-1 overflow-y-auto py-2">
          <ul className="space-y-1 px-2">
            {TRIP_NAV_ITEMS.map((item) => (
              <NavLinkItem
                key={item.pathSuffix}
                item={item}
                tripId={tripId}
                isCollapsed={isCollapsed}
              />
            ))}
          </ul>
        </nav>
      )}

      {/* Spacer when no trip */}
      {!trip && <div className="flex-1" />}

      {/* Settings - always at bottom */}
      <nav className="border-t py-2">
        <ul className="px-2">
          <NavLinkItem
            item={SETTINGS_NAV_ITEM}
            tripId={tripId}
            isCollapsed={isCollapsed}
          />
        </ul>
      </nav>

      {/* Collapse toggle button */}
      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className={cn('w-full', isCollapsed ? 'justify-center' : '')}
          onClick={onToggle}
          aria-label={
            isCollapsed
              ? t('nav.expand', 'Expand sidebar')
              : t('nav.collapse', 'Collapse sidebar')
          }
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4 mr-2" />
              <span>{t('nav.collapse', 'Collapse')}</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  );
});

// ============================================================================
// Main Component
// ============================================================================

/**
 * Main application layout component.
 *
 * Provides a responsive shell with:
 * - Header with app name and current trip
 * - Bottom navigation on mobile
 * - Collapsible sidebar on desktop
 * - Main content area for page content
 *
 * Navigation paths are dynamically built based on the current trip:
 * - Trip-scoped routes (calendar, rooms, persons, transports) use `/trips/:tripId/:path`
 * - Non-trip-scoped routes (trips list, settings) use `/:path`
 *
 * @param props - Layout props including children
 * @returns The layout wrapper with navigation and content area
 *
 * @example
 * ```tsx
 * import { Layout } from '@/components/shared/Layout';
 *
 * function App() {
 *   return (
 *     <Layout>
 *       <HomePage />
 *     </Layout>
 *   );
 * }
 * ```
 */
export function Layout({ children }: LayoutProps): React.ReactElement {
  const { t } = useTranslation(),
   { currentTrip } = useTripContext(),
   [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false),

  // Memoize derived values to prevent unnecessary re-renders
   tripName = useMemo(() => currentTrip?.name ?? null, [currentTrip]),
   tripId = useMemo(() => currentTrip?.id ?? null, [currentTrip]),

  // Memoize callback to maintain stable reference for DesktopSidebar
   toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev);
  }, [setIsSidebarCollapsed]);

  return (
    <div className="min-h-screen bg-background">
      {/* Skip link for keyboard navigation - allows users to bypass navigation */}
      <a
        href="#main-content"
        className={cn(
          'sr-only focus:not-sr-only',
          'focus:absolute focus:top-2 focus:left-2 focus:z-[100]',
          'focus:px-4 focus:py-2 focus:rounded-md',
          'focus:bg-background focus:text-foreground',
          'focus:ring-2 focus:ring-ring focus:ring-offset-2',
          'focus:shadow-lg',
        )}
      >
        {t('nav.skipToMain', 'Skip to main content')}
      </a>

      {/* Header */}
      <Header tripName={tripName} />

      {/* Desktop sidebar */}
      <DesktopSidebar
        isCollapsed={isSidebarCollapsed}
        onToggle={toggleSidebar}
        tripId={tripId}
        trip={currentTrip}
      />

      {/* Main content area */}
      <main
        id="main-content"
        tabIndex={-1}
        className={cn(
          'pb-20 pt-4 transition-all duration-300 md:pb-4',
          // Adjust left margin based on sidebar state (desktop only)
          isSidebarCollapsed ? 'md:ml-16' : 'md:ml-60',
          'px-4 md:px-6',
          // Remove focus outline when programmatically focused via skip link
          'focus:outline-none',
        )}
      >
        {children}
      </main>

      {/* Mobile bottom navigation */}
      <MobileNav tripId={tripId} />
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export type { LayoutProps };
