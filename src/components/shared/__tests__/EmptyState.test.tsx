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

  it('title uses heading element', () => {
    render(
      <EmptyState
        title="Empty State Title"
        description="Description"
      />
    );

    // Title should be an h3
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('Empty State Title');
  });
});

// ============================================================================
// Different Icon Tests
// ============================================================================

describe('EmptyState Different Icons', () => {
  it('renders Users icon', () => {
    const { container } = render(
      <EmptyState
        icon={Users}
        title="No users"
        description="Add users"
      />
    );

    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders Package icon', () => {
    const { container } = render(
      <EmptyState
        icon={Package}
        title="No packages"
        description="Add packages"
      />
    );

    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders Search icon', () => {
    const { container } = render(
      <EmptyState
        icon={Search}
        title="No results"
        description="Try different search"
      />
    );

    expect(container.querySelector('svg')).toBeInTheDocument();
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
