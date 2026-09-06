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
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  UsersRound,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { listGuestsOnSiteOnDate } from '@/features/persons/utils/guest-presence';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';
import { useToday } from '@/hooks/useToday';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { toLocalISODateString } from '@/lib/db/utils';
import { cn } from '@/lib/utils';
import { formatDateRange } from '@/lib/utils/date-format';
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
  // The trip's cars are deliberately absent: they hang off the transport list
  // (`/transports/vehicles`), because a car is only ever entered in order to be
  // picked on a ride and nobody navigates to one for its own sake.
  { labelKey: 'nav.transports', pathSuffix: 'transports', icon: Car, requiresTrip: true },
  { labelKey: 'nav.activities', pathSuffix: 'activities', icon: PartyPopper, requiresTrip: true },
  { labelKey: 'nav.tripAnalytics', pathSuffix: 'analytics', icon: BarChart2, requiresTrip: true },
] as const;

/**
 * Navigation items that don't require a trip (always visible).
 */
const GLOBAL_NAV_ITEMS: readonly NavItem[] = [
  { labelKey: 'trips.title', pathSuffix: '', icon: Luggage, requiresTrip: false },
  // Guest groups sit here rather than beside "Guests": they belong to the
  // account, are edited with no trip selected, and outlive every trip they were
  // imported into.
  { labelKey: 'guestGroups.title', pathSuffix: 'groups', icon: UsersRound, requiresTrip: false },
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
 * inside the "More" sheet. The bar holds 4 trip items + "More".
 *
 * Guests used to be in here, which put one of the pages people open most often
 * two taps away behind "More". Five slots is the ceiling — the bar splits the
 * width evenly, and a sixth makes the labels wrap on a small phone.
 */
const MOBILE_SECONDARY_TRIP_PATHS: readonly string[] = [
  'activities',
  'analytics',
];

/**
 * Primary mobile bottom nav items (max 5 for UX: 4 trip items + "More").
 * Calendar, Rooms, Guests and Transports are directly accessible.
 * Activities, Analytics, Trips, Settings are inside the "More" sheet.
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
  // One shared description for every trip-gated link in this nav. The sheet
  // needs its own copy: Radix marks the rest of the document `aria-hidden`
  // while it is open, and a description that lives in an aria-hidden subtree is
  // not reliably announced.
  const disabledHintId = useId();
  const sheetDisabledHintId = useId();
  // Every trip-gated item shares one reason, so one flag decides whether the
  // hint is worth putting in the accessibility tree at all.
  const hasDisabledItems = tripId === null;

  const sheetNavRef = useRef<HTMLElement>(null);
  /*
    Radix's focus scope skips natively `disabled` nodes but not `aria-disabled`
    ones, and this sheet has no close button to catch focus first. Swapping the
    attribute therefore moved the sheet's opening focus onto "Guests" — the
    first item in the list and, with no trip, disabled. Steer it to the first
    item that actually works; if none does, leave Radix to its default so the
    focus trap still has somewhere to put it.
  */
  const handleSheetOpenAutoFocus = useCallback((event: Event) => {
    const firstEnabled = sheetNavRef.current?.querySelector<HTMLElement>(
      'button:not([aria-disabled="true"])',
    );
    if (firstEnabled) {
      event.preventDefault();
      firstEnabled.focus();
    }
  }, []);

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
      {/*
        `pb-safe` rather than a taller bar: the background fills the home
        indicator's strip while the `h-16` row of links stays above it. Without
        it, `viewport-fit=cover` leaves the bottom of every icon under a bar the
        OS owns. See "The mobile bottom edge" in `src/index.css`.
      */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background pb-safe md:hidden"
        aria-label={t('nav.mobileMain', 'Mobile navigation')}
      >
        <ul className="flex h-16 items-center justify-around">
          {MOBILE_PRIMARY_NAV_ITEMS.map((item) => {
            const path = buildNavPath(item, tripId),
             isDisabled = item.requiresTrip && !tripId;

            return (
              <li key={item.pathSuffix} className="flex-1">
                {/*
                  Disabled, not removed: no `tabIndex={-1}` and no
                  `pointer-events-none`. A control taken out of the tab order is
                  a control a keyboard or screen-reader user never learns
                  exists, and the nav silently changes shape as trips come and
                  go. It stays focusable, announces itself as disabled through
                  `aria-disabled`, says why through `aria-describedby`, and is
                  stopped from navigating in the handler instead.
                */}
                <NavLink
                  to={path}
                  onClick={(e) => { if (isDisabled) e.preventDefault(); }}
                  className={({ isActive }) =>
                    cn(
                      'flex flex-col items-center justify-center gap-1 py-2 text-xs transition-colors',
                      'hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive && !isDisabled
                        ? 'text-primary font-medium'
                        : 'text-muted-foreground',
                      // No hover affordance on something that cannot be used.
                      isDisabled && 'cursor-not-allowed opacity-50 hover:text-muted-foreground',
                    )
                  }
                  aria-disabled={isDisabled || undefined}
                  /*
                    `buildNavPath` falls back to '/trips' for every trip-gated
                    item while no trip is chosen, and `NavLink` has no `end`, so
                    on the trips page react-router marked all three of them
                    current at once. Tabbing the bar then announced three
                    consecutive "current page" links on the one screen where
                    none of them works. 'false' is a real `aria-current` value
                    and the only way to override NavLink's own default.
                  */
                  aria-current={isDisabled ? 'false' : 'page'}
                  aria-describedby={isDisabled ? disabledHintId : undefined}
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        className={cn('h-5 w-5', isActive && !isDisabled && 'text-primary')}
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
        {/*
          Outside the <ul>, which may only contain <li>. Referenced by every
          trip-gated link above so the reason a link is unusable is announced
          rather than left to a dimmed colour nobody can hear.

          Conditional, because an sr-only span is still in the accessibility
          tree: rendered unconditionally, a screen-reader user swiping the
          bottom bar hears "choose a trip first" on every screen of the app,
          including the ones where nothing is gated at all.
        */}
        {hasDisabledItems ? (
          <span id={disabledHintId} className="sr-only">
            {t('nav.requiresTrip', 'Choose a trip first to open this section')}
          </span>
        ) : null}
      </nav>

      {/* "More" bottom sheet */}
      <Sheet open={isMoreOpen} onOpenChange={setIsMoreOpen}>
        {/*
          The sheet covers the nav bar rather than sitting in front of it, but
          the bar is still visible behind the scrim — so its last row keeps clear
          of both the bar and the home indicator. `pb-nav-safe` is that sum;
          `pb-20` used to claim it and was a flat 80px with no inset in it.

          `onOpenAutoFocus` is load-bearing: swapping the native `disabled`
          attribute for `aria-disabled` stopped Radix's FocusScope skipping
          those rows, so without this the sheet lands focus on a disabled item.
        */}
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="pb-nav-safe"
          onOpenAutoFocus={handleSheetOpenAutoFocus}
        >
          <SheetHeader>
            <SheetTitle>{t('nav.more', 'More')}</SheetTitle>
            <SheetDescription className="sr-only">
              {t('nav.main', 'Main navigation')}
            </SheetDescription>
          </SheetHeader>
          <nav ref={sheetNavRef} aria-label={t('nav.moreNavigation', 'More navigation')}>
            <ul className="space-y-1">
              {MOBILE_MORE_NAV_ITEMS.map((item) => {
                const path = buildNavPath(item, tripId);
                const isDisabled = item.requiresTrip && !tripId;
                const isActive = location.pathname === path || location.pathname.startsWith(path + '/');

                return (
                  <li key={`${item.requiresTrip ? 'trip' : 'global'}-${item.pathSuffix || 'trips'}`}>
                    {/*
                      `aria-disabled` rather than the `disabled` attribute, for
                      the same reason the bars above dropped `tabIndex={-1}`: a
                      natively disabled button leaves the tab order, so someone
                      driving this sheet from the keyboard never hears that
                      Rooms and Guests exist and are waiting on a trip.
                    */}
                    <button
                      type="button"
                      onClick={() => { if (!isDisabled) handleMoreItemClick(path); }}
                      aria-disabled={isDisabled || undefined}
                      aria-describedby={isDisabled ? sheetDisabledHintId : undefined}
                      className={cn(
                        'flex items-center gap-3 w-full rounded-lg px-3 py-3 text-sm min-h-[44px] transition-colors',
                        'hover:bg-accent hover:text-accent-foreground',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isActive && !isDisabled
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-foreground',
                        isDisabled &&
                          'opacity-50 cursor-not-allowed hover:bg-transparent hover:text-foreground',
                      )}
                    >
                      <item.icon className={cn('h-5 w-5 shrink-0', isActive && !isDisabled && 'text-primary')} aria-hidden="true" />
                      <span>{t(item.labelKey)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {hasDisabledItems ? (
              <span id={sheetDisabledHintId} className="sr-only">
                {t('nav.requiresTrip', 'Choose a trip first to open this section')}
              </span>
            ) : null}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
});

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
  const { assignments, isLoading: isAssignmentsLoading } = useAssignmentContext();

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

  // Same definition of presence as the calendar headcounts: a guest with a bed
  // and no stay dates is here tonight, and must not go missing from this list.
  const guestsTonight = useMemo(() => {
    if (!todayWithinTrip) {
      return [];
    }
    return listGuestsOnSiteOnDate({
      persons,
      arrivals,
      departures,
      assignments,
      tripWindow: { startDate: trip.startDate, endDate: trip.endDate },
      dateKey: todayKey,
    });
  }, [
    arrivals,
    assignments,
    departures,
    persons,
    todayKey,
    todayWithinTrip,
    trip.endDate,
    trip.startDate,
  ]);

  const isGuestsLoading = isPersonsLoading || isTransportsLoading || isAssignmentsLoading;

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
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
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
  const tooltipId = useId();
  const disabledHintId = useId();

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

  const isTooltipVisible = isCollapsed && collapsedTooltipOpen;

  /*
    Expanding the sidebar hides the tooltip, so the "open" flag has to go with
    it. `onMouseLeave` and `onBlur` are only wired up while collapsed, so
    nothing else clears it — and a stale `true` would make the tooltip pop up
    unprompted the next time the sidebar collapsed.
  */
  useEffect(() => {
    if (!isCollapsed) {
      return;
    }
    // Cleared in the cleanup rather than in the effect body: the cleanup runs
    // on exactly the transition that matters — collapsed going false — and a
    // synchronous setState in an effect body is a cascading render.
    return closeCollapsedTooltipNow;
  }, [isCollapsed, closeCollapsedTooltipNow]);

  /*
    Escape dismisses the tooltip, per the ARIA tooltip pattern. On `document`
    rather than the link so it works for the pointer case too, where the tooltip
    is open but focus is somewhere else entirely. Deliberately not stopping
    propagation: the tooltip is not modal, and swallowing Escape here would stop
    it reaching anything that legitimately wants it.
  */
  useEffect(() => {
    if (!isTooltipVisible) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeCollapsedTooltipNow();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isTooltipVisible, closeCollapsedTooltipNow]);

  /*
    Both descriptions are optional and either can be absent, so build the list
    rather than nesting ternaries. An empty string would be a dangling
    `aria-describedby` pointing at nothing, hence the `undefined`.
  */
  const describedBy =
    [isTooltipVisible ? tooltipId : null, isDisabled ? disabledHintId : null]
      .filter((id): id is string => id !== null)
      .join(' ') || undefined;

  return (
    <li className={cn(isCollapsed && 'flex justify-center')}>
      {/*
        Disabled, not removed from the page: no `tabIndex={-1}`, no
        `pointer-events-none`. See the mobile bar for the reasoning — a disabled
        control has to stay focusable to be discoverable, and `aria-disabled`
        plus a described reason is what tells the user why it will not move.
      */}
      <NavLink
        ref={linkRef}
        to={path}
        onClick={(e) => {
          if (isDisabled) e.preventDefault();
        }}
        aria-label={isCollapsed ? label : undefined}
        className={({ isActive }) =>
          cn(
            'flex items-center rounded-lg transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            isCollapsed
              ? 'size-9 shrink-0 justify-center'
              : 'min-h-9 gap-3 px-3 py-2',
            isActive && !isDisabled
              ? 'bg-primary/14 text-primary font-medium shadow-sm ring-1 ring-primary/20'
              : 'text-muted-foreground hover:bg-accent/80 hover:text-accent-foreground',
            isActive && !isDisabled && 'hover:bg-primary/20 hover:text-primary',
            isDisabled &&
              'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground',
          )
        }
        aria-disabled={isDisabled || undefined}
        // See the mobile bar: every trip-gated path collapses to '/trips'
        // without a trip, so react-router would mark them all current at once.
        aria-current={isDisabled ? 'false' : 'page'}
        aria-describedby={describedBy}
        onMouseEnter={isCollapsed ? openCollapsedTooltip : undefined}
        onMouseLeave={isCollapsed ? scheduleCloseCollapsedTooltip : undefined}
        onFocus={isCollapsed ? openCollapsedTooltip : undefined}
        onBlur={isCollapsed ? closeCollapsedTooltipNow : undefined}
      >
        <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        {!isCollapsed ? <span className="truncate">{label}</span> : null}
      </NavLink>
      {isDisabled ? (
        <span id={disabledHintId} className="sr-only">
          {t('nav.requiresTrip', 'Choose a trip first to open this section')}
        </span>
      ) : null}
      {isTooltipVisible
        ? createPortal(
            /*
              `id` + the link's `aria-describedby` is what makes this reachable:
              a bare `role="tooltip"` in a body portal is an orphan no screen
              reader ever visits, because nothing points at it.

              The `z-[100]` predates this component and is left alone. It does
              sit above the `z-50` dialog/sheet/toast layer, which the app has no
              documented scale for — the skip link uses the same number. Raising
              or renumbering is the wrong fix; a stacking context (`isolation:
              isolate`) is. Out of scope here, and harmless in practice: the
              sidebar is inert behind a modal, so this cannot open over one.

              Inline `style` for the position only — it is measured from the
              link's rect every time, so there is no utility class for it.
            */
            <div
              id={tooltipId}
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
        // `dvh`, not `vh`: `100vh` is the *largest* viewport height, so with
        // browser chrome showing the sidebar overflowed by exactly the chrome's
        // height and its bottom links scrolled out of reach.
        'fixed left-0 top-14 z-30 hidden h-[calc(100dvh-3.5rem)] flex-col border-r bg-background transition-all duration-300 md:flex',
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

      {/*
        Trip navigation, rendered whether or not a trip is selected.

        It used to be behind `{trip && …}`, which meant that on the app's
        landing state — no trip chosen — Calendar, Rooms, Guests, Transport,
        Activities and Analytics were absent from the DOM entirely. A sighted
        user sees the sidebar change shape and infers those sections appear once
        a trip exists; a screen-reader user just never learns they exist. The
        mobile bar had always shown them disabled, so the two navigations also
        disagreed about what the app contains.

        Now they render disabled, exactly as on mobile: focusable, announced as
        unavailable, and described with the reason.
      */}
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
    // `min-h-svh`, not `min-h-screen` (`100vh`): on a phone `100vh` is the tall
    // viewport, the one you only get once the browser chrome has retracted, so
    // the shell was always a chrome's-height taller than the window. `svh` is
    // the small viewport and never overflows; the sharing pages already use it.
    <div className="min-h-svh bg-background">
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
          // `pb-bottom-stack` is the one place the bottom-edge arithmetic
          // lives. `pb-20` here cleared the `h-16` nav bar and nothing else, so
          // the last row of every list sat inside the FAB's 80-136px band and
          // four pages had each pasted their own compensation on top of it.
          'pb-bottom-stack pt-4 transition-all duration-300',
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
