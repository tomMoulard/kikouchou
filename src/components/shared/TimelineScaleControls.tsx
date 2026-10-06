/**
 * @fileoverview The timeline's zoom control: how much time one column covers,
 * and the way back to the present moment.
 *
 * @module components/shared/TimelineScaleControls
 */

import { type ReactElement, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TIMELINE_SCALE_IDS, type TimelineScaleId } from '@/lib/utils/timeline-scale';

// ============================================================================
// Constants
// ============================================================================

/**
 * What each scale is called when its translation is missing.
 *
 * The dropdown is the only place the reader learns what a column means, so a
 * missing key must not leave them choosing between six raw identifiers.
 */
const SCALE_FALLBACK_LABELS: Readonly<Record<TimelineScaleId, string>> = {
  hours: 'Hours (15 min)',
  day: 'Day (1 hour)',
  week: 'Week (1 day)',
  month: 'Trip (1 day)',
  year: 'Year (1 week)',
  fiveYears: '5 years (1 month)',
};

// ============================================================================
// Types
// ============================================================================

export interface TimelineScaleControlsProps {
  readonly value: TimelineScaleId;
  readonly onChange: (scale: TimelineScaleId) => void;
  /**
   * Sends the axis back to the present moment.
   *
   * Both halves of the job belong to the caller: the window a scale shows is
   * anchored on a date it owns, and the frame only re-centres when it is asked
   * to. The button here is the ask.
   */
  readonly onNow: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Renders the scale dropdown and the "now" button for a timeline.
 *
 * @param props - Current scale, the change handler, and the jump-to-now handler
 * @returns The control group, for a frame's `toolbar` slot
 *
 * @example
 * ```tsx
 * <TimelineScaleControls value={scale} onChange={setScale} onNow={goToNow} />
 * ```
 */
const TimelineScaleControls = memo(function TimelineScaleControls({
  value,
  onChange,
  onNow,
}: TimelineScaleControlsProps): ReactElement {
  const { t } = useTranslation();

  const handleValueChange = useCallback(
    (next: string) => {
      // Radix hands back a plain string; only the ids the list offers are ours.
      if ((TIMELINE_SCALE_IDS as readonly string[]).includes(next)) {
        onChange(next as TimelineScaleId);
      }
    },
    [onChange],
  );

  return (
    <>
      <Select value={value} onValueChange={handleValueChange}>
        <SelectTrigger
          className="h-8 w-[11rem]"
          aria-label={t('common.timelineScale', 'Timeline scale')}
          data-testid="timeline-scale-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TIMELINE_SCALE_IDS.map((scale) => (
            <SelectItem key={scale} value={scale}>
              {t(`common.timelineScales.${scale}`, SCALE_FALLBACK_LABELS[scale])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        onClick={onNow}
        data-testid="timeline-now-button"
      >
        <Crosshair className="size-4" aria-hidden="true" />
        {t('common.now', 'Now')}
      </Button>
    </>
  );
});

export { TimelineScaleControls };
