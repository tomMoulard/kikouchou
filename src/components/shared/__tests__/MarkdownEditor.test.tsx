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
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { fireEvent, render, screen } from '@/test/utils';
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

// ============================================================================
// Edits through the browser's undo stack
// ============================================================================

describe('MarkdownEditor with execCommand', () => {
  interface CommandCall {
    readonly command: string;
    readonly showUi: boolean;
    readonly text: string;
    readonly focused: boolean;
    readonly selection: readonly [number, number];
  }

  /**
   * A browser's `insertText`: replaces the selection of the focused text area
   * and fires `input`, which is how React hears about it. `mode` makes it
   * refuse, or type something other than what was asked.
   */
  function installExecCommand(mode: 'types' | 'refuses' | 'mistypes' = 'types'): CommandCall[] {
    const calls: CommandCall[] = [];
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: (command: string, showUi: boolean, text: string) => {
        const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
        calls.push({
          command,
          showUi,
          text,
          focused: document.activeElement === textarea,
          selection: [textarea.selectionStart, textarea.selectionEnd],
        });
        if (mode === 'refuses') return false;
        const typed = mode === 'mistypes' ? `${text}!` : text;
        const { selectionStart, selectionEnd, value } = textarea;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(textarea, value.slice(0, selectionStart) + typed + value.slice(selectionEnd));
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      },
    });
    return calls;
  }

  afterEach(() => {
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('types the edit into the focused selection and selects the result', async () => {
    const calls = installExecCommand();
    const user = userEvent.setup();
    const textarea = renderHarness({ initial: 'bring towels' });
    textarea.blur();
    textarea.setSelectionRange(6, 12);

    await user.click(screen.getByRole('button', { name: 'markdown.bold' }));

    expect(calls).toEqual([
      { command: 'insertText', showUi: false, text: '**towels**', focused: true, selection: [6, 12] },
    ]);
    expect(textarea).toHaveValue('bring **towels**');
    expect(textarea.selectionStart).toBe(8);
    expect(textarea.selectionEnd).toBe(14);
  });

  it('moves the selection to where the edit goes before typing it, and reports the change once', async () => {
    const calls = installExecCommand();
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Counted() {
      const [value, setValue] = useState('abc def');
      return (
        <>
          <label htmlFor="md">Notes</label>
          <MarkdownEditor
            id="md"
            value={value}
            onChange={(next) => {
              onChange(next);
              setValue(next);
            }}
            maxLength={200}
          />
        </>
      );
    }
    render(<Counted />, { withProviders: false });
    const textarea = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement;
    textarea.setSelectionRange(3, 3);

    await user.click(screen.getByRole('button', { name: 'markdown.heading' }));

    // The edit rewrites the whole line, not the text at the caret.
    expect(calls.at(-1)?.selection).toEqual([0, 7]);
    expect(textarea).toHaveValue('## abc def');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('falls back to a plain change when the browser will not type', async () => {
    installExecCommand('refuses');
    const user = userEvent.setup();
    const textarea = renderHarness({ initial: 'bring towels' });
    textarea.setSelectionRange(6, 12);

    await user.click(screen.getByRole('button', { name: 'markdown.bold' }));

    expect(textarea).toHaveValue('bring **towels**');
    expect(textarea.selectionStart).toBe(8);
    expect(textarea.selectionEnd).toBe(14);
  });

  it('puts the intended text back when the browser typed something else', async () => {
    installExecCommand('mistypes');
    const user = userEvent.setup();
    const textarea = renderHarness({ initial: 'bring towels' });
    textarea.setSelectionRange(6, 12);

    await user.click(screen.getByRole('button', { name: 'markdown.bold' }));

    expect(textarea).toHaveValue('bring **towels**');
  });

  it('takes an edit that lands exactly on the length cap', async () => {
    const user = userEvent.setup();
    const textarea = renderHarness({ initial: 'abc', maxLength: 7 });
    textarea.setSelectionRange(1, 2);

    await user.click(screen.getByRole('button', { name: 'markdown.bold' }));

    expect(textarea).toHaveValue('a**b**c');
  });

  it('writes the translated placeholder into an empty bold', async () => {
    const user = userEvent.setup();
    const textarea = renderHarness();

    await user.click(screen.getByRole('button', { name: 'markdown.bold' }));

    expect(textarea).toHaveValue('**markdown.boldPlaceholder**');
  });
});

// ============================================================================
// Keys, labels and the preview frame
// ============================================================================

describe('MarkdownEditor, more of it', () => {
  it('leaves the focus where it was unless asked to take it', () => {
    const textarea = renderHarness({ initial: 'hello' });

    expect(textarea).not.toHaveFocus();
  });

  it('keeps the keys it handles from reaching the page, and leaves the others alone', () => {
    const onEscape = vi.fn();
    const onSubmitShortcut = vi.fn();
    const textarea = renderHarness({ initial: 'x', onEscape, onSubmitShortcut });

    expect(fireEvent.keyDown(textarea, { key: 'Escape' })).toBe(false);
    expect(fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true })).toBe(true);
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onSubmitShortcut).toHaveBeenCalledTimes(1);
  });

  it('formats rather than submits on a shortcut that is not Enter', () => {
    const onSubmitShortcut = vi.fn();
    const textarea = renderHarness({ initial: 'x', onSubmitShortcut });
    textarea.setSelectionRange(0, 1);

    fireEvent.keyDown(textarea, { key: 'b', ctrlKey: true });

    expect(onSubmitShortcut).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('**x**');
  });

  it('keeps the selection when a toolbar button is pressed', () => {
    renderHarness();

    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'markdown.bold' }))).toBe(false);
  });

  it('labels the toolbar, the hint and the count, and ties them to the text area', () => {
    const textarea = renderHarness({ initial: 'abc' });

    expect(screen.getByRole('toolbar', { name: 'markdown.toolbar' })).toHaveAttribute('aria-controls', 'md');
    expect(screen.getByText('markdown.hint')).toHaveAttribute('id', 'md-hint');
    expect(screen.getByText('3/200')).toHaveAttribute('id', 'md-count');
    expect(textarea).toHaveAttribute('aria-describedby', 'md-hint md-count');
    expect(textarea).toHaveClass('min-h-32', 'resize-y', 'font-mono', 'text-sm', 'md:text-sm');
  });

  it('hides only the heading button on a phone', () => {
    renderHarness();

    expect(screen.getByRole('button', { name: 'markdown.heading' })).toHaveClass('max-md:hidden');
    for (const name of ['markdown.bold', 'markdown.italic', 'markdown.link', 'markdown.bulletList', 'markdown.numberedList', 'markdown.checklist']) {
      expect(screen.getByRole('button', { name }), name).not.toHaveClass('max-md:hidden');
    }
  });

  it('reports typing to the newest onChange', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<MarkdownEditor id="md" value="" onChange={first} maxLength={200} />, {
      withProviders: false,
    });
    rerender(<MarkdownEditor id="md" value="" onChange={second} maxLength={200} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a' } });

    expect(second).toHaveBeenCalledWith('a');
    expect(first).not.toHaveBeenCalled();
  });

  it('frames the preview, and mutes it for text that is only spaces', async () => {
    const user = userEvent.setup();
    renderHarness({ initial: '   ' });
    await user.click(screen.getByRole('tab', { name: 'markdown.preview' }));

    const empty = screen.getByText('markdown.nothingToPreview');
    expect(empty).toHaveClass('text-sm');
    expect(empty.parentElement).toHaveClass('min-h-32', 'rounded-md', 'border', 'border-input', 'px-3', 'py-2', 'text-muted-foreground');
  });

  it('does not mute a preview that has something to show', async () => {
    const user = userEvent.setup();
    renderHarness({ initial: ' word ' });
    await user.click(screen.getByRole('tab', { name: 'markdown.preview' }));

    const word = screen.getByText('word');
    expect(word.closest('.min-h-32')).not.toHaveClass('text-muted-foreground');
    expect(screen.queryByText('markdown.nothingToPreview')).not.toBeInTheDocument();
  });
});
