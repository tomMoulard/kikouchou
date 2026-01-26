/**
 * @fileoverview Main application layout with responsive navigation.
 * Provides a consistent shell with header and navigation for all pages.
 *
 * @module components/shared/Layout
 */

import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  Car,
  ChevronLeft,
  ChevronRight,
  Home,
  Menu,
  Settings,
  Users,
  type LucideIcon,
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
  /** Route path */
  readonly path: string;
  /** Lucide icon component */
  readonly icon: LucideIcon;
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
 */
const NAV_ITEMS: readonly NavItem[] = [
  { labelKey: 'nav.calendar', path: '/calendar', icon: Calendar },
  { labelKey: 'nav.rooms', path: '/rooms', icon: Home },
  { labelKey: 'nav.persons', path: '/persons', icon: Users },
  { labelKey: 'nav.transports', path: '/transports', icon: Car },
  { labelKey: 'nav.settings', path: '/settings', icon: Settings },
] as const;

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Header component displaying the app name and current trip.
 * Memoized to prevent unnecessary re-renders on route changes.
 */
const Header = memo(function Header({
  tripName,
  onMenuClick,
}: {
  readonly tripName: string | null;
  readonly onMenuClick?: () => void;
}): React.ReactElement {
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

      {/* App name */}
      <h1 className="text-lg font-semibold">{t('app.name')}</h1>

      {/* Current trip name or placeholder */}
      <span className="ml-auto text-sm text-muted-foreground">
        {tripName ?? t('trips.empty')}
      </span>
    </header>
  );
});

/**
 * Mobile bottom navigation bar.
 * Fixed at the bottom of the screen, visible only on mobile.
 * Memoized to prevent unnecessary re-renders on route changes.
 */
const MobileNav = memo(function MobileNav(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background md:hidden"
      aria-label={t('nav.main', 'Main navigation')}
    >
      <ul className="flex h-16 items-center justify-around">
        {NAV_ITEMS.map((item) => (
          <li key={item.path} className="flex-1">
            <NavLink
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center justify-center gap-1 py-2 text-xs transition-colors',
                  'hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'text-primary font-medium'
                    : 'text-muted-foreground',
                )
              }
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
        ))}
      </ul>
    </nav>
  );
});

/**
 * Desktop sidebar navigation.
 * Collapsible sidebar visible only on desktop.
 * Memoized to prevent unnecessary re-renders on route changes.
 */
const DesktopSidebar = memo(function DesktopSidebar({
  isCollapsed,
  onToggle,
}: {
  readonly isCollapsed: boolean;
  readonly onToggle: () => void;
}): React.ReactElement {
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
          {NAV_ITEMS.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground',
                    isCollapsed && 'justify-center px-2',
                  )
                }
                title={isCollapsed ? t(item.labelKey) : undefined}
              >
                <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                {!isCollapsed && (
                  <span className="truncate">{t(item.labelKey)}</span>
                )}
              </NavLink>
            </li>
          ))}
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
  const { currentTrip } = useTripContext();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Memoize derived value to prevent unnecessary re-renders
  const tripName = useMemo(() => currentTrip?.name ?? null, [currentTrip?.name]);

  // Memoize callback to maintain stable reference for DesktopSidebar
  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <Header tripName={tripName} />

      {/* Desktop sidebar */}
      <DesktopSidebar
        isCollapsed={isSidebarCollapsed}
        onToggle={toggleSidebar}
      />

      {/* Main content area */}
      <main
        className={cn(
          'pb-20 pt-4 transition-all duration-300 md:pb-4',
          // Adjust left margin based on sidebar state (desktop only)
          isSidebarCollapsed ? 'md:ml-16' : 'md:ml-60',
          'px-4 md:px-6',
        )}
      >
        {children}
      </main>

      {/* Mobile bottom navigation */}
      <MobileNav />
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export type { LayoutProps };
