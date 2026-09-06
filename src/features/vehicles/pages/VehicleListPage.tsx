/**
 * @fileoverview Vehicle List Page — the cars available to one trip.
 *
 * Route: /trips/:tripId/vehicles
 *
 * A car is entered once here and then picked per ride, so "the rented Espace"
 * is not retyped for every airport run and "which car has the boosters in it"
 * has an answer that survives the week.
 *
 * @module features/vehicles/pages/VehicleListPage
 * @see GuestGroupListPage.tsx for the card/dialog/confirm layout
 * @see ActivityListPage.tsx for the trip-scoping guards
 */

import {
  type MouseEvent,
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Car, Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { PageHeader } from '@/components/shared/PageHeader';
import { VehicleDialog } from '@/features/vehicles/components/VehicleDialog';
import { useOfflineAwareToast } from '@/hooks';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';
import { useTripContext } from '@/contexts/TripContext';
import { cn } from '@/lib/utils';
import { CHILD_SEAT_KINDS } from '@/types';
import type { ChildSeatKind, Person, PersonId, Vehicle, VehicleId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** One `{kind, count}` row of a car's child-restraint tally. */
interface ChildSeatSummary {
  readonly kind: ChildSeatKind;
  readonly count: number;
}

interface VehicleCardProps {
  readonly vehicle: Vehicle;
  /** The guest who owns the car, when they are still on the trip. */
  readonly owner: Person | undefined;
  readonly onEdit: (vehicleId: VehicleId) => void;
  readonly onDelete: (vehicleId: VehicleId) => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Counts a car's restraints per kind, dropping the kinds it does not carry.
 *
 * The stored list holds one entry per seat — two boosters appear twice — so it
 * is tallied before it is rendered rather than printed row by row.
 */
function summariseChildSeats(
  childSeats: readonly ChildSeatKind[] | undefined,
): ChildSeatSummary[] {
  if (!childSeats || childSeats.length === 0) {
    return [];
  }

  return CHILD_SEAT_KINDS.map((kind) => ({
    kind,
    count: childSeats.filter((entry) => entry === kind).length,
  })).filter((summary) => summary.count > 0);
}

// ============================================================================
// VehicleCard Component
// ============================================================================

/**
 * One car, with its owner, its seats and the restraints it carries.
 */
const VehicleCard = memo(function VehicleCard({
  vehicle,
  owner,
  onEdit,
  onDelete,
}: VehicleCardProps): ReactElement {
  const { t } = useTranslation();

  const childSeats = useMemo(
    () => summariseChildSeats(vehicle.childSeats),
    [vehicle.childSeats],
  );

  const handleEdit = useCallback(() => {
    onEdit(vehicle.id);
  }, [onEdit, vehicle.id]);

  const handleDelete = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onDelete(vehicle.id);
    },
    [onDelete, vehicle.id],
  );

  return (
    <Card
      className={cn(
        'transition-colors hover:bg-accent/40',
        'focus-within:ring-2 focus-within:ring-ring',
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <button
          type="button"
          onClick={handleEdit}
          className="flex-1 text-left focus-visible:outline-none"
          aria-label={t('vehicles.editNamed', { name: vehicle.name })}
        >
          <CardTitle className="text-base">{vehicle.name}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {owner ? owner.name : t('vehicles.noOwner')}
          </p>
        </button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleDelete}
          aria-label={t('vehicles.deleteNamed', { name: vehicle.name })}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </CardHeader>

      <CardContent className="flex flex-wrap items-center gap-2">
        {vehicle.isRental === true && (
          <Badge variant="secondary">{t('vehicles.rental')}</Badge>
        )}

        <Badge variant="outline" className="tabular-nums">
          <Car className="size-3" aria-hidden="true" />
          {vehicle.seatCount === undefined
            ? t('vehicles.seatsUnknown')
            : t('vehicles.seatCountBadge', { count: vehicle.seatCount })}
        </Badge>

        {childSeats.map((summary) => (
          <Badge key={summary.kind} variant="outline" className="tabular-nums">
            {t('childSeats.required', {
              count: summary.count,
              kind: t(`childSeats.${summary.kind}`),
            })}
          </Badge>
        ))}

        {vehicle.luggageNotes !== undefined && vehicle.luggageNotes.length > 0 && (
          <p className="w-full text-xs text-muted-foreground">
            {t('vehicles.luggageNotes')}
            {': '}
            {vehicle.luggageNotes}
          </p>
        )}
      </CardContent>
    </Card>
  );
});

// ============================================================================
// Page Component
// ============================================================================

/**
 * Lists the current trip's cars.
 *
 * @returns The page element
 *
 * @example
 * ```tsx
 * { path: '/trips/:tripId/transports/vehicles', element: <VehicleListPage /> }
 * ```
 */
const VehicleListPage = memo(function VehicleListPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tripId: tripIdFromUrl } = useParams<'tripId'>();
  const { successToast } = useOfflineAwareToast();

  const {
    currentTrip,
    isLoading: isTripLoading,
    setCurrentTrip,
  } = useTripContext();
  const { persons, isLoading: isPersonsLoading } = usePersonContext();
  const {
    vehicles,
    isLoading: isVehiclesLoading,
    error: vehiclesError,
    deleteVehicle,
  } = useRideContext();

  const [editingId, setEditingId] = useState<VehicleId | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<VehicleId | null>(null);

  const isLoading = isTripLoading || isPersonsLoading || isVehiclesLoading;

  // Sync URL tripId with context, as every other trip-scoped page does.
  useEffect(() => {
    if (tripIdFromUrl && !isTripLoading && currentTrip?.id !== tripIdFromUrl) {
      setCurrentTrip(tripIdFromUrl).catch((error: unknown) => {
        console.error('Failed to set current trip from URL:', error);
      });
    }
  }, [currentTrip?.id, isTripLoading, setCurrentTrip, tripIdFromUrl]);

  const tripMismatch = useMemo(() => {
    if (!tripIdFromUrl || !currentTrip) {
      return false;
    }
    return tripIdFromUrl !== currentTrip.id;
  }, [currentTrip, tripIdFromUrl]);

  const personsById = useMemo(() => {
    const map = new Map<PersonId, Person>();
    for (const person of persons) {
      map.set(person.id, person);
    }
    return map;
  }, [persons]);

  const editingVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === editingId),
    [editingId, vehicles],
  );

  const pendingDeleteVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === pendingDeleteId),
    [pendingDeleteId, vehicles],
  );

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleCreate = useCallback(() => {
    setEditingId(null);
    setIsDialogOpen(true);
  }, []);

  const handleEdit = useCallback((vehicleId: VehicleId) => {
    setEditingId(vehicleId);
    setIsDialogOpen(true);
  }, []);

  const handleDialogOpenChange = useCallback((open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setEditingId(null);
    }
  }, []);

  const handleRequestDelete = useCallback((vehicleId: VehicleId) => {
    setPendingDeleteId(vehicleId);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDeleteId) {
      return;
    }

    try {
      await deleteVehicle(pendingDeleteId);
      successToast(t('vehicles.deleteSuccess'));
    } catch (error) {
      console.error('Failed to delete vehicle:', error);
      toast.error(t('errors.deleteFailed'));
    } finally {
      setPendingDeleteId(null);
    }
  }, [deleteVehicle, pendingDeleteId, successToast, t]);

  const handleDeleteOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setPendingDeleteId(null);
    }
  }, []);

  // ============================================================================
  // Render: Loading
  // ============================================================================

  if (isLoading) {
    return (
      <div className="container max-w-5xl py-6 md:py-8">
        <PageHeader
          title={t('vehicles.title')}
          backLink={
            tripIdFromUrl ? `/trips/${tripIdFromUrl}/transports` : '/trips'
          }
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
        <PageHeader title={t('vehicles.title')} backLink="/trips" />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <EmptyState
            icon={Car}
            title={t('errors.tripNotFound')}
            description={t('errors.tripNotFoundDescription')}
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

  if (vehiclesError) {
    return (
      <div className="container max-w-5xl py-6 md:py-8">
        <PageHeader
          title={t('vehicles.title')}
          backLink={`/trips/${tripIdFromUrl}/transports`}
        />
        <ErrorDisplay
          error={vehiclesError}
          onRetry={() => window.location.reload()}
          onBack={() => navigate(`/trips/${tripIdFromUrl}/transports`)}
        />
      </div>
    );
  }

  // ============================================================================
  // Render: List
  // ============================================================================

  return (
    <div className="container max-w-5xl py-6 md:py-8">
      <PageHeader
        title={t('vehicles.title')}
        description={t('vehicles.description')}
        backLink={`/trips/${tripIdFromUrl}/transports`}
        action={
          vehicles.length > 0 ? (
            <Button onClick={handleCreate}>
              <Plus className="mr-2 size-4" aria-hidden="true" />
              {t('vehicles.new')}
            </Button>
          ) : undefined
        }
      />

      {vehicles.length === 0 ? (
        <EmptyState
          icon={Car}
          title={t('vehicles.noVehicles')}
          description={t('vehicles.emptyDescription')}
          action={{
            label: t('vehicles.new'),
            onClick: handleCreate,
          }}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {vehicles.map((vehicle) => (
            <li key={vehicle.id}>
              <VehicleCard
                vehicle={vehicle}
                owner={
                  vehicle.ownerId === undefined
                    ? undefined
                    : personsById.get(vehicle.ownerId)
                }
                onEdit={handleEdit}
                onDelete={handleRequestDelete}
              />
            </li>
          ))}
        </ul>
      )}

      <VehicleDialog
        vehicle={editingVehicle}
        open={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
      />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={handleDeleteOpenChange}
        title={t('vehicles.deleteTitle')}
        description={t('vehicles.deleteDescription', {
          name: pendingDeleteVehicle?.name ?? '',
        })}
        confirmLabel={t('common.delete')}
        onConfirm={handleConfirmDelete}
        variant="destructive"
      />
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { VehicleListPage };
export default VehicleListPage;
