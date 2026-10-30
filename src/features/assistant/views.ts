/**
 * @fileoverview The views of a trip the assistant can show inside the chat.
 *
 * A view is not a write. The model asks for one with a `showView` block, the
 * same envelope as every action, and the bubble draws it from the trip as it is
 * now. Nothing but the block is stored, so an old answer never shows stale data.
 *
 * @module features/assistant/views
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Every view the assistant can show, in the order the shortcuts list them.
 *
 * The planning comes first: it is the one view that answers "who is here
 * when", which is what the app is for.
 */
export const ASSISTANT_VIEWS = [
  'planning',
  'rooms',
  'rides',
  'activities',
  'money',
] as const;

// ============================================================================
// Type Definitions
// ============================================================================

/** One view the assistant can show. */
export type AssistantView = (typeof ASSISTANT_VIEWS)[number];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Whether a value names a view.
 *
 * @param value - Any value, usually from a parsed block
 * @returns True when it is one of `ASSISTANT_VIEWS`
 */
export function isAssistantView(value: unknown): value is AssistantView {
  return (
    typeof value === 'string' &&
    (ASSISTANT_VIEWS as readonly string[]).includes(value)
  );
}

/**
 * The block that asks the bubble to draw a view.
 *
 * The shortcuts write their answer with it, so a view opened from a chip and a
 * view the model asked for go through the same parser and the same renderer.
 *
 * @param view - The view to show
 * @returns A fenced ```action block holding one `showView`
 */
export function buildShowViewBlock(view: AssistantView): string {
  return [
    '```action',
    JSON.stringify({ action: 'showView', data: { view } }),
    '```',
  ].join('\n');
}
