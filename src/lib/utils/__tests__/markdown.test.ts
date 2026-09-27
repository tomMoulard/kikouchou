/**
 * @fileoverview Tests for the Markdown edit and plain-text helpers.
 *
 * @module lib/utils/__tests__/markdown.test
 */

import { describe, expect, it } from 'vitest';

import {
  type MarkdownEdit,
  applyMarkdownEdit,
  continueList,
  insertLink,
  markdownToPlainText,
  toggleLinePrefix,
  wrapSelection,
} from '@/lib/utils/markdown';

/** The text after an edit, and what it leaves selected. */
function run(value: string, edit: MarkdownEdit): { text: string; selected: string } {
  const text = applyMarkdownEdit(value, edit);
  return { text, selected: text.slice(edit.selectionStart, edit.selectionEnd) };
}

describe('wrapSelection', () => {
  it('wraps the selection and keeps it selected', () => {
    const value = 'bring towels';
    expect(run(value, wrapSelection(value, 6, 12, '**', 'bold'))).toEqual({
      text: 'bring **towels**',
      selected: 'towels',
    });
  });

  it('inserts the placeholder, selected, when nothing is selected', () => {
    expect(run('a ', wrapSelection('a ', 2, 2, '_', 'italic'))).toEqual({
      text: 'a _italic_',
      selected: 'italic',
    });
  });

  it('unwraps a selection already inside the marker', () => {
    const value = 'bring **towels**';
    expect(run(value, wrapSelection(value, 8, 14, '**', 'bold'))).toEqual({
      text: 'bring towels',
      selected: 'towels',
    });
  });
});

describe('toggleLinePrefix', () => {
  it('prefixes the line the caret is on', () => {
    const value = 'one\ntwo';
    const edit = toggleLinePrefix(value, 5, 5, 'bullet');
    expect(applyMarkdownEdit(value, edit)).toBe('one\n- two');
    // The caret moves with its text.
    expect(edit.selectionStart).toBe(7);
  });

  it('numbers every selected line and skips blank ones', () => {
    const value = 'a\n\nb';
    expect(applyMarkdownEdit(value, toggleLinePrefix(value, 0, 4, 'ordered'))).toBe(
      '1. a\n\n3. b',
    );
  });

  it('removes the prefix when every line already has it', () => {
    const value = '- [ ] milk\n- [x] eggs';
    expect(applyMarkdownEdit(value, toggleLinePrefix(value, 0, value.length, 'task'))).toBe(
      'milk\neggs',
    );
  });

  it('does not read a task item as a bullet', () => {
    const value = '- [ ] milk';
    expect(applyMarkdownEdit(value, toggleLinePrefix(value, 0, 0, 'bullet'))).toBe(
      '- - [ ] milk',
    );
  });

  it('toggles a heading on an empty text', () => {
    expect(applyMarkdownEdit('', toggleLinePrefix('', 0, 0, 'heading'))).toBe('## ');
    expect(applyMarkdownEdit('## Hi', toggleLinePrefix('## Hi', 0, 0, 'heading'))).toBe('Hi');
  });
});

describe('insertLink', () => {
  it('makes a selected word the label and selects the target', () => {
    const value = 'see tricount';
    expect(run(value, insertLink(value, 4, 12, 'link'))).toEqual({
      text: 'see [tricount](https://)',
      selected: 'https://',
    });
  });

  it('makes a selected URL the target and selects the label', () => {
    const value = 'https://tricount.com/abc';
    expect(run(value, insertLink(value, 0, value.length, 'link'))).toEqual({
      text: '[link](https://tricount.com/abc)',
      selected: 'link',
    });
  });

  it('uses the placeholder label with nothing selected', () => {
    expect(applyMarkdownEdit('', insertLink('', 0, 0, 'link'))).toBe('[link](https://)');
  });
});

describe('continueList', () => {
  it('returns null outside a list', () => {
    expect(continueList('just text', 9)).toBeNull();
  });

  it('continues a bullet list', () => {
    const value = '- milk';
    const edit = continueList(value, value.length);
    expect(edit && applyMarkdownEdit(value, edit)).toBe('- milk\n- ');
    expect(edit?.selectionStart).toBe(9);
  });

  it('numbers the next item and keeps the indent', () => {
    const value = '  3) third';
    const edit = continueList(value, value.length);
    expect(edit && applyMarkdownEdit(value, edit)).toBe('  3) third\n  4) ');
  });

  it('starts an unticked box after a task item', () => {
    const value = '- [x] milk';
    const edit = continueList(value, value.length);
    expect(edit && applyMarkdownEdit(value, edit)).toBe('- [x] milk\n- [ ] ');
  });

  it('ends the list on an empty item', () => {
    const value = '- milk\n- ';
    const edit = continueList(value, value.length);
    expect(edit && applyMarkdownEdit(value, edit)).toBe('- milk\n');
  });
});

describe('markdownToPlainText', () => {
  it('keeps the words and drops the syntax', () => {
    const markdown = [
      '## Arrival',
      '**Door code** is _1234_, see [the map](https://example.com).',
      '- [ ] towels',
      '1. `wifi`',
      '> quiet after 22h',
      '![photo](https://example.com/a.png) ~~old~~',
      '---',
    ].join('\n');

    expect(markdownToPlainText(markdown)).toBe(
      [
        'Arrival',
        'Door code is 1234, see the map.',
        'towels',
        'wifi',
        'quiet after 22h',
        'photo old',
      ].join('\n'),
    );
  });

  it('leaves snake_case words alone', () => {
    expect(markdownToPlainText('my_wifi_name')).toBe('my_wifi_name');
  });

  it('returns an empty string for whitespace', () => {
    expect(markdownToPlainText('   \n ')).toBe('');
  });
});
