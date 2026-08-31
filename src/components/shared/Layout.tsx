/**
 * @fileoverview Main application layout with responsive navigation.
 * Provides a consistent shell with header and navigation for all pages.
 *
 * @module components/shared/Layout
 */

import {
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { format, isValid, parseISO } from 'date-fns';
import type { Locale } from 'date-fns';
import {
  BarChart2,
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
  PartyPopper,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { listGuestsPresentOnDate } from '@/features/persons/utils/guest-presence';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';
import { useToday } from '@/hooks/useToday';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { toLocalISODateString } from '@/lib/db/utils';
import { cn } from '@/lib/utils';
import type { Trip } from '@/types';

import { SyncStatusBadge } from './SyncStatusBadge';

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
  { labelKey: 'nav.activities', pathSuffix: 'activities', icon: PartyPopper, requiresTrip: true },
  { labelKey: 'nav.tripAnalytics', pathSuffix: 'analytics', icon: BarChart2, requiresTrip: true },
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
 * AI Assistant navigation item.
 */
const ASSISTANT_NAV_ITEM: NavItem = {
  labelKey: 'nav.assistant',
  pathSuffix: 'assistant',
  icon: Sparkles,
  requiresTrip: false,
};

/**
 * Trip sections kept out of the mobile bottom bar, in the order they appear
 * inside the "More" sheet. The bar holds 3 trip items + "More".
 */
const MOBILE_SECONDARY_TRIP_PATHS: readonly string[] = [
  'persons',
  'activities',
  'analytics',
];

/**
 * Primary mobile bottom nav items (max 4 for UX: 3 trip items + "More").
 * Calendar, Rooms, Transports are directly accessible.
 * Persons, Activities, Analytics, Trips, Settings are inside the "More" sheet.
 * Derived from canonical arrays to avoid duplication.
 */
const MOBILE_PRIMARY_NAV_ITEMS: readonly NavItem[] = TRIP_NAV_ITEMS.filter(
  (item) => !MOBILE_SECONDARY_TRIP_PATHS.includes(item.pathSuffix),
);

/**
 * Items shown inside the "More" sheet on mobile.
 * Derived from canonical arrays to avoid duplication.
 */
const MOBILE_MORE_NAV_ITEMS: readonly NavItem[] = [
  ...MOBILE_SECONDARY_TRIP_PATHS.map(
    (pathSuffix) => TRIP_NAV_ITEMS.find((item) => item.pathSuffix === pathSuffix)!,
  ),
  ...GLOBAL_NAV_ITEMS,
  ASSISTANT_NAV_ITEM,
  SETTINGS_NAV_ITEM,
];

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
          <Menu className="h-5 w-5" aria-hidden="true" />
        </Button>
      )}

      {/* App name - links to trips list */}
      <Link to="/trips" className="text-lg font-semibold hover:text-primary transition-colors">
        {t('app.name')}
      </Link>

      <div className="ml-auto flex min-w-0 max-w-full items-center gap-3">
        <div className="shrink-0 md:hidden">
          <SyncStatusBadge />
        </div>
        <span className="text-sm text-muted-foreground truncate max-w-[120px] sm:max-w-[200px]">
          {tripName ?? t('trips.empty')}
        </span>
      </div>
    </header>
  );
});

/**
 * Mobile bottom navigation bar.
 * Fixed at the bottom of the screen, visible only on mobile.
 * Shows 3 primary items + a "More" button that opens a bottom sheet.
 * Memoized to prevent unnecessary re-renders on route changes.
 */
const MobileNav = memo(function MobileNav({ tripId }: NavProps): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const handleMoreItemClick = useCallback((path: string) => {
    setIsMoreOpen(false);
    // Defer navigation to let Sheet exit animation start before route change
    requestAnimationFrame(() => navigate(path));
  }, [navigate]);

  // Check if any "More" item's route is currently active
  const isMoreItemActive = useMemo(() => {
    return MOBILE_MORE_NAV_ITEMS.some((item) => {
      const path = buildNavPath(item, tripId);
      return location.pathname === path || location.pathname.startsWith(path + '/');
    });
  }, [tripId, location.pathname]);

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background md:hidden"
        aria-label={t('nav.mobileMain', 'Mobile navigation')}
      >
        <ul className="flex h-16 items-center justify-around">
          {MOBILE_PRIMARY_NAV_ITEMS.map((item) => {
            const path = buildNavPath(item, tripId),
             isDisabled = item.requiresTrip && !tripId;

            return (
              <li key={item.pathSuffix} className="flex-1">
                <NavLink
                  to={path}
                  onClick={(e) => { if (isDisabled) e.preventDefault(); }}
                  tabIndex={isDisabled ? -1 : undefined}
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
                  aria-disabled={isDisabled || undefined}
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

          {/* "More" button - highlights when a More item's route is active */}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setIsMoreOpen(true)}
              className={cn(
                'flex flex-col items-center justify-center gap-1 py-2 text-xs transition-colors w-full',
                'hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isMoreOpen || isMoreItemActive ? 'text-primary font-medium' : 'text-muted-foreground',
              )}
              aria-label={t('nav.more', 'More')}
              aria-expanded={isMoreOpen}
            >
              <MoreHorizontal className={cn('h-5 w-5', (isMoreOpen || isMoreItemActive) && 'text-primary')} aria-hidden="true" />
              <span>{t('nav.more', 'More')}</span>
            </button>
          </li>
        </ul>
      </nav>

      {/* "More" bottom sheet */}
      <Sheet open={isMoreOpen} onOpenChange={setIsMoreOpen}>
        {/* pb-20 accounts for h-16 bottom nav + safe area buffer */}
        <SheetContent side="bottom" showCloseButton={false} className="pb-20">
          <SheetHeader>
            <SheetTitle>{t('nav.more', 'More')}</SheetTitle>
            <SheetDescription className="sr-only">
              {t('nav.main', 'Main navigation')}
            </SheetDescription>
          </SheetHeader>
          <nav aria-label={t('nav.moreNavigation', 'More navigation')}>
            <ul className="space-y-1">
              {MOBILE_MORE_NAV_ITEMS.map((item) => {
                const path = buildNavPath(item, tripId);
                const isDisabled = item.requiresTrip && !tripId;
                const isActive = location.pathname === path || location.pathname.startsWith(path + '/');

                return (
                  <li key={`${item.requiresTrip ? 'trip' : 'global'}-${item.pathSuffix || 'trips'}`}>
                    <button
                      type="button"
                      onClick={() => handleMoreItemClick(path)}
                      disabled={isDisabled}
                      className={cn(
                        'flex items-center gap-3 w-full rounded-lg px-3 py-3 text-sm min-h-[44px] transition-colors',
                        'hover:bg-accent hover:text-accent-foreground',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isActive
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-foreground',
                        isDisabled && 'opacity-50 cursor-not-allowed',
                      )}
                    >
                      <item.icon className={cn('h-5 w-5 shrink-0', isActive && 'text-primary')} aria-hidden="true" />
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
function formatDateRange(
  startDate: string,
  endDate: string,
  locale: Locale,
): string {
  // `new Date('2026-08-01')` is UTC midnight, and `toLocaleDateString` renders
  // it in the LOCAL zone — one day early at any negative offset. `parseISO`
  // gives local midnight, so the printed day matches the stored one. Passing the
  // locale also keeps month names in the app's language rather than the
  // browser's default.
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (!isValid(start) || !isValid(end)) {
    return '';
  }
  return `${format(start, 'MMM d', { locale })} - ${format(end, 'MMM d', { locale })}`;
}

/**
 * Trip info section in the sidebar when a trip is selected (expanded rail only).
 */
const TripInfoSection = memo(function TripInfoSection({
  trip,
  isCollapsed,
}: {
  readonly trip: Trip;
  readonly isCollapsed: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { today } = useToday();
  const { persons, isLoading: isPersonsLoading } = usePersonContext();
  const { arrivals, departures, isLoading: isTransportsLoading } = useTransportContext();

  const { i18n } = useTranslation();
  const dateRange = useMemo(
    () => formatDateRange(trip.startDate, trip.endDate, getDateLocale(i18n.language)),
    [trip.startDate, trip.endDate, i18n.language],
  );

  const todayKey = useMemo(() => toLocalISODateString(today), [today]);

  const todayWithinTrip = useMemo(
    () => trip.startDate <= todayKey && todayKey <= trip.endDate,
    [todayKey, trip.endDate, trip.startDate],
  );

  const guestsTonight = useMemo(() => {
    if (!todayWithinTrip) {
      return [];
    }
    return listGuestsPresentOnDate(persons, arrivals, departures, todayKey);
  }, [arrivals, departures, persons, todayKey, todayWithinTrip]);

  const isGuestsLoading = isPersonsLoading || isTransportsLoading;

  if (isCollapsed) {
    // Icon-only sidebar already has trip nav; a duplicate luggage chip adds no usable info.
    return null;
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

      <div className="mt-3 pt-2 border-t border-border/60">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          {t('nav.guestsOfTheDay')}
        </p>
        <p className="sr-only">{t('nav.guestsOfTheDayHint')}</p>
        {isGuestsLoading ? (
          <p className="text-xs text-muted-foreground mt-1.5">{t('nav.guestsOfTheDayLoading')}</p>
        ) : !todayWithinTrip ? (
          <p className="text-xs text-muted-foreground mt-1.5">{t('nav.guestsOfTheDayOutsideTrip')}</p>
        ) : guestsTonight.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-1.5">{t('nav.guestsOfTheDayEmpty')}</p>
        ) : (
          <ul
            className="mt-1.5 space-y-1 max-h-36 overflow-y-auto"
            aria-label={t('nav.guestsOfTheDay')}
          >
            {guestsTonight.map((person) => (
              <li key={person.id}>
                <Link
                  to={`/trips/${trip.id}/persons`}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-1 py-0.5 -mx-1',
                    'text-xs text-foreground hover:bg-accent/80 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <span
                    className="size-2 rounded-full shrink-0"
                    style={{ backgroundColor: person.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{person.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});

/**
 * Renders a navigation link item.
 */
const NavLinkItem = memo(function NavLinkItem({
  item,
  tripId,
  isCollapsed,
}: {
  readonly item: NavItem;
  readonly tripId: string | null;
  readonly isCollapsed: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const path = buildNavPath(item, tripId);
  const isDisabled = item.requiresTrip && !tripId;
  const label = String(t(item.labelKey));

  const linkRef = useRef<HTMLAnchorElement>(null);
  const hideTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [collapsedTooltipOpen, setCollapsedTooltipOpen] = useState(false);
  const [collapsedTooltipPos, setCollapsedTooltipPos] = useState({ top: 0, left: 0 });

  const clearHideTooltipTimer = useCallback(() => {
    if (hideTooltipTimerRef.current !== null) {
      clearTimeout(hideTooltipTimerRef.current);
      hideTooltipTimerRef.current = null;
    }
  }, []);

  const openCollapsedTooltip = useCallback(() => {
    clearHideTooltipTimer();
    setCollapsedTooltipOpen(true);
  }, [clearHideTooltipTimer]);

  const scheduleCloseCollapsedTooltip = useCallback(() => {
    clearHideTooltipTimer();
    hideTooltipTimerRef.current = setTimeout(() => {
      setCollapsedTooltipOpen(false);
    }, 150);
  }, [clearHideTooltipTimer]);

  const closeCollapsedTooltipNow = useCallback(() => {
    clearHideTooltipTimer();
    setCollapsedTooltipOpen(false);
  }, [clearHideTooltipTimer]);

  useLayoutEffect(() => {
    if (!isCollapsed || !collapsedTooltipOpen || !linkRef.current) {
      return;
    }
    const r = linkRef.current.getBoundingClientRect();
    setCollapsedTooltipPos({ top: r.top + r.height / 2, left: r.right + 8 });
  }, [isCollapsed, collapsedTooltipOpen]);

  useEffect(() => {
    return () => {
      clearHideTooltipTimer();
    };
  }, [clearHideTooltipTimer]);

  return (
    <li className={cn(isCollapsed && 'flex justify-center')}>
      <NavLink
        ref={linkRef}
        to={path}
        onClick={(e) => {
          if (isDisabled) e.preventDefault();
        }}
        tabIndex={isDisabled ? -1 : undefined}
        aria-label={isCollapsed ? label : undefined}
        className={({ isActive }) =>
          cn(
            'flex items-center rounded-lg transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            isCollapsed
              ? 'size-9 shrink-0 justify-center'
              : 'min-h-9 gap-3 px-3 py-2',
            isActive
              ? 'bg-primary/14 text-primary font-medium shadow-sm ring-1 ring-primary/20'
              : 'text-muted-foreground hover:bg-accent/80 hover:text-accent-foreground',
            isActive && 'hover:bg-primary/20 hover:text-primary',
            isDisabled && 'pointer-events-none opacity-50',
          )
        }
        aria-disabled={isDisabled || undefined}
        onMouseEnter={isCollapsed ? openCollapsedTooltip : undefined}
        onMouseLeave={isCollapsed ? scheduleCloseCollapsedTooltip : undefined}
        onFocus={isCollapsed ? openCollapsedTooltip : undefined}
        onBlur={isCollapsed ? closeCollapsedTooltipNow : undefined}
      >
        <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        {!isCollapsed ? <span className="truncate">{label}</span> : null}
      </NavLink>
      {isCollapsed && collapsedTooltipOpen
        ? createPortal(
            <div
              role="tooltip"
              className={cn(
                'pointer-events-auto fixed z-[100] -translate-y-1/2',
                'whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1.5',
                'text-xs font-medium text-popover-foreground shadow-md',
              )}
              style={{
                top: collapsedTooltipPos.top,
                left: collapsedTooltipPos.left,
              }}
              onMouseEnter={clearHideTooltipTimer}
              onMouseLeave={scheduleCloseCollapsedTooltip}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
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
const DesktopSidebar = memo(function DesktopSidebar({
  isCollapsed,
  onToggle,
  tripId,
  trip,
}: {
  readonly isCollapsed: boolean;
  readonly onToggle: () => void;
  readonly tripId: string | null;
  readonly trip: Trip | null;
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
      {/* My Trips link - always at top */}
      <nav className="py-2" aria-label={t('nav.tripsNavigation', 'Trips navigation')}>
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
        <nav className="flex-1 overflow-y-auto py-2" aria-label={t('nav.tripSections', 'Trip navigation')}>
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

      {/* Yjs / P2P online count — desktop sidebar only when others are online (mobile: header above) */}
      <SyncStatusBadge collapsed={isCollapsed} layout="sidebar" />

      {/* AI Assistant & Settings - always at bottom */}
      <nav className="border-t py-2" aria-label={t('nav.settingsNavigation', 'Settings navigation')}>
        <ul className="space-y-1 px-2">
          <NavLinkItem
            item={ASSISTANT_NAV_ITEM}
            tripId={tripId}
            isCollapsed={isCollapsed}
          />
          <NavLinkItem
            item={SETTINGS_NAV_ITEM}
            tripId={tripId}
            isCollapsed={isCollapsed}
          />
        </ul>
      </nav>

      {/* Collapse toggle button */}
      <div className={cn('border-t p-2', isCollapsed && 'flex justify-center')}>
        <Button
          variant="ghost"
          size={isCollapsed ? 'icon' : 'sm'}
          className={cn(!isCollapsed && 'w-full')}
          onClick={onToggle}
          title={
            isCollapsed
              ? t('nav.expand', 'Expand sidebar')
              : t('nav.collapse', 'Collapse sidebar')
          }
          aria-label={
            isCollapsed
              ? t('nav.expand', 'Expand sidebar')
              : t('nav.collapse', 'Collapse sidebar')
          }
        >
          {isCollapsed ? (
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4 mr-2" aria-hidden="true" />
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
