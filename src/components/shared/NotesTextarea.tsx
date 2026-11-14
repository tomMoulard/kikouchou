/**
 * @fileoverview The notes field every guest form in the app uses.
 *
 * One field, so a guest's notes stop at the same length wherever they are
 * typed: the guest form, a guest group's members. The limit is the one the
 * save enforces (`MAX_LENGTHS.personNotes`); without it a long paste went in
 * whole and the save failed. A counter appears as the limit nears.
 *
 * @module components/shared/NotesTextarea
 */

import { type ComponentProps, type ReactNode, memo } from 'react';

import { Textarea } from '@/components/ui/textarea';

import { MAX_LENGTHS } from '@/lib/db/sanitize';
import { cn } from '@/lib/utils';

// ============================================================================
// Constants
// ============================================================================

/**
 * How close to the limit the counter appears. Below it, a count is noise;
 * past it, the person needs to see the wall coming.
 */
const NOTES_COUNTER_FROM = Math.floor(MAX_LENGTHS.personNotes * 0.8);

// ============================================================================
// Type Definitions
// ============================================================================

/** Props for {@link NotesTextarea}. */
export interface NotesTextareaProps
  extends Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange' | 'maxLength'> {
  /** The field's id; the hint takes `${id}-hint`. */
  readonly id: string;
  /** The notes as typed. */
  readonly value: string;
  /** Receives the notes as typed. */
  readonly onValueChange: (value: string) => void;
  /** A line under the field saying what the notes are for. */
  readonly hint?: ReactNode;
}

// ============================================================================
// Component
// ============================================================================

/**
 * A guest's notes: bounded, with a counter near the bound.
 *
 * @param props - See {@link NotesTextareaProps}
 * @returns The field, its hint and its counter
 */
export const NotesTextarea = memo(function NotesTextarea({
  id,
  value,
  onValueChange,
  hint,
  className,
  ...props
}: NotesTextareaProps) {
  const hintId = `${id}-hint`;
  const showCounter = value.length >= NOTES_COUNTER_FROM;

  return (
    <>
      <Textarea
        {...props}
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        maxLength={MAX_LENGTHS.personNotes}
        aria-describedby={hint ? hintId : props['aria-describedby']}
        className={cn('max-h-64 resize-y', className)}
      />
      {(hint || showCounter) && (
        <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
          {hint ? <p id={hintId}>{hint}</p> : <span />}
          {showCounter && (
            <p className="shrink-0 tabular-nums" aria-live="polite">
              {value.length} / {MAX_LENGTHS.personNotes}
            </p>
          )}
        </div>
      )}
    </>
  );
});
