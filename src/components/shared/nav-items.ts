/**
 * @fileoverview The trip pages the navigation links to, and the order a phone
 * shows them in.
 *
 * Out of `Layout` because two screens draw the same list: the navigation
 * itself, and the settings card where a user picks which four pages go in the
 * bottom bar. One definition keeps the label and the icon the user drags in
 * settings identical to the ones they then tap.
 *
 * @module components/shared/nav-items
 */

import {
  BarChart2,
  Calendar,
  Car,
  Home,
  type LucideIcon,
  PartyPopper,
  Settings2,
  Users,
  Wallet,
} from 'lucide-react';

import {
  CalendarSolid,
  HouseSolid,
  type SolidIconProps,
  UsersSolid,
  WalletSolid,
} from '@/components/shared/nav-icons';
import {
  MOBILE_NAV_PAGES,
  type MobileNavMode,
  type MobileNavPage,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * A filled glyph drawn in place of an outline one. Structurally what a
 * `LucideIcon` is used as here, minus the stroke props a fill ignores.
 */
export type SolidIcon = (props: SolidIconProps) => React.ReactElement;

/**
 * Navigation item configuration.
 */
export interface NavItem {
  /** Translation key for the label */
  readonly labelKey: string;
  /** Route path suffix (will be prefixed with tripId for trip-scoped routes) */
  readonly pathSuffix: string;
  /** Lucide icon component */
  readonly icon: LucideIcon;
  /**
   * Solid twin of {@link NavItem.icon}, drawn instead of it in the mobile tab
   * bar while this item is the current page.
   *
   * Only the default primary tabs carry one — see `components/shared/nav-icons`
   * for why the set is closed. An item without one keeps its outline and is
   * marked current by colour alone, as everything did before.
   */
  readonly activeIcon?: SolidIcon;
  /** Whether this route requires a trip (trip-scoped) */
  readonly requiresTrip: boolean;
}

/**
 * A trip page: a {@link NavItem} whose path is one the bottom bar can hold.
 */
export interface TripNavItem extends NavItem {
  readonly pathSuffix: MobileNavPage;
  readonly requiresTrip: true;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Navigation items that require a trip to be selected, in the default order.
 */
export const TRIP_NAV_ITEMS: readonly TripNavItem[] = [
  {
    labelKey: 'nav.calendar',
    pathSuffix: 'calendar',
    icon: Calendar,
    activeIcon: CalendarSolid,
    requiresTrip: true,
  },
  {
    labelKey: 'nav.rooms',
    pathSuffix: 'rooms',
    icon: Home,
    activeIcon: HouseSolid,
    requiresTrip: true,
  },
  {
    labelKey: 'nav.persons',
    pathSuffix: 'persons',
    icon: Users,
    activeIcon: UsersSolid,
    requiresTrip: true,
  },
  {
    labelKey: 'nav.money',
    pathSuffix: 'money',
    icon: Wallet,
    activeIcon: WalletSolid,
    requiresTrip: true,
  },
  // The trip's cars are deliberately absent: they hang off the transport list
  // (`/transports/vehicles`), because a car is only ever entered in order to be
  // picked on a ride and nobody navigates to one for its own sake.
  { labelKey: 'nav.activities', pathSuffix: 'activities', icon: PartyPopper, requiresTrip: true },
  { labelKey: 'nav.transports', pathSuffix: 'transports', icon: Car, requiresTrip: true },
  { labelKey: 'nav.tripAnalytics', pathSuffix: 'analytics', icon: BarChart2, requiresTrip: true },
  // The trip's own settings — its name, its dates, who you are on it, and
  // deleting it. `nav.settings` is the app's: the language, the theme, the
  // account. Two entries because they are two different things, and the trip's
  // used to be reachable only through the app's.
  { labelKey: 'nav.tripSettings', pathSuffix: 'edit', icon: Settings2, requiresTrip: true },
] as const;

/** The mode a device that never chose one gets. */
export const DEFAULT_MOBILE_NAV_MODE: MobileNavMode = 'auto';

// ============================================================================
// Functions
// ============================================================================

/**
 * Turns a stored order into a complete one.
 *
 * The stored value is whatever an earlier release wrote, so it is read as
 * untrusted: unknown pages are dropped, a repeated page keeps its first place,
 * and a page missing from it is appended in its default position. A release
 * that adds a page therefore shows it in "More" rather than nowhere.
 *
 * @param stored - The order from the settings row, if any
 * @returns Every trip page exactly once
 */
export function resolveMobileNavOrder(
  stored: readonly unknown[] | undefined,
): readonly MobileNavPage[] {
  const known = new Set<string>(MOBILE_NAV_PAGES),
    seen = new Set<MobileNavPage>();

  for (const page of stored ?? []) {
    if (typeof page === 'string' && known.has(page)) {
      seen.add(page as MobileNavPage);
    }
  }
  for (const page of MOBILE_NAV_PAGES) {
    seen.add(page);
  }
  return [...seen];
}

/**
 * Reads a stored mode, falling back to {@link DEFAULT_MOBILE_NAV_MODE}.
 *
 * @param stored - The mode from the settings row, if any
 * @returns A valid mode
 */
export function resolveMobileNavMode(stored: unknown): MobileNavMode {
  return stored === 'bar' || stored === 'menu' || stored === 'auto'
    ? stored
    : DEFAULT_MOBILE_NAV_MODE;
}

/**
 * The trip nav items, in the given page order.
 *
 * @param order - A complete order, from {@link resolveMobileNavOrder}
 * @returns The matching items
 */
export function tripNavItemsInOrder(order: readonly MobileNavPage[]): readonly TripNavItem[] {
  return order.flatMap((page) => TRIP_NAV_ITEMS.filter((item) => item.pathSuffix === page));
}
