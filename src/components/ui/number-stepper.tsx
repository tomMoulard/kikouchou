import * as React from 'react'
import { Minus, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Props for {@link NumberStepper}.
 */
export interface NumberStepperProps {
  /** Id for the input, so a `<Label htmlFor>` points at the right element. */
  readonly id?: string
  /** Current committed value. */
  readonly value: number
  /** Called with the new value whenever the control commits one. */
  readonly onValueChange: (value: number) => void
  /** Smallest allowed value. The decrement button stops here. */
  readonly min?: number
  /** Largest allowed value, if there is one. */
  readonly max?: number
  /** How much one press moves the value. */
  readonly step?: number
  readonly disabled?: boolean
  /** Accessible name for the decrement button, e.g. "Remove a bed". */
  readonly decrementLabel: string
  /** Accessible name for the increment button, e.g. "Add a bed". */
  readonly incrementLabel: string
  readonly onBlur?: () => void
  readonly 'aria-invalid'?: boolean
  readonly 'aria-describedby'?: string
  /** Classes for the input itself, not the row. */
  readonly className?: string
}

function clamp(value: number, min: number, max: number | undefined): number {
  const lower = Math.max(min, value)
  return max === undefined ? lower : Math.min(max, lower)
}

/**
 * A number field with a button on each side to step it.
 *
 * Exists because a bare `type="number"` is miserable to correct on a phone.
 * Changing 1 to 2 in a field that will not go below 1 means placing the caret
 * before the digit, typing, then placing it after and deleting — with the
 * on-screen keyboard covering the field throughout. Two buttons make the common
 * edit one tap, and they carry the repo's `max-md:size-11` touch floor.
 *
 * The field stays typable for the uncommon edit: reaching 12 by tapping ten
 * times would be worse than typing it.
 *
 * While the field is being edited its text is held locally rather than rewritten
 * from `value` on every keystroke. Clamping mid-typing is what makes these
 * fields fight back — clear the box and it refills with the minimum before the
 * next digit lands, so the old value can never be removed first. Nothing is
 * committed until the text parses to a value inside the bounds, and on blur the
 * box falls back to whatever was last committed, which is always valid.
 */
const NumberStepper = React.memo(function NumberStepper({
  id,
  value,
  onValueChange,
  min = 0,
  max,
  step = 1,
  disabled = false,
  decrementLabel,
  incrementLabel,
  onBlur,
  className,
  ...aria
}: NumberStepperProps): React.ReactElement {
  // `null` means "show the committed value". A string means the field is being
  // edited and that text is what the reader typed, untouched.
  const [draft, setDraft] = React.useState<string | null>(null)

  const commit = React.useCallback(
    (next: number) => {
      setDraft(null)
      onValueChange(clamp(next, min, max))
    },
    [max, min, onValueChange],
  )

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value
      setDraft(raw)

      const parsed = Number.parseInt(raw, 10)
      if (
        Number.isInteger(parsed) &&
        parsed >= min &&
        (max === undefined || parsed <= max)
      ) {
        onValueChange(parsed)
      }
    },
    [max, min, onValueChange],
  )

  const handleBlur = React.useCallback(() => {
    setDraft(null)
    onBlur?.()
  }, [onBlur])

  const handleDecrement = React.useCallback(() => {
    commit(value - step)
  }, [commit, step, value])

  const handleIncrement = React.useCallback(() => {
    commit(value + step)
  }, [commit, step, value])

  const atMin = value <= min
  const atMax = max !== undefined && value >= max

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={handleDecrement}
        disabled={disabled || atMin}
        aria-label={decrementLabel}
      >
        <Minus aria-hidden="true" />
      </Button>

      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={draft ?? String(value)}
        onChange={handleChange}
        onBlur={handleBlur}
        disabled={disabled}
        className={cn('w-20 text-center', className)}
        {...aria}
      />

      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={handleIncrement}
        disabled={disabled || atMax}
        aria-label={incrementLabel}
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  )
})

export { NumberStepper }
