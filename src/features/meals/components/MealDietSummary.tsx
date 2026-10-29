/**
 * @fileoverview What the people at one meal eat: a count per diet, and the
 * food notes of the guests at the table.
 *
 * @module features/meals/components/MealDietSummary
 */

import { type ReactElement, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import type { MealAttendance } from '@/features/meals/utils/meal-headcount';
import { cn } from '@/lib/utils';
import { DIETARY_TAGS } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for {@link MealDietSummary}.
 */
export interface MealDietSummaryProps {
  /** Who eats the meal */
  readonly attendance: MealAttendance;
  /** Leave the food notes out, for a compact row */
  readonly compact?: boolean;
  readonly className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * The diets and food notes of one meal, or nothing when there are none.
 *
 * @param props - Component props
 * @returns The summary, or null
 */
const MealDietSummary = memo(function MealDietSummary({
  attendance,
  compact = false,
  className,
}: MealDietSummaryProps): ReactElement | null {
  const { t } = useTranslation();

  const diets = DIETARY_TAGS.filter((tag) => (attendance.diets.get(tag) ?? 0) > 0);
  const notes = compact ? [] : attendance.notes;

  if (diets.length === 0 && notes.length === 0) {
    return null;
  }

  return (
    <div className={cn('space-y-2', className)}>
      {diets.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('meals.diets')}>
          {diets.map((tag) => (
            <li key={tag}>
              <Badge variant="secondary" className="font-normal">
                {t('diets.count', {
                  count: attendance.diets.get(tag) ?? 0,
                  diet: t(`diets.${tag}`),
                })}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('meals.notes')}</p>
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            {notes.map(({ person, note }) => (
              <li key={person.id}>
                <span className="font-medium text-foreground">{person.name}</span>
                {' · '}
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { MealDietSummary };
