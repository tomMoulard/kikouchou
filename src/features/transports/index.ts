/**
 * @fileoverview Public API for the Transports feature module.
 * Re-exports pages, components, routes, and types for external consumption.
 *
 * @module features/transports
 *
 * @example
 * ```tsx
 * import {
 *   TransportListPage,
 *   TransportForm,
 *   TransportDialog,
 *   transportRoutes,
 * } from '@/features/transports';
 * ```
 */

// ============================================================================
// Pages
// ============================================================================

export { TransportListPage } from './pages/TransportListPage';

// ============================================================================
// Components
// ============================================================================

export { TransportForm } from './components/TransportForm';
export type { TransportFormProps } from './components/TransportForm';

export { TransportDialog } from './components/TransportDialog';
export type { TransportDialogProps } from './components/TransportDialog';

export { UpcomingPickups } from './components/UpcomingPickups';
export type { UpcomingPickupsProps } from './components/UpcomingPickups';

export { RideCard } from './components/RideCard';
export type { RideCardProps } from './components/RideCard';

export { RideCapacityBadge } from './components/RideCapacityBadge';
export type { RideCapacityBadgeProps } from './components/RideCapacityBadge';

export { RideMismatchNotice } from './components/RideMismatchNotice';
export type { RideMismatchNoticeProps } from './components/RideMismatchNotice';

// ============================================================================
// Utilities
// ============================================================================

// Timing and selection only. `groupPickupsByProximity` stays internal to the
// pickup alert panel: it groups an already-selected list and would silently
// render assigned or past rides as "needs a driver" if handed a raw one.
export {
  isTransportUpcoming,
  selectPickupsNeedingDriver,
  sortTransportsByInstant,
  toTransportInstant,
} from './utils/pickup-utils';

// One summary and one predicate, so a badge, a card and a form cannot disagree
// about whether a car is overloaded. `hasCapacityWarning` is the only question
// worth colouring: being exactly full is a correctly loaded car.
export {
  hasCapacityWarning,
  summariseRideCapacity,
} from './utils/ride-capacity';
export type {
  ChildSeatShortfall,
  ChildSeatTally,
  RideCapacitySummary,
} from './utils/ride-capacity';

// ============================================================================
// Routes
// ============================================================================

export { transportRoutes } from './routes';
