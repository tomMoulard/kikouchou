/**
 * @fileoverview Calendar feature public exports.
 * Re-exports all public components, hooks, and types from the calendar feature.
 *
 * @module features/calendar
 */

// ============================================================================
// Pages
// ============================================================================

export { CalendarPage, default as CalendarPageDefault } from './pages/CalendarPage';
export type {
  CalendarEvent,
  CalendarHeaderProps,
  CalendarDayHeaderProps,
  CalendarDayProps,
  CalendarEventProps,
} from './pages/CalendarPage';

// ============================================================================
// Routes
// ============================================================================

export { calendarRoutes } from './routes';
export type { CalendarParams } from './routes';
