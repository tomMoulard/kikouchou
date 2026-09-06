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

export { TransportScopeFilter } from './components/TransportScopeFilter';
export type { TransportScopeFilterProps } from './components/TransportScopeFilter';

// ============================================================================
// Hooks
// ============================================================================

export { useTransportScope } from './hooks/useTransportScope';
export type { UseTransportScopeResult } from './hooks/useTransportScope';

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

// "Does this concern me?" — the one definition both transport views filter by.
export {
  parseTransportScope,
  selectTransportsConcerning,
  TRANSPORT_SCOPE_PARAM,
  type TransportScope,
} from './utils/transport-scope';

// ============================================================================
// Routes
// ============================================================================

export { transportRoutes } from './routes';
