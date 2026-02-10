/**
 * @fileoverview Room Assignment Section component for managing room assignments.
 * Displays assigned persons with date ranges, supports add/edit/delete operations,
 * and shows conflict warnings.
 *
 * @module features/rooms/components/RoomAssignmentSection
 */

import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useFormSubmission } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { format, isValid, parseISO } from 'date-fns';
import { type Locale, enUS, fr } from 'date-fns/locale';
import {
  AlertTriangle,
  Calendar,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { type DateRange, DateRangePicker } from '@/components/shared/DateRangePicker';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { useTripContext } from '@/contexts/TripContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { calculatePeakOccupancy } from '@/features/rooms/utils/capacity-utils';
import { cn } from '@/lib/utils';
import type {
  ISODateString,
  Person,
  PersonId,
  RoomAssignment,
  RoomAssignmentFormData,
  RoomAssignmentId,
  RoomId,
} from '@/types';
import { toISODateString } from '@/lib/db/utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the RoomAssignmentSection component.
 */
export interface RoomAssignmentSectionProps {
  /** The room ID to display/manage assignments for */
  readonly roomId: RoomId;
  /** Display variant: 'compact' for embedded in RoomCard, 'expanded' for standalone */
  readonly variant?: 'compact' | 'expanded';
  /** Additional CSS classes */
  readonly className?: string;
  /** Callback fired after any assignment CRUD operation */
  readonly onAssignmentChange?: () => void;
}

/**
 * Props for the AssignmentItem subcomponent.
 */
interface AssignmentItemProps {
  readonly assignment: RoomAssignment;
  readonly person: Person | undefined;
  readonly hasConflict: boolean;
  readonly dateLocale: Locale;
  readonly isDisabled: boolean;
  readonly onEdit: (assignment: RoomAssignment) => void;
  readonly onDelete: (assignment: RoomAssignment) => void;
}

/**
 * Transport dates for a person (arrival and departure).
 */
interface PersonTransportDates {
  /** Earliest arrival date (from arrival transports) */
  readonly arrivalDate: Date | undefined;
  /** Latest departure date (from departure transports) */
  readonly departureDate: Date | undefined;
}

/**
 * Props for the AssignmentFormDialog subcomponent.
 */
interface AssignmentFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly roomId: RoomId;
  readonly existingAssignment?: RoomAssignment;
  readonly persons: readonly Person[];
  readonly tripStartDate?: Date;
  readonly tripEndDate?: Date;
  readonly onSubmit: (data: RoomAssignmentFormData) => Promise<void>;
  readonly checkConflict: (
    personId: PersonId,
    startDate: ISODateString,
    endDate: ISODateString,
    excludeId?: RoomAssignmentId,
  ) => Promise<boolean>;
  /** Function to get transport dates for a person (for autofill) */
  readonly getPersonTransportDates?: (personId: PersonId) => PersonTransportDates;
  /** Existing assignments for this room (to show as booked in calendar) */
  readonly existingAssignments?: readonly RoomAssignment[];
  /** Room capacity for capacity check */
  readonly roomCapacity?: number;
}

// Utility functions (isDateInStayRange, calculatePeakOccupancy) imported from capacity-utils

/**
 * Gets the date-fns locale based on the i18n language.
 */
function getDateLocale(language: string): Locale {
  return language === 'fr' ? fr : enUS;
}

/**
 * Formats a date range for display.
 */
function formatDateRange(
  startDate: ISODateString,
  endDate: ISODateString,
  locale: Locale,
): string {
  const start = parseISO(startDate);
  const end = parseISO(endDate);

  if (!isValid(start) || !isValid(end)) {
    return `${startDate} - ${endDate}`;
  }

  const dateFormat = 'PP'; // Localized date format
  const startStr = format(start, dateFormat, { locale });
  const endStr = format(end, dateFormat, { locale });

  // Same day
  if (startDate === endDate) {
    return startStr;
  }

  return `${startStr} - ${endStr}`;
}



// ============================================================================
// AssignmentItem Subcomponent
// ============================================================================

/**
 * Displays a single assignment with person badge, date range, and actions.
 */
const AssignmentItem = memo(function AssignmentItem({
  assignment,
  person,
  hasConflict,
  dateLocale,
  isDisabled,
  onEdit,
  onDelete,
}: AssignmentItemProps): ReactElement {
  const { t } = useTranslation();

  // Event handlers with propagation control
  const handleEditClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onEdit(assignment);
    },
    [onEdit, assignment],
  );

  const handleEditKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onEdit(assignment);
      }
    },
    [onEdit, assignment],
  );

  const handleDeleteClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onDelete(assignment);
    },
    [onDelete, assignment],
  );

  const handleDeleteKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onDelete(assignment);
      }
    },
    [onDelete, assignment],
  );

  const formattedDateRange = useMemo(
    () => formatDateRange(assignment.startDate, assignment.endDate, dateLocale),
    [assignment.startDate, assignment.endDate, dateLocale],
  );

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-md border p-2 transition-colors',
        hasConflict && 'border-destructive bg-destructive/10',
      )}
      role="listitem"
    >
      <div className="flex flex-1 items-center gap-2 min-w-0">
        {/* Person display */}
        {person ? (
          <PersonBadge person={person} size="sm" />
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            {t('common.unknown', 'Unknown')}
          </Badge>
        )}

        {/* Date range */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground truncate">
          <Calendar className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{formattedDateRange}</span>
        </div>

        {/* Conflict warning */}
        {hasConflict && (
          <div
            className="flex items-center gap-1 text-destructive"
            title={t('assignments.conflict')}
          >
            <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
            <span className="sr-only">{t('assignments.conflict')}</span>
          </div>
        )}
      </div>

      {/* Action buttons - min 44px touch targets on mobile */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="size-11 md:size-7"
          disabled={isDisabled}
          onClick={handleEditClick}
          onKeyDown={handleEditKeyDown}
          aria-label={t('common.edit')}
        >
          <Pencil className="size-4 md:size-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 md:size-7 text-destructive hover:text-destructive hover:bg-destructive/10"
          disabled={isDisabled}
          onClick={handleDeleteClick}
          onKeyDown={handleDeleteKeyDown}
          aria-label={t('common.delete')}
        >
          <Trash2 className="size-4 md:size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
});

// ============================================================================
// AssignmentFormDialog Subcomponent
// ============================================================================

/**
 * Dialog for creating or editing a room assignment.
 */
const AssignmentFormDialog = memo(function AssignmentFormDialog({
  open,
  onOpenChange,
  roomId,
  existingAssignment,
  persons,
  tripStartDate,
  tripEndDate,
  onSubmit,
  checkConflict,
  getPersonTransportDates,
  existingAssignments,
  roomCapacity,
}: AssignmentFormDialogProps): ReactElement {
  const { t } = useTranslation();

  // Form state
  const [selectedPersonId, setSelectedPersonId] = useState<PersonId | ''>('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [conflictError, setConflictError] = useState<string | undefined>(undefined);
  const [capacityWarning, setCapacityWarning] = useState<string | undefined>(undefined);
  const [isCheckingConflict, setIsCheckingConflict] = useState(false);
  const [wasAutoFilled, setWasAutoFilled] = useState(false);

  // Refs for async safety (conflict checks still need mount tracking)
  const isMountedRef = useRef(true);

  // Edit mode detection
  const isEditMode = Boolean(existingAssignment);

  // Initialize/reset form when dialog opens or assignment changes
  useEffect(() => {
    if (open) {
      if (existingAssignment) {
        setSelectedPersonId(existingAssignment.personId);
        setDateRange({
          from: parseISO(existingAssignment.startDate),
          to: parseISO(existingAssignment.endDate),
        });
        setWasAutoFilled(false);
      } else {
        setSelectedPersonId('');
        setDateRange(undefined);
        setWasAutoFilled(false);
      }
      setConflictError(undefined);
      setCapacityWarning(undefined);
      setIsCheckingConflict(false); // Reset checking state to prevent stale results
    }
  }, [open, existingAssignment]);

  // Mount/unmount tracking
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Check for conflicts and capacity when person or dates change
  useEffect(() => {
    if (!selectedPersonId || !dateRange?.from || !dateRange?.to) {
      setConflictError(undefined);
      setCapacityWarning(undefined);
      return;
    }

    const startDate = toISODateString(dateRange.from);
    const endDate = toISODateString(dateRange.to);

    // Check capacity (soft enforcement - warning only)
    if (roomCapacity !== undefined && existingAssignments) {
      // Filter out the current assignment being edited (if any)
      const otherAssignments = existingAssignment
        ? existingAssignments.filter((a) => a.id !== existingAssignment.id)
        : existingAssignments;
      const peak = calculatePeakOccupancy(otherAssignments, startDate, endDate);
      // Adding 1 for the proposed assignment
      setCapacityWarning(
        (peak + 1) > roomCapacity ? t('rooms.capacityWarning') : undefined,
      );
    }

    let cancelled = false;
    setIsCheckingConflict(true);

    checkConflict(
      selectedPersonId as PersonId,
      startDate,
      endDate,
      existingAssignment?.id,
    )
      .then((hasConflict) => {
        if (!cancelled && isMountedRef.current) {
          setConflictError(hasConflict ? t('assignments.conflict') : undefined);
        }
      })
      .catch(() => {
        // Silently ignore conflict check errors
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
  }, [selectedPersonId, dateRange, checkConflict, existingAssignment, existingAssignments, roomCapacity, t]);

  // Form validation
  const isFormValid = useMemo(() => (
      selectedPersonId !== '' &&
      dateRange?.from !== undefined &&
      dateRange?.to !== undefined &&
      !conflictError
    ), [selectedPersonId, dateRange, conflictError]);

  // Submission handler via useFormSubmission hook
  const { isSubmitting, handleSubmit: doSubmit } = useFormSubmission<RoomAssignmentFormData>(
    async (data) => {
      await onSubmit(data);
      if (isMountedRef.current) {
        onOpenChange(false);
      }
    },
  );

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    if (!isFormValid) {return;}
    if (!selectedPersonId || !dateRange?.from || !dateRange?.to) {return;}

    const data: RoomAssignmentFormData = {
      roomId,
      personId: selectedPersonId as PersonId,
      startDate: toISODateString(dateRange.from),
      endDate: toISODateString(dateRange.to),
    };

    try {
      await doSubmit(data);
    } catch {
      // Error handling is done by parent - keep dialog open for retry
    }
  }, [isFormValid, selectedPersonId, dateRange, roomId, doSubmit]);

  // Prevent closing during submission
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (isSubmitting && !newOpen) {return;}
      onOpenChange(newOpen);
    },
    [isSubmitting, onOpenChange],
  );

  // Handle person selection with transport dates autofill
  const handlePersonChange = useCallback((value: string) => {
    const personId = value as PersonId | '';
    setSelectedPersonId(personId);

    // Only autofill if:
    // 1. Not in edit mode (editing existing assignment)
    // 2. No dates currently selected
    // 3. A valid person is selected
    // 4. getPersonTransportDates is available
    if (!isEditMode && !dateRange?.from && !dateRange?.to && personId && getPersonTransportDates) {
      const transportDates = getPersonTransportDates(personId);
      
      if (transportDates.arrivalDate || transportDates.departureDate) {
        const newRange: DateRange = {
          from: transportDates.arrivalDate,
          to: transportDates.departureDate,
        };
        setDateRange(newRange);
        setWasAutoFilled(true);
      }
    }
  }, [isEditMode, dateRange, getPersonTransportDates]);

  // Compute booked ranges for the calendar visualization
  // Exclude the current assignment being edited (if any)
  const bookedRanges = useMemo(() => {
    if (!existingAssignments || existingAssignments.length === 0) {
      return undefined;
    }

    return existingAssignments
      .filter((a) => a.id !== existingAssignment?.id) // Exclude the one being edited
      .map((a) => ({
        from: parseISO(a.startDate),
        to: parseISO(a.endDate),
      }));
  }, [existingAssignments, existingAssignment?.id]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[425px] max-h-[90vh] overflow-y-auto"
        onPointerDownOutside={(e) => isSubmitting && e.preventDefault()}
        onEscapeKeyDown={(e) => isSubmitting && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {isEditMode
              ? t('assignments.editAssignment', 'Edit assignment')
              : t('assignments.assign')}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? t('assignments.editDescription', 'Modify the assignment details below.')
              : t('assignments.assignDescription', 'Select a guest and date range for this room.')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Person selector */}
          <div className="grid gap-2">
            <Label htmlFor="person-select">{t('assignments.person')}</Label>
            <Select
              value={selectedPersonId}
              onValueChange={handlePersonChange}
              disabled={isSubmitting}
            >
              <SelectTrigger
                id="person-select"
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
                  persons.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="size-3 rounded-full shrink-0"
                          style={{ backgroundColor: person.color }}
                          aria-hidden="true"
                        />
                        {person.name}
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Date range picker */}
          <div className="grid gap-2">
            <Label>{t('assignments.period')}</Label>
            <DateRangePicker
              value={dateRange}
              onChange={(range) => {
                setDateRange(range);
                // Clear autofill indicator when user manually changes dates
                if (wasAutoFilled) {setWasAutoFilled(false);}
              }}
              minDate={tripStartDate}
              maxDate={tripEndDate}
              disabled={isSubmitting}
              aria-label={t('assignments.period')}
              bookedRanges={bookedRanges}
            />
            {/* Hint about check-in/check-out model */}
            <p className="text-xs text-muted-foreground">
              {wasAutoFilled 
                ? t('assignments.autofilledFromTransport', 'Dates pre-filled from transport schedule')
                : t('assignments.periodHint', 'Guest stays from check-in night until check-out morning')
              }
            </p>
          </div>

          {/* Capacity warning (soft enforcement) */}
          {capacityWarning && (
            <div
              className="flex items-center gap-2 rounded-md border border-amber-500 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-200"
              role="alert"
            >
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              <span>{capacityWarning}</span>
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
            {isEditMode ? t('common.save') : t('common.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

// ============================================================================
// Main Component
// ============================================================================

/**
 * Room Assignment Section component for managing room assignments.
 *
 * Features:
 * - Displays list of assigned persons with date ranges
 * - Add new assignment via modal dialog
 * - Edit existing assignments
 * - Delete assignments with confirmation
 * - Visual conflict warnings
 * - Empty state handling
 * - Loading state handling
 *
 * @example
 * ```tsx
 * <RoomAssignmentSection
 *   roomId={room.id}
 *   variant="compact"
 *   onAssignmentChange={() => console.log('Assignment changed')}
 * />
 * ```
 */
export const RoomAssignmentSection = memo(function RoomAssignmentSection({
  roomId,
  variant = 'compact',
  className,
  onAssignmentChange,
}: RoomAssignmentSectionProps): ReactElement {
  const { t, i18n } = useTranslation();
  const { currentTrip } = useTripContext();
  const { persons, isLoading: isPersonsLoading, getPersonById } = usePersonContext();
  const { rooms } = useRoomContext();
  const {
    getAssignmentsByRoom,
    createAssignment,
    updateAssignment,
    deleteAssignment,
    checkConflict,
    isLoading: isAssignmentsLoading,
  } = useAssignmentContext();
  const { getTransportsByPerson } = useTransportContext();

  // Local state
  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<RoomAssignment | undefined>(
    undefined,
  );
  const [deletingAssignment, setDeletingAssignment] = useState<RoomAssignment | undefined>(
    undefined,
  );
  const [isOperationPending, setIsOperationPending] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Manual isMountedRef is intentionally maintained here (not replaced by useFormSubmission)
  // because handleFormSubmit and handleConfirmDelete manage their own async lifecycle
  // (setIsOperationPending, toast, onAssignmentChange) outside the useFormSubmission pattern.
  // The sub-component AssignmentFormDialog uses useFormSubmission for its own submission.
  const isMountedRef = useRef(true);

  // Mount tracking
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Get date locale
  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  // Get assignments for this room
  const assignments = useMemo(
    () => getAssignmentsByRoom(roomId),
    [getAssignmentsByRoom, roomId],
  );

  // Get trip date constraints
  const tripDates = useMemo(() => {
    if (!currentTrip) {return { start: undefined, end: undefined };}
    return {
      start: parseISO(currentTrip.startDate),
      end: parseISO(currentTrip.endDate),
    };
  }, [currentTrip]);

  // Get transport dates for a person (for autofill in assignment dialog)
  const getPersonTransportDates = useCallback(
    (personId: PersonId): PersonTransportDates => {
      const transports = getTransportsByPerson(personId);
      
      // Find earliest arrival and latest departure
      let arrivalDate: Date | undefined;
      let departureDate: Date | undefined;

      for (const transport of transports) {
        const transportDate = parseISO(transport.datetime);
        if (!isValid(transportDate)) {continue;}

        if (transport.type === 'arrival') {
          if (!arrivalDate || transportDate < arrivalDate) {
            arrivalDate = transportDate;
          }
        } else if (transport.type === 'departure') {
          if (!departureDate || transportDate > departureDate) {
            departureDate = transportDate;
          }
        }
      }

      return { arrivalDate, departureDate };
    },
    [getTransportsByPerson],
  );

  // Get room capacity for capacity checks
  const currentRoom = useMemo(
    () => rooms.find((r) => r.id === roomId),
    [rooms, roomId],
  );

  // Loading state
  const isLoading = isPersonsLoading || isAssignmentsLoading;

  // Combined disabled state
  const isDisabled = isLoading || isOperationPending;

  // Limit displayed items in compact mode (can be expanded)
  const maxVisibleItems = variant === 'compact' && !isExpanded ? 3 : Infinity;
  const visibleAssignments = assignments.slice(0, maxVisibleItems);
  const hiddenCount = Math.max(0, assignments.length - maxVisibleItems);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Opens the add assignment dialog.
   */
  const handleAddClick = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    setEditingAssignment(undefined);
    setIsFormDialogOpen(true);
  }, []);

  /**
   * Expands the list to show all assignments (in compact mode).
   */
  const handleExpandClick = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(true);
  }, []);

  /**
   * Opens the edit dialog for an assignment.
   */
  const handleEditAssignment = useCallback((assignment: RoomAssignment) => {
    setEditingAssignment(assignment);
    setIsFormDialogOpen(true);
  }, []);

  /**
   * Opens the delete confirmation dialog for an assignment.
   */
  const handleDeleteAssignment = useCallback((assignment: RoomAssignment) => {
    setDeletingAssignment(assignment);
  }, []);

  /**
   * Handles form submission (create or update).
   */
  const handleFormSubmit = useCallback(
    async (data: RoomAssignmentFormData) => {
      setIsOperationPending(true);

      try {
        if (editingAssignment) {
          await updateAssignment(editingAssignment.id, data);
          toast.success(t('assignments.updateSuccess'));
        } else {
          await createAssignment(data);
          toast.success(t('assignments.createSuccess'));
        }

        if (isMountedRef.current) {
          onAssignmentChange?.();
        }
      } catch (error) {
        toast.error(t('errors.saveFailed'));
        throw error;
      } finally {
        if (isMountedRef.current) {
          setIsOperationPending(false);
        }
      }
    },
    [editingAssignment, updateAssignment, createAssignment, onAssignmentChange, t],
  );

  /**
   * Handles delete confirmation.
   * Note: Errors are re-thrown to be handled by ConfirmDialog (keeps dialog open for retry).
   */
  const handleConfirmDelete = useCallback(async () => {
    if (!deletingAssignment) {return;}

    setIsOperationPending(true);

    try {
      await deleteAssignment(deletingAssignment.id);
      toast.success(t('assignments.deleteSuccess'));

      if (isMountedRef.current) {
        setDeletingAssignment(undefined);
        onAssignmentChange?.();
      }
    } catch (error) {
      toast.error(t('errors.deleteFailed'));
      // Re-throw to let ConfirmDialog handle error state (keeps dialog open for retry)
      throw error;
    } finally {
      if (isMountedRef.current) {
        setIsOperationPending(false);
      }
    }
  }, [deletingAssignment, deleteAssignment, onAssignmentChange, t]);

  /**
   * Closes the delete confirmation dialog.
   */
  const handleDeleteDialogClose = useCallback((open: boolean) => {
    if (!open) {
      setDeletingAssignment(undefined);
    }
  }, []);

  /**
   * Handles form dialog close.
   */
  const handleFormDialogClose = useCallback((open: boolean) => {
    if (!open) {
      setIsFormDialogOpen(false);
      setEditingAssignment(undefined);
    } else {
      setIsFormDialogOpen(true);
    }
  }, []);

  // ============================================================================
  // Render
  // ============================================================================

  // Loading state
  if (isLoading && assignments.length === 0) {
    return (
      <div
        className={cn('flex items-center justify-center p-4', className)}
        role="status"
        aria-busy="true"
      >
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    );
  }

  return (
    <section
      className={cn(
        'space-y-3',
        variant === 'compact' && 'text-sm',
        className,
      )}
      aria-label={t('assignments.title')}
    >
      {/* Header with title and add button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" aria-hidden="true" />
          <h4 className="font-medium text-sm">{t('assignments.title')}</h4>
          {assignments.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {assignments.length}
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 md:h-7 gap-1"
          disabled={isDisabled || persons.length === 0}
          onClick={handleAddClick}
          aria-label={t('assignments.assign')}
        >
          <Plus className="size-4 md:size-3.5" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">{t('common.add')}</span>
        </Button>
      </div>

      {/* Assignments list or empty state */}
      {assignments.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-4 text-center">
          <Users className="size-8 text-muted-foreground/50 mb-2" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{t('assignments.empty')}</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            {t('assignments.emptyDescription')}
          </p>
        </div>
      ) : (
        <div className="space-y-2" role="list" aria-label={t('assignments.title')}>
          {visibleAssignments.map((assignment) => (
            <AssignmentItem
              key={assignment.id}
              assignment={assignment}
              person={getPersonById(assignment.personId)}
              hasConflict={false} // Conflict detection happens in the form dialog during add/edit
              dateLocale={dateLocale}
              isDisabled={isDisabled}
              onEdit={handleEditAssignment}
              onDelete={handleDeleteAssignment}
            />
          ))}

          {/* Show more button for compact mode */}
          {hiddenCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={handleExpandClick}
              aria-label={t('assignments.showMore', '+{{count}} more', { count: hiddenCount })}
            >
              {t('assignments.showMore', '+{{count}} more', { count: hiddenCount })}
            </Button>
          )}
        </div>
      )}

      {/* Assignment Form Dialog */}
      <AssignmentFormDialog
        open={isFormDialogOpen}
        onOpenChange={handleFormDialogClose}
        roomId={roomId}
        existingAssignment={editingAssignment}
        persons={persons}
        tripStartDate={tripDates.start}
        tripEndDate={tripDates.end}
        onSubmit={handleFormSubmit}
        checkConflict={checkConflict}
        getPersonTransportDates={getPersonTransportDates}
        existingAssignments={assignments}
        roomCapacity={currentRoom?.capacity}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deletingAssignment)}
        onOpenChange={handleDeleteDialogClose}
        title={t('assignments.deleteConfirmTitle', 'Delete assignment?')}
        description={t(
          'assignments.deleteConfirm',
          'Are you sure you want to delete this assignment? This action cannot be undone.',
        )}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </section>
  );
});

// ============================================================================
// Exports
// ============================================================================

export type { AssignmentItemProps, AssignmentFormDialogProps };
