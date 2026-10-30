/**
 * @fileoverview One-tap join/leave button for the guest holding this device.
 *
 * Shared by the agenda card, the activity editor and the calendar's detail
 * dialog, so the three say the same thing and refuse a full activity the same
 * way.
 *
 * @module features/activities/components/ActivityParticipationButton
 */

import { type ReactElement, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { UserMinus, UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { Activity, ActivityId, PersonId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the ActivityParticipationButton component.
 */
export interface ActivityParticipationButtonProps {
  /** The activity to join or leave */
  readonly activity: Activity;
  /** The guest holding this device */
  readonly personId: PersonId;
  /** Called with `true` to join and `false` to leave */
  readonly onToggle: (activityId: ActivityId, joining: boolean) => void;
  /** Whether the button is disabled */
  readonly disabled?: boolean;
  /** Extra classes for the button */
  readonly className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * "Join" when the guest is not signed up, "Leave" when they are, and "Full"
 * (disabled) when the cap is reached. Leaving a full activity stays possible.
 *
 * @param props - Component props
 * @returns The join/leave button
 */
const ActivityParticipationButton = memo(function ActivityParticipationButton({
  activity,
  personId,
  onToggle,
  disabled = false,
  className,
}: ActivityParticipationButtonProps): ReactElement {
  const { t } = useTranslation();

  const participantIds = activity.participantIds ?? [];
  const isJoined = participantIds.includes(personId);
  const cap = activity.maxParticipants;
  const isFull = cap !== undefined && participantIds.length >= cap;

  const handleClick = useCallback(() => {
    onToggle(activity.id, !isJoined);
  }, [activity.id, isJoined, onToggle]);

  return (
    <Button
      type="button"
      variant={isJoined ? 'outline' : 'default'}
      size="sm"
      className={className}
      onClick={handleClick}
      disabled={disabled || (!isJoined && isFull)}
    >
      {isJoined ? (
        <>
          <UserMinus className="size-4 mr-2" aria-hidden="true" />
          {t('activities.leave')}
        </>
      ) : (
        <>
          <UserPlus className="size-4 mr-2" aria-hidden="true" />
          {isFull ? t('activities.full') : t('activities.join')}
        </>
      )}
    </Button>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ActivityParticipationButton };
