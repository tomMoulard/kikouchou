/**
 * @fileoverview The diet chips a guest, or a guest group member, is tagged with.
 *
 * One copy for both forms: a member becomes a guest on import, so the two
 * forms must offer the same tags in the same order and look the same.
 *
 * @module features/persons/components/DietaryTagPicker
 */

import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { DIETARY_TAGS } from '@/types';
import type { DietaryTag } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export interface DietaryTagPickerProps {
  /** The tags selected now. */
  readonly value: readonly DietaryTag[];
  /** Called with the next selection, always in {@link DIETARY_TAGS} order. */
  readonly onChange: (tags: DietaryTag[]) => void;
  /** Id of the hint under the chips, unique in the document. */
  readonly hintId: string;
  readonly disabled?: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * A fieldset of toggle chips, one per {@link DietaryTag}, with its hint.
 *
 * @param props - Component props
 * @returns The fieldset and its hint
 */
const DietaryTagPicker = memo(function DietaryTagPicker({
  value,
  onChange,
  hintId,
  disabled = false,
}: DietaryTagPickerProps) {
  const { t } = useTranslation();

  const handleToggle = useCallback(
    (tag: DietaryTag) => {
      onChange(
        value.includes(tag)
          ? value.filter((candidate) => candidate !== tag)
          : DIETARY_TAGS.filter((candidate) => candidate === tag || value.includes(candidate)),
      );
    },
    [onChange, value],
  );

  return (
    <>
      <fieldset className="space-y-2" aria-describedby={hintId}>
        <legend className="text-sm font-medium leading-none">{t('diets.label')}</legend>
        <div className="flex flex-wrap gap-2">
          {DIETARY_TAGS.map((tag) => {
            const isSelected = value.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => handleToggle(tag)}
                disabled={disabled}
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
                {t(`diets.${tag}`)}
                {isSelected && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </fieldset>
      <p id={hintId} className="text-xs text-muted-foreground">
        {t('diets.hint')}
      </p>
    </>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { DietaryTagPicker };
