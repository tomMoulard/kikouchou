/**
 * @fileoverview Summary feature public exports.
 *
 * @module features/summary
 */

// ============================================================================
// Pages
// ============================================================================

export {
  TripSummaryPage,
  default as TripSummaryPageDefault,
} from './pages/TripSummaryPage';

// ============================================================================
// Components
// ============================================================================

export { SummarySheet } from './components/SummarySheet';
export type { SummarySheetProps } from './components/SummarySheet';

export { TripGlancePanel } from './components/TripGlancePanel';
export type { TripGlancePanelProps } from './components/TripGlancePanel';

// ============================================================================
// Library
// ============================================================================

export { loadTripSummary } from './lib/trip-summary';
export type {
  SummaryGuest,
  SummaryRoom,
  SummaryStay,
  SummaryTravel,
  TripSummary,
} from './lib/trip-summary';

export { buildTripGlance } from './lib/trip-glance';
export type {
  GlanceArrival,
  GlanceGuestWithoutRoom,
  GlanceNight,
  GlanceRoom,
  TripGlance,
  TripGlanceInput,
} from './lib/trip-glance';

// ============================================================================
// Routes
// ============================================================================

export { summaryRoutes } from './routes';
export type { SummaryParams } from './routes';
