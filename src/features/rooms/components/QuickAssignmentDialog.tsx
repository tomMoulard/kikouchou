/**
 * @fileoverview QuickAssignmentDialog for drag-and-drop room assignments.
 * A simplified dialog that opens when a guest is dropped on a room.
 *
 * @module features/rooms/components/QuickAssignmentDialog
 */

import {
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useFormSubmission } from '@/hooks';
import { parseISO } from 'date-fns';

import { AlertTriangle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { type DateRange, DateRangePicker } from '@/components/shared/DateRangePicker';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { useTripContext } from '@/contexts/TripContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { toISODateString } from '@/lib/db/utils';
import type {
  ISODateString,
  Person,
  RoomAssignmentFormData,
  RoomId,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the QuickAssignmentDialog component.
 */
export interface QuickAssignmentDialogProps {
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback to change open state */
  readonly onOpenChange: (open: boolean) => void;
  /** The person being assigned (from drag) */
  readonly person: Person | null;
  /** The target room (from drop) */
  readonly roomId: RoomId | null;
  /** Pre-filled start date (from unassigned dates) */
  readonly suggestedStartDate?: string;
  /** Pre-filled end date (from unassigned dates) */
  readonly suggestedEndDate?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * QuickAssignmentDialog is a streamlined dialog for creating room assignments
 * after a guest is dropped on a room via drag-and-drop.
 *
 * The person is pre-selected from the drag operation, and dates are
 * pre-filled from the guest's unassigned dates.
 *
 * @example
 * ```tsx
 * <QuickAssignmentDialog
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   person={draggedPerson}
 *   roomId={droppedRoomId}
 *   suggestedStartDate="2026-01-05"
 *   suggestedEndDate="2026-01-10"
 * />
 * ```
 */
const QuickAssignmentDialog = memo(function QuickAssignmentDialog(props: QuickAssignmentDialogProps): ReactElement | null {
  const {
    open,
    onOpenChange,
    person,
    roomId,
    suggestedStartDate,
    suggestedEndDate,
  } = props;

  const { t } = useTranslation();
  const { currentTrip } = useTripContext();
  const { rooms } = useRoomContext();
  const { createAssignment, checkConflict, getAssignmentsByRoom } = useAssignmentContext();

  // Form state
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [conflictError, setConflictError] = useState<string | undefined>(undefined);
  const [isCheckingConflict, setIsCheckingConflict] = useState(false);

  // Refs for async safety (conflict checks still need mount tracking)
  const isMountedRef = useRef(true);

  // Get the target room
  const room = useMemo(
    () => (roomId ? rooms.find((r) => r.id === roomId) : undefined),
    [rooms, roomId],
  );

  // Get trip date constraints
  const tripStartDate = useMemo(
    () => (currentTrip?.startDate ? parseISO(currentTrip.startDate) : undefined),
    [currentTrip?.startDate],
  );

  const tripEndDate = useMemo(
    () => (currentTrip?.endDate ? parseISO(currentTrip.endDate) : undefined),
    [currentTrip?.endDate],
  );

  // Get existing assignments for this room (for booked ranges display)
  const existingAssignments = useMemo(
    () => (roomId ? getAssignmentsByRoom(roomId) : []),
    [roomId, getAssignmentsByRoom],
  );

  const bookedRanges = useMemo(() => {
    if (existingAssignments.length === 0) {
      return undefined;
    }
    return existingAssignments.map((a) => ({
      from: parseISO(a.startDate),
      to: parseISO(a.endDate),
    }));
  }, [existingAssignments]);

  // Initialize form when dialog opens
  useEffect(() => {
    if (open && person && roomId) {
      // Pre-fill dates from suggested dates
      if (suggestedStartDate && suggestedEndDate) {
        setDateRange({
          from: parseISO(suggestedStartDate),
          to: parseISO(suggestedEndDate),
        });
      } else {
        setDateRange(undefined);
      }
      setConflictError(undefined);
      setIsCheckingConflict(false);
    }
  }, [open, person, roomId, suggestedStartDate, suggestedEndDate]);

  // Mount/unmount tracking
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Check for conflicts when dates change
  useEffect(() => {
    if (!person || !dateRange?.from || !dateRange?.to) {
      setConflictError(undefined);
      return;
    }

    const startDate = toISODateString(dateRange.from) as ISODateString;
    const endDate = toISODateString(dateRange.to) as ISODateString;

    let cancelled = false;
    setIsCheckingConflict(true);

    checkConflict(person.id, startDate, endDate)
      .then((hasConflict) => {
        if (!cancelled && isMountedRef.current) {
          setConflictError(hasConflict ? t('assignments.conflict') : undefined);
        }
      })
      .catch(() => {
        if (!cancelled && isMountedRef.current) {
          setConflictError(undefined);
        }
      })
      .finally(() => {
        if (!cancelled && isMountedRef.current) {
          setIsCheckingConflict(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [person, dateRange, checkConflict, t]);

  // Form validation
  const isFormValid = useMemo(
    () =>
      person !== null &&
      roomId !== null &&
      dateRange?.from !== undefined &&
      dateRange?.to !== undefined &&
      !conflictError,
    [person, roomId, dateRange, conflictError],
  );

  // Submission handler via useFormSubmission hook
  const { isSubmitting, handleSubmit: doSubmit } = useFormSubmission<RoomAssignmentFormData>(
    async (data) => {
      await createAssignment(data);
      if (isMountedRef.current) {
        toast.success(t('assignments.createSuccess', 'Assignment created successfully'));
        onOpenChange(false);
      }
    },
  );

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    if (!isFormValid) return;
    if (!person || !roomId || !dateRange?.from || !dateRange?.to) return;

    const data: RoomAssignmentFormData = {
      roomId,
      personId: person.id,
      startDate: toISODateString(dateRange.from),
      endDate: toISODateString(dateRange.to),
    };

    try {
      await doSubmit(data);
    } catch {
      // Error handled by hook - keep dialog open for retry
    }
  }, [isFormValid, person, roomId, dateRange, doSubmit]);

  // Prevent closing during submission
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (isSubmitting && !newOpen) return;
      onOpenChange(newOpen);
    },
    [isSubmitting, onOpenChange],
  );

  // Don't render if no person or room
  if (!person || !room) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[425px]"
        onPointerDownOutside={(e) => isSubmitting && e.preventDefault()}
        onEscapeKeyDown={(e) => isSubmitting && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {t('assignments.quickAssign', 'Assign to room')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'assignments.quickAssignDescription',
              'Confirm the dates for this room assignment.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Guest display (read-only) */}
          <div className="grid gap-2">
            <Label>{t('assignments.person')}</Label>
            <div className="flex items-center gap-2 p-2 rounded-md border bg-muted/50">
              <PersonBadge person={person} size="default" />
            </div>
          </div>

          {/* Room display (read-only) */}
          <div className="grid gap-2">
            <Label>{t('assignments.room')}</Label>
            <div className="p-2 rounded-md border bg-muted/50 text-sm">
              {room.name}
            </div>
          </div>

          {/* Date range picker */}
          <div className="grid gap-2">
            <Label>{t('assignments.period')}</Label>
            <DateRangePicker
              value={dateRange}
              onChange={setDateRange}
              minDate={tripStartDate}
              maxDate={tripEndDate}
              disabled={isSubmitting}
              aria-label={t('assignments.period')}
              bookedRanges={bookedRanges}
            />
            <p className="text-xs text-muted-foreground">
              {t(
                'assignments.periodHint',
                'Guest stays from check-in night until check-out morning',
              )}
            </p>
          </div>

          {/* Conflict warning */}
          {conflictError && (
            <div
              className="flex items-center gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              <span>{conflictError}</span>
            </div>
          )}

          {/* Checking conflict indicator */}
          {isCheckingConflict && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>{t('assignments.checkingConflict', 'Checking availability...')}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isFormValid || isSubmitting || isCheckingConflict}
          >
            {isSubmitting && (
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
            )}
            {t('common.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { QuickAssignmentDialog };
