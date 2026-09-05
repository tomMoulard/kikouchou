/**
 * @fileoverview Turns a trip's guests into a reusable group.
 *
 * The shortest path to a first group: the family is usually already typed into
 * this year's trip, so capturing it beats retyping it on the groups page. Only
 * name, colour, headcount and notes travel — stay dates, rooms and transports
 * belong to the trip, not to the person.
 *
 * @module features/guest-groups/components/SaveGuestsAsGroupDialog
 */

import {
  type ChangeEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOfflineAwareToast } from '@/hooks';
import { useGuestGroups } from '@/features/guest-groups/hooks/useGuestGroups';
import { captureUsage } from '@/lib/posthog';
import { MAX_GUEST_GROUP_MEMBERS, getPersonHeadcount } from '@/types';
import type { Person, PersonId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export interface SaveGuestsAsGroupDialogProps {
  /** The trip's guests, offered for capture. */
  readonly persons: readonly Person[];
  /** Name to pre-fill, usually the trip's. */
  readonly defaultName?: string;
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback to change the open state */
  readonly onOpenChange: (open: boolean) => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Save selected guests as a new group.
 *
 * @param props - Component props
 * @returns The dialog element
 *
 * @example
 * ```tsx
 * <SaveGuestsAsGroupDialog
 *   persons={persons}
 *   defaultName={currentTrip?.name}
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 * />
 * ```
 */
const SaveGuestsAsGroupDialog = memo(function SaveGuestsAsGroupDialog({
  persons,
  defaultName,
  open,
  onOpenChange,
}: SaveGuestsAsGroupDialogProps) {
  const { t } = useTranslation();
  const { createGroupFromPersons } = useGuestGroups();
  const { successToast } = useOfflineAwareToast();

  const [name, setName] = useState(defaultName ?? '');
  const [selectedIds, setSelectedIds] = useState<readonly PersonId[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * Whether this opening has been initialised.
   *
   * Same hazard as the import picker: `persons` is a new array whenever the
   * guest list re-publishes, and resetting on that would re-tick guests the
   * user had just cleared — a co-traveller's edit arriving over sync is enough
   * to trigger it.
   */
  const isInitialisedRef = useRef(false);

  useEffect(() => {
    if (!open || isInitialisedRef.current) {
      return;
    }
    isInitialisedRef.current = true;

    setName(defaultName ?? '');
    // Everybody, capped: the guest list can be longer than a group may hold,
    // and silently dropping the overflow at save time would be worse than
    // showing exactly what is ticked.
    setSelectedIds(persons.slice(0, MAX_GUEST_GROUP_MEMBERS).map((person) => person.id));
  }, [defaultName, open, persons]);

  // Clear on close, so reopening does not flash the last selection.
  useEffect(() => {
    if (open) {
      return;
    }
    isInitialisedRef.current = false;
    setError(undefined);
    setIsSaving(false);
  }, [open]);

  const isFull = selectedIds.length >= MAX_GUEST_GROUP_MEMBERS;

  const handleNameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
    setError(undefined);
  }, []);

  const handleToggle = useCallback(
    (personId: PersonId) => {
      setSelectedIds((prev) => {
        if (prev.includes(personId)) {
          return prev.filter((id) => id !== personId);
        }
        return prev.length >= MAX_GUEST_GROUP_MEMBERS ? prev : [...prev, personId];
      });
    },
    [],
  );

  const selected = useMemo(
    () => persons.filter((person) => selectedIds.includes(person.id)),
    [persons, selectedIds],
  );

  const handleSave = useCallback(async () => {
    if (isSaving) {
      return;
    }
    if (name.trim().length === 0) {
      setError(t('common.required'));
      return;
    }
    if (selected.length === 0) {
      setError(t('guestGroups.membersRequired', 'Add at least one person to the group'));
      return;
    }

    setIsSaving(true);
    try {
      await createGroupFromPersons(name.trim(), selected);
      successToast(t('guestGroups.createSuccess', 'Group created'));
      captureUsage('guest_group_saved', {
        operation: 'created',
        member_count: selected.length,
        source: 'trip_guests',
      });
      onOpenChange(false);
    } catch (caught) {
      console.error('Failed to save guests as a group:', caught);
      setError(t('errors.saveFailed', 'Could not save. Please try again.'));
    } finally {
      setIsSaving(false);
    }
  }, [createGroupFromPersons, isSaving, name, onOpenChange, selected, successToast, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('guestGroups.saveAsGroup', 'Save as a group')}</DialogTitle>
          <DialogDescription>
            {t(
              'guestGroups.saveAsGroupDescription',
              'Keep these guests for next time. Stay dates, rooms and transports stay with this trip.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="save-group-name">
            {t('guestGroups.name', 'Group name')}
            <span className="text-destructive ml-1" aria-hidden="true">
              *
            </span>
          </Label>
          <Input
            id="save-group-name"
            type="text"
            value={name}
            onChange={handleNameChange}
            placeholder={t('guestGroups.namePlaceholder', 'e.g. Family')}
            disabled={isSaving}
            aria-invalid={Boolean(error)}
          />
        </div>

        <ul className="space-y-1">
          {persons.map((person) => {
            const inputId = `save-group-person-${person.id}`,
              headcount = getPersonHeadcount(person),
              isChecked = selectedIds.includes(person.id);

            return (
              <li key={person.id}>
                <div className="flex items-center gap-3 rounded-md p-2 hover:bg-accent/40">
                  <Checkbox
                    id={inputId}
                    checked={isChecked}
                    onCheckedChange={() => handleToggle(person.id)}
                    disabled={isSaving || (!isChecked && isFull)}
                  />
                  <span
                    className="size-3 shrink-0 rounded-full border"
                    style={{ backgroundColor: person.color }}
                    aria-hidden="true"
                  />
                  <Label htmlFor={inputId} className="flex-1 cursor-pointer font-normal">
                    {person.name}
                    {headcount > 1 && (
                      <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                        {t('persons.headcountBadge', '{{count}} people', { count: headcount })}
                      </span>
                    )}
                  </Label>
                </div>
              </li>
            );
          })}
        </ul>

        {isFull && (
          <p className="text-xs text-muted-foreground">
            {t('guestGroups.membersFull', 'A group holds at most {{count}} people.', {
              count: MAX_GUEST_GROUP_MEMBERS,
            })}
          </p>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving || selected.length === 0}
            aria-busy={isSaving}
          >
            {isSaving ? t('common.loading') : t('common.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { SaveGuestsAsGroupDialog };
