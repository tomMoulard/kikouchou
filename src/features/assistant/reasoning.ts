/**
 * @fileoverview Splits a model answer into the reasoning it showed and the
 * answer it meant to give.
 *
 * Two producers feed this, and both are handled by the same split so the UI has
 * one shape to render:
 *
 * - the Transformers.js presets, which wrap a chain of thought in a
 *   `<think>` / `<thinking>` / `<reasoning>` tag when the model was trained to
 *   emit one;
 * - the Needle worker, which has no chat channel and puts the rationale it
 *   decoded outside the `<tool_call>` markers (see `needle-tools.ts`).
 *
 * The split runs on every streamed chunk, so it must cope with a block that is
 * still open: while the closing tag has not arrived, everything after the
 * opening tag is reasoning and the answer is still empty. That is what lets the
 * UI show the thinking live instead of a blank bubble.
 *
 * @module features/assistant/reasoning
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * A model answer taken apart.
 */
export interface SplitReasoning {
  /** Everything the model put inside reasoning tags. Empty when it showed none. */
  readonly reasoning: string;
  /** Everything outside those tags — the text the user is meant to read. */
  readonly answer: string;
  /**
   * An opening tag arrived and its closing tag has not. The reasoning is still
   * growing and the answer has not started, so the UI keeps the section open.
   */
  readonly thinking: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Tags treated as reasoning. `think` is what the reasoning-tuned instruction
 * models emit; the other two appear when a model improvises the wrapper it was
 * asked for, which small models do often enough to be worth accepting.
 */
const REASONING_TAGS = ['think', 'thinking', 'reasoning'] as const;

const TAG_GROUP = REASONING_TAGS.join('|');

/** One complete block, non-greedy so two blocks never merge into one. */
const CLOSED_BLOCK_REGEX = new RegExp(
  `<(${TAG_GROUP})>([\\s\\S]*?)</\\1>`,
  'gi',
);

/** An opening tag with nothing closing it — the streaming case. */
const OPEN_BLOCK_REGEX = new RegExp(`<(${TAG_GROUP})>([\\s\\S]*)$`, 'i');

// ============================================================================
// Public API
// ============================================================================

/**
 * Separates shown reasoning from the answer.
 *
 * @param text - Raw model output, possibly a partial stream
 * @returns The reasoning, the answer, and whether a block is still open
 *
 * @example
 * ```ts
 * splitReasoning('<think>Two nights, so two rooms.</think>I added two rooms.');
 * // { reasoning: 'Two nights, so two rooms.', answer: 'I added two rooms.', thinking: false }
 *
 * splitReasoning('<think>Counting the beds');
 * // { reasoning: 'Counting the beds', answer: '', thinking: true }
 * ```
 */
export function splitReasoning(text: string): SplitReasoning {
  if (!text.includes('<')) {
    return { reasoning: '', answer: text, thinking: false };
  }

  const parts: string[] = [];

  // Pull out every finished block, keeping what surrounded them as the answer.
  const withoutClosed = text.replace(
    CLOSED_BLOCK_REGEX,
    (_match, _tag: string, body: string) => {
      parts.push(body.trim());
      return '';
    },
  );

  // Whatever is left may still hold an opening tag whose close has not
  // streamed in yet. Everything from that tag onwards is reasoning.
  const open = OPEN_BLOCK_REGEX.exec(withoutClosed);
  if (open) {
    parts.push((open[2] ?? '').trim());
    return {
      reasoning: joinBlocks(parts),
      answer: withoutClosed.slice(0, open.index).trim(),
      thinking: true,
    };
  }

  return {
    reasoning: joinBlocks(parts),
    answer: withoutClosed.trim(),
    thinking: false,
  };
}

/**
 * Whether this text carries any reasoning at all, without paying for the split.
 */
export function hasReasoning(text: string): boolean {
  return splitReasoning(text).reasoning.length > 0;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Joins several blocks into one section, dropping the empty ones a model emits
 * when it opens and closes a tag with nothing between.
 */
function joinBlocks(parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join('\n\n');
}
