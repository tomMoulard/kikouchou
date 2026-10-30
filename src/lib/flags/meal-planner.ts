/**
 * @fileoverview The `meal-planner` PostHog flag.
 *
 * The flag decides what this device *shows*: the meal planner page, its link
 * in the navigation, the diet fields on a guest, and the meal actions of the
 * assistant. It never decides what is *kept* or *synced*. Meals, shopping lines
 * and diets are stored and published on every device, flag on or off, for the
 * reason `YjsTripSync` gives: a device that held a collection back would let
 * the projection read its absence as a deletion, and delete the group's
 * meals for everybody.
 *
 * Off and undecided read the same way, so the planner never appears and then
 * vanishes under somebody's thumb while PostHog answers.
 *
 * @module lib/flags/meal-planner
 */

// ============================================================================
// Constants
// ============================================================================

/** The flag's key in PostHog. */
export const MEAL_PLANNER_FLAG = 'meal-planner';
