/**
 * @fileoverview Tests for the Markdown editor: the toolbar, the keyboard, the
 * character count and the preview.
 *
 * jsdom has no `execCommand`, so every edit here takes the fallback path, which
 * is the one that goes through `onChange`.
 *
 * @module components/shared/__tests__/MarkdownEditor.test
 */

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/utils';
import { MarkdownEditor } from '@/components/shared/MarkdownEditor';

interface HarnessProps {
  readonly initial?: string;
  readonly maxLength?: number;
  readonly onEscape?: () => void;
  readonly onSubmitShortcut?: () => void;
  readonly focusOnMount?: boolean;
}

function Harness({
  initial = '',
  maxLength = 200,
  onEscape,
  onSubmitShortcut,
  focusOnMount,
}: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="md">Notes</label>
      <MarkdownEditor
        id="md"
        value={value}
        onChange={setValue}
        maxLength={maxLength}
        onEscape={onEscape}
        onSubmitShortcut={onSubmitShortcut}
        focusOnMount={focusOnMount}
      />
    </>
  );
}

function renderHarness(props: HarnessProps = {}) {
  render(<Harness {...props} />, { withProviders: false });
  return screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement;
}

describe('MarkdownEditor', () => {
  it('shows the character count', async () => {
    const user = userEvent.setup();
    const textarea = renderHarness();
    expect(screen.getByText('0/200')).toBeInTheDocument();
    await user.type(textarea, 'Hello');
    expect(screen.getByText('5/200')).toBeInTheDocument();
  });

  it('wraps the selection in bold from the toolbar', async () => {
    const user = userEvent.setup();
    const textarea = renderHarness({ initial: 'bring towels' });
    textarea.setSelectionRange(6, 12);
    await user.click(screen.getByRole('button', { name: 'markdown.bold' }));

    expect(textarea).toHaveValue('bring **towels**');
    expect(textarea.selectionStart).toBe(8);
    expect(textarea.selectionEnd).toBe(14);
    expect(textarea).toHaveFocus();
  });

  it('applies every toolbar button', async () => {
    const user = userEvent.setup();
    const textarea = renderHarness();

    await user.click(screen.getByRole('button', { name: 'markdown.italic' }));
    expect(textarea).toHaveValue('_markdown.italicPlaceholder_');

    await user.clear(textarea);
    await user.click(screen.getByRole('button', { name: 'markdown.link' }));
    expect(textarea).toHaveValue('[markdown.linkPlaceholder](https://)');

    await user.clear(textarea);
    await user.click(screen.getByRole('button', { name: 'markdown.heading' }));
    expect(textarea).toHaveValue('## ');

    await user.clear(textarea);
    await user.click(screen.getByRole('button', { name: 'markdown.bulletList' }));
    expect(textarea).toHaveValue('- ');

    await user.clear(textarea);
    await user.click(screen.getByRole('button', { name: 'markdown.numberedList' }));
    expect(textarea).toHaveValue('1. ');

    await user.clear(textarea);
    await user.click(screen.getByRole('button', { name: 'markdown.checklist' }));
    expect(textarea).toHaveValue('- [ ] ');
  });

  it('refuses an edit that would pass the length cap', async () => {
    const user = userEvent.setup();
    const textarea = renderHarness({ initial: 'abcd', maxLength: 5 });
    textarea.setSelectionRange(0, 4);
    await user.click(screen.getByRole('button', { name: 'markdown.bold' }));
    expect(textarea).toHaveValue('abcd');
  });

  it('formats with the keyboard shortcuts', async () => {
    const user = userEvent.setup();
    const textarea = renderHarness({ initial: 'x' });
    await user.click(textarea);
    textarea.setSelectionRange(0, 1);
    await user.keyboard('{Control>}b{/Control}');
    expect(textarea).toHaveValue('**x**');

    textarea.setSelectionRange(2, 3);
    await user.keyboard('{Meta>}i{/Meta}');
    expect(textarea).toHaveValue('**_x_**');

    textarea.setSelectionRange(0, 0);
    await user.keyboard('{Control>}k{/Control}');
    expect(textarea).toHaveValue('[markdown.linkPlaceholder](https://)**_x_**');

    // A modifier chord that is not a shortcut types nothing and breaks nothing.
    await user.keyboard('{Control>}z{/Control}');
    expect(textarea).toHaveValue('[markdown.linkPlaceholder](https://)**_x_**');
  });

  it('continues a list on Enter and ends it on an empty item', async () => {
    const user = userEvent.setup();
    const textarea = renderHarness();
    await user.type(textarea, '- milk{Enter}eggs{Enter}{Enter}done');
    expect(textarea).toHaveValue('- milk\n- eggs\ndone');
  });

  it('keeps a plain Enter outside a list and with a selection', async () => {
    const user = userEvent.setup();
    const textarea = renderHarness({ initial: '- milk' });
    await user.type(textarea, 'hi{Enter}there', { initialSelectionStart: 6 });
    expect(textarea).toHaveValue('- milkhi\n- there');

    await user.clear(textarea);
    await user.type(textarea, 'plain{Enter}text');
    expect(textarea).toHaveValue('plain\ntext');

    // With text selected, Enter replaces it like in any text area.
    await user.clear(textarea);
    await user.type(textarea, '- ab');
    textarea.setSelectionRange(3, 4);
    await user.keyboard('{Enter}');
    expect(textarea).toHaveValue('- a\n');
  });

  it('calls onEscape and onSubmitShortcut', async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    const onSubmitShortcut = vi.fn();
    const textarea = renderHarness({ onEscape, onSubmitShortcut });
    await user.click(textarea);
    await user.keyboard('{Escape}');
    expect(onEscape).toHaveBeenCalledTimes(1);
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onSubmitShortcut).toHaveBeenCalledTimes(1);
  });

  it('focuses the text area on mount, caret at the end', () => {
    const textarea = renderHarness({ initial: 'hello', focusOnMount: true });
    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(5);
  });

  it('previews what will be rendered', async () => {
    const user = userEvent.setup();
    const textarea = renderHarness({ initial: '**bold**' });
    expect(textarea).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'markdown.preview' }));
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    // The toolbar only acts on the text area, so it goes with it.
    expect(screen.queryByRole('toolbar')).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'markdown.write' }));
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('**bold**');
  });

  it('says there is nothing to preview on an empty text', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByRole('tab', { name: 'markdown.preview' }));
    expect(screen.getByText('markdown.nothingToPreview')).toBeInTheDocument();
  });
});
