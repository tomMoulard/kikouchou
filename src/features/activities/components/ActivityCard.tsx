/**
 * @fileoverview Card showing one activity in the agenda list.
 *
 * @module features/activities/components/ActivityCard
 */

import { type ReactElement, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale } from 'date-fns/locale';
import {
  CalendarClock,
  Edit,
  MapPin,
  MoreVertical,
  Trash2,
  UserPlus,
  UserMinus,
  Users,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { statusVariants } from '@/components/ui/status.variants';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ActivityCategoryIcon } from '@/components/shared/ActivityCategoryIcon';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { cn } from '@/lib/utils';
import { getActivityCategoryColor } from '@/types';
import type { Activity, ActivityId, Person, PersonId } from '@/types';

import { formatActivityTimeRange } from '../utils/activity-utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the ActivityCard component.
 */
export interface ActivityCardProps {
  /** The activity to display */
  readonly activity: Activity;
  /** Lookup of trip guests by ID, for organizer and participant badges */
  readonly personsMap: ReadonlyMap<PersonId, Person>;
  /**
   * The guest using this browser, when known (set after joining through a
   * share link). Enables the one-tap join/leave button.
   */
  readonly currentPersonId?: PersonId;
  /** Date locale for time formatting */
  readonly dateLocale: Locale;
  /** Whether this activity is already over */
  readonly isPast?: boolean;
  /** Callback when edit is chosen */
  readonly onEdit: (activityId: ActivityId) => void;
  /** Callback when delete is chosen */
  readonly onDelete: (activityId: ActivityId) => void;
  /** Callback when the current guest joins or leaves */
  readonly onToggleParticipation?: (activityId: ActivityId, joining: boolean) => void;
  /** Whether actions are disabled */
  readonly isActionsDisabled?: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * A single activity in the agenda: what, when, where, and who is coming.
 *
 * @param props - Component props
 * @returns The activity card element
 */
const ActivityCard = memo(function ActivityCard({
  activity,
  personsMap,
  currentPersonId,
  dateLocale,
  isPast = false,
  onEdit,
  onDelete,
  onToggleParticipation,
  isActionsDisabled = false,
}: ActivityCardProps): ReactElement {
  const { t } = useTranslation();

  const categoryColor = getActivityCategoryColor(activity.category);
  const timeRange = formatActivityTimeRange(activity, dateLocale);

  const participants = useMemo(
    () =>
      (activity.participantIds ?? [])
        .map((personId) => personsMap.get(personId))
        .filter((person): person is Person => person !== undefined),
    [activity.participantIds, personsMap],
  );

  const organizer = activity.organizerId
    ? personsMap.get(activity.organizerId)
    : undefined;

  const participantCount = activity.participantIds?.length ?? 0;
  const cap = activity.maxParticipants;
  const isFull = cap !== undefined && participantCount >= cap;
  const isJoined = currentPersonId
    ? (activity.participantIds ?? []).includes(currentPersonId)
    : false;
  const canToggleParticipation = Boolean(currentPersonId && onToggleParticipation);

  const handleEdit = useCallback(() => {
    onEdit(activity.id);
  }, [activity.id, onEdit]);

  const handleDelete = useCallback(() => {
    onDelete(activity.id);
  }, [activity.id, onDelete]);

  const handleToggleParticipation = useCallback(() => {
    onToggleParticipation?.(activity.id, !isJoined);
  }, [activity.id, isJoined, onToggleParticipation]);

  /**
   * How many people are coming, said the same way on screen and to a screen
   * reader. The capped form used to be a bare `3/5` template string, which no
   * translator could reach and which read as a fraction out of context.
   */
  const participantLabel = useMemo(
    () =>
      cap === undefined
        ? t('activities.participantCount', {
            count: participantCount,
            defaultValue_one: '{{count}} participant',
            defaultValue_other: '{{count}} participants',
          })
        : t('activities.participantCountCapped', {
            count: participantCount,
            max: cap,
            defaultValue_one: '{{count}}/{{max}} participant',
            defaultValue_other: '{{count}}/{{max}} participants',
          }),
    [cap, participantCount, t],
  );

  const ariaLabel = useMemo(() => {
    const parts = [
      activity.title,
      t(`activities.categories.${activity.category}`),
      activity.allDay ? t('activities.allDay') : timeRange,
      activity.location,
      participantLabel,
    ];
    return parts.filter(Boolean).join(', ');
  }, [activity, participantLabel, t, timeRange]);

  return (
    <Card
      role="article"
      aria-label={ariaLabel}
      className={cn(
        'relative overflow-hidden transition-all duration-200',
        'hover:shadow-md hover:border-primary/20',
        isPast && 'opacity-60',
      )}
    >
      {/* Category colour spine */}
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: categoryColor }}
        aria-hidden="true"
      />

      <CardHeader className="pb-2 pl-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <ActivityCategoryIcon
              category={activity.category}
              className="mt-0.5 size-5"
              style={{ color: categoryColor }}
            />
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-medium" title={activity.title}>
                {activity.title}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t(`activities.categories.${activity.category}`)}
              </p>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 md:size-8"
                disabled={isActionsDisabled}
                aria-label={t('common.actions', 'Actions')}
              >
                <MoreVertical className="size-5 md:size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleEdit}>
                <Edit className="size-4" aria-hidden="true" />
                {t('common.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={handleDelete}>
                <Trash2 className="size-4" aria-hidden="true" />
                {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="space-y-2 pl-5 pt-0">
        {/* When */}
        <div className="flex items-center gap-2 text-sm">
          <CalendarClock
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="font-medium">
            {activity.allDay ? t('activities.allDay') : timeRange}
          </span>
        </div>

        {/* Where */}
        {activity.location && (
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate" title={activity.location}>
              {activity.location}
            </span>
          </div>
        )}

        {/* Who */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm text-muted-foreground">{participantLabel}</span>
          {isFull && (
            <Badge variant="outline" className={statusVariants({ tone: 'warning', emphasis: 'outline' })}>
              {t('activities.full')}
            </Badge>
          )}
          {participants.map((person) => (
            <PersonBadge
              key={person.id}
              person={person}
              size="sm"
              className={
                organizer && person.id === organizer.id ? 'ring-1 ring-primary' : undefined
              }
            />
          ))}
        </div>

        {organizer && (
          <p className="text-xs text-muted-foreground">
            {t('activities.organizedBy', 'Organized by {{name}}', {
              name: organizer.name,
            })}
          </p>
        )}

        {/* Notes */}
        {activity.notes && (
          <p className="line-clamp-2 text-sm italic text-muted-foreground">
            {activity.notes}
          </p>
        )}

        {/* Join / leave */}
        {canToggleParticipation && (
          <Button
            type="button"
            variant={isJoined ? 'outline' : 'default'}
            size="sm"
            className="w-full sm:w-auto"
            onClick={handleToggleParticipation}
            disabled={isActionsDisabled || (!isJoined && isFull)}
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
        )}
      </CardContent>
    </Card>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ActivityCard };
