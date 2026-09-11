/**
 * @fileoverview Expense form for creating and editing a trip's money lines.
 * Handles validation, controlled inputs and submission state.
 *
 * The form's job is to make the three kinds of line one form rather than three:
 * a transfer hides the split rules and asks for one recipient, an income keeps
 * them and renames the payer, and an expense is the plain case. What the line
 * comes to per guest is shown while it is typed, because the split rule is the
 * part people get wrong and a preview is the only honest way to check it.
 *
 * @module features/money/components/ExpenseForm
 * @see ActivityForm.tsx for the reference implementation pattern
 */

import {
  type ChangeEvent,
  type FormEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { useFormSubmission } from '@/hooks';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ExpenseCategoryPicker } from '@/features/money/components/ExpenseCategoryPicker';
import { useMoneyFormat } from '@/features/money/hooks/useMoneyFormat';
import { computeExpenseShares } from '@/features/money/lib/expense-split';
import type { PersonNightCounts } from '@/features/money/lib/expense-split';
import { cn } from '@/lib/utils';
import {
  DEFAULT_EXPENSE_CATEGORY,
  DEFAULT_EXPENSE_SPLIT_MODE,
  EXPENSE_KINDS,
  EXPENSE_SPLIT_MODES,
  MAX_EXPENSE_AMOUNT,
} from '@/types';
import type {
  CurrencyCode,
  Expense,
  ExpenseCategory,
  ExpenseFormData,
  ExpenseKind,
  ExpenseSplitMode,
  ISODateString,
  Person,
  PersonId,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the ExpenseForm component.
 */
interface ExpenseFormProps {
  /** Existing line for edit mode. If undefined, the form is in create mode. */
  readonly expense?: Expense;
  /** Guests available as payer and beneficiaries. */
  readonly persons: readonly Person[];
  /** Each guest's person nights, for the preview of a night split. */
  readonly personNights: PersonNightCounts;
  /** The trip's currency, for the preview and the amount field. */
  readonly currency: CurrencyCode | undefined;
  /** Day pre-selected in create mode (YYYY-MM-DD). */
  readonly defaultDate?: ISODateString;
  /** Guest pre-selected as the payer in create mode. */
  readonly defaultPayerId?: PersonId;
  /** Callback when the form is successfully submitted with validated data. */
  readonly onSubmit: (data: ExpenseFormData) => Promise<void>;
  /** Callback when the cancel button is clicked. */
  readonly onCancel: () => void;
  /** Callback when the form dirty state changes (for the unsaved changes guard). */
  readonly onDirtyChange?: (isDirty: boolean) => void;
}

/**
 * Form validation errors.
 */
interface FormErrors {
  title?: string;
  amount?: string;
  payer?: string;
  splits?: string;
}

/**
 * Internal form state. Numbers are held as strings to avoid uncontrolled inputs.
 */
interface FormState {
  kind: ExpenseKind;
  category: ExpenseCategory;
  title: string;
  date: string;
  amount: string;
  payerId: PersonId | '';
  splitMode: ExpenseSplitMode;
  /** Guests the line is for, in the order they were picked. */
  beneficiaryIds: PersonId[];
  /** Parts or amounts per guest, as typed. Kept for guests not currently picked. */
  values: Record<string, string>;
  /** The guest being paid, for a transfer. */
  recipientId: PersonId | '';
  description: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Special value for "no selection" in select dropdowns. */
const NO_SELECTION = '__none__';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Reads a number the user typed.
 *
 * A comma is read as a decimal point, because a French keyboard puts one there
 * and `type="number"` only agrees with the locale on some browsers.
 *
 * @param raw - What is in the field
 * @returns The number, or `null` when the field holds none
 */
function parseNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Creates the initial form state from a line, or sensible defaults.
 */
function getInitialFormState(
  expense: Expense | undefined,
  persons: readonly Person[],
  defaultDate: ISODateString | undefined,
  defaultPayerId: PersonId | undefined,
): FormState {
  if (expense) {
    const values: Record<string, string> = {};
    for (const split of expense.splits ?? []) {
      values[split.personId] = String(split.value);
    }

    return {
      kind: expense.kind,
      category: expense.category,
      title: expense.title,
      date: expense.date,
      amount: String(expense.amount),
      payerId: expense.payerId,
      splitMode: expense.splitMode,
      beneficiaryIds: (expense.splits ?? []).map((split) => split.personId),
      values,
      recipientId: expense.splits?.[0]?.personId ?? '',
      description: expense.description ?? '',
    };
  }

  return {
    kind: 'expense',
    category: DEFAULT_EXPENSE_CATEGORY,
    title: '',
    date: defaultDate ?? '',
    amount: '',
    payerId: defaultPayerId ?? persons[0]?.id ?? '',
    splitMode: DEFAULT_EXPENSE_SPLIT_MODE,
    // A new expense is for everybody, which is what a group means by "we split
    // it" and what they would otherwise tap once per guest.
    beneficiaryIds: persons.map((person) => person.id),
    values: {},
    recipientId: '',
    description: '',
  };
}

/**
 * Compares two beneficiary lists ignoring order.
 */
function areBeneficiariesEqual(
  left: readonly PersonId[],
  right: readonly PersonId[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const set = new Set(right);
  return left.every((personId) => set.has(personId));
}

// ============================================================================
// Component
// ============================================================================

/**
 * Form for creating and editing one money line.
 *
 * Features:
 * - Kind, category, title, day, amount and payer
 * - Four split rules, with the beneficiaries picked as chips
 * - Parts or exact amounts per guest, for the two rules that need them
 * - A live preview of what each guest owes, and of what the amounts add up to
 * - Validation on submit, with inline field errors
 *
 * @param props - Component props
 * @returns The expense form element
 */
const ExpenseForm = memo(function ExpenseForm({
  expense,
  persons,
  personNights,
  currency,
  defaultDate,
  defaultPayerId,
  onSubmit,
  onCancel,
  onDirtyChange,
}: ExpenseFormProps) {
  const { t } = useTranslation();
  const formatMoney = useMoneyFormat(currency);

  const [formState, setFormState] = useState<FormState>(() =>
    getInitialFormState(expense, persons, defaultDate, defaultPayerId),
  );
  const [errors, setErrors] = useState<FormErrors>({});

  const initialFormState = useMemo(
    () => getInitialFormState(expense, persons, defaultDate, defaultPayerId),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only recompute when editing a different line
    [expense?.id, defaultDate, defaultPayerId],
  );

  const isDirty = useMemo(
    () =>
      formState.kind !== initialFormState.kind ||
      formState.category !== initialFormState.category ||
      formState.title !== initialFormState.title ||
      formState.date !== initialFormState.date ||
      formState.amount !== initialFormState.amount ||
      formState.payerId !== initialFormState.payerId ||
      formState.splitMode !== initialFormState.splitMode ||
      formState.recipientId !== initialFormState.recipientId ||
      formState.description !== initialFormState.description ||
      !areBeneficiariesEqual(
        formState.beneficiaryIds,
        initialFormState.beneficiaryIds,
      ) ||
      formState.beneficiaryIds.some(
        (personId) =>
          (formState.values[personId] ?? '') !==
          (initialFormState.values[personId] ?? ''),
      ),
    [formState, initialFormState],
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Sync form state when editing a different line
  useEffect(() => {
    setFormState(getInitialFormState(expense, persons, defaultDate, defaultPayerId));
    setErrors({});
  }, [expense?.id, defaultDate, defaultPayerId]); // eslint-disable-line react-hooks/exhaustive-deps -- Only sync on expense.id change

  const isTransfer = formState.kind === 'transfer';
  const needsValues =
    !isTransfer &&
    (formState.splitMode === 'shares' || formState.splitMode === 'amounts');

  const amount = parseNumber(formState.amount) ?? 0;

  /**
   * The shares as the line currently reads, for the preview under the picker.
   */
  const preview = useMemo(() => {
    const splits = isTransfer
      ? formState.recipientId
        ? [{ personId: formState.recipientId, value: amount }]
        : []
      : formState.beneficiaryIds.map((personId) => ({
          personId,
          value: parseNumber(formState.values[personId] ?? '') ?? 0,
        }));

    return computeExpenseShares(
      {
        amount,
        splitMode: isTransfer ? 'equal' : formState.splitMode,
        splits,
      },
      personNights,
    );
  }, [
    amount,
    formState.beneficiaryIds,
    formState.recipientId,
    formState.splitMode,
    formState.values,
    isTransfer,
    personNights,
  ]);

  const previewByPerson = useMemo(
    () => new Map(preview.map((share) => [share.personId, share.amount])),
    [preview],
  );

  /**
   * What the typed amounts add up to, for the `amounts` rule.
   *
   * Shown whether or not it matches, because the difference is the thing the
   * person typing is checking — an error message that only appears on submit
   * makes them re-add the column themselves.
   */
  const typedTotal = useMemo(
    () =>
      formState.splitMode === 'amounts'
        ? formState.beneficiaryIds.reduce(
            (total, personId) =>
              total + (parseNumber(formState.values[personId] ?? '') ?? 0),
            0,
          )
        : 0,
    [formState.beneficiaryIds, formState.splitMode, formState.values],
  );

  const amountsMatch =
    Math.round(typedTotal * 100) === Math.round(amount * 100);

  // ==========================================================================
  // Validation
  // ==========================================================================

  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!formState.title.trim()) {
      newErrors.title = t('common.required');
    }

    const typedAmount = parseNumber(formState.amount);
    if (typedAmount === null || typedAmount <= 0) {
      newErrors.amount = t('money.expense.errors.amountAboveZero');
    } else if (typedAmount > MAX_EXPENSE_AMOUNT) {
      newErrors.amount = t('money.expense.errors.amountTooLarge', {
        max: MAX_EXPENSE_AMOUNT,
      });
    }

    if (!formState.payerId) {
      newErrors.payer = t('common.required');
    }

    if (isTransfer) {
      if (!formState.recipientId) {
        newErrors.splits = t('money.expense.errors.recipientRequired');
      } else if (formState.recipientId === formState.payerId) {
        newErrors.splits = t('money.expense.errors.recipientIsPayer');
      }
    } else if (formState.beneficiaryIds.length === 0) {
      newErrors.splits = t('money.expense.errors.beneficiaryRequired');
    } else if (formState.splitMode === 'amounts' && !amountsMatch) {
      newErrors.splits = t('money.expense.errors.amountsDoNotAddUp');
    } else if (
      formState.splitMode === 'shares' &&
      formState.beneficiaryIds.every(
        (personId) => (parseNumber(formState.values[personId] ?? '') ?? 0) <= 0,
      )
    ) {
      newErrors.splits = t('money.expense.errors.sharesRequired');
    } else if (
      formState.splitMode === 'nights' &&
      formState.beneficiaryIds.every(
        (personId) => (personNights.get(personId) ?? 0) <= 0,
      )
    ) {
      newErrors.splits = t('money.expense.errors.noNightsToSplitBy');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [amountsMatch, formState, isTransfer, personNights, t]);

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  const handleKindChange = useCallback((value: string) => {
    setFormState((prev) => ({ ...prev, kind: value as ExpenseKind }));
    setErrors((prev) => (prev.splits ? { ...prev, splits: undefined } : prev));
  }, []);

  const handleCategoryChange = useCallback((category: ExpenseCategory) => {
    setFormState((prev) => ({ ...prev, category }));
  }, []);

  const handleTitleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setFormState((prev) => ({ ...prev, title: value }));
    setErrors((prev) => (prev.title ? { ...prev, title: undefined } : prev));
  }, []);

  const handleDateChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setFormState((prev) => ({ ...prev, date: value }));
  }, []);

  const handleAmountChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setFormState((prev) => ({ ...prev, amount: value }));
    setErrors((prev) => (prev.amount ? { ...prev, amount: undefined } : prev));
  }, []);

  const handlePayerChange = useCallback((value: string) => {
    setFormState((prev) => ({
      ...prev,
      payerId: value === NO_SELECTION ? '' : (value as PersonId),
    }));
    setErrors((prev) => (prev.payer ? { ...prev, payer: undefined } : prev));
  }, []);

  const handleRecipientChange = useCallback((value: string) => {
    setFormState((prev) => ({
      ...prev,
      recipientId: value === NO_SELECTION ? '' : (value as PersonId),
    }));
    setErrors((prev) => (prev.splits ? { ...prev, splits: undefined } : prev));
  }, []);

  const handleSplitModeChange = useCallback((value: string) => {
    setFormState((prev) => ({ ...prev, splitMode: value as ExpenseSplitMode }));
    setErrors((prev) => (prev.splits ? { ...prev, splits: undefined } : prev));
  }, []);

  const handleBeneficiaryToggle = useCallback((personId: PersonId) => {
    setFormState((prev) => ({
      ...prev,
      beneficiaryIds: prev.beneficiaryIds.includes(personId)
        ? prev.beneficiaryIds.filter((candidate) => candidate !== personId)
        : [...prev.beneficiaryIds, personId],
    }));
    setErrors((prev) => (prev.splits ? { ...prev, splits: undefined } : prev));
  }, []);

  const handleSelectEveryone = useCallback(() => {
    setFormState((prev) => ({
      ...prev,
      beneficiaryIds: persons.map((person) => person.id),
    }));
    setErrors((prev) => (prev.splits ? { ...prev, splits: undefined } : prev));
  }, [persons]);

  const handleSelectNobody = useCallback(() => {
    setFormState((prev) => ({ ...prev, beneficiaryIds: [] }));
  }, []);

  const handleValueChange = useCallback(
    (personId: PersonId, value: string) => {
      setFormState((prev) => ({
        ...prev,
        values: { ...prev.values, [personId]: value },
      }));
      setErrors((prev) => (prev.splits ? { ...prev, splits: undefined } : prev));
    },
    [],
  );

  const handleDescriptionChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const { value } = event.target;
      setFormState((prev) => ({ ...prev, description: value }));
    },
    [],
  );

  const { isSubmitting, submitError, handleSubmit: doSubmit } =
    useFormSubmission<ExpenseFormData>(onSubmit);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();

      if (!validateForm()) {
        return;
      }

      const typedAmount = parseNumber(formState.amount) ?? 0;

      const splits = isTransfer
        ? [{ personId: formState.recipientId as PersonId, value: typedAmount }]
        : formState.beneficiaryIds.map((personId) => ({
            personId,
            // Under `equal` and `nights` the rule supplies the weight, so the
            // stored value is one rather than whatever was typed under another
            // rule earlier in this edit.
            value:
              formState.splitMode === 'shares' || formState.splitMode === 'amounts'
                ? (parseNumber(formState.values[personId] ?? '') ?? 0)
                : 1,
          }));

      const data: ExpenseFormData = {
        kind: formState.kind,
        category: formState.category,
        title: formState.title.trim(),
        date: formState.date as ISODateString,
        amount: typedAmount,
        payerId: formState.payerId as PersonId,
        // A transfer is one guest paying another, so there is nothing to divide
        // and no rule to pick: it is stored as the single share it is.
        splitMode: isTransfer ? 'equal' : formState.splitMode,
        splits,
        description: formState.description.trim() || undefined,
      };

      try {
        await doSubmit(data);
      } catch {
        // Error surfaced by useFormSubmission via submitError
      }
    },
    [validateForm, doSubmit, formState, isTransfer],
  );

  // ==========================================================================
  // Render
  // ==========================================================================

  const payerLabel =
    formState.kind === 'income'
      ? t('money.expense.receivedBy')
      : formState.kind === 'transfer'
        ? t('money.expense.transferFrom')
        : t('money.expense.paidBy');

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Kind */}
      <div className="space-y-2">
        <Label htmlFor="expense-kind">{t('money.expense.kind')}</Label>
        <Select
          value={formState.kind}
          onValueChange={handleKindChange}
          disabled={isSubmitting}
        >
          <SelectTrigger id="expense-kind" className="w-full">
            <SelectValue placeholder={t('money.expense.kind')} />
          </SelectTrigger>
          <SelectContent>
            {EXPENSE_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(`money.expense.kinds.${kind}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t(`money.expense.kindHints.${formState.kind}`)}
        </p>
      </div>

      {/* Title, with the category as the icon in front of it — a transfer is not
          spending, so it has nothing to categorise */}
      <div className="space-y-2">
        <Label htmlFor="expense-title">
          {t('money.expense.title_field')}
          <span className="text-destructive ml-1" aria-hidden="true">*</span>
        </Label>
        <div className="flex items-center gap-2">
          {!isTransfer && (
            <ExpenseCategoryPicker
              id="expense-category"
              value={formState.category}
              onChange={handleCategoryChange}
              disabled={isSubmitting}
            />
          )}
          <Input
            id="expense-title"
            type="text"
            className="min-w-0 flex-1"
            value={formState.title}
            onChange={handleTitleChange}
            placeholder={t('money.expense.titlePlaceholder')}
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? 'expense-title-error' : undefined}
            disabled={isSubmitting}
          />
        </div>
        {errors.title && (
          <p id="expense-title-error" className="text-sm text-destructive" role="alert">
            {errors.title}
          </p>
        )}
      </div>

      {/* Amount and day */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="expense-amount">
            {t('money.expense.amount')}
            <span className="text-destructive ml-1" aria-hidden="true">*</span>
          </Label>
          <Input
            id="expense-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={formState.amount}
            onChange={handleAmountChange}
            placeholder={t('money.expense.amountPlaceholder')}
            aria-invalid={Boolean(errors.amount)}
            aria-describedby={errors.amount ? 'expense-amount-error' : undefined}
            disabled={isSubmitting}
          />
          {errors.amount && (
            <p id="expense-amount-error" className="text-sm text-destructive" role="alert">
              {errors.amount}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="expense-date">{t('money.expense.date')}</Label>
          <Input
            id="expense-date"
            type="date"
            value={formState.date}
            onChange={handleDateChange}
            disabled={isSubmitting}
          />
        </div>
      </div>

      {/* Payer */}
      <div className="space-y-2">
        <Label htmlFor="expense-payer">
          {payerLabel}
          <span className="text-destructive ml-1" aria-hidden="true">*</span>
        </Label>
        <Select
          value={formState.payerId || NO_SELECTION}
          onValueChange={handlePayerChange}
          disabled={isSubmitting || persons.length === 0}
        >
          <SelectTrigger id="expense-payer" className="w-full">
            <SelectValue placeholder={payerLabel} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SELECTION}>—</SelectItem>
            {persons.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                <div className="flex items-center gap-2">
                  <div
                    className="size-3 rounded-full shrink-0"
                    style={{ backgroundColor: person.color }}
                    aria-hidden="true"
                  />
                  {person.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.payer && (
          <p className="text-sm text-destructive" role="alert">
            {errors.payer}
          </p>
        )}
      </div>

      {/* A transfer names the other end and stops there */}
      {isTransfer ? (
        <div className="space-y-2">
          <Label htmlFor="expense-recipient">
            {t('money.expense.transferTo')}
            <span className="text-destructive ml-1" aria-hidden="true">*</span>
          </Label>
          <Select
            value={formState.recipientId || NO_SELECTION}
            onValueChange={handleRecipientChange}
            disabled={isSubmitting || persons.length === 0}
          >
            <SelectTrigger id="expense-recipient" className="w-full">
              <SelectValue placeholder={t('money.expense.transferTo')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SELECTION}>—</SelectItem>
              {persons.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  <div className="flex items-center gap-2">
                    <div
                      className="size-3 rounded-full shrink-0"
                      style={{ backgroundColor: person.color }}
                      aria-hidden="true"
                    />
                    {person.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.splits && (
            <p className="text-sm text-destructive" role="alert">
              {errors.splits}
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Split rule */}
          <div className="space-y-2">
            <Label htmlFor="expense-split-mode">{t('money.expense.splitMode')}</Label>
            <Select
              value={formState.splitMode}
              onValueChange={handleSplitModeChange}
              disabled={isSubmitting}
            >
              <SelectTrigger id="expense-split-mode" className="w-full">
                <SelectValue placeholder={t('money.expense.splitMode')} />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_SPLIT_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(`money.expense.splitModes.${mode}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t(`money.expense.splitModeHints.${formState.splitMode}`)}
            </p>
          </div>

          {/* Beneficiaries */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium leading-none">
              {t('money.expense.beneficiaries')}
            </legend>
            <p className="text-sm text-muted-foreground">
              {t('money.expense.beneficiariesDescription')}
            </p>

            {persons.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('persons.empty')}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSelectEveryone}
                    disabled={isSubmitting}
                  >
                    {t('money.expense.everyone')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSelectNobody}
                    disabled={isSubmitting}
                  >
                    {t('money.expense.nobody')}
                  </Button>
                </div>

                <ul className="space-y-2">
                  {persons.map((person) => {
                    const isSelected = formState.beneficiaryIds.includes(person.id);
                    const share = previewByPerson.get(person.id) ?? 0;

                    return (
                      <li key={person.id} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleBeneficiaryToggle(person.id)}
                          disabled={isSubmitting}
                          aria-pressed={isSelected}
                          className={cn(
                            'flex min-w-0 flex-1 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm',
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
                          <span className="truncate">{person.name}</span>
                          {isSelected && (
                            <Check className="size-3.5 shrink-0" aria-hidden="true" />
                          )}
                        </button>

                        {needsValues && isSelected ? (
                          <Input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step={formState.splitMode === 'amounts' ? '0.01' : '1'}
                            className="w-24 shrink-0"
                            value={formState.values[person.id] ?? ''}
                            onChange={(event) =>
                              handleValueChange(person.id, event.target.value)
                            }
                            disabled={isSubmitting}
                            aria-label={
                              formState.splitMode === 'amounts'
                                ? t('money.expense.amountFor', { name: person.name })
                                : t('money.expense.sharesFor', { name: person.name })
                            }
                          />
                        ) : null}

                        {isSelected ? (
                          <span className="w-20 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                            {formatMoney(share)}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>

                {formState.splitMode === 'amounts' && (
                  <p
                    className={cn(
                      'text-sm tabular-nums',
                      amountsMatch ? 'text-muted-foreground' : 'text-destructive',
                    )}
                    role={amountsMatch ? undefined : 'alert'}
                  >
                    {t('money.expense.amountsTotal', {
                      typed: formatMoney(typedTotal),
                      amount: formatMoney(amount),
                    })}
                  </p>
                )}
              </>
            )}

            {errors.splits && (
              <p className="text-sm text-destructive" role="alert">
                {errors.splits}
              </p>
            )}
          </fieldset>
        </>
      )}

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="expense-description">{t('money.expense.description')}</Label>
        <Textarea
          id="expense-description"
          value={formState.description}
          onChange={handleDescriptionChange}
          placeholder={t('money.expense.descriptionPlaceholder')}
          disabled={isSubmitting}
          rows={3}
        />
      </div>

      {/* Submission error */}
      {submitError && (
        <div
          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {submitError}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
          {isSubmitting ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </form>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ExpenseForm };
export type { ExpenseFormProps };
