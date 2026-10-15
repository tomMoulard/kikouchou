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
 *   ActivityTimeline,
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

export { ActivityTimeline } from './components/ActivityTimeline';
export type { ActivityTimelineProps } from './components/ActivityTimeline';

export { ActivityTimelineRow } from './components/ActivityTimelineRow';
export type { ActivityTimelineRowProps } from './components/ActivityTimelineRow';

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
  buildActivityTimelineModel,
  type ActivityTimelineItem,
  type ActivityTimelineItemWithLane,
  type ActivityTimelineModel,
  type ActivityTimelineRowModel,
} from './utils/activity-timeline-utils';

// ============================================================================
// Routes
// ============================================================================

export { activityRoutes, type ActivityListParams } from './routes';
