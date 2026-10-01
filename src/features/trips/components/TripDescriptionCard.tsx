/**
 * @fileoverview The trip's description on its settings page: rendered by
 * default, edited in place.
 *
 * The description is the trip's long-form note (door codes, the Tricount link,
 * what to bring) and it is read far more often than it is written. So the card
 * shows it formatted, with one Edit button; Edit swaps the text for a Markdown
 * editor with its own Cancel and Save, and saves the description alone. The
 * rest of the trip form is not submitted with it, which is why this is a card
 * of its own and not a field of `TripForm`.
 *
 * @module features/trips/components/TripDescriptionCard
 */

import { type ReactElement, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MarkdownEditor } from '@/components/shared/MarkdownEditor';
import { MarkdownText } from '@/components/shared/MarkdownText';

import { MAX_LENGTHS } from '@/lib/db/sanitize';
import { notify } from '@/lib/notifications';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the TripDescriptionCard component.
 */
interface TripDescriptionCardProps {
  /** The stored description, Markdown source. */
  readonly description: string | undefined;
  /** False for a viewer trip: the description is shown and nothing else. */
  readonly canEdit: boolean;
  /**
   * Persists the new description (trimmed; empty clears it). Rejects on
   * failure, which keeps the editor open with the draft intact.
   */
  readonly onSave: (description: string) => Promise<void>;
  /** Reports whether the editor holds an unsaved change, for the page's guard. */
  readonly onDirtyChange?: (isDirty: boolean) => void;
}

// ============================================================================
// Constants
// ============================================================================

const EDITOR_ID = 'trip-description-editor';

// ============================================================================
// Component
// ============================================================================

/**
 * Shows a trip's description formatted, and edits it in place.
 */
const TripDescriptionCard = memo(function TripDescriptionCard({
  description,
  canEdit,
  onSave,
  onDirtyChange,
}: TripDescriptionCardProps): ReactElement {
  const { t } = useTranslation();
  const stored = description ?? '';

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(stored);
  const [isSaving, setIsSaving] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  // Focus goes back to Edit when the editor closes, rather than to the body.
  const restoreFocusRef = useRef(false);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isDirty = isEditing && draft !== stored;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!isEditing && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      editButtonRef.current?.focus();
    }
  }, [isEditing]);

  const handleEdit = useCallback(() => {
    // Seeded from what is stored *now*: a member may have changed it over sync
    // since the page loaded.
    setDraft(stored);
    setIsEditing(true);
  }, [stored]);

  const handleCancel = useCallback(() => {
    if (isSaving) {return;}
    restoreFocusRef.current = true;
    setIsEditing(false);
    setDraft(stored);
  }, [isSaving, stored]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (isSaving) {return;}
    const next = draft.trim();
    if (next === stored.trim()) {
      restoreFocusRef.current = true;
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(next);
      if (isMountedRef.current) {
        restoreFocusRef.current = true;
        setIsEditing(false);
      }
    } catch (error) {
      console.error('Failed to save trip description:', error);
      if (isMountedRef.current) {
        notify.error(t('errors.saveFailed', 'Failed to save'));
      }
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  }, [draft, isSaving, onSave, stored, t]);

  const handleSaveShortcut = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const hasDescription = stored.trim() !== '';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg">
          {isEditing ? (
            <label htmlFor={EDITOR_ID}>{t('trips.description', 'Description')}</label>
          ) : (
            t('trips.description', 'Description')
          )}
        </CardTitle>
        {canEdit && !isEditing && (
          <CardAction>
            <Button
              ref={editButtonRef}
              type="button"
              variant="outline"
              size="sm"
              onClick={handleEdit}
              aria-label={t('trips.descriptionEdit.editAria', 'Edit the description')}
            >
              <Pencil aria-hidden="true" />
              {t('common.edit', 'Edit')}
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent>
        {isEditing ? (
          <div className="space-y-3">
            <MarkdownEditor
              id={EDITOR_ID}
              value={draft}
              onChange={setDraft}
              maxLength={MAX_LENGTHS.tripDescription}
              placeholder={t('trips.descriptionPlaceholder')}
              disabled={isSaving}
              rows={8}
              focusOnMount
              onEscape={handleCancel}
              onSubmitShortcut={handleSaveShortcut}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={handleCancel} disabled={isSaving}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button type="button" onClick={handleSaveShortcut} disabled={isSaving}>
                {isSaving && <Loader2 className="animate-spin" aria-hidden="true" />}
                {t('common.save', 'Save')}
              </Button>
            </div>
          </div>
        ) : hasDescription ? (
          <MarkdownText>{stored}</MarkdownText>
        ) : (
          <p className="text-sm text-muted-foreground">
            {canEdit
              ? t(
                  'trips.descriptionEdit.emptyEditable',
                  'No description yet. Add the door code, the Tricount link or what to bring.',
                )
              : t('trips.descriptionEdit.empty', 'No description yet.')}
          </p>
        )}
      </CardContent>
    </Card>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { TripDescriptionCard };
export type { TripDescriptionCardProps };
