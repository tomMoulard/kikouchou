/**
 * @fileoverview Public API for the Activities feature module.
 *
 * @module features/activities
 *
 * @example
 * ```tsx
 * import {
 *   ActivityListPage,
 *   ActivityDialog,
 *   ActivityAgenda,
 *   activityRoutes,
 * } from '@/features/activities';
 * ```
 */

// ============================================================================
// Pages
// ============================================================================

export { ActivityListPage } from './pages/ActivityListPage';

// ============================================================================
// Components
// ============================================================================

export { ActivityForm } from './components/ActivityForm';
export type { ActivityFormProps } from './components/ActivityForm';

export { ActivityDialog } from './components/ActivityDialog';
export type { ActivityDialogProps } from './components/ActivityDialog';

export { ActivityCard } from './components/ActivityCard';
export type { ActivityCardProps } from './components/ActivityCard';

export { ActivityAgenda } from './components/ActivityAgenda';
export type { ActivityAgendaProps } from './components/ActivityAgenda';

// ============================================================================
// Utilities
// ============================================================================

export {
  formatActivityDayRange,
  formatActivityTimeRange,
  getActivityEndDayKey,
  getActivityEndInstant,
  getActivityStartDayKey,
  groupActivitiesByDate,
  isActivityPast,
  type ActivityDateGroup,
} from './utils/activity-utils';

export {
  buildActivityAgenda,
  MAX_AGENDA_SPAN_DAYS,
  type ActivityAgendaDay,
  type ActivityAgendaEntry,
} from './utils/activity-agenda-utils';

// ============================================================================
// Routes
// ============================================================================

export { activityRoutes, type ActivityListParams } from './routes';
