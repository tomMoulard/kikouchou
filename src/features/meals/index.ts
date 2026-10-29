/**
 * @fileoverview Meal planner feature public exports.
 *
 * @module features/meals
 */

// ============================================================================
// Pages
// ============================================================================

export {
  MealPlannerPage,
  default as MealPlannerPageDefault,
} from './pages/MealPlannerPage';

// ============================================================================
// Components
// ============================================================================

export { MealDialog } from './components/MealDialog';
export type { MealDialogProps } from './components/MealDialog';
export { MealDietSummary } from './components/MealDietSummary';
export type { MealDietSummaryProps } from './components/MealDietSummary';
export { ShoppingList } from './components/ShoppingList';
export type { ShoppingListProps } from './components/ShoppingList';

// ============================================================================
// Library
// ============================================================================

export { buildMealAttendance } from './utils/meal-headcount';
export type {
  MealAttendance,
  MealDietaryNote,
  MealPresenceSource,
} from './utils/meal-headcount';

// ============================================================================
// Routes
// ============================================================================

export { mealRoutes } from './routes';
export type { MealParams } from './routes';
