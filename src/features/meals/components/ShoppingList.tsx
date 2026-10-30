/**
 * @fileoverview The trip's shared shopping list.
 *
 * One list for the whole trip, independent of the meals. A line is added with
 * a name and an optional quantity, can be claimed by the guest who buys it,
 * and is ticked off in the shop. Bought lines drop to a second list, where one
 * button clears them all once the shopping is put away.
 *
 * @module features/meals/components/ShoppingList
 */

import {
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, ShoppingBasket, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { useOfflineAwareNotify } from '@/hooks';
import { useMealContext } from '@/contexts/MealContext';
import { MAX_LENGTHS } from '@/lib/db/sanitize';
import { reportFailure } from '@/lib/errors/report-failure';
import { captureDeletion, captureUsage } from '@/lib/posthog';
import { cn } from '@/lib/utils';
import type { Person, PersonId, ShoppingItem } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for {@link ShoppingList}.
 */
export interface ShoppingListProps {
  /** The trip's guests, offered as buyers */
  readonly persons: readonly Person[];
  /** False on a read-only trip: the list is shown and nothing can change */
  readonly canEdit: boolean;
}

interface ShoppingRowProps {
  readonly item: ShoppingItem;
  readonly persons: readonly Person[];
  readonly canEdit: boolean;
  readonly onToggle: (item: ShoppingItem, checked: boolean) => void;
  readonly onBuyerChange: (item: ShoppingItem, buyerId: PersonId | undefined) => void;
  readonly onRemove: (item: ShoppingItem) => void;
}

// ============================================================================
// Constants
// ============================================================================

/** Select value standing for "no buyer", since a select item cannot be empty. */
const NO_BUYER = 'none';

// ============================================================================
// Row
// ============================================================================

const ShoppingRow = memo(function ShoppingRow({
  item,
  persons,
  canEdit,
  onToggle,
  onBuyerChange,
  onRemove,
}: ShoppingRowProps): ReactElement {
  const { t } = useTranslation();
  const checkboxId = `shopping-item-${item.id}`;
  // A buyer who left the trip is shown as nobody rather than as a blank pick.
  const buyerId = persons.some((person) => person.id === item.buyerId)
    ? item.buyerId
    : undefined;

  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
      <Checkbox
        id={checkboxId}
        checked={item.checked}
        onCheckedChange={(value) => onToggle(item, value === true)}
        disabled={!canEdit}
        aria-label={t('meals.shopping.check', { name: item.name })}
        className="size-5"
      />
      <label
        htmlFor={checkboxId}
        className={cn(
          'min-w-0 flex-1 text-sm',
          item.checked && 'text-muted-foreground line-through',
        )}
      >
        <span className="break-words">{item.name}</span>
        {item.quantity && (
          <span className="ml-2 text-muted-foreground">{item.quantity}</span>
        )}
      </label>
      {persons.length > 0 && (
        <Select
          value={buyerId ?? NO_BUYER}
          onValueChange={(value) =>
            onBuyerChange(item, value === NO_BUYER ? undefined : (value as PersonId))
          }
          disabled={!canEdit}
        >
          <SelectTrigger
            size="sm"
            className="w-32 shrink-0"
            aria-label={t('meals.shopping.buyer', { name: item.name })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_BUYER}>{t('meals.shopping.noBuyer')}</SelectItem>
            {persons.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                {person.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {canEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={() => onRemove(item)}
          aria-label={t('meals.shopping.remove', { name: item.name })}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      )}
    </li>
  );
});

// ============================================================================
// Component
// ============================================================================

/**
 * The trip's shopping list, with the form that adds to it.
 *
 * @param props - Component props
 * @returns The list element
 */
const ShoppingList = memo(function ShoppingList({
  persons,
  canEdit,
}: ShoppingListProps): ReactElement {
  const { t } = useTranslation();
  const { notifySuccess } = useOfflineAwareNotify();
  const {
    shoppingItems,
    createShoppingItem,
    updateShoppingItem,
    deleteShoppingItem,
    clearCheckedShoppingItems,
  } = useMealContext();

  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);

  const { toBuy, bought } = useMemo(
    () => ({
      toBuy: shoppingItems.filter((item) => !item.checked),
      bought: shoppingItems.filter((item) => item.checked),
    }),
    [shoppingItems],
  );

  const handleNameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
  }, []);

  const handleQuantityChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setQuantity(event.target.value);
  }, []);

  const handleAdd = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmedName = name.trim();
      if (trimmedName.length === 0 || isAdding) {
        return;
      }
      setIsAdding(true);
      const trimmedQuantity = quantity.trim();
      try {
        await createShoppingItem({
          name: trimmedName,
          checked: false,
          ...(trimmedQuantity.length > 0 && { quantity: trimmedQuantity }),
        });
        captureUsage('shopping_item_saved', {
          operation: 'created',
          has_quantity: trimmedQuantity.length > 0,
        });
        setName('');
        setQuantity('');
      } catch (error) {
        reportFailure('ShoppingList.add', error, t('errors.saveFailed'));
      } finally {
        setIsAdding(false);
      }
    },
    [createShoppingItem, isAdding, name, quantity, t],
  );

  const handleToggle = useCallback(
    (item: ShoppingItem, checked: boolean) => {
      updateShoppingItem(item.id, { checked })
        .then(() => {
          captureUsage('shopping_item_saved', {
            operation: checked ? 'checked' : 'unchecked',
          });
        })
        .catch((error: unknown) => {
          reportFailure('ShoppingList.toggle', error, t('errors.saveFailed'));
        });
    },
    [t, updateShoppingItem],
  );

  const handleBuyerChange = useCallback(
    (item: ShoppingItem, buyerId: PersonId | undefined) => {
      updateShoppingItem(item.id, { buyerId })
        .then(() => {
          captureUsage('shopping_item_saved', {
            operation: 'updated',
            has_buyer: buyerId !== undefined,
          });
        })
        .catch((error: unknown) => {
          reportFailure('ShoppingList.buyer', error, t('errors.saveFailed'));
        });
    },
    [t, updateShoppingItem],
  );

  const handleRemove = useCallback(
    (item: ShoppingItem) => {
      deleteShoppingItem(item.id)
        .then(() => {
          captureDeletion('shopping_item_deleted', { checked: item.checked, count: 1 });
        })
        .catch((error: unknown) => {
          reportFailure('ShoppingList.remove', error, t('errors.deleteFailed'));
        });
    },
    [deleteShoppingItem, t],
  );

  const handleClearConfirm = useCallback(async () => {
    try {
      const count = await clearCheckedShoppingItems();
      captureDeletion('shopping_item_deleted', { checked: true, count });
      notifySuccess(t('meals.shopping.cleared', { count }));
    } catch (error) {
      reportFailure('ShoppingList.clear', error, t('errors.deleteFailed'));
    } finally {
      setIsClearConfirmOpen(false);
    }
  }, [clearCheckedShoppingItems, notifySuccess, t]);

  return (
    <div className="space-y-6">
      {canEdit && (
        <form onSubmit={handleAdd} className="flex items-end gap-2" noValidate>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="shopping-item-name">{t('meals.shopping.itemLabel')}</Label>
            <Input
              id="shopping-item-name"
              value={name}
              onChange={handleNameChange}
              placeholder={t('meals.shopping.itemPlaceholder')}
              maxLength={MAX_LENGTHS.shoppingItemName}
              autoComplete="off"
              disabled={isAdding}
            />
          </div>
          <div className="w-24 shrink-0 space-y-1.5">
            <Label htmlFor="shopping-item-quantity">
              {t('meals.shopping.quantityLabel')}
            </Label>
            <Input
              id="shopping-item-quantity"
              value={quantity}
              onChange={handleQuantityChange}
              placeholder={t('meals.shopping.quantityPlaceholder')}
              maxLength={MAX_LENGTHS.shoppingItemQuantity}
              autoComplete="off"
              disabled={isAdding}
            />
          </div>
          <Button type="submit" disabled={isAdding || name.trim().length === 0}>
            <Plus className="size-4 sm:mr-2" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">{t('meals.shopping.add')}</span>
          </Button>
        </form>
      )}

      {shoppingItems.length === 0 ? (
        <div className="flex min-h-[200px] items-center justify-center rounded-lg border">
          <EmptyState
            icon={ShoppingBasket}
            title={t('meals.shopping.empty')}
            description={t('meals.shopping.emptyDescription')}
          />
        </div>
      ) : (
        <>
          {toBuy.length > 0 && (
            <section className="space-y-2" aria-labelledby="shopping-to-buy">
              <h2 id="shopping-to-buy" className="font-display text-sm font-semibold">
                {t('meals.shopping.toBuy')}
              </h2>
              <ul className="space-y-2">
                {toBuy.map((item) => (
                  <ShoppingRow
                    key={item.id}
                    item={item}
                    persons={persons}
                    canEdit={canEdit}
                    onToggle={handleToggle}
                    onBuyerChange={handleBuyerChange}
                    onRemove={handleRemove}
                  />
                ))}
              </ul>
            </section>
          )}

          {bought.length > 0 && (
            <section className="space-y-2" aria-labelledby="shopping-bought">
              <div className="flex items-center justify-between gap-2">
                <h2 id="shopping-bought" className="font-display text-sm font-semibold">
                  {t('meals.shopping.bought')}
                </h2>
                {canEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsClearConfirmOpen(true)}
                  >
                    {t('meals.shopping.clearChecked')}
                  </Button>
                )}
              </div>
              <ul className="space-y-2">
                {bought.map((item) => (
                  <ShoppingRow
                    key={item.id}
                    item={item}
                    persons={persons}
                    canEdit={canEdit}
                    onToggle={handleToggle}
                    onBuyerChange={handleBuyerChange}
                    onRemove={handleRemove}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <ConfirmDialog
        open={isClearConfirmOpen}
        onOpenChange={setIsClearConfirmOpen}
        title={t('meals.shopping.clearTitle')}
        description={t('meals.shopping.clearDescription', { count: bought.length })}
        confirmLabel={t('meals.shopping.clearChecked')}
        onConfirm={handleClearConfirm}
        variant="destructive"
      />
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ShoppingList };
