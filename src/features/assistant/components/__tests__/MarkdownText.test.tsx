/**
 * Component tests for MarkdownText.
 *
 * This renderer is on screen for every assistant reply and had no test file at
 * all, so this covers both halves of it: the markdown subset it claims to
 * support, and the one thing about its styling that can silently break —
 * the code surface, which has to stay distinguishable from whatever bubble
 * `ChatMessage` puts behind it.
 *
 * @module features/assistant/components/__tests__/MarkdownText.test
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { MarkdownText } from '../MarkdownText';
import { ChatMessage } from '../ChatMessage';

// ============================================================================
// Helpers
// ============================================================================

/** Every background utility on an element, `dark:` variants included. */
function backgroundClasses(el: Element): string[] {
  return el.className
    .split(/\s+/)
    .filter((c) => /^(?:[a-z-]+:)*bg-/.test(c));
}

/** The rendered `<code>` for an inline span of markdown. */
function inlineCode(markdown: string): HTMLElement {
  const { container } = render(<MarkdownText content={markdown} />);
  const code = container.querySelector('code');
  expect(code, `no <code> rendered for ${markdown}`).not.toBeNull();
  return code as HTMLElement;
}

// ============================================================================
// Code Surface Tests
// ============================================================================

describe('MarkdownText code surface', () => {
  /**
   * The regression that motivated this file.
   *
   * `ChatMessage` paints the assistant bubble `bg-muted`. The tempting token
   * for a code chip is also `bg-muted` — and that is exactly the colour it
   * would sit on (1.000:1), so every code span in every reply would vanish.
   * Reading the bubble back off a real `ChatMessage` rather than hardcoding
   * `bg-muted` here means this still fails if the bubble is what moves.
   */
  it('does not paint code the same colour as the bubble behind it', () => {
    const { container } = render(
      <ChatMessage
        message={{
          id: 'm1',
          role: 'assistant',
          content: 'try `bun run test:run`',
        }}
      />,
    );

    const code = container.querySelector('code');
    const bubble = code?.closest('.rounded-2xl');
    expect(code).not.toBeNull();
    expect(bubble, 'ChatMessage bubble not found').not.toBeNull();

    const bubbleBackgrounds = backgroundClasses(bubble!);
    const codeBackgrounds = backgroundClasses(code!);

    expect(bubbleBackgrounds.length).toBeGreaterThan(0);
    expect(codeBackgrounds.length).toBeGreaterThan(0);
    for (const background of codeBackgrounds) {
      expect(bubbleBackgrounds).not.toContain(background);
    }
  });

  /**
   * The surface used to be `bg-black/10 dark:bg-white/10`: two raw palette
   * colours, one of which only applies under `.dark`. A single token-derived
   * class needs no `dark:` partner, so the presence of one is the signal that
   * somebody went back to hand-managing both themes.
   */
  it('themes itself with one token class, not a light/dark pair', () => {
    const code = inlineCode('`x`');
    const backgrounds = backgroundClasses(code);

    expect(backgrounds).toHaveLength(1);
    expect(backgrounds[0]).toBe('bg-foreground/10');
    expect(code.className).not.toMatch(/\bdark:/);
    expect(code.className).not.toMatch(/bg-(?:black|white|gray|zinc|slate)\b/);
  });

  it('gives fenced blocks the same surface as inline code', () => {
    const { container } = render(
      <MarkdownText content={'`inline`\n\n```\nblock\n```'} />,
    );

    const inline = container.querySelector('p code');
    const pre = container.querySelector('pre');
    expect(inline).not.toBeNull();
    expect(pre).not.toBeNull();

    expect(backgroundClasses(pre!)).toEqual(backgroundClasses(inline!));
  });

  it('keeps a fenced block scrollable rather than widening the bubble', () => {
    const { container } = render(
      <MarkdownText content={'```\nan extremely long unbroken line\n```'} />,
    );

    expect(container.querySelector('pre')?.className).toContain(
      'overflow-x-auto',
    );
  });
});

// ============================================================================
// Inline Markdown Tests
// ============================================================================

describe('MarkdownText inline markdown', () => {
  it('renders bold, italic and bold-italic as their semantic elements', () => {
    const { container } = render(
      <MarkdownText content={'**b** and *i* and ***bi***'} />,
    );

    expect(container.querySelector('strong')?.textContent).toBe('b');
    expect(container.querySelector('em')?.textContent).toBe('i');
    expect(container.querySelector('strong em')?.textContent).toBe('bi');
  });

  it('accepts underscore spellings of the same emphasis', () => {
    const { container } = render(<MarkdownText content={'__b__ and _i_'} />);

    expect(container.querySelector('strong')?.textContent).toBe('b');
    expect(container.querySelector('em')?.textContent).toBe('i');
  });

  it('keeps the text around a token in order', () => {
    render(<MarkdownText content={'before **bold** after'} />);

    expect(screen.getByText(/before/).textContent).toBe('before ');
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText(/after/).textContent).toBe(' after');
  });

  it('renders inline code as <code>, not as literal backticks', () => {
    const code = inlineCode('run `bun test` now');

    expect(code.textContent).toBe('bun test');
    expect(code.textContent).not.toContain('`');
  });

  /**
   * A pair of adjacent markers matched the emphasis regex with an empty body
   * and became an empty `<em>`/`<strong>` — an element that renders nothing —
   * so the markers silently vanished from the reply. Everything the model
   * writes goes through here, so losing characters is the worst thing this
   * renderer can do.
   */
  it.each([
    ['2 ** 3 = 8', 'a bare **'],
    ['a *** b', 'a bare ***'],
    ['type __ to blank it', 'a bare __'],
    ['an empty `` chip', 'empty backticks'],
  ])('renders %s verbatim (%s) instead of swallowing it', (content) => {
    const { container } = render(<MarkdownText content={content} />);

    expect(container.textContent).toBe(content);
    expect(screen.getByText(content)).toBeInTheDocument();
  });

  it('keeps a run of plain text in one node rather than splitting it', () => {
    const { container } = render(<MarkdownText content={'2 ** 3 = 8'} />);

    // One text node, not `2 ` + `**` + ` 3 = 8` across three spans.
    expect(container.querySelectorAll('span')).toHaveLength(0);
  });

  it('still parses a real token that follows an empty one', () => {
    const { container } = render(<MarkdownText content={'`` and `code` here'} />);

    expect(container.querySelector('code')?.textContent).toBe('code');
    expect(container.textContent).toBe('`` and code here');
  });
});

// ============================================================================
// Block Markdown Tests
// ============================================================================

describe('MarkdownText blocks', () => {
  it('renders a bullet list, whatever bullet character is used', () => {
    const { container } = render(
      <MarkdownText content={'- one\n* two\n+ three'} />,
    );

    const items = container.querySelectorAll('ul li');
    expect([...items].map((li) => li.textContent)).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it('renders a numbered list for both `1.` and `1)`', () => {
    const { container } = render(<MarkdownText content={'1. one\n2) two'} />);

    const items = container.querySelectorAll('ol li');
    expect([...items].map((li) => li.textContent)).toEqual(['one', 'two']);
  });

  it('applies inline markdown inside list items', () => {
    const { container } = render(<MarkdownText content={'- a **bold** item'} />);

    expect(container.querySelector('li strong')?.textContent).toBe('bold');
  });

  it('renders the fenced block body verbatim, fences excluded', () => {
    const { container } = render(
      <MarkdownText content={'```ts\nconst a = 1;\nconst b = 2;\n```'} />,
    );

    expect(container.querySelector('pre code')?.textContent).toBe(
      'const a = 1;\nconst b = 2;',
    );
  });

  it('does not treat markdown inside a fenced block as markdown', () => {
    const { container } = render(
      <MarkdownText content={'```\n**not bold**\n```'} />,
    );

    expect(container.querySelector('pre strong')).toBeNull();
    expect(container.querySelector('pre code')?.textContent).toBe(
      '**not bold**',
    );
  });

  it('renders the three heading levels at descending weights', () => {
    const { container } = render(
      <MarkdownText content={'# one\n## two\n### three'} />,
    );

    const paragraphs = [...container.querySelectorAll('p')];
    expect(paragraphs.map((p) => p.textContent)).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(paragraphs[0]?.className).toContain('font-bold');
    expect(paragraphs[1]?.className).toContain('font-semibold');
    expect(paragraphs[2]?.className).toContain('font-medium');
  });

  it('renders nothing for empty content rather than throwing', () => {
    const { container } = render(<MarkdownText content="" />);

    expect(container.querySelector('div')?.children).toHaveLength(0);
  });

  it('merges a caller className onto the wrapper', () => {
    const { container } = render(
      <MarkdownText content="hi" className="text-xs" />,
    );

    expect(container.firstElementChild?.className).toContain('text-xs');
  });
});
