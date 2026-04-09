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

  INLINE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_REGEX.exec(text)) !== null) {
    // Push any plain text before this match
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }

    if (match[1] !== undefined) {
      // ***bold italic*** or ___bold italic___
      tokens.push({ type: 'boldItalic', value: match[2]! });
    } else if (match[3] !== undefined) {
      // **bold** or __bold__
      tokens.push({ type: 'bold', value: match[4]! });
    } else if (match[5] !== undefined) {
      // *italic* or _italic_
      tokens.push({ type: 'italic', value: match[6]! });
    } else if (match[7] !== undefined) {
      // `code`
      tokens.push({ type: 'code', value: match[8]! });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining plain text
  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) });
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
            className="rounded bg-black/10 px-1 py-0.5 text-[0.85em] dark:bg-white/10"
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
          className="my-1.5 overflow-x-auto rounded-lg bg-black/10 p-2.5 text-xs dark:bg-white/10"
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
