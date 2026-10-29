/**
 * @fileoverview The meal planner: a lunch and a dinner for every day of the
 * trip, and the group's shopping list.
 *
 * Route: `/trips/:tripId/meals`
 *
 * Two views, because they are used in two places:
 *
 * - **Meals**, planned on the sofa: each day lists its lunch and its dinner,
 *   who is in charge, what is on the menu, how many people eat and what they
 *   cannot eat. A slot nobody filled shows as an invitation to fill it.
 * - **Shopping list**, used in the shop: one checklist for the trip.
 *
 * The page sits behind the `meal-planner` flag. While PostHog answers it
 * waits, and when the answer is no it sends the visitor to the calendar, so a
 * bookmarked link never lands on a page the navigation does not offer.
 *
 * @module features/meals/pages/MealPlannerPage
 */

import { type ReactElement, memo, useCallback, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { ChefHat, Sandwich, Store, Users, UtensilsCrossed } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ViewSwitcher } from '@/components/ui/view-switcher';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { PageHeader } from '@/components/shared/PageHeader';
import { MealDialog } from '@/features/meals/components/MealDialog';
import { MealDietSummary } from '@/features/meals/components/MealDietSummary';
import { ShoppingList } from '@/features/meals/components/ShoppingList';
import {
  buildMealAttendance,
  type MealAttendance,
  type MealPresenceSource,
} from '@/features/meals/utils/meal-headcount';
import { TripNotOnDeviceState } from '@/features/trips/components/TripNotOnDeviceState';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { useToday } from '@/hooks/useToday';
import { useTripAccess } from '@/hooks/useTripAccess';
import { useTripFromUrl } from '@/hooks/useTripFromUrl';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { useMealContext } from '@/contexts/MealContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';
import { toLocalISODateString } from '@/lib/db/utils';
import { MEAL_PLANNER_FLAG } from '@/lib/flags';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import { buildDayColumnsCovering, parseLocalDayKey, toDayKeys } from '@/lib/utils/trip-days';
import { MEAL_SLOTS } from '@/types';
import type { ISODateString, Meal, MealKind, MealSlot, Person, PersonId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** Which list is on screen. */
type MealView = 'meals' | 'shopping';

/** The views, in the order the switcher offers them. */
const MEAL_VIEWS: readonly MealView[] = ['meals', 'shopping'];

/** Query parameter carrying the view, so a reload and a back button keep it. */
const VIEW_PARAM = 'view';

/** The slot the dialog is open on. */
interface OpenSlot {
  readonly date: ISODateString;
  readonly slot: MealSlot;
  /** The stored meal, when the row that opened the dialog had one. */
  readonly mealId?: Meal['id'];
}

interface MealSlotRowProps {
  readonly date: ISODateString;
  readonly slot: MealSlot;
  readonly dayLabel: string;
  readonly meal: Meal | undefined;
  readonly attendance: MealAttendance;
  readonly personsById: ReadonlyMap<PersonId, Person>;
  readonly canEdit: boolean;
  readonly onOpen: (slot: OpenSlot) => void;
}

// ============================================================================
// Constants
// ============================================================================

/** The icon of each kind of meal. */
const KIND_ICONS: Readonly<Record<MealKind, typeof ChefHat>> = {
  home: ChefHat,
  restaurant: Store,
  picnic: Sandwich,
};

// ============================================================================
// Slot Row
// ============================================================================

/**
 * One lunch or dinner: a button that opens the dialog, or a plain row on a
 * read-only trip.
 */
const MealSlotRow = memo(function MealSlotRow({
  date,
  slot,
  dayLabel,
  meal,
  attendance,
  personsById,
  canEdit,
  onOpen,
}: MealSlotRowProps): ReactElement {
  const { t } = useTranslation();
  const slotLabel = t(`meals.slots.${slot}`);
  const people = Math.max(0, attendance.onSite + (meal?.headcountAdjustment ?? 0));
  const organizers = (meal?.organizerIds ?? [])
    .map((id) => personsById.get(id))
    .filter((person): person is Person => person !== undefined);
  const KindIcon = meal ? KIND_ICONS[meal.kind] : UtensilsCrossed;

  const content = (
    <>
      <span className="flex items-center gap-2">
        <KindIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{slotLabel}</span>
        {meal && meal.kind !== 'home' && (
          <span className="text-sm text-muted-foreground">
            {t(`meals.kinds.${meal.kind}`)}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 text-sm text-muted-foreground">
          <Users className="size-3.5" aria-hidden="true" />
          {t('meals.people', { count: people })}
        </span>
      </span>
      {meal?.menu && <span className="block text-sm break-words">{meal.menu}</span>}
      <span
        className={cn(
          'block text-sm',
          organizers.length === 0 ? 'text-muted-foreground italic' : 'text-foreground',
        )}
      >
        {organizers.length === 0
          ? t('meals.unplanned')
          : organizers.map((person) => person.name).join(', ')}
      </span>
      <MealDietSummary attendance={attendance} compact />
    </>
  );

  if (!canEdit) {
    return <div className="space-y-1 rounded-md border px-3 py-2">{content}</div>;
  }

  const lowerSlot = slotLabel.toLocaleLowerCase();
  return (
    <button
      type="button"
      onClick={() => onOpen({ date, slot, ...(meal && { mealId: meal.id }) })}
      aria-label={
        meal
          ? t('meals.open', { slot: lowerSlot, date: dayLabel })
          : t('meals.plan', { slot: lowerSlot, date: dayLabel })
      }
      className={cn(
        'block w-full space-y-1 rounded-md border px-3 py-2 text-left transition-colors',
        'hover:bg-muted/60',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        !meal && 'border-dashed',
      )}
    >
      {content}
    </button>
  );
});

// ============================================================================
// Page
// ============================================================================

const MealPlannerPage = memo(function MealPlannerPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { tripId: tripIdFromUrl } = useParams<'tripId'>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { today } = useToday();
  const flag = useFeatureFlag(MEAL_PLANNER_FLAG);

  const { currentTrip, isLoading: isTripLoading } = useTripContext();
  const { persons, isLoading: isPersonsLoading } = usePersonContext();
  const { assignments } = useAssignmentContext();
  const { arrivals, departures } = useTransportContext();
  const { meals, isLoading: isMealsLoading, error: mealsError } = useMealContext();
  const { canEdit } = useTripAccess();
  const { isTripMissing } = useTripFromUrl(tripIdFromUrl);

  const [openSlot, setOpenSlot] = useState<OpenSlot | null>(null);

  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);
  const todayKey = useMemo(() => toLocalISODateString(today), [today]);

  const tripMismatch =
    tripIdFromUrl !== undefined &&
    currentTrip !== null &&
    currentTrip !== undefined &&
    currentTrip.id !== tripIdFromUrl;

  const rawView = searchParams.get(VIEW_PARAM);
  const currentView: MealView = MEAL_VIEWS.includes(rawView as MealView)
    ? (rawView as MealView)
    : 'meals';

  const handleViewChange = useCallback(
    (value: string): void => {
      const next = new URLSearchParams(searchParams);
      next.set(VIEW_PARAM, value);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const personsById = useMemo(
    () => new Map<PersonId, Person>(persons.map((person) => [person.id, person])),
    [persons],
  );

  const tripStartDate = currentTrip?.startDate;
  const tripEndDate = currentTrip?.endDate;
  const source = useMemo<MealPresenceSource>(
    () => ({
      persons,
      arrivals,
      departures,
      assignments,
      tripWindow: { startDate: tripStartDate, endDate: tripEndDate },
    }),
    [arrivals, assignments, departures, persons, tripEndDate, tripStartDate],
  );

  // The trip's days, widened to reach a meal planned outside them: a meal the
  // group wrote down must not vanish because the trip dates moved.
  const dayKeys = useMemo((): readonly ISODateString[] => {
    if (!tripStartDate || !tripEndDate) {
      return [];
    }
    return toDayKeys(
      buildDayColumnsCovering({
        startKey: tripStartDate,
        endKey: tripEndDate,
        mustInclude: meals.map((meal) => meal.date),
      }),
    );
  }, [tripEndDate, tripStartDate, meals]);

  const mealsBySlot = useMemo(() => {
    const map = new Map<string, Meal[]>();
    for (const meal of meals) {
      const key = `${meal.date}|${meal.slot}`;
      const list = map.get(key);
      if (list) {
        list.push(meal);
      } else {
        map.set(key, [meal]);
      }
    }
    return map;
  }, [meals]);

  const attendanceBySlot = useMemo(() => {
    const map = new Map<string, MealAttendance>();
    for (const dateKey of dayKeys) {
      for (const slot of MEAL_SLOTS) {
        map.set(`${dateKey}|${slot}`, buildMealAttendance(source, dateKey, slot));
      }
    }
    return map;
  }, [dayKeys, source]);

  const formatDay = useCallback(
    (dateKey: ISODateString): string => {
      const date = parseLocalDayKey(dateKey);
      return date ? format(date, 'EEEE d MMMM', { locale: dateLocale }) : dateKey;
    },
    [dateLocale],
  );

  const handleOpen = useCallback((slot: OpenSlot) => setOpenSlot(slot), []);

  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setOpenSlot(null);
    }
  }, []);

  const isLoading = isTripLoading || isPersonsLoading || isMealsLoading || flag === undefined;

  // ==========================================================================
  // Render: Flag Off
  // ==========================================================================

  if (flag === false) {
    return (
      <Navigate to={tripIdFromUrl ? `/trips/${tripIdFromUrl}/calendar` : '/trips'} replace />
    );
  }

  // ==========================================================================
  // Render: Loading
  // ==========================================================================

  if (isLoading) {
    return (
      <div className="container max-w-3xl py-6 md:py-8">
        <PageHeader title={t('meals.title')} />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <LoadingState variant="inline" size="lg" />
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: Trip Mismatch or Not Found
  // ==========================================================================

  if (!tripIdFromUrl || !currentTrip || tripMismatch) {
    return (
      <div className="container max-w-3xl py-6 md:py-8">
        <PageHeader title={t('meals.title')} backLink="/trips" />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          {isTripMissing ? (
            <TripNotOnDeviceState />
          ) : (
            <EmptyState
              icon={UtensilsCrossed}
              title={t('errors.tripNotFound')}
              description={t('errors.tripNotFoundDescription')}
              action={{ label: t('common.back'), onClick: () => navigate('/trips') }}
            />
          )}
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: Error
  // ==========================================================================

  if (mealsError) {
    return (
      <div className="container max-w-3xl py-6 md:py-8">
        <PageHeader title={t('meals.title')} />
        <ErrorDisplay
          error={mealsError}
          onRetry={() => window.location.reload()}
          onBack={() => navigate(`/trips/${tripIdFromUrl}/calendar`)}
        />
      </div>
    );
  }

  // ==========================================================================
  // Render: The Page
  // ==========================================================================

  const openMeal =
    openSlot?.mealId === undefined
      ? undefined
      : meals.find((meal) => meal.id === openSlot.mealId);
  const openAttendance = openSlot
    ? (attendanceBySlot.get(`${openSlot.date}|${openSlot.slot}`) ??
      buildMealAttendance(source, openSlot.date, openSlot.slot))
    : undefined;

  return (
    <div className="container max-w-3xl space-y-6 py-6 md:py-8">
      <PageHeader title={t('meals.title')} description={t('meals.description')} />

      <ViewSwitcher
        value={currentView}
        onValueChange={handleViewChange}
        ariaLabel={t('meals.view.ariaLabel')}
        options={[
          { value: 'meals', label: t('meals.view.meals') },
          { value: 'shopping', label: t('meals.view.shopping') },
        ]}
      />

      {currentView === 'shopping' ? (
        <ShoppingList persons={persons} canEdit={canEdit} />
      ) : dayKeys.length === 0 ? (
        <div className="flex min-h-[200px] items-center justify-center rounded-lg border">
          <EmptyState
            icon={UtensilsCrossed}
            title={t('meals.noDays')}
            description={t('meals.noDaysDescription')}
          />
        </div>
      ) : (
        <ol className="space-y-4" aria-label={t('meals.view.meals')}>
          {dayKeys.map((dateKey) => {
            const dayLabel = formatDay(dateKey);
            const isToday = dateKey === todayKey;
            return (
              <li key={dateKey}>
                <Card className={cn(isToday && 'border-primary')}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base capitalize">
                      {dayLabel}
                      {isToday && (
                        <Badge variant="secondary" className="normal-case">
                          {t('meals.today')}
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {MEAL_SLOTS.map((slot) => {
                      const key = `${dateKey}|${slot}`;
                      const attendance = attendanceBySlot.get(key);
                      if (!attendance) {
                        return null;
                      }
                      const slotMeals = mealsBySlot.get(key) ?? [];
                      // Two members can fill one slot while both offline. Both
                      // rows are shown, so neither plan disappears.
                      const rows: readonly (Meal | undefined)[] =
                        slotMeals.length > 0 ? slotMeals : [undefined];
                      return rows.map((meal) => (
                        <MealSlotRow
                          key={meal?.id ?? key}
                          date={dateKey}
                          slot={slot}
                          dayLabel={dayLabel}
                          meal={meal}
                          attendance={attendance}
                          personsById={personsById}
                          canEdit={canEdit}
                          onOpen={handleOpen}
                        />
                      ));
                    })}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      )}

      {openSlot && openAttendance && (
        <MealDialog
          open
          onOpenChange={handleDialogOpenChange}
          date={openSlot.date}
          slot={openSlot.slot}
          dayLabel={formatDay(openSlot.date)}
          meal={openMeal}
          attendance={openAttendance}
          persons={persons}
        />
      )}
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { MealPlannerPage };
export default MealPlannerPage;
