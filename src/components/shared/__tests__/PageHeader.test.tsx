/**
 * @fileoverview Tests for the PageHeader component.
 * @module components/shared/__tests__/PageHeader.test
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/utils';
import { PageHeader } from '@/components/shared/PageHeader';

// ============================================================================
// Tests
// ============================================================================

describe('PageHeader', () => {
  it('renders the title as an h1', () => {
    render(<PageHeader title="Dashboard" />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Dashboard');
  });

  it('renders inside a header element', () => {
    render(<PageHeader title="Test" />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<PageHeader title="Settings" description="Manage preferences" />);
    expect(screen.getByText('Manage preferences')).toBeInTheDocument();
  });

  it('does not render description when omitted', () => {
    render(<PageHeader title="Settings" />);
    const paragraphs = document.querySelectorAll('p');
    expect(paragraphs).toHaveLength(0);
  });

  it('renders action slot when provided', () => {
    render(
      <PageHeader
        title="Page"
        action={<button type="button">Save</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('renders titleAccessory on the same line as the title', () => {
    render(
      <PageHeader
        title="My trips"
        titleAccessory={<span>List Map</span>}
      />,
    );
    expect(screen.getByText('List Map')).toBeInTheDocument();
  });

  it('does not render action wrapper when action is omitted', () => {
    const { container } = render(<PageHeader title="Page" />);
    // The action wrapper has class "shrink-0"
    expect(container.querySelector('.shrink-0')).toBeNull();
  });

  it('renders back link when backLink is provided', () => {
    render(<PageHeader title="Edit" backLink="/trips" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/trips');
    expect(link).toHaveTextContent('common.back');
  });

  it('does not render back link when backLink is omitted', () => {
    render(<PageHeader title="Home" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('applies additional className', () => {
    const { container } = render(<PageHeader title="Test" className="mt-8" />);
    const header = container.querySelector('header');
    expect(header?.className).toContain('mt-8');
  });
});

describe('PageHeader drawing', () => {
  it('spaces the header, and draws the back link as a quiet focusable link', () => {
    const { container } = render(<PageHeader title="Rooms" backLink="/trips" />);

    expect(container.querySelector('header')).toHaveClass('flex', 'flex-col', 'gap-4', 'pb-4', 'md:pb-6');
    const back = screen.getByRole('link', { name: 'common.back' });
    expect(back).toHaveAttribute('href', '/trips');
    expect(back).toHaveClass(
      'inline-flex', 'items-center', 'gap-1.5', 'text-sm', 'text-muted-foreground',
      'transition-colors', 'hover:text-foreground',
      'focus-visible:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-ring', 'focus-visible:ring-offset-2',
      'rounded-sm',
    );
    expect(back.querySelector('svg')).toHaveClass('size-4');
  });

  it('draws a clickable title as a plain, focusable button', () => {
    render(<PageHeader title="Rooms" onTitleClick={() => undefined} />);

    expect(screen.getByRole('button', { name: 'Rooms' })).toHaveClass(
      'rounded-sm', 'text-left',
      'focus-visible:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-ring', 'focus-visible:ring-offset-2',
    );
  });
});
