/**
 * @fileoverview Lightweight inline markdown renderer for chat messages.
 * Handles the subset of markdown that LLMs typically produce: bold, italic,
 * inline code, code blocks, bullet/numbered lists, and line breaks.
 *
 * No external dependencies — pure React elements.
 *
 * @module features/assistant/components/MarkdownText
 */

import { type ReactElement, type ReactNode, memo, useMemo } from 'react';

import { cn } from '@/lib/utils';

// ============================================================================
// Constants
// ============================================================================

/**
 * The tint behind inline code and fenced code blocks.
 *
 * `bg-foreground/10` rather than the `bg-black/10 dark:bg-white/10` pair it
 * replaces: one self-theming class instead of two raw palette colours, and a
 * warm grey (`--foreground` is `oklch(… 0.03 50)`) instead of the pure neutral
 * that clashed with this app's palette. Same weight either way — 1.24:1 in
 * light, 1.34:1 in dark against the assistant bubble, versus 1.25 / 1.37 for
 * the pair it replaces.
 *
 * Deliberately *not* `bg-muted`, the obvious-looking token: `ChatMessage`
 * paints the assistant bubble `bg-muted`, so `bg-muted` here would be exactly
 * the colour it sits on — 1.000:1 — and every code span in every assistant
 * reply would disappear. `MarkdownText.test.tsx` asserts the two differ.
 */
const CODE_SURFACE = 'bg-foreground/10';

// ============================================================================
// Type Definitions
// ============================================================================

interface MarkdownTextProps {
  /** Raw markdown text */
  readonly content: string;
  /** Extra classes applied to the wrapper */
  readonly className?: string;
}

// ============================================================================
// Inline Parsing
// ============================================================================

/**
 * Token types produced by the inline tokenizer.
 */
type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'boldItalic'; value: string }
  | { type: 'code'; value: string };

/**
 * Regex that matches inline markdown tokens in priority order:
 * 1. `***bold italic***` or `___bold italic___`
 * 2. `**bold**` or `__bold__`
 * 3. `*italic*` or `_italic_`
 * 4. `` `code` ``
 */
const INLINE_REGEX =
  /(\*{3}|_{3})(.*?)\1|(\*{2}|_{2})(.*?)\3|(\*|_)(.*?)\5|(`)(.*?)\7/g;

/**
 * Parse a line of text into inline tokens preserving order.
 */
function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;

  /**
   * Append plain text, folding it into the previous token when that is also
   * plain text. Without the fold, a passage that contains a literal `**` comes
   * back as three text tokens and renders as three `<span>`s, which splits what
   * the reader sees as one sentence across elements.
   */
  const pushText = (value: string): void => {
    if (value === '') return;
    const previous = tokens.at(-1);
    if (previous?.type === 'text') {
      previous.value += value;
      return;
    }
    tokens.push({ type: 'text', value });
  };

  INLINE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_REGEX.exec(text)) !== null) {
    // Push any plain text before this match
    if (match.index > lastIndex) {
      pushText(text.slice(lastIndex, match.index));
    }

    // An emphasis run with nothing between its markers renders as an empty
    // `<strong>`/`<em>`, which is to say it renders as nothing: `2 ** 3 = 8`
    // reached the user as `2  3 = 8`, and `a *** b` lost three characters. The
    // markers are the content in that case, so emit them verbatim. Empty
    // `` `` `` code follows the same rule — an empty chip is no more useful
    // than an empty `<em>`.
    const value = match[2] ?? match[4] ?? match[6] ?? match[8] ?? '';
    if (value === '') {
      pushText(match[0]);
    } else if (match[1] !== undefined) {
      // ***bold italic*** or ___bold italic___
      tokens.push({ type: 'boldItalic', value });
    } else if (match[3] !== undefined) {
      // **bold** or __bold__
      tokens.push({ type: 'bold', value });
    } else if (match[5] !== undefined) {
      // *italic* or _italic_
      tokens.push({ type: 'italic', value });
    } else if (match[7] !== undefined) {
      // `code`
      tokens.push({ type: 'code', value });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining plain text
  if (lastIndex < text.length) {
    pushText(text.slice(lastIndex));
  }

  return tokens;
}

/**
 * Render inline tokens into React nodes.
 */
function renderInline(tokens: InlineToken[]): ReactNode[] {
  return tokens.map((token, i) => {
    switch (token.type) {
      case 'bold':
        return <strong key={i}>{token.value}</strong>;
      case 'italic':
        return <em key={i}>{token.value}</em>;
      case 'boldItalic':
        return (
          <strong key={i}>
            <em>{token.value}</em>
          </strong>
        );
      case 'code':
        return (
          <code
            key={i}
            className={cn('rounded px-1 py-0.5 text-[0.85em]', CODE_SURFACE)}
          >
            {token.value}
          </code>
        );
      case 'text':
      default:
        return <span key={i}>{token.value}</span>;
    }
  });
}

/**
 * Shorthand: parse + render inline markdown for a single string.
 */
function inlineMarkdown(text: string): ReactNode {
  const tokens = tokenizeInline(text);
  if (tokens.length === 1 && tokens[0]!.type === 'text') {
    return text; // plain string, no wrapping needed
  }
  return renderInline(tokens);
}

// ============================================================================
// Block Parsing
// ============================================================================

/**
 * Render a markdown string into React block elements.
 * Handles code blocks, bullet lists, numbered lists, and paragraphs.
 */
function renderBlocks(content: string): ReactNode[] {
  const lines = content.split('\n');
  const elements: ReactNode[] = [];
  let key = 0;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // ---- Fenced code block ----
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++; // skip opening fence
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing fence
      elements.push(
        <pre
          key={key++}
          className={cn(
            'my-1.5 overflow-x-auto rounded-lg p-2.5 text-xs',
            CODE_SURFACE,
          )}
        >
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // ---- Bullet list ----
    if (/^[\s]*[-*+]\s/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^[\s]*[-*+]\s/.test(lines[i]!)) {
        const text = lines[i]!.replace(/^[\s]*[-*+]\s+/, '');
        items.push(<li key={items.length}>{inlineMarkdown(text)}</li>);
        i++;
      }
      elements.push(
        <ul key={key++} className="my-1 ml-4 list-disc space-y-0.5">
          {items}
        </ul>,
      );
      continue;
    }

    // ---- Numbered list ----
    if (/^[\s]*\d+[.)]\s/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^[\s]*\d+[.)]\s/.test(lines[i]!)) {
        const text = lines[i]!.replace(/^[\s]*\d+[.)]\s+/, '');
        items.push(<li key={items.length}>{inlineMarkdown(text)}</li>);
        i++;
      }
      elements.push(
        <ol key={key++} className="my-1 ml-4 list-decimal space-y-0.5">
          {items}
        </ol>,
      );
      continue;
    }

    // ---- Heading (##) ----
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const text = headingMatch[2]!;
      const headingClass =
        level === 1
          ? 'text-base font-bold mt-2 mb-1'
          : level === 2
            ? 'text-sm font-semibold mt-1.5 mb-0.5'
            : 'text-sm font-medium mt-1 mb-0.5';
      elements.push(
        <p key={key++} className={headingClass}>
          {inlineMarkdown(text)}
        </p>,
      );
      i++;
      continue;
    }

    // ---- Empty line → spacing ----
    if (line.trim() === '') {
      i++;
      continue;
    }

    // ---- Normal paragraph ----
    elements.push(
      <p key={key++} className="my-0.5">
        {inlineMarkdown(line)}
      </p>,
    );
    i++;
  }

  return elements;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Renders a markdown string as formatted React elements.
 *
 * Supports: **bold**, *italic*, ***bold italic***, `inline code`,
 * fenced code blocks, bullet lists, numbered lists, headings, paragraphs.
 */
const MarkdownText = memo(function MarkdownText({
  content,
  className,
}: MarkdownTextProps): ReactElement {
  const rendered = useMemo(() => renderBlocks(content), [content]);

  return (
    <div className={cn('space-y-0.5 [&>*:first-child]:mt-0', className)}>
      {rendered}
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { MarkdownText };
