/**
 * @fileoverview Form for creating and editing a guest group and its members.
 *
 * The member list is edited inline rather than through a second dialog: a group
 * is typed in one sitting ("us, the girls, grandma"), and making each person a
 * separate round trip through a modal is what makes people give up and type
 * everybody into the trip instead — the thing this feature exists to avoid.
 *
 * @module features/guest-groups/components/GuestGroupForm
 * @see PersonForm.tsx for the single-guest equivalent
 */

import {
  type ChangeEvent,
  type FormEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ColorPicker, DEFAULT_COLORS } from '@/components/shared/ColorPicker';
import { useFormSubmission } from '@/hooks';
import { MAX_LENGTHS } from '@/lib/db/sanitize';
import { toHexColor } from '@/lib/db/utils';
import { pickRandomUnusedColor } from '@/lib/utils/guest-colors';
import {
  MAX_GUEST_GROUP_MEMBERS,
  MAX_PERSON_HEADCOUNT,
  MIN_PERSON_HEADCOUNT,
  getPersonHeadcount,
  normalizePersonHeadcount,
} from '@/types';
import type { GuestGroup, GuestGroupFormData } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export interface GuestGroupFormProps {
  /** Existing group for edit mode. Undefined means create. */
  readonly group?: GuestGroup;
  /** Called with validated data on submit. */
  readonly onSubmit: (data: GuestGroupFormData) => Promise<void>;
  /** Called when the user cancels. */
  readonly onCancel: () => void;
  /** Called when the dirty state changes, for the unsaved-changes guard. */
  readonly onDirtyChange?: (isDirty: boolean) => void;
}

/**
 * One row being edited.
 *
 * `headcount` is a string so the field can be emptied while typing; it is
 * normalised on blur and again on submit, exactly as `PersonForm` does.
 * `key` is a render key that outlives reordering — the stored member id is
 * absent for a row that has not been saved yet.
 */
interface MemberDraft {
  readonly key: string;
  name: string;
  color: string;
  headcount: string;
  notes: string;
  phone: string;
}

interface FormErrors {
  name?: string;
  members?: string;
}

// ============================================================================
// Constants
// ============================================================================

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * A blank row, coloured so it does not collide with the rows above it.
 *
 * Through the same helper `PersonForm` uses, which is the point: a member
 * becomes a guest on import, and a group whose colours came out in a different
 * order from a hand-typed trip's would look like two features rather than one.
 * The first version here took the first unused swatch instead, so every group
 * ever created started red, orange, yellow.
 */
function emptyDraft(drafts: readonly MemberDraft[]): MemberDraft {
  return {
    key: `member-${Date.now()}-${drafts.length}`,
    name: '',
    color: pickRandomUnusedColor({
      usedColors: new Set(drafts.map((draft) => draft.color)),
      palette: DEFAULT_COLORS,
    }),
    headcount: String(MIN_PERSON_HEADCOUNT),
    notes: '',
    phone: '',
  };
}

/** The stored group as editable rows. */
function toDrafts(group: GuestGroup | undefined): MemberDraft[] {
  if (!group || group.members.length === 0) {
    return [];
  }

  return group.members.map((member) => ({
    key: member.id,
    name: member.name,
    color: member.color,
    headcount: String(getPersonHeadcount(member)),
    notes: member.notes ?? '',
    phone: member.phone ?? '',
  }));
}

/** A comparable snapshot, for the dirty check. */
function snapshot(name: string, drafts: readonly MemberDraft[]): string {
  return JSON.stringify([
    name.trim(),
    drafts.map((draft) => [
      draft.name.trim(),
      draft.color,
      normalizePersonHeadcount(Number.parseInt(draft.headcount, 10)),
      draft.notes.trim(),
      draft.phone.trim(),
    ]),
  ]);
}

// ============================================================================
// Component
// ============================================================================

/**
 * Guest group form.
 *
 * @param props - Component props
 * @returns The form element
 *
 * @example
 * ```tsx
 * <GuestGroupForm
 *   group={existingGroup}
 *   onSubmit={async (data) => await updateGroup(existingGroup.id, data)}
 *   onCancel={close}
 * />
 * ```
 */
const GuestGroupForm = memo(function GuestGroupForm({
  group,
  onSubmit,
  onCancel,
  onDirtyChange,
}: GuestGroupFormProps) {
  const { t } = useTranslation();

  const [name, setName] = useState(group?.name ?? '');
  const [drafts, setDrafts] = useState<MemberDraft[]>(() => toDrafts(group));
  const [errors, setErrors] = useState<FormErrors>({});
  const [initial, setInitial] = useState<string>(() =>
    snapshot(group?.name ?? '', toDrafts(group)),
  );

  const isDirty = useMemo(
    () => snapshot(name, drafts) !== initial,
    [drafts, initial, name],
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Re-seed when a different group is opened in the same mounted dialog.
  useEffect(() => {
    const nextDrafts = toDrafts(group),
      nextName = group?.name ?? '';

    setName(nextName);
    setDrafts(nextDrafts);
    setInitial(snapshot(nextName, nextDrafts));
    setErrors((prev) => (Object.keys(prev).length === 0 ? prev : {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Keyed on the group's identity: re-seeding on every prop reference would discard what the user is typing.
  }, [group?.id]);

  const { isSubmitting, submitError, handleSubmit: doSubmit } =
    useFormSubmission<GuestGroupFormData>(onSubmit);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleNameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
    setErrors((prev) => (prev.name ? { ...prev, name: undefined } : prev));
  }, []);

  const handleAddMember = useCallback(() => {
    setDrafts((prev) =>
      prev.length >= MAX_GUEST_GROUP_MEMBERS ? prev : [...prev, emptyDraft(prev)],
    );
    setErrors((prev) => (prev.members ? { ...prev, members: undefined } : prev));
  }, []);

  const handleRemoveMember = useCallback((key: string) => {
    setDrafts((prev) => prev.filter((draft) => draft.key !== key));
  }, []);

  const handleMemberChange = useCallback(
    (key: string, patch: Partial<Omit<MemberDraft, 'key'>>) => {
      setDrafts((prev) =>
        prev.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)),
      );
      setErrors((prev) => (prev.members ? { ...prev, members: undefined } : prev));
    },
    [],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();

      const named = drafts.filter((draft) => draft.name.trim().length > 0),
        nextErrors: FormErrors = {};

      if (name.trim().length === 0) {
        nextErrors.name = t('common.required');
      }
      if (named.length === 0) {
        nextErrors.members = t(
          'guestGroups.membersRequired',
          'Add at least one person to the group',
        );
      }

      setErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) {
        return;
      }

      try {
        await doSubmit({
          name: name.trim(),
          // Rows left blank are dropped rather than rejected: an empty row is
          // how somebody signals "I am done adding", not a mistake to correct.
          members: named.map((draft) => {
            const headcount = normalizePersonHeadcount(
                Number.parseInt(draft.headcount, 10),
              ),
              notes = draft.notes.trim(),
              phone = draft.phone.trim();

            return {
              name: draft.name.trim(),
              color: toHexColor(draft.color),
              ...(headcount > MIN_PERSON_HEADCOUNT ? { headcount } : {}),
              ...(notes.length > 0 ? { notes } : {}),
              ...(phone.length > 0 ? { phone } : {}),
            };
          }),
        });
      } catch {
        // Reported through `submitError` by useFormSubmission.
      }
    },
    [doSubmit, drafts, name, t],
  );

  // ============================================================================
  // Render
  // ============================================================================

  const isFull = drafts.length >= MAX_GUEST_GROUP_MEMBERS;

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div className="space-y-2">
        <Label htmlFor="guest-group-name">
          {t('guestGroups.name', 'Group name')}
          <span className="text-destructive ml-1" aria-hidden="true">
            *
          </span>
        </Label>
        <Input
          id="guest-group-name"
          type="text"
          value={name}
          onChange={handleNameChange}
          placeholder={t('guestGroups.namePlaceholder', 'e.g. Family')}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'guest-group-name-error' : undefined}
          disabled={isSubmitting}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- The first control of a form the user has just chosen to open; without it focus stays on the dialog's close button.
          autoFocus
        />
        {errors.name && (
          <p id="guest-group-name-error" className="text-sm text-destructive" role="alert">
            {errors.name}
          </p>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label>{t('guestGroups.members', 'People')}</Label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('guestGroups.memberCount', '{{count}} people', { count: drafts.length })}
          </span>
        </div>

        {drafts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t(
              'guestGroups.membersEmpty',
              'Nobody yet. Add the people you invite together.',
            )}
          </p>
        )}

        <ul className="space-y-3">
          {drafts.map((draft, index) => (
            <li key={draft.key} className="rounded-md border p-3 space-y-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-2">
                  <Label htmlFor={`guest-group-member-${draft.key}`} className="sr-only">
                    {t('guestGroups.memberName', 'Name')}
                  </Label>
                  <Input
                    id={`guest-group-member-${draft.key}`}
                    type="text"
                    value={draft.name}
                    onChange={(event) =>
                      handleMemberChange(draft.key, { name: event.target.value })
                    }
                    placeholder={t('guestGroups.memberNamePlaceholder', 'Name')}
                    disabled={isSubmitting}
                  />
                </div>

                <div className="w-24 space-y-2">
                  <Label htmlFor={`guest-group-headcount-${draft.key}`} className="sr-only">
                    {t('persons.headcount', 'Number of people')}
                  </Label>
                  <Input
                    id={`guest-group-headcount-${draft.key}`}
                    type="number"
                    inputMode="numeric"
                    min={MIN_PERSON_HEADCOUNT}
                    max={MAX_PERSON_HEADCOUNT}
                    step={1}
                    value={draft.headcount}
                    onChange={(event) =>
                      handleMemberChange(draft.key, { headcount: event.target.value })
                    }
                    onBlur={() =>
                      handleMemberChange(draft.key, {
                        headcount: String(
                          normalizePersonHeadcount(Number.parseInt(draft.headcount, 10)),
                        ),
                      })
                    }
                    disabled={isSubmitting}
                    aria-label={t('persons.headcount', 'Number of people')}
                  />
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveMember(draft.key)}
                  disabled={isSubmitting}
                  aria-label={t('guestGroups.removeMember', 'Remove {{name}}', {
                    name: draft.name.trim() || t('guestGroups.memberFallback', 'person {{index}}', { index: index + 1 }),
                  })}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>

              <ColorPicker
                value={draft.color}
                onChange={(color) => handleMemberChange(draft.key, { color })}
                disabled={isSubmitting}
                label={t('persons.color')}
              />

              <div className="space-y-1">
                <Label htmlFor={`guest-group-phone-${draft.key}`} className="sr-only">
                  {t('persons.phone', 'Phone')}
                </Label>
                <Input
                  id={`guest-group-phone-${draft.key}`}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={MAX_LENGTHS.personPhone}
                  value={draft.phone}
                  onChange={(event) =>
                    handleMemberChange(draft.key, { phone: event.target.value })
                  }
                  placeholder={t('persons.phonePlaceholder', '+33 6 12 34 56 78')}
                  disabled={isSubmitting}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor={`guest-group-notes-${draft.key}`} className="sr-only">
                  {t('persons.notes', 'Notes')}
                </Label>
                <Textarea
                  id={`guest-group-notes-${draft.key}`}
                  value={draft.notes}
                  onChange={(event) =>
                    handleMemberChange(draft.key, { notes: event.target.value })
                  }
                  placeholder={t('persons.notesPlaceholder', 'e.g. allergic to cats, vegan…')}
                  disabled={isSubmitting}
                  rows={2}
                  className="resize-y"
                />
              </div>
            </li>
          ))}
        </ul>

        {errors.members && (
          <p className="text-sm text-destructive" role="alert">
            {errors.members}
          </p>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={handleAddMember}
          disabled={isSubmitting || isFull}
          className="w-full"
        >
          <Plus className="size-4 mr-2" aria-hidden="true" />
          {t('guestGroups.addMember', 'Add a person')}
        </Button>

        {isFull && (
          <p className="text-xs text-muted-foreground">
            {t('guestGroups.membersFull', 'A group holds at most {{count}} people.', {
              count: MAX_GUEST_GROUP_MEMBERS,
            })}
          </p>
        )}
      </div>

      {submitError && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {submitError}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
          {isSubmitting ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </form>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { GuestGroupForm };
