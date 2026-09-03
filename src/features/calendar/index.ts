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

// ============================================================================
// Types
// ============================================================================

export type {
  CalendarEvent,
  CalendarTransport,
  CalendarHeaderProps,
  CalendarDayHeaderProps,
  CalendarDayProps,
  CalendarEventProps,
  TransportIndicatorProps,
  SegmentPosition,
  CalendarView,
  CalendarTimelineProps,
  CalendarTimelineModel,
  CalendarTimelineRowModel,
  TimelineItem,
} from './types';

// ============================================================================
// Components
// ============================================================================

export {
  CalendarHeader,
  CalendarDayHeader,
  CalendarDay,
  CalendarEventPill,
  TransportIndicator,
  CalendarTimeline,
  CalendarTimelineRow,
} from './components';

// ============================================================================
// Utilities
// ============================================================================

export {
  getLuminance,
  getContrastTextColor,
  getSegmentBorderRadiusClasses,
  formatTime,
  EMPTY_EVENTS,
  EMPTY_TRANSPORTS,
  MAX_VISIBLE_EVENT_SLOTS,
} from './utils/calendar-utils';

// ============================================================================
// Routes
// ============================================================================

export { calendarRoutes } from './routes';
export type { CalendarParams } from './routes';
