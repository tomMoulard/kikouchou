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
export { TransportRunSheetPage } from './pages/TransportRunSheetPage';

// ============================================================================
// Components
// ============================================================================

export { TransportForm } from './components/TransportForm';
export type { TransportFormProps } from './components/TransportForm';

export { TransportDialog } from './components/TransportDialog';
export type { TransportDialogProps } from './components/TransportDialog';

export { UpcomingPickups } from './components/UpcomingPickups';
export type { UpcomingPickupsProps } from './components/UpcomingPickups';

export { MyRides } from './components/MyRides';
export type { MyRidesProps } from './components/MyRides';

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

// "Which of these legs are mine?", asked by the run sheet's filter, the
// "Your rides" panel and the highlight on a transport card.
export {
  isDrivenBy,
  isMyTransport,
  isTravelledBy,
  selectMyTransports,
} from './utils/my-transports';
export type { MyTransports } from './utils/my-transports';

// The dated sections the transport list and the run sheet both render.
export {
  countGroupedTransports,
  getTransportDateKey,
  groupTransportsByDate,
} from './utils/transport-grouping';
export type { TransportDateGroup } from './utils/transport-grouping';

// ============================================================================
// Routes
// ============================================================================

export { transportRoutes } from './routes';
