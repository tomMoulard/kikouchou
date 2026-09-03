/**
 * Component tests for ConfirmDialog
 *
 * Tests dialog behavior, async handling, loading states,
 * variant styling, and accessibility.
 *
 * @module components/shared/__tests__/ConfirmDialog.test
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * One `userEvent` instance per describe, not one per test.
 *
 * `userEvent.setup()` was being called in all 13 interactive tests here, each
 * time re-attaching to the same jsdom `document` and re-stubbing the clipboard.
 * The default `delay: 0` is the more expensive half: user-event awaits a
 * macrotask between every synthetic event, so a single `click` — pointerover,
 * pointerenter, pointermove, pointerdown, mousedown, focus, pointerup, mouseup,
 * click — costs ten trips through the event loop, against Radix's portalled
 * alertdialog. `delay: null` fires them back to back; nothing in this component
 * depends on wall-clock spacing between the events of one click, only on React
 * having flushed, which user-event's `act` wrapper still guarantees.
 *
 * That mattered because this file was one of the five repeatedly reported as
 * "flaky" — it was not flaky, it was slow, and slow is what a 10s `testTimeout`
 * turns into a failure when the machine is loaded.
 */
function setupUser(): ReturnType<typeof userEvent.setup> {
  return userEvent.setup({ delay: null });
}

/**
 * An `onConfirm` result that never settles, for asserting on the loading state.
 *
 * Six tests here used a timed `delay(...)` and then asserted *during* that
 * window. That makes each assertion a race between a wall-clock timer and
 * however long jsdom takes to dispatch the events — fine on an idle laptop, and
 * a real failure on a busy one, which is how this file earned its reputation
 * for flakiness. `prevents double-click during loading` was the sharpest: once
 * 50ms elapsed between the two clicks the dialog had already closed, so the
 * second click genuinely did call `onConfirm` again, and the test was right to
 * fail.
 *
 * A promise that never settles removes time from the assertion entirely: the
 * dialog is loading until the test ends, so "while loading" means exactly that.
 * Two tests further down already used `new Promise(() => {})` for this; this is
 * the same idea with a name. Nothing needs to resolve it — the component is
 * unmounted by the global `cleanup()` in `afterEach`.
 */
function neverSettles(): Promise<void> {
  return new Promise<void>(() => {});
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

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
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

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
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

    // The className is applied to AlertDialogContent
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveClass('custom-dialog');
  });
});

// ============================================================================
// Confirm Action Tests
// ============================================================================

describe('ConfirmDialog Confirm Action', () => {
  const user = setupUser();

  it('calls onConfirm when confirm button clicked', async () => {
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
  const user = setupUser();

  it('calls onOpenChange(false) when cancel clicked', async () => {
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
  const user = setupUser();

  it('shows loading spinner during async confirm', async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockImplementation(neverSettles);

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
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockImplementation(neverSettles);

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
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockImplementation(neverSettles);

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
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockImplementation(neverSettles);

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
    const onConfirm = vi.fn().mockImplementation(neverSettles);

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
  const user = setupUser();

  it('has role="alertdialog", not the ordinary dialog role', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete this trip?"
        description="This cannot be undone"
        onConfirm={onConfirm}
      />
    );

    // A confirmation is an interruption a screen reader must announce as such.
    // `role="dialog"` announces "Delete this trip?" exactly like "Edit room".
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names and describes itself from the title and description', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete this trip?"
        description="This cannot be undone"
        onConfirm={onConfirm}
      />
    );

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAccessibleName('Delete this trip?');
    expect(dialog).toHaveAccessibleDescription('This cannot be undone');
  });

  it('opens with focus on the cancel button, not the destructive one', () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete this trip?"
        description="This cannot be undone"
        onConfirm={onConfirm}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
      />
    );

    // Radix focuses AlertDialogCancel on open. Without one it prevents its own
    // default focus and focuses nothing at all, which breaks the trap.
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
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
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockImplementation(neverSettles);

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
  const user = setupUser();

  it('handles synchronous onConfirm', async () => {
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

  it('guards handleConfirm when isLoading is true (fireEvent bypasses disabled)', async () => {
    const onConfirm = vi.fn().mockImplementation(neverSettles);
    const onOpenChange = vi.fn();

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

    // First click starts loading
    fireEvent.click(confirmButton);

    // Wait for loading state
    await waitFor(() => {
      expect(confirmButton).toBeDisabled();
    });

    // Second click via fireEvent bypasses disabled attribute, testing isLoading guard
    fireEvent.click(confirmButton);

    // onConfirm should only be called once due to the isLoading guard
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('guards handleOpenChange when isLoading is true (cancel during loading)', async () => {
    const onConfirm = vi.fn().mockImplementation(neverSettles);
    const onOpenChange = vi.fn();

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
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    });

    // Try cancel during loading via fireEvent
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // onOpenChange should not be called with false during loading
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
