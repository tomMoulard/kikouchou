/**
 * @fileoverview Analytics feature public exports.
 *
 * @module features/analytics
 */

export { AnalyticsScopeSelector } from './components/AnalyticsScopeSelector';
export type { AnalyticsScopeSelectorProps } from './components/AnalyticsScopeSelector';

export { StatCard } from './components/StatCard';
export type { StatCardProps } from './components/StatCard';

export { useAnalyticsClock } from './hooks/useAnalyticsClock';
export type { AnalyticsClock } from './hooks/useAnalyticsClock';

export {
  isTripStatsEmpty,
  loadTripStats,
  readAnalytics,
  sumTripStats,
} from './lib/trip-stats';
export type {
  AnalyticsResult,
  TripStats,
  TripStatsTotals,
} from './lib/trip-stats';

export { analyticsRoutes } from './routes';
export type { AnalyticsParams } from './routes';
