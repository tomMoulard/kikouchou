/**
 * Component tests for ConfirmDialog
 *
 * Tests dialog behavior, async handling, loading states,
 * variant styling, and accessibility.
 *
 * @module components/shared/__tests__/ConfirmDialog.test
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a delay promise for testing async behavior.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Basic Rendering Tests
// ============================================================================

describe('ConfirmDialog Basic Rendering', () => {
  it('renders dialog when open', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test Title"
        description="Test description"
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test description')).toBeInTheDocument();
  });

  it('does not render dialog when closed', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={false}
        onOpenChange={onOpenChange}
        title="Test Title"
        description="Test description"
        onConfirm={onConfirm}
      />
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders confirm and cancel buttons', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
      />
    );

    // Default labels from i18n mock
    expect(screen.getByRole('button', { name: 'common.confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeInTheDocument();
  });

  it('renders custom button labels', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        confirmLabel="Delete"
        cancelLabel="Keep"
      />
    );

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        className="custom-dialog"
      />
    );

    // The className is applied to DialogContent
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('custom-dialog');
  });
});

// ============================================================================
// Confirm Action Tests
// ============================================================================

describe('ConfirmDialog Confirm Action', () => {
  it('calls onConfirm when confirm button clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        confirmLabel="Confirm"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('closes dialog on successful confirm', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        confirmLabel="Confirm"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('stays open on confirm error for retry', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockRejectedValue(new Error('Failed'));

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        confirmLabel="Confirm"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    // Wait for the async operation
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalled();
    });

    // Should NOT close the dialog on error
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

// ============================================================================
// Cancel Action Tests
// ============================================================================

describe('ConfirmDialog Cancel Action', () => {
  it('calls onOpenChange(false) when cancel clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        cancelLabel="Cancel"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not call onConfirm when cancelled', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        cancelLabel="Cancel"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onConfirm).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Loading State Tests
// ============================================================================

describe('ConfirmDialog Loading State', () => {
  it('shows loading spinner during async confirm', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockImplementation(() => delay(100));

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        confirmLabel="Confirm"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    // Loading spinner should be visible (uses motion-safe:animate-spin for NFR12 compliance)
    const spinner = document.querySelector('.motion-safe\\:animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('disables buttons during loading', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockImplementation(() => delay(100));

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        confirmLabel="Confirm"
        cancelLabel="Cancel"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    // Both buttons should be disabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });
  });

  it('prevents close during loading', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockImplementation(() => delay(100));

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        confirmLabel="Confirm"
        cancelLabel="Cancel"
      />
    );

    // Start loading
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    // Try to cancel during loading
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);

    // Should not have called onOpenChange with false (cancel blocked during loading)
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('prevents double-click during loading', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockImplementation(() => delay(50));

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        confirmLabel="Confirm"
      />
    );

    const confirmButton = screen.getByRole('button', { name: 'Confirm' });

    // Click twice quickly
    await user.click(confirmButton);
    await user.click(confirmButton);

    // Should only call onConfirm once
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('resets loading state when dialog closes externally', async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockImplementation(() => delay(100));

    const { rerender } = render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        confirmLabel="Confirm"
      />
    );

    // Close dialog externally
    rerender(
      <ConfirmDialog
        open={false}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        confirmLabel="Confirm"
      />
    );

    // Reopen dialog
    rerender(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        confirmLabel="Confirm"
      />
    );

    // Confirm button should not be disabled (loading was reset)
    expect(screen.getByRole('button', { name: 'Confirm' })).not.toBeDisabled();
  });
});

// ============================================================================
// Variant Tests
// ============================================================================

describe('ConfirmDialog Variants', () => {
  it('uses default variant by default', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        confirmLabel="Confirm"
      />
    );

    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    // Default variant should not have destructive class
    expect(confirmButton).not.toHaveClass('bg-destructive');
  });

  it('applies destructive variant styling', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete?"
        description="This cannot be undone"
        onConfirm={onConfirm}
        confirmLabel="Delete"
        variant="destructive"
      />
    );

    const confirmButton = screen.getByRole('button', { name: 'Delete' });
    // Destructive variant should have destructive styling
    expect(confirmButton).toHaveClass('bg-destructive');
  });
});

// ============================================================================
// Accessibility Tests
// ============================================================================

describe('ConfirmDialog Accessibility', () => {
  it('has role="dialog"', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has accessible title', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Confirm Action"
        description="Are you sure?"
        onConfirm={onConfirm}
      />
    );

    // DialogTitle should be present
    expect(screen.getByText('Confirm Action')).toBeInTheDocument();
  });

  it('has accessible description', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="This action is permanent"
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByText('This action is permanent')).toBeInTheDocument();
  });

  it('loading spinner has aria-hidden', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockImplementation(() => delay(100));

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        confirmLabel="Confirm"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    const spinner = document.querySelector('.motion-safe\\:animate-spin');
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
  });
});

// ============================================================================
// Sync vs Async Confirm Tests
// ============================================================================

describe('ConfirmDialog Sync vs Async', () => {
  it('handles synchronous onConfirm', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn(); // Sync function

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        confirmLabel="Confirm"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onConfirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('handles async onConfirm that resolves', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        confirmLabel="Confirm"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('handles async onConfirm that rejects', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockRejectedValue(new Error('Error'));

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Test"
        description="Test"
        onConfirm={onConfirm}
        confirmLabel="Confirm"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    // Wait for async handling
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalled();
    });

    // Should NOT close on error
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
