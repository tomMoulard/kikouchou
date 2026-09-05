/**
 * @fileoverview Activity List Page — the shared agenda of a trip.
 * Shows every planned outing, event and meal, as a chronological list or a
 * horizontal timeline, and lets guests sign up.
 *
 * Route: /trips/:tripId/activities
 *
 * Features:
 * - List view grouped by day, with a collapsible "past activities" section.
 *   The upcoming/past split is read from `ActivityContext`, never recomputed
 *   here — the page and the context used to answer "is this over?" differently.
 * - Timeline view: one band per category across the trip days
 * - Create / edit / delete via the activity dialog
 * - One-tap join & leave for the guest using this browser
 * - Empty and error states, responsive layout, FAB on mobile
 *
 * @module features/activities/pages/ActivityListPage
 */

import {
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { Locale } from 'date-fns';
import { CalendarDays, ChevronDown, ChevronRight, History, Plus } from 'lucide-react';

import { useOfflineAwareToast } from '@/hooks';
import { useToday } from '@/hooks/useToday';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { ViewSwitcher } from '@/components/ui/view-switcher';
import { useActivityContext } from '@/contexts/ActivityContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTripContext } from '@/contexts/TripContext';
import { toLocalISODateString } from '@/lib/db/utils';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { getTripGuestPersonId } from '@/lib/sharing/guest-identity';
import { cn } from '@/lib/utils';
import type { Activity, ActivityId, ISODateString, Person, PersonId } from '@/types';

import { ActivityCard } from '../components/ActivityCard';
import { ActivityDialog } from '../components/ActivityDialog';
import { ActivityTimeline } from '../components/ActivityTimeline';
import {
  type ActivityDateGroup,
  groupActivitiesByDate,
} from '../utils/activity-utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Which representation of the agenda is on screen.
 */
type ActivityView = 'list' | 'timeline';

/**
 * Props for the ActivityDateGroupSection component.
 */
interface ActivityDateGroupSectionProps {
  readonly group: ActivityDateGroup;
  readonly personsMap: ReadonlyMap<PersonId, Person>;
  readonly currentPersonId?: PersonId;
  readonly dateLocale: Locale;
  readonly isPast?: boolean;
  readonly onEdit: (activityId: ActivityId) => void;
  readonly onDelete: (activityId: ActivityId) => void;
  readonly onToggleParticipation: (activityId: ActivityId, joining: boolean) => void;
}

// ============================================================================
// ActivityDateGroupSection Component
// ============================================================================

/**
 * Renders one day of the agenda with its activities.
 */
const ActivityDateGroupSection = memo(function ActivityDateGroupSection({
  group,
  personsMap,
  currentPersonId,
  dateLocale,
  isPast = false,
  onEdit,
  onDelete,
  onToggleParticipation,
}: ActivityDateGroupSectionProps): ReactElement {
  return (
    <section aria-labelledby={`activity-date-header-${group.dateKey}`}>
      <h2
        id={`activity-date-header-${group.dateKey}`}
        className={cn(
          'mb-3 px-1 text-sm font-semibold uppercase tracking-wide',
          isPast ? 'text-muted-foreground/60' : 'text-muted-foreground',
        )}
      >
        {group.displayDate}
      </h2>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {group.activities.map((activity) => (
          <div key={activity.id} role="listitem">
            <ActivityCard
              activity={activity}
              personsMap={personsMap}
              currentPersonId={currentPersonId}
              dateLocale={dateLocale}
              isPast={isPast}
              onEdit={onEdit}
              onDelete={onDelete}
              onToggleParticipation={onToggleParticipation}
            />
          </div>
        ))}
      </div>
    </section>
  );
});

// ============================================================================
// ActivityListPage Component
// ============================================================================

/**
 * The trip agenda page.
 *
 * @example
 * ```tsx
 * // In router configuration
 * { path: '/trips/:tripId/activities', element: <ActivityListPage /> }
 * ```
 */
const ActivityListPage = memo(function ActivityListPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { tripId: tripIdFromUrl } = useParams<'tripId'>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { successToast } = useOfflineAwareToast();
  const { today } = useToday();

  const { currentTrip, isLoading: isTripLoading, setCurrentTrip } = useTripContext();
  const { persons, isLoading: isPersonsLoading } = usePersonContext();
  const {
    activities,
    upcomingActivities,
    pastActivities,
    isLoading: isActivitiesLoading,
    error: activitiesError,
    deleteActivity,
    setParticipation,
  } = useActivityContext();

  const [activityToDelete, setActivityToDelete] = useState<ActivityId | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingActivityId, setEditingActivityId] = useState<ActivityId | undefined>(
    undefined,
  );
  const [isPastExpanded, setIsPastExpanded] = useState(false);

  const isLoading = isTripLoading || isPersonsLoading || isActivitiesLoading;
  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  const currentView: ActivityView = useMemo(
    () => (searchParams.get('view') === 'list' ? 'list' : 'timeline'),
    [searchParams],
  );

  const handleViewChange = useCallback(
    (nextValue: string) => {
      const nextView: ActivityView = nextValue === 'list' ? 'list' : 'timeline';
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('view', nextView);
        return next;
      });
    },
    [setSearchParams],
  );

  const personsMap = useMemo(() => {
    const map = new Map<PersonId, Person>();
    for (const person of persons) {
      map.set(person.id, person);
    }
    return map;
  }, [persons]);

  /**
   * The guest this browser identified as when opening a share link, if any.
   * Owners of the trip have no stored identity and manage sign-ups in the form.
   */
  const currentPersonId = useMemo(
    () => getTripGuestPersonId(currentTrip),
    [currentTrip],
  );

  /**
   * Day a new activity starts on: today while the trip is running, its first
   * day otherwise. Saves the most common bit of typing.
   */
  const defaultActivityDate = useMemo((): ISODateString | undefined => {
    if (!currentTrip) {
      return undefined;
    }

    const todayKey = toLocalISODateString(today);
    return todayKey >= currentTrip.startDate && todayKey <= currentTrip.endDate
      ? todayKey
      : currentTrip.startDate;
  }, [currentTrip, today]);

  const upcomingDateGroups = useMemo(
    () => groupActivitiesByDate(upcomingActivities, dateLocale),
    [upcomingActivities, dateLocale],
  );

  const pastDateGroups = useMemo(
    () => groupActivitiesByDate(pastActivities, dateLocale).reverse(),
    [pastActivities, dateLocale],
  );

  // Sync URL tripId with context
  useEffect(() => {
    if (tripIdFromUrl && !isTripLoading && currentTrip?.id !== tripIdFromUrl) {
      setCurrentTrip(tripIdFromUrl).catch((err) => {
        console.error('Failed to set current trip from URL:', err);
      });
    }
  }, [tripIdFromUrl, currentTrip?.id, isTripLoading, setCurrentTrip]);

  const tripMismatch = useMemo(() => {
    if (!tripIdFromUrl || !currentTrip) {
      return false;
    }
    return tripIdFromUrl !== currentTrip.id;
  }, [tripIdFromUrl, currentTrip]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleAddActivity = useCallback(() => {
    setEditingActivityId(undefined);
    setIsDialogOpen(true);
  }, []);

  const handleEdit = useCallback((activityId: ActivityId) => {
    setEditingActivityId(activityId);
    setIsDialogOpen(true);
  }, []);

  const handleActivityClick = useCallback(
    (activity: Activity) => {
      handleEdit(activity.id);
    },
    [handleEdit],
  );

  const handleDeleteClick = useCallback((activityId: ActivityId) => {
    setActivityToDelete(activityId);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!activityToDelete) {
      return;
    }

    try {
      await deleteActivity(activityToDelete);
      setActivityToDelete(null);
      successToast(t('activities.deleteSuccess'));
    } catch (error) {
      console.error('Failed to delete activity:', error);
      toast.error(t('errors.deleteFailed', 'Failed to delete'));
      throw error; // Keep the dialog open so the user can retry
    }
  }, [activityToDelete, deleteActivity, t, successToast]);

  const handleCancelDelete = useCallback((open: boolean) => {
    if (!open) {
      setActivityToDelete(null);
    }
  }, []);

  const handleToggleParticipation = useCallback(
    (activityId: ActivityId, joining: boolean) => {
      if (!currentPersonId) {
        return;
      }

      void setParticipation(activityId, currentPersonId, joining)
        .then(() => {
          successToast(joining ? t('activities.joined') : t('activities.left'));
        })
        .catch((error: unknown) => {
          console.error('Failed to update participation:', error);
          toast.error(t('activities.errors.participationFailed'));
        });
    },
    [currentPersonId, setParticipation, successToast, t],
  );

  const handleDialogOpenChange = useCallback((open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setEditingActivityId(undefined);
    }
  }, []);

  const togglePastSection = useCallback(() => {
    setIsPastExpanded((prev) => !prev);
  }, []);

  /**
   * Escape hatch from the timeline when every activity sits outside the trip
   * dates: the list view has no day axis and can still show them all.
   */
  const handleShowAsList = useCallback(() => {
    handleViewChange('list');
  }, [handleViewChange]);

  const headerAction = useMemo(
    () => (
      <div className="hidden sm:flex items-center gap-2">
        <Button onClick={handleAddActivity}>
          <Plus className="size-4 mr-2" aria-hidden="true" />
          {t('activities.new')}
        </Button>
      </div>
    ),
    [handleAddActivity, t],
  );

  // ============================================================================
  // Render: Loading
  // ============================================================================

  if (isLoading) {
    return (
      <div className="container max-w-5xl py-6 md:py-8">
        <PageHeader
          title={t('activities.title')}
          backLink={tripIdFromUrl ? `/trips/${tripIdFromUrl}/calendar` : '/trips'}
        />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <LoadingState variant="inline" size="lg" />
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render: Trip Mismatch or Not Found
  // ============================================================================

  if (!tripIdFromUrl || !currentTrip || tripMismatch) {
    return (
      <div className="container max-w-5xl py-6 md:py-8">
        <PageHeader title={t('activities.title')} backLink="/trips" />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <EmptyState
            icon={CalendarDays}
            title={t('errors.tripNotFound', 'Trip not found')}
            description={t(
              'errors.tripNotFoundDescription',
              'The trip you are looking for does not exist or you do not have access to it.',
            )}
            action={{
              label: t('common.back'),
              onClick: () => navigate('/trips'),
            }}
          />
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render: Error
  // ============================================================================

  if (activitiesError) {
    return (
      <div className="container max-w-5xl py-6 md:py-8">
        <PageHeader
          title={t('activities.title')}
          backLink={`/trips/${tripIdFromUrl}/calendar`}
        />
        <ErrorDisplay
          error={activitiesError}
          onRetry={() => window.location.reload()}
          onBack={() => navigate(`/trips/${tripIdFromUrl}/calendar`)}
        />
      </div>
    );
  }

  // ============================================================================
  // Render: Agenda
  // ============================================================================

  const hasActivities = activities.length > 0;

  return (
    <div className="container max-w-5xl py-6 md:py-8">
      <PageHeader
        title={t('activities.title')}
        description={currentTrip.name}
        backLink={`/trips/${tripIdFromUrl}/calendar`}
        action={headerAction}
      />

      <ViewSwitcher
        className="mb-4"
        value={currentView}
        onValueChange={handleViewChange}
        ariaLabel={t('activities.view.ariaLabel', 'Agenda view')}
        options={[
          { value: 'timeline', label: t('activities.view.timeline') },
          { value: 'list', label: t('activities.view.list') },
        ]}
      />

      {/*
        One empty state for both views: the agenda being empty is the same
        situation whichever tab is open, so it must make the same offer.
      */}
      {!hasActivities ? (
        <div className="flex min-h-[200px] items-center justify-center rounded-lg border">
          <EmptyState
            icon={CalendarDays}
            title={t('activities.empty')}
            description={t('activities.emptyDescription')}
            action={{
              label: t('activities.new'),
              onClick: handleAddActivity,
            }}
          />
        </div>
      ) : currentView === 'timeline' ? (
        <ActivityTimeline
          trip={currentTrip}
          activities={activities}
          dateLocale={dateLocale}
          today={today}
          onActivityClick={handleActivityClick}
          onShowAsList={handleShowAsList}
        />
      ) : (
        <div
          role="list"
          aria-label={t('activities.title')}
          // Bottom clearance is `<main>`'s job (`pb-bottom-stack`), not this
          // list's.
          className="space-y-6"
        >
          {upcomingDateGroups.map((group) => (
            <ActivityDateGroupSection
              key={group.dateKey}
              group={group}
              personsMap={personsMap}
              currentPersonId={currentPersonId}
              dateLocale={dateLocale}
              onEdit={handleEdit}
              onDelete={handleDeleteClick}
              onToggleParticipation={handleToggleParticipation}
            />
          ))}

          {pastActivities.length > 0 && (
            <div className="mt-6 border-t pt-4">
              <button
                type="button"
                onClick={togglePastSection}
                className={cn(
                  'flex w-full items-center gap-2 text-left',
                  'text-sm font-semibold text-muted-foreground',
                  'transition-colors hover:text-foreground',
                  'rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'px-1 py-2',
                )}
                aria-expanded={isPastExpanded}
                aria-controls="past-activities-section"
              >
                {isPastExpanded ? (
                  <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
                )}
                <History className="size-4 shrink-0" aria-hidden="true" />
                <span>
                  {t('activities.pastActivitiesWithCount', {
                    count: pastActivities.length,
                  })}
                </span>
              </button>

              {isPastExpanded && (
                <div id="past-activities-section" className="mt-4 space-y-6">
                  {pastDateGroups.map((group) => (
                    <ActivityDateGroupSection
                      key={group.dateKey}
                      group={group}
                      personsMap={personsMap}
                      currentPersonId={currentPersonId}
                      dateLocale={dateLocale}
                      isPast
                      onEdit={handleEdit}
                      onDelete={handleDeleteClick}
                      onToggleParticipation={handleToggleParticipation}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Floating action button for mobile */}
      <Button
        onClick={handleAddActivity}
        size="lg"
        className={cn(
          'fixed bottom-nav-safe right-4 z-10',
          'size-14 rounded-full shadow-lg',
          'sm:hidden',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
        aria-label={t('activities.new')}
      >
        <Plus className="size-6" aria-hidden="true" />
      </Button>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={activityToDelete !== null}
        onOpenChange={handleCancelDelete}
        title={t('confirm.deleteActivity')}
        description={t('confirm.deleteActivityDescription')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />

      {/* Create / edit dialog */}
      <ActivityDialog
        activityId={editingActivityId}
        open={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
        defaultDate={defaultActivityDate}
      />
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ActivityListPage };
export default ActivityListPage;
