/**
 * @fileoverview Plain-text helpers for Markdown notes: the edits the editor's
 * toolbar makes, and the one-line preview a card shows.
 *
 * Every edit is a pure function of the text and the selection, and it returns
 * one replacement rather than a whole new string. The editor hands that
 * replacement to the browser as typed text, which keeps the native undo stack
 * intact: a toolbar click is then undone with Cmd+Z like any keystroke.
 *
 * @module lib/utils/markdown
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * One replacement of the text, plus the selection to leave behind.
 *
 * `from`/`to` index the text *before* the edit; the selection indexes the text
 * *after* it.
 */
export interface MarkdownEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

/** A line prefix the toolbar can toggle. */
export type MarkdownLineKind = 'heading' | 'bullet' | 'ordered' | 'task';

// ============================================================================
// Constants
// ============================================================================

const LINE_PATTERNS: Readonly<Record<MarkdownLineKind, RegExp>> = {
  heading: /^#{1,6} /,
  // A task item starts with "- " too, so a bullet is a dash *not* followed by a box.
  bullet: /^[-*+] (?!\[[ xX]\] )/,
  ordered: /^\d+[.)] /,
  task: /^[-*+] \[[ xX]\] /,
};

const LIST_ITEM_PATTERN = /^(\s*)(?:([-*+])|(\d+)([.)]))\s+(\[[ xX]\]\s+)?/;

const URL_PATTERN = /^(https?:\/\/|mailto:)\S+$/i;

// ============================================================================
// Helpers
// ============================================================================

/** Applies an edit, for callers that cannot let the browser do it. */
export function applyMarkdownEdit(value: string, edit: MarkdownEdit): string {
  return value.slice(0, edit.from) + edit.insert + value.slice(edit.to);
}

function linePrefix(kind: MarkdownLineKind, index: number): string {
  switch (kind) {
    case 'heading':
      return '## ';
    case 'bullet':
      return '- ';
    case 'ordered':
      return `${index + 1}. `;
    case 'task':
      return '- [ ] ';
  }
}

// ============================================================================
// Edits
// ============================================================================

/**
 * Wraps the selection in `marker` (bold, italic, code), or unwraps it when the
 * marker is already around it. With nothing selected, inserts `placeholder`
 * wrapped and selects it, so typing replaces the placeholder.
 */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  marker: string,
  placeholder: string,
): MarkdownEdit {
  const selected = value.slice(start, end);
  const size = marker.length;

  if (
    selected !== '' &&
    value.slice(start - size, start) === marker &&
    value.slice(end, end + size) === marker
  ) {
    const from = start - size;
    return {
      from,
      to: end + size,
      insert: selected,
      selectionStart: from,
      selectionEnd: from + selected.length,
    };
  }

  const text = selected === '' ? placeholder : selected;
  return {
    from: start,
    to: end,
    insert: `${marker}${text}${marker}`,
    selectionStart: start + size,
    selectionEnd: start + size + text.length,
  };
}

/**
 * Toggles a line prefix (heading, bullet, numbered, task) on every line the
 * selection touches. The prefix comes off when every non-blank line already
 * carries it, and goes on otherwise.
 */
export function toggleLinePrefix(
  value: string,
  start: number,
  end: number,
  kind: MarkdownLineKind,
): MarkdownEdit {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const newline = value.indexOf('\n', end);
  const lineEnd = newline === -1 ? value.length : newline;
  const lines = value.slice(lineStart, lineEnd).split('\n');
  const pattern = LINE_PATTERNS[kind];

  const nonBlank = lines.filter((line) => line.trim() !== '');
  const remove = nonBlank.length > 0 && nonBlank.every((line) => pattern.test(line));

  let firstDelta = 0;
  const next = lines.map((line, index) => {
    const before = line;
    const after = remove
      ? line.replace(pattern, '')
      : line.trim() === '' && lines.length > 1
        ? line
        : `${linePrefix(kind, index)}${line}`;
    if (index === 0) {firstDelta = after.length - before.length;}
    return after;
  });

  const insert = next.join('\n');
  const totalDelta = insert.length - (lineEnd - lineStart);
  return {
    from: lineStart,
    to: lineEnd,
    insert,
    selectionStart: Math.max(lineStart, start + firstDelta),
    selectionEnd: Math.max(lineStart, end + totalDelta),
  };
}

/**
 * Turns the selection into a link. A selected URL becomes the target and the
 * label is selected; any other selection becomes the label and the target is
 * selected, ready to paste over.
 */
export function insertLink(
  value: string,
  start: number,
  end: number,
  labelPlaceholder: string,
): MarkdownEdit {
  const selected = value.slice(start, end).trim();

  if (URL_PATTERN.test(selected)) {
    return {
      from: start,
      to: end,
      insert: `[${labelPlaceholder}](${selected})`,
      selectionStart: start + 1,
      selectionEnd: start + 1 + labelPlaceholder.length,
    };
  }

  const label = selected === '' ? labelPlaceholder : selected;
  const target = 'https://';
  const targetStart = start + label.length + 3;
  return {
    from: start,
    to: end,
    insert: `[${label}](${target})`,
    selectionStart: targetStart,
    selectionEnd: targetStart + target.length,
  };
}

/**
 * What Enter does inside a list item: start the next item with the same
 * marker (the next number, an unticked box), or end the list when the item is
 * still empty. Returns `null` outside a list, where Enter is just a newline.
 */
export function continueList(value: string, caret: number): MarkdownEdit | null {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const line = value.slice(lineStart, caret);
  const match = LIST_ITEM_PATTERN.exec(line);
  if (!match) {return null;}

  const [prefix, indent = '', bullet, number, delimiter, box] = match;

  if (line === prefix) {
    return { from: lineStart, to: caret, insert: '', selectionStart: lineStart, selectionEnd: lineStart };
  }

  const marker = bullet ?? `${Number(number) + 1}${delimiter ?? '.'}`;
  const insert = `\n${indent}${marker} ${box ? '[ ] ' : ''}`;
  return {
    from: caret,
    to: caret,
    insert,
    selectionStart: caret + insert.length,
    selectionEnd: caret + insert.length,
  };
}

// ============================================================================
// Plain Text
// ============================================================================

/**
 * The words of a Markdown note without its syntax, for a place too small to
 * render it: a clamped card line, a tooltip, an accessible name.
 *
 * Deliberately a handful of patterns and not a parser. A preview that misses a
 * rare construct prints a stray character; pulling the Markdown parser into the
 * trip list would put it in the first screen every visitor loads.
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '$1')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    // Underscores only at a word edge, as CommonMark reads them: `snake_case`
    // in a note is a word, not emphasis.
    .replace(/(^|\W)__([^_\n]+)__(?!\w)/g, '$1$2')
    .replace(/(^|\W)_([^_\n]+)_(?!\w)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
