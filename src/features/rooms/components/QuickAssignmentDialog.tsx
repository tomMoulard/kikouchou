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
import { useFormSubmission, useOfflineAwareToast } from '@/hooks';
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
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { statusVariants } from '@/components/ui/status.variants';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { type DateRange, DateRangePicker } from '@/components/shared/DateRangePicker';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTripContext } from '@/contexts/TripContext';
import { useRoomContext } from '@/contexts/RoomContext';
import {
  calculatePeakOccupancy,
  createHeadcountResolver,
} from '@/features/rooms/utils/capacity-utils';
import { cn } from '@/lib/utils';
import { toLocalISODateString } from '@/lib/db/utils';
import type {
  ISODateString,
  Person,
  PersonId,
  RoomAssignmentFormData,
  RoomId,
} from '@/types';
import { getPersonHeadcount } from '@/types';

// Utility functions (isDateInStayRange, calculatePeakOccupancy) imported from capacity-utils

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
  const { successToast } = useOfflineAwareToast();
  const { currentTrip } = useTripContext();
  const { rooms } = useRoomContext();
  const { persons } = usePersonContext();
  const { createAssignment, checkConflict, getAssignmentsByRoom } = useAssignmentContext();

  // Form state
  const [selectedPersonId, setSelectedPersonId] = useState<PersonId | ''>('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [conflictError, setConflictError] = useState<string | undefined>(undefined);
  const [isCheckingConflict, setIsCheckingConflict] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Refs for async safety (conflict checks still need mount tracking)
  const isMountedRef = useRef(true);

  // Get the target room
  const room = useMemo(
    () => (roomId ? rooms.find((r) => r.id === roomId) : undefined),
    [rooms, roomId],
  );

  // Get trip date constraints
  const tripStartDateStr = currentTrip?.startDate;
  const tripStartDate = useMemo(
    () => (tripStartDateStr ? parseISO(tripStartDateStr) : undefined),
    [tripStartDateStr],
  );

  const tripEndDateStr = currentTrip?.endDate;
  const tripEndDate = useMemo(
    () => (tripEndDateStr ? parseISO(tripEndDateStr) : undefined),
    [tripEndDateStr],
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

  // The effective person: either pre-selected (drag-drop) or chosen (claim flow)
  const effectivePerson = useMemo(() => {
    if (person) {return person;}
    if (selectedPersonId) {
      return persons.find((p) => p.id === selectedPersonId) ?? null;
    }
    return null;
  }, [person, selectedPersonId, persons]);

  // State-based sync: initialize form when dialog opens (render-time, no effect needed)
  const [prevInitKey, setPrevInitKey] = useState<string | null>(null);
  const initKey = open && roomId ? `${roomId}-${person?.id ?? ''}-${suggestedStartDate ?? ''}-${suggestedEndDate ?? ''}` : null;
  if (initKey !== null && prevInitKey !== initKey) {
    setPrevInitKey(initKey);
    // Pre-fill person if provided (drag-drop flow)
    if (person) {
      setSelectedPersonId(person.id);
    } else {
      setSelectedPersonId('');
    }
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
    setShowDiscardConfirm(false);
  }
  if (!open && prevInitKey !== null) {
    setPrevInitKey(null);
  }

  // Mount/unmount tracking
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Compute dirty state: has user changed anything from the pre-filled values?
  const isDirty = useMemo(() => {
    // Person changed from pre-filled (drag-drop flow) or selected in claim flow
    const initialPersonId = person?.id ?? '';
    if (selectedPersonId !== initialPersonId) {return true;}

    // Date range changed from suggested dates
    if (suggestedStartDate && suggestedEndDate) {
      const suggestedFrom = parseISO(suggestedStartDate);
      const suggestedTo = parseISO(suggestedEndDate);
      if (
        dateRange?.from?.getTime() !== suggestedFrom.getTime() ||
        dateRange?.to?.getTime() !== suggestedTo.getTime()
      ) {
        return true;
      }
    } else if (dateRange?.from || dateRange?.to) {
      // No suggested dates but user selected some
      return true;
    }

    return false;
  }, [selectedPersonId, dateRange, person, suggestedStartDate, suggestedEndDate]);

  // Compute capacity warning synchronously (derived state, no effect needed)
  const computedCapacityWarning = useMemo(() => {
    if (!effectivePerson || !dateRange?.from || !dateRange?.to) return undefined;
    if (!roomId || !room) return undefined;
    const startDate = toLocalISODateString(dateRange.from) as ISODateString;
    const endDate = toLocalISODateString(dateRange.to) as ISODateString;
    const roomAssignments = getAssignmentsByRoom(roomId);
    const headcountOf = createHeadcountResolver(persons);
    const peak = calculatePeakOccupancy(roomAssignments, startDate, endDate, headcountOf);
    // The guest being added may itself stand for several people.
    const incoming = getPersonHeadcount(effectivePerson);
    return peak + incoming > room.capacity ? t('rooms.capacityWarning') : undefined;
  }, [effectivePerson, dateRange, roomId, room, getAssignmentsByRoom, persons, t]);

  // Clear conflict error when inputs become invalid (render-time)
  const hasValidConflictInputs = Boolean(effectivePerson && dateRange?.from && dateRange?.to);
  const [prevHadValidInputs, setPrevHadValidInputs] = useState(false);
  if (!hasValidConflictInputs && prevHadValidInputs) {
    setPrevHadValidInputs(false);
    setConflictError(undefined);
  }
  if (hasValidConflictInputs && !prevHadValidInputs) {
    setPrevHadValidInputs(true);
  }

  // Check for conflicts asynchronously when person/dates change
  useEffect(() => {
    if (!effectivePerson || !dateRange?.from || !dateRange?.to) {
      return;
    }

    const startDate = toLocalISODateString(dateRange.from) as ISODateString;
    const endDate = toLocalISODateString(dateRange.to) as ISODateString;

    let cancelled = false;
    setIsCheckingConflict(true);

    checkConflict(effectivePerson.id, startDate, endDate)
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
  }, [effectivePerson, dateRange, checkConflict, t]);

  // Form validation
  const isFormValid = useMemo(
    () =>
      effectivePerson !== null &&
      roomId !== null &&
      dateRange?.from !== undefined &&
      dateRange?.to !== undefined &&
      !conflictError,
    [effectivePerson, roomId, dateRange, conflictError],
  );

  // Submission handler via useFormSubmission hook
  const { isSubmitting, handleSubmit: doSubmit } = useFormSubmission<RoomAssignmentFormData>(
    async (data) => {
      await createAssignment(data);
      if (isMountedRef.current) {
        successToast(t('assignments.createSuccess', 'Assignment created successfully'));
        onOpenChange(false);
      }
    },
  );

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    if (!isFormValid) return;
    if (!effectivePerson || !roomId || !dateRange?.from || !dateRange?.to) return;

    const data: RoomAssignmentFormData = {
      roomId,
      personId: effectivePerson.id,
      startDate: toLocalISODateString(dateRange.from),
      endDate: toLocalISODateString(dateRange.to),
    };

    try {
      await doSubmit(data);
    } catch {
      // Error handled by hook - keep dialog open for retry
    }
  }, [isFormValid, effectivePerson, roomId, dateRange, doSubmit]);

  // Prevent closing during submission and guard dirty state
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (isSubmitting && !newOpen) return;
      if (!newOpen && isDirty) {
        setShowDiscardConfirm(true);
        return;
      }
      onOpenChange(newOpen);
    },
    [isSubmitting, isDirty, onOpenChange],
  );

  /**
   * Handles discard confirmation — user chose to discard changes.
   */
  const handleDiscardConfirm = useCallback(() => {
    setShowDiscardConfirm(false);
    onOpenChange(false);
  }, [onOpenChange]);

  /**
   * Handles discard cancel — user chose to keep editing.
   */
  const handleDiscardCancel = useCallback((newOpen: boolean) => {
    if (!newOpen) {
      setShowDiscardConfirm(false);
    }
  }, []);

  // Don't render if no room
  if (!room) {
    return null;
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="sm:max-w-[425px]"
          onPointerDownOutside={(e) => isSubmitting && e.preventDefault()}
          onEscapeKeyDown={(e) => isSubmitting && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {person
                ? t('assignments.quickAssign', 'Assign to room')
                : t('rooms.claimRoom')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'assignments.quickAssignDescription',
                'Confirm the dates for this room assignment.',
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Guest display: read-only if pre-selected (drag-drop), selector if claim flow */}
            {person ? (
              <div className="grid gap-2">
                <Label>{t('assignments.person')}</Label>
                <div className="flex items-center gap-2 p-2 rounded-md border bg-muted/50">
                  <PersonBadge person={person} size="default" />
                </div>
              </div>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="claim-person-select">{t('assignments.person')}</Label>
                <Select
                  value={selectedPersonId}
                  onValueChange={(value) => setSelectedPersonId(value as PersonId)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger
                    id="claim-person-select"
                    className="w-full"
                    aria-label={t('assignments.person')}
                  >
                    <SelectValue placeholder={t('assignments.selectPerson', 'Select a guest')} />
                  </SelectTrigger>
                  <SelectContent>
                    {persons.length === 0 ? (
                      <div className="p-2 text-sm text-muted-foreground text-center">
                        {t('persons.empty')}
                      </div>
                    ) : (
                      persons.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <div className="flex items-center gap-2">
                            <div
                              className="size-3 rounded-full shrink-0"
                              style={{ backgroundColor: p.color }}
                              aria-hidden="true"
                            />
                            {p.name}
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

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

            {/* Capacity warning */}
            {computedCapacityWarning && (
              <div
                className={cn(
                  statusVariants({ tone: 'warning' }),
                  'flex items-center gap-2 rounded-md border-warning p-3 text-sm',
                )}
                role="alert"
              >
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                <span>{computedCapacityWarning}</span>
              </div>
            )}

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
                <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
                <span>{t('assignments.checkingConflict', 'Checking availability...')}</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!isFormValid || isSubmitting || isCheckingConflict}
            >
              {isSubmitting && (
                <Loader2 className="mr-2 size-4 motion-safe:animate-spin" aria-hidden="true" />
              )}
              {t('common.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discard changes confirmation */}
      <ConfirmDialog
        open={showDiscardConfirm}
        onOpenChange={handleDiscardCancel}
        title={t('unsaved.discardChanges')}
        description={t('unsaved.discardDescription')}
        confirmLabel={t('unsaved.discard')}
        cancelLabel={t('unsaved.keepEditing')}
        onConfirm={handleDiscardConfirm}
        variant="default"
      />
    </>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { QuickAssignmentDialog };
