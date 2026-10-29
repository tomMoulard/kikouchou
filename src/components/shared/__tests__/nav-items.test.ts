/**
 * @fileoverview Tests for the trip nav items and the stored order they follow.
 *
 * @module components/shared/__tests__/nav-items.test
 */

import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_MOBILE_NAV_MODE,
  TRIP_NAV_ITEMS,
  hiddenNavPages,
  resolveMobileNavMode,
  resolveMobileNavOrder,
  tripNavItemsInOrder,
} from '../nav-items';
import { MOBILE_NAV_PAGES } from '@/types';

describe('nav items load-time tables', () => {
  // A fresh copy of the module, so its tables are built while this test runs:
  // Stryker can only test a mutant in load-time code against the test that was
  // running when the module loaded.
  it('lists every trip page with its key, path, icons and trip scope, and defaults the mobile mode to auto', async () => {
    vi.resetModules();
    const fresh = await import('../nav-items');
    const icons = await import('../nav-icons');
    const lucide = await import('lucide-react');

    expect(fresh.DEFAULT_MOBILE_NAV_MODE).toBe('auto');
    expect(fresh.TRIP_NAV_ITEMS).toEqual([
      { labelKey: 'nav.calendar', pathSuffix: 'calendar', icon: lucide.Calendar, activeIcon: icons.CalendarSolid, requiresTrip: true },
      { labelKey: 'nav.rooms', pathSuffix: 'rooms', icon: lucide.Home, activeIcon: icons.HouseSolid, requiresTrip: true },
      { labelKey: 'nav.persons', pathSuffix: 'persons', icon: lucide.Users, activeIcon: icons.UsersSolid, requiresTrip: true },
      { labelKey: 'nav.money', pathSuffix: 'money', icon: lucide.Wallet, activeIcon: icons.WalletSolid, requiresTrip: true },
      { labelKey: 'nav.activities', pathSuffix: 'activities', icon: lucide.PartyPopper, requiresTrip: true },
      { labelKey: 'nav.meals', pathSuffix: 'meals', icon: lucide.UtensilsCrossed, requiresTrip: true },
      { labelKey: 'nav.transports', pathSuffix: 'transports', icon: lucide.Car, requiresTrip: true },
      { labelKey: 'nav.tripAnalytics', pathSuffix: 'analytics', icon: lucide.BarChart2, requiresTrip: true },
      { labelKey: 'nav.tripSettings', pathSuffix: 'edit', icon: lucide.Settings2, requiresTrip: true },
    ]);
  });
});

describe('TRIP_NAV_ITEMS', () => {
  it('lists every page the bar can hold, in the default order', () => {
    expect(TRIP_NAV_ITEMS.map((item) => item.pathSuffix)).toEqual([...MOBILE_NAV_PAGES]);
  });
});

describe('resolveMobileNavOrder', () => {
  it('returns the default order when nothing is stored', () => {
    expect(resolveMobileNavOrder(undefined)).toEqual([...MOBILE_NAV_PAGES]);
  });

  it('keeps a complete stored order as it is', () => {
    const stored = ['money', 'transports', 'calendar', 'rooms', 'persons', 'activities', 'meals', 'analytics', 'edit'];
    expect(resolveMobileNavOrder(stored)).toEqual(stored);
  });

  it('drops pages it does not know and values that are not pages', () => {
    expect(resolveMobileNavOrder(['vehicles', 42, null, 'money'])[0]).toBe('money');
    expect(resolveMobileNavOrder(['vehicles', 42, null, 'money'])).not.toContain('vehicles');
  });

  it('keeps the first place of a repeated page', () => {
    const order = resolveMobileNavOrder(['money', 'calendar', 'money']);
    expect(order.slice(0, 2)).toEqual(['money', 'calendar']);
    expect(order.filter((page) => page === 'money')).toHaveLength(1);
  });

  it('appends a page missing from an older order in its default position', () => {
    expect(resolveMobileNavOrder(['transports', 'money'])).toEqual([
      'transports',
      'money',
      'calendar',
      'rooms',
      'persons',
      'activities',
      'meals',
      'analytics',
      'edit',
    ]);
  });
});

describe('hiddenNavPages', () => {
  it('hides the meal planner while its flag is off, and nothing once it is on', () => {
    expect([...hiddenNavPages({ mealPlanner: false })]).toEqual(['meals']);
    expect(hiddenNavPages({ mealPlanner: true }).size).toBe(0);
  });
});

describe('resolveMobileNavMode', () => {
  it.each(['auto', 'bar', 'menu'] as const)('keeps %s', (mode) => {
    expect(resolveMobileNavMode(mode)).toBe(mode);
  });

  it.each([undefined, 'sidebar', 3])('falls back to the default for %s', (stored) => {
    expect(resolveMobileNavMode(stored)).toBe(DEFAULT_MOBILE_NAV_MODE);
  });
});

describe('tripNavItemsInOrder', () => {
  it('returns the items in the order of the pages', () => {
    expect(tripNavItemsInOrder(['edit', 'calendar']).map((item) => item.labelKey)).toEqual([
      'nav.tripSettings',
      'nav.calendar',
    ]);
  });
});
