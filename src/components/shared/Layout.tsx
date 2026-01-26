/**
 * @fileoverview Main application layout with responsive navigation.
 * Provides a consistent shell with header and navigation for all pages.
 *
 * @module components/shared/Layout
 */

import { type ReactNode, memo, useCallback, useMemo, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  Car,
  ChevronLeft,
  ChevronRight,
  Home,
  type LucideIcon,
  Luggage,
  Menu,
  Settings,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useTripContext } from '@/contexts/TripContext';
import { Button } from '@/components/ui/button';

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
 * Navigation items configuration.
 * Defines the main navigation structure used in both mobile and desktop nav.
 *
 * Trip-scoped routes (calendar, rooms, persons, transports) require a tripId.
 * Non-trip-scoped routes (trips list, settings) work without a tripId.
 */
const NAV_ITEMS: readonly NavItem[] = [
  { labelKey: 'nav.calendar', pathSuffix: 'calendar', icon: Calendar, requiresTrip: true },
  { labelKey: 'nav.rooms', pathSuffix: 'rooms', icon: Home, requiresTrip: true },
  { labelKey: 'nav.persons', pathSuffix: 'persons', icon: Users, requiresTrip: true },
  { labelKey: 'nav.transports', pathSuffix: 'transports', icon: Car, requiresTrip: true },
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
 * Memoized to prevent unnecessary re-renders on route changes.
 */
 MobileNav = memo(({ tripId }: NavProps): React.ReactElement => {
  const { t } = useTranslation();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background md:hidden"
      aria-label={t('nav.main', 'Main navigation')}
    >
      <ul className="flex h-16 items-center justify-around">
        {NAV_ITEMS.map((item) => {
          const path = buildNavPath(item, tripId),
           isDisabled = item.requiresTrip && !tripId;

          return (
            <li key={item.pathSuffix || 'trips'} className="flex-1">
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
      </ul>
    </nav>
  );
}),

/**
 * Desktop sidebar navigation.
 * Collapsible sidebar visible only on desktop.
 * Memoized to prevent unnecessary re-renders on route changes.
 */
 DesktopSidebar = memo(({
  isCollapsed,
  onToggle,
  tripId,
}: {
  readonly isCollapsed: boolean;
  readonly onToggle: () => void;
  readonly tripId: string | null;
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
      {/* Navigation items */}
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1 px-2">
          {NAV_ITEMS.map((item) => {
            const path = buildNavPath(item, tripId),
             isDisabled = item.requiresTrip && !tripId;

            return (
              <li key={item.pathSuffix || 'trips'}>
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
          })}
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
