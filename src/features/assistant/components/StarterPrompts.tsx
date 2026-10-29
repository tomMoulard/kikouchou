/**
 * @fileoverview Ready-made first questions for an empty chat.
 *
 * A first visit to the assistant meets an empty text box, and people who do
 * not know what the assistant can do do not type into it. These buttons say
 * it for them, in two halves: two start a trip of the visitor's own, which is
 * what the onboarding experiment measures, and two ask about the trip on
 * screen, which on a first open is the sample.
 *
 * A tap hands the question to the page, which sends it, or asks for an
 * account first when the selected model needs one (`AssistantPage`).
 *
 * @module features/assistant/components/StarterPrompts
 */

import { memo, useCallback, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { STARTER_PROMPTS, type StarterKind, type StarterPrompt } from '../starters';

// ============================================================================
// Type Definitions
// ============================================================================

interface StarterPromptsProps {
  readonly onPick: (text: string, kind: StarterKind) => void;
  readonly disabled: boolean;
}

interface StarterButtonProps {
  readonly starter: StarterPrompt;
  readonly onPick: (text: string, kind: StarterKind) => void;
  readonly disabled: boolean;
}

// ============================================================================
// Component
// ============================================================================

const StarterButton = memo(function StarterButton({
  starter,
  onPick,
  disabled,
}: StarterButtonProps): ReactElement {
  const { t } = useTranslation();
  const text = t(starter.key, starter.fallback);

  const handleClick = useCallback((): void => {
    onPick(text, starter.kind);
  }, [onPick, starter.kind, text]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-auto min-h-8 whitespace-normal rounded-full px-3 py-1.5 text-left text-xs"
      onClick={handleClick}
      disabled={disabled}
    >
      {text}
    </Button>
  );
});

/**
 * The starters, wrapping onto as many lines as the width needs.
 */
const StarterPrompts = memo(function StarterPrompts({
  onPick,
  disabled,
}: StarterPromptsProps): ReactElement {
  const { t } = useTranslation();

  return (
    <div
      role="group"
      aria-label={t('assistant.starters.label', 'Questions to start with')}
      className="flex flex-wrap justify-center gap-2"
    >
      {STARTER_PROMPTS.map((starter) => (
        <StarterButton
          key={starter.id}
          starter={starter}
          onPick={onPick}
          disabled={disabled}
        />
      ))}
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { StarterPrompts };
