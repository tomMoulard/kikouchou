/**
 * @fileoverview Meal Context: the meal planner of the current trip, its
 * lunches and dinners and its shopping list.
 *
 * Meals and shopping lines share one provider because they share one page, and
 * two providers would mean two re-render cascades for one screen. They are two
 * tables rather than one, so two guests ticking items off in the supermarket
 * never overwrite each other (see `ShoppingItem`).
 *
 * @module contexts/MealContext
 */

import {
  type ReactElement,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { useTripContext } from '@/contexts/TripContext';
import { areArraysEqual, wrapAndSetError } from '@/contexts/utils';
import {
  createMeal as repositoryCreateMeal,
  createShoppingItem as repositoryCreateShoppingItem,
  deleteCheckedShoppingItems,
  deleteMealWithOwnershipCheck,
  deleteShoppingItemWithOwnershipCheck,
  getMealsByTripId,
  getShoppingItemsByTripId,
  updateMealWithOwnershipCheck,
  updateShoppingItemWithOwnershipCheck,
} from '@/lib/db';
import type {
  Meal,
  MealFormData,
  MealId,
  ShoppingItem,
  ShoppingItemFormData,
  ShoppingItemId,
  TripId,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** Public interface for the Meal Context value. */
export interface MealContextValue {
  /** Meals of the current trip, by day then lunch before dinner. */
  readonly meals: readonly Meal[];

  /** Shopping lines of the current trip, in the order they were added. */
  readonly shoppingItems: readonly ShoppingItem[];

  /** True while either live query has yet to resolve for a selected trip. */
  readonly isLoading: boolean;

  /** The last CRUD error, or null. */
  readonly error: Error | null;

  createMeal: (data: MealFormData) => Promise<Meal>;
  updateMeal: (id: MealId, data: Partial<MealFormData>) => Promise<void>;
  deleteMeal: (id: MealId) => Promise<void>;

  createShoppingItem: (data: ShoppingItemFormData) => Promise<ShoppingItem>;
  updateShoppingItem: (
    id: ShoppingItemId,
    data: Partial<ShoppingItemFormData>,
  ) => Promise<void>;
  deleteShoppingItem: (id: ShoppingItemId) => Promise<void>;

  /** Deletes every checked line, and answers how many went. */
  clearCheckedShoppingItems: () => Promise<number>;
}

interface MealProviderProps {
  /** Child components to render within the provider */
  readonly children: ReactNode;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Compares every mutable field of a meal.
 *
 * A field missing here never reaches the UI: the provider only publishes a new
 * array when this returns false. The list is complete and must stay so.
 */
const compareMeals = (a: Meal, b: Meal): boolean =>
  a.id === b.id &&
  a.tripId === b.tripId &&
  a.date === b.date &&
  a.slot === b.slot &&
  a.kind === b.kind &&
  a.menu === b.menu &&
  a.headcountAdjustment === b.headcountAdjustment &&
  areIdListsEqual(a.organizerIds, b.organizerIds);

/** Compares every mutable field of a shopping line. See {@link compareMeals}. */
const compareShoppingItems = (a: ShoppingItem, b: ShoppingItem): boolean =>
  a.id === b.id &&
  a.tripId === b.tripId &&
  a.name === b.name &&
  a.quantity === b.quantity &&
  a.buyerId === b.buyerId &&
  a.checked === b.checked &&
  a.createdAt === b.createdAt;

/**
 * Order-sensitive comparison of two id lists. The organisers are listed in the
 * order they were picked, so a reordering is a visible change.
 */
function areIdListsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) {
    return true;
  }
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

const areMealsEqual = (a: Meal[], b: Meal[]): boolean =>
  areArraysEqual(a, b, compareMeals);

const areShoppingItemsEqual = (a: ShoppingItem[], b: ShoppingItem[]): boolean =>
  areArraysEqual(a, b, compareShoppingItems);

/** Day first, then lunch before dinner, ties on id so every device agrees. */
function compareMealOrder(left: Meal, right: Meal): number {
  return (
    left.date.localeCompare(right.date) ||
    left.slot.localeCompare(right.slot) ||
    left.id.localeCompare(right.id)
  );
}

// ============================================================================
// Context Creation
// ============================================================================

const MealContext = createContext<MealContextValue | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

/**
 * Provides the current trip's meals and shopping list.
 *
 * Must be nested inside `TripProvider`.
 *
 * @param props - Provider props including children
 * @returns The provider element
 */
export function MealProvider({ children }: MealProviderProps): ReactElement {
  const { currentTrip } = useTripContext(),
    currentTripId = currentTrip?.id,
    [error, setError] = useState<Error | null>(null),
    mealsQuery = useLiveQuery(async () => {
      if (!currentTripId) {
        return [];
      }

      try {
        const rows = await getMealsByTripId(currentTripId);
        return rows.sort(compareMealOrder);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to load meals'));
        return [];
      }
    }, [currentTripId]),
    shoppingQuery = useLiveQuery(async () => {
      if (!currentTripId) {
        return [];
      }

      try {
        return await getShoppingItemsByTripId(currentTripId);
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error('Failed to load the shopping list'),
        );
        return [];
      }
    }, [currentTripId]),
    isLoading =
      currentTripId !== undefined &&
      (mealsQuery === undefined || shoppingQuery === undefined),
    rawMeals = useMemo(() => mealsQuery ?? [], [mealsQuery]),
    rawShoppingItems = useMemo(() => shoppingQuery ?? [], [shoppingQuery]),
    [meals, setMeals] = useState<Meal[]>([]),
    [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);

  // Publish a new array only when something a view renders actually changed.
  useEffect(() => {
    setMeals((previous) => (areMealsEqual(previous, rawMeals) ? previous : rawMeals));
  }, [rawMeals]);

  useEffect(() => {
    setShoppingItems((previous) =>
      areShoppingItemsEqual(previous, rawShoppingItems) ? previous : rawShoppingItems,
    );
  }, [rawShoppingItems]);

  const requireTrip = useCallback((): TripId => {
      if (!currentTripId) {
        throw new Error('No trip selected');
      }
      return currentTripId;
    }, [currentTripId]),
    createMeal = useCallback(
      async (data: MealFormData): Promise<Meal> => {
        try {
          const meal = await repositoryCreateMeal(requireTrip(), data);
          setError(null);
          return meal;
        } catch (err) {
          wrapAndSetError(err, 'Failed to create meal', setError);
          throw err;
        }
      },
      [requireTrip],
    ),
    updateMeal = useCallback(
      async (id: MealId, data: Partial<MealFormData>): Promise<void> => {
        try {
          await updateMealWithOwnershipCheck(id, requireTrip(), data);
          setError(null);
        } catch (err) {
          wrapAndSetError(err, 'Failed to update meal', setError);
          throw err;
        }
      },
      [requireTrip],
    ),
    deleteMeal = useCallback(
      async (id: MealId): Promise<void> => {
        try {
          await deleteMealWithOwnershipCheck(id, requireTrip());
          setError(null);
        } catch (err) {
          wrapAndSetError(err, 'Failed to delete meal', setError);
          throw err;
        }
      },
      [requireTrip],
    ),
    createShoppingItem = useCallback(
      async (data: ShoppingItemFormData): Promise<ShoppingItem> => {
        try {
          const item = await repositoryCreateShoppingItem(requireTrip(), data);
          setError(null);
          return item;
        } catch (err) {
          wrapAndSetError(err, 'Failed to add shopping item', setError);
          throw err;
        }
      },
      [requireTrip],
    ),
    updateShoppingItem = useCallback(
      async (id: ShoppingItemId, data: Partial<ShoppingItemFormData>): Promise<void> => {
        try {
          await updateShoppingItemWithOwnershipCheck(id, requireTrip(), data);
          setError(null);
        } catch (err) {
          wrapAndSetError(err, 'Failed to update shopping item', setError);
          throw err;
        }
      },
      [requireTrip],
    ),
    deleteShoppingItem = useCallback(
      async (id: ShoppingItemId): Promise<void> => {
        try {
          await deleteShoppingItemWithOwnershipCheck(id, requireTrip());
          setError(null);
        } catch (err) {
          wrapAndSetError(err, 'Failed to delete shopping item', setError);
          throw err;
        }
      },
      [requireTrip],
    ),
    clearCheckedShoppingItems = useCallback(async (): Promise<number> => {
      try {
        const count = await deleteCheckedShoppingItems(requireTrip());
        setError(null);
        return count;
      } catch (err) {
        wrapAndSetError(err, 'Failed to clear the shopping list', setError);
        throw err;
      }
    }, [requireTrip]),
    contextValue = useMemo<MealContextValue>(
      () => ({
        meals,
        shoppingItems,
        isLoading,
        error,
        createMeal,
        updateMeal,
        deleteMeal,
        createShoppingItem,
        updateShoppingItem,
        deleteShoppingItem,
        clearCheckedShoppingItems,
      }),
      [
        meals,
        shoppingItems,
        isLoading,
        error,
        createMeal,
        updateMeal,
        deleteMeal,
        createShoppingItem,
        updateShoppingItem,
        deleteShoppingItem,
        clearCheckedShoppingItems,
      ],
    );

  return <MealContext.Provider value={contextValue}>{children}</MealContext.Provider>;
}

// ============================================================================
// Custom Hook
// ============================================================================

/**
 * Hook to access the Meal Context.
 *
 * Must be used within both `TripProvider` and `MealProvider`.
 *
 * @returns The meal context value
 * @throws {Error} When used outside `MealProvider`
 */
export function useMealContext(): MealContextValue {
  const context = useContext(MealContext);

  if (context === undefined) {
    throw new Error('useMealContext must be used within a MealProvider');
  }

  return context;
}

// ============================================================================
// Exports
// ============================================================================

export { MealContext };
export type { MealProviderProps };
