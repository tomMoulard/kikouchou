/**
 * @fileoverview Whether this device shows the meal planner.
 *
 * @module hooks/useMealPlannerEnabled
 */

import { useFeatureFlag } from '@/hooks/useFeatureFlag';

import { MEAL_PLANNER_FLAG } from '@/lib/flags';

/**
 * The `meal-planner` flag, with "still asking" read as off.
 *
 * Every surface of the planner hides on `false`, so a pending answer must not
 * show it: a navigation item that appears and then disappears is worse than
 * one that appears a moment late. The route alone waits on the pending
 * answer, through {@link useFeatureFlag}, so a direct link is not bounced
 * while PostHog is still loading.
 *
 * @returns `true` only once the flag is known to be on
 */
export function useMealPlannerEnabled(): boolean {
  return useFeatureFlag(MEAL_PLANNER_FLAG) === true;
}
