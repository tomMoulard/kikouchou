/**
 * @fileoverview The row of shortcuts that opens a view of the trip in the chat
 * without a model turn.
 *
 * Typing "show me the planning" works, but a local model can take seconds to
 * answer it and some people would rather tap than type. A shortcut writes the
 * same `showView` block the model would, so both draw the same view.
 *
 * @module features/assistant/components/ViewShortcuts
 */

import { memo, useCallback, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { ASSISTANT_VIEWS, type AssistantView } from '../views';

// ============================================================================
// Type Definitions
// ============================================================================

interface ViewShortcutsProps {
  readonly onShowView: (view: AssistantView) => void;
  readonly disabled: boolean;
}

interface ViewShortcutButtonProps {
  readonly view: AssistantView;
  readonly onShowView: (view: AssistantView) => void;
  readonly disabled: boolean;
}

// ============================================================================
// Component
// ============================================================================

const ViewShortcutButton = memo(function ViewShortcutButton({
  view,
  onShowView,
  disabled,
}: ViewShortcutButtonProps): ReactElement {
  const { t } = useTranslation();

  const handleClick = useCallback((): void => {
    onShowView(view);
  }, [onShowView, view]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 shrink-0 rounded-full px-3 text-xs"
      onClick={handleClick}
      disabled={disabled}
    >
      {t(`assistant.views.${view}.shortcut`)}
    </Button>
  );
});

/**
 * One button per view, in a row that scrolls sideways on a phone rather than
 * wrapping over the messages.
 */
const ViewShortcuts = memo(function ViewShortcuts({
  onShowView,
  disabled,
}: ViewShortcutsProps): ReactElement {
  const { t } = useTranslation();

  return (
    <div
      role="group"
      aria-label={t('assistant.views.shortcutsLabel', 'Show in the chat')}
      className="flex shrink-0 gap-2 overflow-x-auto px-3 pt-2"
    >
      {ASSISTANT_VIEWS.map((view) => (
        <ViewShortcutButton
          key={view}
          view={view}
          onShowView={onShowView}
          disabled={disabled}
        />
      ))}
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ViewShortcuts };
