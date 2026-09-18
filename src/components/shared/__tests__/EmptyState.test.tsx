/**
 * Component tests for EmptyState
 *
 * Tests rendering of icon, title, description, action button,
 * and accessibility attributes.
 *
 * @module components/shared/__tests__/EmptyState.test
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Users, Package, Search } from 'lucide-react';

import { EmptyState } from '@/components/shared/EmptyState';

// ============================================================================
// Basic Rendering Tests
// ============================================================================

describe('EmptyState Basic Rendering', () => {
  it('renders title', () => {
    render(
      <EmptyState
        title="No items found"
        description="There are no items to display"
      />
    );

    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('renders description', () => {
    render(
      <EmptyState
        title="No items"
        description="Add some items to get started"
      />
    );

    expect(screen.getByText('Add some items to get started')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(
      <EmptyState
        icon={Users}
        title="No participants"
        description="Add people to the trip"
      />
    );

    // Icon should be rendered with aria-hidden
    const icon = document.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('does not render icon when not provided', () => {
    render(
      <EmptyState
        title="No items"
        description="Description text"
      />
    );

    const icon = document.querySelector('svg');
    expect(icon).not.toBeInTheDocument();
  });
});

// ============================================================================
// Action Button Tests
// ============================================================================

describe('EmptyState Action Button', () => {
  it('renders action button when provided', () => {
    const onClick = vi.fn();

    render(
      <EmptyState
        title="No items"
        description="Description"
        action={{
          label: 'Add Item',
          onClick,
        }}
      />
    );

    expect(screen.getByRole('button', { name: 'Add Item' })).toBeInTheDocument();
  });

  it('does not render action button when not provided', () => {
    render(
      <EmptyState
        title="No items"
        description="Description"
      />
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('calls onClick when action button clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <EmptyState
        title="No items"
        description="Description"
        action={{
          label: 'Add Item',
          onClick,
        }}
      />
    );

    const button = screen.getByRole('button', { name: 'Add Item' });
    await user.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders action button with correct label', () => {
    render(
      <EmptyState
        title="Empty"
        description="Nothing here"
        action={{
          label: 'Create New',
          onClick: vi.fn(),
        }}
      />
    );

    expect(screen.getByText('Create New')).toBeInTheDocument();
  });

  it('renders a secondary action beside the primary one', async () => {
    const user = userEvent.setup();
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();

    render(
      <EmptyState
        title="Empty"
        description="Nothing here"
        action={{ label: 'Add guests', onClick: onPrimary }}
        secondaryAction={{ label: 'Add rooms', onClick: onSecondary }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add rooms' }));

    expect(onSecondary).toHaveBeenCalledTimes(1);
    expect(onPrimary).not.toHaveBeenCalled();
  });

  it('renders the secondary action as the less prominent of the two', () => {
    render(
      <EmptyState
        title="Empty"
        description="Nothing here"
        action={{ label: 'Add guests', onClick: vi.fn() }}
        secondaryAction={{ label: 'Add rooms', onClick: vi.fn() }}
      />
    );

    expect(screen.getByRole('button', { name: 'Add guests' })).toHaveAttribute(
      'data-variant',
      'default',
    );
    expect(screen.getByRole('button', { name: 'Add rooms' })).toHaveAttribute(
      'data-variant',
      'outline',
    );
  });

  it('drops a secondary action that has no primary action to sit beside', () => {
    // The pair is styled as primary + outline; a lone outline button would read
    // as the weaker of two options with the other one missing.
    render(
      <EmptyState
        title="Empty"
        description="Nothing here"
        secondaryAction={{ label: 'Add rooms', onClick: vi.fn() }}
      />
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

// ============================================================================
// Styling Tests
// ============================================================================

describe('EmptyState Styling', () => {
  it('applies custom className', () => {
    render(
      <EmptyState
        title="Title"
        description="Description"
        className="custom-class"
      />
    );

    const section = screen.getByRole('status');
    expect(section).toHaveClass('custom-class');
  });

  it('has centered text alignment', () => {
    render(
      <EmptyState
        title="Title"
        description="Description"
      />
    );

    const section = screen.getByRole('status');
    expect(section).toHaveClass('text-center');
  });

  it('has flex column layout', () => {
    render(
      <EmptyState
        title="Title"
        description="Description"
      />
    );

    const section = screen.getByRole('status');
    expect(section).toHaveClass('flex');
    expect(section).toHaveClass('flex-col');
  });

  it('has max-width constraint', () => {
    render(
      <EmptyState
        title="Title"
        description="Description"
      />
    );

    const section = screen.getByRole('status');
    expect(section).toHaveClass('max-w-md');
  });
});

// ============================================================================
// Accessibility Tests
// ============================================================================

describe('EmptyState Accessibility', () => {
  it('has role="status"', () => {
    render(
      <EmptyState
        title="Title"
        description="Description"
      />
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has aria-live="polite"', () => {
    render(
      <EmptyState
        title="Title"
        description="Description"
      />
    );

    const section = screen.getByRole('status');
    expect(section).toHaveAttribute('aria-live', 'polite');
  });

  it('icon has aria-hidden="true"', () => {
    render(
      <EmptyState
        icon={Package}
        title="Title"
        description="Description"
      />
    );

    const icon = document.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('title uses a level-2 heading by default', () => {
    render(
      <EmptyState
        title="Empty State Title"
        description="Description"
      />
    );

    // Every caller renders directly under a page's `PageHeader`, which is the
    // `h1` — so `h2` is the level that keeps the outline unbroken. It used to
    // be a hardcoded `h3`, which skipped a level and is why `heading-order`
    // was switched off for the whole a11y suite.
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('Empty State Title');
  });

  it('renders the title at the requested heading level', () => {
    render(
      <EmptyState
        title="Nested Empty State"
        description="Description"
        headingLevel={3}
      />
    );

    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('Nested Empty State');
    expect(heading.tagName).toBe('H3');
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('supports level 4 for empty states two sections deep', () => {
    render(
      <EmptyState
        title="Deeply Nested"
        description="Description"
        headingLevel={4}
      />
    );

    expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('Deeply Nested');
  });

  it('keeps the heading styling regardless of level', () => {
    render(
      <EmptyState
        title="Styled"
        description="Description"
        headingLevel={4}
      />
    );

    expect(screen.getByRole('heading', { level: 4 })).toHaveClass('text-lg', 'font-semibold');
  });
});

// ============================================================================
// Different Icon Tests
// ============================================================================

describe('EmptyState Different Icons', () => {
  // All three of these used to assert the same thing — "an svg exists" — so
  // the component could have hardcoded one icon and ignored the prop. Lucide
  // stamps each glyph with its own `lucide-*` class, which is what tells them
  // apart.
  it('renders the icon it was handed, not a fixed one', () => {
    const { container, rerender } = render(
      <EmptyState icon={Users} title="No users" description="Add users" />
    );

    expect(container.querySelector('svg')).toHaveClass('lucide-users');

    rerender(
      <EmptyState icon={Package} title="No packages" description="Add packages" />
    );
    expect(container.querySelector('svg')).toHaveClass('lucide-package');

    rerender(
      <EmptyState icon={Search} title="No results" description="Try again" />
    );
    expect(container.querySelector('svg')).toHaveClass('lucide-search');
  });

  it('sizes every icon the same, whichever one is passed', () => {
    // Rendered across all three so a component that special-cased one glyph —
    // `Icon === Search ? 'size-12' : 'size-10'` — cannot pass.
    for (const icon of [Users, Package, Search]) {
      const { container, unmount } = render(
        <EmptyState icon={icon} title="No results" description="Try again" />
      );

      expect(container.querySelector('svg')).toHaveClass('size-12');
      unmount();
    }
  });
});

// ============================================================================
// Complete Example Tests
// ============================================================================

describe('EmptyState Complete Examples', () => {
  it('renders complete empty state with all props', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <EmptyState
        icon={Users}
        title="No participants"
        description="Add people who will participate in the trip"
        action={{
          label: 'Add participant',
          onClick,
        }}
        className="my-custom-class"
      />
    );

    // Check all elements are present
    expect(document.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText('No participants')).toBeInTheDocument();
    expect(screen.getByText('Add people who will participate in the trip')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add participant' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('my-custom-class');

    // Verify button works
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });

  it('renders minimal empty state', () => {
    render(
      <EmptyState
        title="Empty"
        description="Nothing here yet"
      />
    );

    expect(screen.getByText('Empty')).toBeInTheDocument();
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(document.querySelector('svg')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
