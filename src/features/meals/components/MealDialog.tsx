/**
 * @fileoverview Dialog to fill in, change or clear one lunch or dinner.
 *
 * The page mounts the dialog only while it is open, so each opening starts
 * from the stored meal, and a sync that changes the meal while the dialog is
 * open never overwrites what the user is typing.
 *
 * The slot is fixed by the row that opened the dialog, so the form asks only
 * what the group decides: where the meal happens, who is in charge, what is on
 * the menu, and how many people to feed. The count starts from the guests on
 * site at that time and the stepper stores the difference, so a guest who
 * changes trains later still changes the count.
 *
 * @module features/meals/components/MealDialog
 */

import {
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
  memo,
  useCallback,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { NumberStepper } from '@/components/ui/number-stepper';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { MealDietSummary } from '@/features/meals/components/MealDietSummary';
import type { MealAttendance } from '@/features/meals/utils/meal-headcount';
import { useOfflineAwareNotify } from '@/hooks';
import { useMealContext } from '@/contexts/MealContext';
import { MAX_LENGTHS } from '@/lib/db/sanitize';
import { reportFailure } from '@/lib/errors/report-failure';
import { captureDeletion, captureUsage } from '@/lib/posthog';
import { cn } from '@/lib/utils';
import {
  DEFAULT_MEAL_KIND,
  MAX_MEAL_HEADCOUNT_ADJUSTMENT,
  MEAL_KINDS,
} from '@/types';
import type {
  ISODateString,
  Meal,
  MealKind,
  MealSlot,
  Person,
  PersonId,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for {@link MealDialog}.
 */
export interface MealDialogProps {
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback to change the open state */
  readonly onOpenChange: (open: boolean) => void;
  /** The day of the meal */
  readonly date: ISODateString;
  /** Lunch or dinner */
  readonly slot: MealSlot;
  /** The day, as the page shows it ("Friday 12 April") */
  readonly dayLabel: string;
  /** The stored meal, or undefined for a slot nobody filled yet */
  readonly meal: Meal | undefined;
  /** Who is on site for this meal, without the meal's own correction */
  readonly attendance: MealAttendance;
  /** The trip's guests, offered as the people in charge */
  readonly persons: readonly Person[];
}

// ============================================================================
// Component
// ============================================================================

/**
 * Fill in, change or clear the meal of one slot.
 *
 * @param props - Component props
 * @returns The dialog element
 */
const MealDialog = memo(function MealDialog({
  open,
  onOpenChange,
  date,
  slot,
  dayLabel,
  meal,
  attendance,
  persons,
}: MealDialogProps): ReactElement {
  const { t } = useTranslation();
  const { createMeal, updateMeal, deleteMeal } = useMealContext();
  const { notifySuccess } = useOfflineAwareNotify();

  const [kind, setKind] = useState<MealKind>(meal?.kind ?? DEFAULT_MEAL_KIND);
  const [organizerIds, setOrganizerIds] = useState<PersonId[]>(
    () => [...(meal?.organizerIds ?? [])],
  );
  const [menu, setMenu] = useState(meal?.menu ?? '');
  // The correction, not the total: the guests on site can still change while
  // the dialog is open (the roster loads, a train time syncs), and a total
  // typed against the old count would turn into the wrong correction.
  const [adjustment, setAdjustment] = useState(meal?.headcountAdjustment ?? 0);
  const people = Math.max(0, attendance.onSite + adjustment);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);

  const slotLabel = t(`meals.slots.${slot}`);
  const minPeople = Math.max(0, attendance.onSite - MAX_MEAL_HEADCOUNT_ADJUSTMENT);
  const maxPeople = attendance.onSite + MAX_MEAL_HEADCOUNT_ADJUSTMENT;

  const handleKindChange = useCallback((value: string) => {
    if ((MEAL_KINDS as readonly string[]).includes(value)) {
      setKind(value as MealKind);
    }
  }, []);

  const handleOrganizerToggle = useCallback((personId: PersonId) => {
    setOrganizerIds((previous) =>
      previous.includes(personId)
        ? previous.filter((id) => id !== personId)
        : [...previous, personId],
    );
  }, []);

  const handlePeopleChange = useCallback(
    (value: number) => setAdjustment(value - attendance.onSite),
    [attendance.onSite],
  );

  const handleMenuChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setMenu(event.target.value);
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isSubmitting) {
        return;
      }
      setIsSubmitting(true);

      const trimmedMenu = menu.trim();
      const data = {
        date,
        slot,
        kind,
        organizerIds,
        menu: trimmedMenu.length > 0 ? trimmedMenu : undefined,
        headcountAdjustment: adjustment === 0 ? undefined : adjustment,
      };

      try {
        if (meal) {
          await updateMeal(meal.id, data);
        } else {
          await createMeal(data);
        }
        // Counts and enum values only: a menu and the names of the cooks are
        // the group's, not analytics data.
        captureUsage('meal_saved', {
          operation: meal ? 'updated' : 'created',
          slot,
          kind,
          organizer_count: organizerIds.length,
          has_menu: data.menu !== undefined,
          has_adjustment: data.headcountAdjustment !== undefined,
        });
        notifySuccess(t('meals.saveSuccess'));
        onOpenChange(false);
      } catch (error) {
        reportFailure('MealDialog.save', error, t('errors.saveFailed'));
        setIsSubmitting(false);
      }
    },
    [
      adjustment,
      createMeal,
      date,
      isSubmitting,
      kind,
      meal,
      menu,
      notifySuccess,
      onOpenChange,
      organizerIds,
      slot,
      t,
      updateMeal,
    ],
  );

  const handleClearConfirm = useCallback(async () => {
    if (!meal) {
      return;
    }
    try {
      await deleteMeal(meal.id);
      captureDeletion('meal_deleted', { slot: meal.slot, kind: meal.kind });
      notifySuccess(t('meals.clearSuccess'));
      onOpenChange(false);
    } catch (error) {
      reportFailure('MealDialog.clear', error, t('errors.deleteFailed'));
    } finally {
      setIsClearConfirmOpen(false);
    }
  }, [deleteMeal, meal, notifySuccess, onOpenChange, t]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t('meals.dialogTitle', { slot: slotLabel, date: dayLabel })}
            </DialogTitle>
            <DialogDescription>{t('meals.dialogDescription')}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-6" noValidate>
            {/* Where */}
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium leading-none">
                {t('meals.kindLabel')}
              </legend>
              <RadioGroup
                value={kind}
                onValueChange={handleKindChange}
                className="flex flex-wrap gap-4"
                disabled={isSubmitting}
              >
                {MEAL_KINDS.map((option) => (
                  <div key={option} className="flex items-center gap-2">
                    <RadioGroupItem value={option} id={`meal-kind-${option}`} />
                    <Label htmlFor={`meal-kind-${option}`} className="font-normal">
                      {t(`meals.kinds.${option}`)}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>

            {/* Who is in charge */}
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium leading-none">
                {t(`meals.organizers.${kind}`)}
              </legend>
              {persons.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('persons.empty')}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {persons.map((person) => {
                    const isSelected = organizerIds.includes(person.id);
                    return (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => handleOrganizerToggle(person.id)}
                        disabled={isSubmitting}
                        aria-pressed={isSelected}
                        className={cn(
                          'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm',
                          'transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                          'disabled:opacity-50',
                          isSelected
                            ? 'border-primary bg-primary/10 text-foreground'
                            : 'border-input text-muted-foreground hover:bg-muted',
                        )}
                      >
                        <span
                          className="size-3 rounded-full shrink-0"
                          style={{ backgroundColor: person.color }}
                          aria-hidden="true"
                        />
                        {person.name}
                        {isSelected && (
                          <Check className="size-3.5 shrink-0" aria-hidden="true" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </fieldset>

            {/* Menu */}
            <div className="space-y-2">
              <Label htmlFor="meal-menu">{t(`meals.menu.${kind}`)}</Label>
              <Textarea
                id="meal-menu"
                value={menu}
                onChange={handleMenuChange}
                placeholder={t(`meals.menuPlaceholder.${kind}`)}
                maxLength={MAX_LENGTHS.mealMenu}
                rows={2}
                disabled={isSubmitting}
              />
            </div>

            {/* How many */}
            <div className="space-y-2">
              <Label htmlFor="meal-people">{t('meals.headcount')}</Label>
              <NumberStepper
                id="meal-people"
                value={people}
                onValueChange={handlePeopleChange}
                min={minPeople}
                max={maxPeople}
                disabled={isSubmitting}
                decrementLabel={t('meals.decrease')}
                incrementLabel={t('meals.increase')}
                aria-describedby="meal-people-hint"
              />
              <p id="meal-people-hint" className="text-sm text-muted-foreground">
                {t('meals.headcountHint', { count: attendance.onSite })}
              </p>
              <MealDietSummary attendance={attendance} />
            </div>

            <DialogFooter className="gap-2 sm:justify-between">
              {meal ? (
                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive"
                  onClick={() => setIsClearConfirmOpen(true)}
                  disabled={isSubmitting}
                >
                  {t('meals.clear')}
                </Button>
              ) : (
                <span aria-hidden="true" />
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isSubmitting}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {t('common.save')}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={isClearConfirmOpen}
        onOpenChange={setIsClearConfirmOpen}
        title={t('meals.clearTitle')}
        description={t('meals.clearDescription', {
          slot: slotLabel.toLocaleLowerCase(),
          date: dayLabel,
        })}
        confirmLabel={t('meals.clear')}
        onConfirm={handleClearConfirm}
        variant="destructive"
      />
    </>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { MealDialog };
