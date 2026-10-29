/**
 * Shopping Item Repository
 *
 * Provides CRUD operations for ShoppingItem entities: the lines of a trip's
 * shared shopping list. All operations use the Dexie.js database and branded
 * types for type safety.
 *
 * @module lib/db/repositories/shopping-item-repository
 */

import { db } from '@/lib/db/database';
import { sanitizeShoppingItemData } from '@/lib/db/sanitize';
import { createShoppingItemId } from '@/lib/db/utils';
import type {
  ShoppingItem,
  ShoppingItemFormData,
  ShoppingItemId,
  TripId,
} from '@/types';
import { MAX_SHOPPING_ITEMS } from '@/types';
import { repositoryError } from '@/lib/db/repository-error';

// ============================================================================
// Create
// ============================================================================

/**
 * Adds a line to a trip's shopping list.
 *
 * @param tripId - The trip this line belongs to
 * @param data - The shopping item form data
 * @returns The created ShoppingItem object
 * @throws {Error} When the list already holds {@link MAX_SHOPPING_ITEMS} lines
 *
 * @example
 * ```typescript
 * const item = await createShoppingItem(tripId, { name: 'Baguettes', quantity: '4', checked: false });
 * ```
 */
export async function createShoppingItem(
  tripId: TripId,
  data: ShoppingItemFormData,
): Promise<ShoppingItem> {
  const sanitizedData = sanitizeShoppingItemData(data);

  try {
    const count = await db.shoppingItems.where('tripId').equals(tripId).count();
    if (count >= MAX_SHOPPING_ITEMS) {
      throw new Error(`The shopping list already holds ${MAX_SHOPPING_ITEMS} lines`);
    }

    const item: ShoppingItem = {
      id: createShoppingItemId(),
      tripId,
      name: sanitizedData.name,
      checked: sanitizedData.checked,
      createdAt: Date.now(),
      ...(sanitizedData.quantity !== undefined && { quantity: sanitizedData.quantity }),
      ...(sanitizedData.buyerId !== undefined && { buyerId: sanitizedData.buyerId }),
    };

    await db.shoppingItems.add(item);
    return item;
  } catch (error) {
    throw repositoryError(
      `Failed to add "${sanitizedData.name}" to the shopping list of trip ${tripId}`,
      error,
    );
  }
}

// ============================================================================
// Read
// ============================================================================

/**
 * Retrieves every line of a trip's shopping list, in the order they were added.
 *
 * @param tripId - The trip ID to filter by
 * @returns Array of shopping items sorted by creation time
 */
export async function getShoppingItemsByTripId(tripId: TripId): Promise<ShoppingItem[]> {
  const items = await db.shoppingItems.where('tripId').equals(tripId).toArray();
  return items.sort(compareShoppingItems);
}

/**
 * Retrieves one shopping line by its unique ID.
 *
 * @param id - The shopping item's unique identifier
 * @returns The item if found, undefined otherwise
 */
export async function getShoppingItemById(
  id: ShoppingItemId,
): Promise<ShoppingItem | undefined> {
  return db.shoppingItems.get(id);
}

/**
 * The list's order: oldest line first, ties broken by id so two devices agree.
 */
export function compareShoppingItems(left: ShoppingItem, right: ShoppingItem): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

// ============================================================================
// Transactional Operations with Ownership Validation
// ============================================================================

/**
 * Updates a shopping line with ownership validation in a single transaction.
 *
 * A field passed as `undefined` is cleared; a field left out stays as it is.
 *
 * @param id - The shopping item's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @param data - Partial shopping item form data to update
 * @throws {Error} If the item is not found or belongs to another trip
 */
export async function updateShoppingItemWithOwnershipCheck(
  id: ShoppingItemId,
  tripId: TripId,
  data: Partial<ShoppingItemFormData>,
): Promise<void> {
  const sanitized = sanitizeShoppingItemData({
    name: data.name ?? '',
    quantity: data.quantity,
  });
  const patch: Partial<ShoppingItemFormData> = { ...data };
  if (data.name !== undefined) {
    patch.name = sanitized.name;
  }
  if ('quantity' in data) {
    patch.quantity = sanitized.quantity;
  }

  await db.transaction('rw', db.shoppingItems, async () => {
    const item = await db.shoppingItems.get(id);

    if (!item) {
      throw new Error(`Shopping item with ID "${id}" not found`);
    }
    if (item.tripId !== tripId) {
      throw new Error('Cannot update shopping item: item does not belong to current trip');
    }

    await db.shoppingItems.update(id, patch);
  });
}

/**
 * Deletes a shopping line with ownership validation in a single transaction.
 *
 * @param id - The shopping item's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @throws {Error} If the item is not found or belongs to another trip
 */
export async function deleteShoppingItemWithOwnershipCheck(
  id: ShoppingItemId,
  tripId: TripId,
): Promise<void> {
  await db.transaction('rw', db.shoppingItems, async () => {
    const item = await db.shoppingItems.get(id);

    if (!item) {
      throw new Error(`Shopping item with ID "${id}" not found`);
    }
    if (item.tripId !== tripId) {
      throw new Error('Cannot delete shopping item: item does not belong to current trip');
    }

    await db.shoppingItems.delete(id);
  });
}

/**
 * Deletes every checked line of a trip's list, after the shopping is done.
 *
 * @param tripId - The trip whose bought lines are cleared
 * @returns How many lines were deleted
 */
export async function deleteCheckedShoppingItems(tripId: TripId): Promise<number> {
  return db.shoppingItems
    .where('tripId')
    .equals(tripId)
    .filter((item) => item.checked)
    .delete();
}
