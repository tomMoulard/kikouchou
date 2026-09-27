/**
 * @fileoverview Tests for the Markdown renderer: what it formats, and what it
 * refuses to render from somebody else's note.
 *
 * @module components/shared/__tests__/MarkdownText.test
 */

import { describe, expect, it } from 'vitest';

import { render, screen } from '@/test/utils';
import { MarkdownText } from '@/components/shared/MarkdownText';

function renderMarkdown(markdown: string): HTMLElement {
  const { container } = render(<MarkdownText>{markdown}</MarkdownText>, {
    withProviders: false,
  });
  return container;
}

describe('MarkdownText', () => {
  it('formats emphasis, lists and code', () => {
    const container = renderMarkdown('**bold** _it_ `code`\n\n- one\n- two\n\n3. three');

    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('it').tagName).toBe('EM');
    expect(screen.getByText('code').tagName).toBe('CODE');
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(container.querySelector('ol')).toHaveAttribute('start', '3');
  });

  it('demotes headings below the card title', () => {
    renderMarkdown('# Big\n\n### Small');
    expect(screen.getByRole('heading', { name: 'Big', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Small', level: 4 })).toBeInTheDocument();
  });

  it('opens a link in a new tab with no opener', () => {
    renderMarkdown('[Tricount](https://tricount.com/abc)');
    const link = screen.getByRole('link', { name: 'Tricount' });
    expect(link).toHaveAttribute('href', 'https://tricount.com/abc');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  });

  it('turns a bare URL into a link', () => {
    renderMarkdown('see https://example.com');
    expect(screen.getByRole('link', { name: 'https://example.com' })).toBeInTheDocument();
  });

  it('blanks a javascript: link', () => {
    renderMarkdown('[click](javascript:alert(1))');
    expect(screen.getByText('click').closest('a')?.getAttribute('href') ?? '').not.toMatch(
      /javascript/i,
    );
  });

  it('never renders raw HTML', () => {
    const container = renderMarkdown('<img src="x" onerror="alert(1)"><b>bold</b> text');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container).toHaveTextContent('text');
  });

  it('shows an image as a link and never fetches it', () => {
    const container = renderMarkdown('![the house](https://example.com/house.png)');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('link', { name: 'the house' })).toHaveAttribute(
      'href',
      'https://example.com/house.png',
    );
  });

  it('shows the alt text of an image with no source', () => {
    const container = renderMarkdown('![nothing]()');
    expect(container.querySelector('a')).toBeNull();
    expect(container).toHaveTextContent('nothing');
  });

  it('renders task boxes that cannot be ticked', () => {
    const container = renderMarkdown('- [x] milk\n- [ ] eggs');
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).toBeDisabled();
    expect(container.querySelector('ul')).toHaveClass('list-none');
  });

  it('renders quotes, rules, fenced code and tables', () => {
    const container = renderMarkdown(
      '> quiet\n\n---\n\n```\nwifi\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |',
    );
    expect(container.querySelector('blockquote')).toHaveTextContent('quiet');
    expect(container.querySelector('hr')).not.toBeNull();
    expect(container.querySelector('pre code')).toHaveTextContent('wifi');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'a' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '2' })).toBeInTheDocument();
  });
});
